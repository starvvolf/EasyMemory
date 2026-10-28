// 같은 지식 찾기 3단계 (2026-10-28 결정: docs/DECISIONS.md "같은 지식 찾기: 임베딩").
//
//   1. 이름·별칭 비교 — at save time, in the store (sameAs): an exact match merges right away.
//   2. 임베딩 후보 — for each item that check did not catch, the 5 closest items by meaning (embed.ts).
//   3. AI 판정 — one model call for a batch of new items and their candidates: 같음 / 포함 / 활용 / 선수 / 가까움 / 다름
//      (2026-10-28 고리 종류: 고리는 "학습에 쓸 수 있는 관계"만. SKOS의 상하·연관, 교육 연구의 선수 관계를 따름).
//      같음 → a "중복 의심" pair for the learner (합치기 or 다른 지식) — never merged automatically, not yet.
//      포함("포함") · 활용("씀") · 선수("먼저") → a link with a short 연결 문장 (note), which the learner can remove.
//      가까움 → no link, only listed as 가까운 지식 (해시 ↔ Map: close, but no clear direction).
//
// It runs a few seconds after saves that made new items (the store tells the listener the knowledge API registers),
// off the request, so saving never waits for the model. Every item is checked once; items from before this check
// existed are checked too, newest first, a few batches per run.
// File (STUDY_FORGE_DATA_DIR/knowledge/dupes.json): which items were checked, and the pairs found.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { askJson, S } from "../assist/model.ts";
import { similarKnowledge } from "./embed.ts";
import { getKnowledge, KIND_LABEL, linkKnowledge, mergeKnowledge, normalize, tree, unlinkKnowledge, type KKind } from "./store.ts";

// "related" is the old 관련 (before 2026-10-28 evening) and now only 어휘 비슷한 말.
export type Verdict = "same" | "narrower" | "broader" | "uses" | "used_by" | "requires" | "required_by" | "needs" | "needed_by" | "near" | "related" | "different";
const VERDICTS = ["same", "narrower", "broader", "uses", "used_by", "requires", "required_by", "needs", "needed_by", "near", "different"] as const;
/**
 * 고리 정의 두 가지 (2026-10-28 비교 중, 사용자 "B C 둘 다 테스트"):
 *   broad (B): 먼저 알기 = 이해하거나 제대로 쓰려면 먼저 알아야 함 (배우는 순서와 쓰는 조건을 하나로).
 *   split (C): 먼저 = 배우는 순서만, 조건 = 쓰려면 데이터·상황이 그 상태여야 함 (정렬 —조건→ 이분 탐색).
 * RECALLER_LINK_MODE=broad|split, default broad until the learner picks.
 */
export type LinkMode = "broad" | "split";
export const linkMode = (): LinkMode => (process.env.RECALLER_LINK_MODE?.trim() === "split" ? "split" : "broad");
const LABEL: Record<LinkMode, { needs: string; requires: string }> = { broad: { needs: "먼저 알기", requires: "먼저 알기" }, split: { needs: "먼저", requires: "조건" } };
export type DupPair = { id: string; newId: string; otherId: string; verdict: Exclude<Verdict, "different">; reason: string; score: number; at: string;
  note?: string; status: "open" | "merged" | "dismissed" | "linked" | "near" };
type DupFile = { checked: string[]; pairs: DupPair[] };

const BATCH = 25, CANDIDATES = 5, BATCHES_PER_RUN = 3, WAIT_MS = 4000, MAX_RELATED = 2, OTHER_FIELD_SCORE = 0.8;
const file = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "knowledge", "dupes.json");
async function read(): Promise<DupFile> {
  try { const d = JSON.parse(await readFile(file(), "utf8")) as Partial<DupFile>; return { checked: d.checked ?? [], pairs: d.pairs ?? [] }; }
  catch { return { checked: [], pairs: [] }; }
}
/** One read-modify-write of dupes.json at a time (the check and the learner's answers both write it). */
const lock = globalThis as unknown as { __dedupeFile?: Promise<unknown> };
function serialFile<T>(run: () => Promise<T>): Promise<T> {
  const next = (lock.__dedupeFile ?? Promise.resolve()).then(run, run);
  lock.__dedupeFile = next.catch(() => undefined);
  return next;
}
async function write(data: DupFile) {
  await mkdir(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 1), "utf8");
  await rename(tmp, file());
}

const JUDGE_HEAD = `학습자의 지식 저장소에 새 지식이 들어왔다. 새 지식마다 뜻이 가까운 기존 지식 후보가 있다. 후보마다 관계를 하나 고른다.
고리는 복습할 때 쓸모 있는 관계만 만든다("틀렸을 때 무엇을 다시 볼까", "아는 것을 어디에 쓸까"). 위에서부터 맞는 첫 번째를 고른다.
방향이 있는 관계는 "새 지식 → 후보" 쪽이면 앞의 것(uses, needs …), 반대면 _by 쪽을 고른다. 예시의 "새="와 "후보="를 잘 본다.
- same: 같은 개념을 다른 말로 부른 것(이진 탐색 = 이분 탐색 = Binary Search, 깊이 우선 탐색 = DFS). 둘을 합쳐도 아무것도 잃지 않을 때만.
- narrower: 새 지식이 후보의 한 종류·부분·특수한 경우(새=lower_bound, 후보=이분 탐색; 새=문자열 정렬, 후보=정렬). 원인·결과나 조건은 종류가 아니다(정수 오버플로는 정수 범위의 종류가 아님).
- broader: 후보가 새 지식의 한 종류·부분·특수한 경우(새=이분 탐색, 후보=lower_bound).
- uses: 새 지식이 후보를 부품·도구로 쓴다. 새 지식의 방법 안에 후보가 들어간다(새=다익스트라, 후보=우선순위 큐; 새=구간 합, 후보=누적 합 — 구간 합을 누적 합으로 구한다).
- used_by: 후보가 새 지식을 부품·도구로 쓴다(새=우선순위 큐, 후보=다익스트라; 새=그래프 최단 거리, 후보=다익스트라 — 최단 거리를 다익스트라로 구한다).`;
const JUDGE_PRE: Record<LinkMode, string> = {
  broad: `- needs: 새 지식을 이해하거나 제대로 쓰려면 후보를 먼저 알아야 한다. 배우는 순서든 쓰는 조건이든(새=이분 탐색, 후보=정렬 — 정렬된 상태여야 쓸 수 있다; 새=투영 행렬, 후보=행렬 곱셈). 어느 쪽이 먼저인지 분명할 때만.
- needed_by: 후보를 이해하거나 제대로 쓰려면 새 지식을 먼저 알아야 한다(새=정렬, 후보=이분 탐색).`,
  split: `- requires: 쓰는 조건. 새 지식을 쓰려면 데이터나 상황이 후보의 상태여야 한다(새=이분 탐색, 후보=정렬 — 정렬된 배열이어야 쓸 수 있다; 새=투 포인터, 후보=정렬).
- required_by: 후보를 쓰려면 데이터나 상황이 새 지식의 상태여야 한다(새=정렬, 후보=이분 탐색).
- needs: 배우는 순서. 새 지식을 설명하려면 후보의 뜻이 그대로 필요하다(새=투영 행렬, 후보=행렬 곱셈; 새=DFS, 후보=재귀; 새=정수 오버플로, 후보=정수 범위). 쓰는 조건이면 requires. 어느 쪽이 먼저인지 분명할 때만.
- needed_by: 후보를 설명하려면 새 지식의 뜻이 그대로 필요하다(새=재귀, 후보=DFS).`,
};
const JUDGE_TAIL: Record<LinkMode, string> = {
  broad: `- near: 뜻이 겹치거나 같은 문제에서 자주 같이 나오지만 위 관계와 방향이 분명하지 않다(해시 ↔ Map, 시간 복잡도 ↔ 시간 복잡도 분석). 고리는 만들지 않고 "가까운 지식"으로만 보인다.
- different: 그 밖의 모든 것. 관계가 약하거나("X의 시간 복잡도를 분석할 수 있다", "둘 다 순서를 쓴다"), 같은 과목일 뿐이거나, 반대·대비되는 개념(깊이 우선 탐색 ↔ 너비 우선 탐색, 기준금리 ↔ 시장금리).
대부분의 후보는 different다. 애매하면 same이 아니라 near나 different를 고른다. 잘못 합치거나 억지로 잇는 것이 놓치는 것보다 나쁘다. 새 지식 하나에 uses·used_by는 많아야 2개, needs·needed_by도 많아야 2개.
note: narrower·broader·uses·used_by·needs·needed_by면 두 지식이 어떻게 이어지는지 학습자가 읽을 한국어 한 문장, 40자 안쪽("누적 합으로 구간 합을 한 번에 구한다", "정렬된 배열이어야 이분 탐색을 쓸 수 있다"). 그 밖에는 빈 문자열 "".
n과 m은 받은 번호를 그대로 쓴다.`,
  split: `- near: 뜻이 겹치거나 같은 문제에서 자주 같이 나오지만 위 관계와 방향이 분명하지 않다(해시 ↔ Map, 시간 복잡도 ↔ 시간 복잡도 분석). 고리는 만들지 않고 "가까운 지식"으로만 보인다.
- different: 그 밖의 모든 것. 관계가 약하거나("X의 시간 복잡도를 분석할 수 있다", "둘 다 순서를 쓴다"), 같은 과목일 뿐이거나, 반대·대비되는 개념(깊이 우선 탐색 ↔ 너비 우선 탐색, 기준금리 ↔ 시장금리).
대부분의 후보는 different다. 애매하면 same이 아니라 near나 different를 고른다. 잘못 합치거나 억지로 잇는 것이 놓치는 것보다 나쁘다. 새 지식 하나에 uses·used_by, requires·required_by, needs·needed_by는 각각 많아야 2개.
note: narrower·broader·uses·used_by·requires·required_by·needs·needed_by면 두 지식이 어떻게 이어지는지 학습자가 읽을 한국어 한 문장, 40자 안쪽("누적 합으로 구간 합을 한 번에 구한다", "정렬된 배열이어야 이분 탐색을 쓸 수 있다"). 그 밖에는 빈 문자열 "".
n과 m은 받은 번호를 그대로 쓴다.`,
};
/** The judge's instructions for one link mode. B never offers requires (its 먼저 알기 covers 조건). */
const judgeSystem = (mode: LinkMode) => [JUDGE_HEAD, JUDGE_PRE[mode], JUDGE_TAIL[mode]].join("\n");
// 이유 (2026-10-28 사용자 결정): 평소에는 same만 이유를 쓴다(학습자가 합칠지 고르는 카드에 보임). 나머지 이유는 답만 길게 해
// 느려지므로 비운다. 고리가 이상하게 붙는 등 문제가 생겨 따져 볼 때만 RECALLER_DEDUPE_REASONS=all로 전부 쓰게 한다.
const REASON_SAME = "reason: same이면 왜 같은지 한국어 한 문장. same이 아니면 빈 문자열 \"\".";
const REASON_ALL = "reason: 한국어 한 문장.";
export const reasonMode = (): "same" | "all" => (process.env.RECALLER_DEDUPE_REASONS?.trim() === "all" ? "all" : "same");
type Judged = { items: Array<{ n: number; candidates: Array<{ m: number; verdict: Verdict; note: string; reason: string }> }> };
const schemaFor = (mode: LinkMode) => S.obj({ items: S.arr(S.obj({ n: S.int, candidates: S.arr(S.obj({ m: S.int,
  verdict: S.oneOf(...VERDICTS.filter((v) => mode === "split" || (v !== "requires" && v !== "required_by"))), note: S.str, reason: S.str })) })) });
const AUTO_RELATIONS = new Set(["포함", "관련", "씀", "먼저", "먼저 알기", "조건", "비슷한 말"]);
const LINKS = new Set<Verdict>(["narrower", "broader", "uses", "used_by", "requires", "required_by", "needs", "needed_by"]);

export type JudgeItem = { title: string; aliases: string[]; body: string; path: string; kind?: KKind };
const line = (d: JudgeItem) =>
  `${d.title}${d.aliases.length ? ` (다른 이름: ${d.aliases.slice(0, 5).join(", ")})` : ""} [${d.path || "폴더 없음"}${d.kind ? ` · ${KIND_LABEL[d.kind]}` : ""}] ${d.body.split("\n").find((l) => l.trim() && !l.startsWith("헷갈림:"))?.slice(0, 160) ?? "(뜻 없음)"}`;
const asJudgeItem = (d: Awaited<ReturnType<typeof getKnowledge>>): JudgeItem => ({ title: d.item.title, aliases: d.item.aliases, body: d.item.body, path: d.path, ...(d.item.kind ? { kind: d.item.kind } : {}) });
/** 어휘: two words with the same meaning are two things to learn (big, large) — never 같음, at most 비슷한 말 (관련). */
const vocabPair = (a: JudgeItem, b: JudgeItem) => (a.kind === "vocab" || b.kind === "vocab") && ![a.title, ...a.aliases].some((x) => [b.title, ...b.aliases].some((y) => normalize(x) === normalize(y)));

/** The model this check uses: RECALLER_DEDUPE_MODEL / _EFFORT, else the assist defaults (src/lib/assist/model.ts). */
const judgeModel = () => ({ model: process.env.RECALLER_DEDUPE_MODEL?.trim() || undefined, effort: process.env.RECALLER_DEDUPE_EFFORT?.trim() || undefined });
/**
 * 3단계 AI 판정 for a batch: each new item with its candidates (closest first) → one verdict per candidate, in order.
 * A candidate the model left out counts as "different"; past two 관련 per item, the rest are "different" too.
 * Exported for the evaluation (dedupe-eval.ts), which runs the same judgment with other models.
 */
export async function judgeBatch(work: Array<{ item: JudgeItem; cands: JudgeItem[] }>, options: { model?: string; effort?: string; reasons?: "same" | "all"; mode?: LinkMode } = judgeModel()) {
  const mode = options.mode ?? linkMode();
  const out = work.map((w) => w.cands.map(() => ({ verdict: "different" as Verdict, reason: "", note: "" })));
  if (!work.length) return out;
  const user = work.map((w, n) => `[새 지식 ${n}] ${line(w.item)}\n${w.cands.map((c, m) => `  후보 ${m}. ${line(c)}`).join("\n")}`).join("\n\n");
  const system = `${judgeSystem(mode)}\n${(options.reasons ?? reasonMode()) === "all" ? REASON_ALL : REASON_SAME}`;
  const judged = await askJson<Judged>("knowledge:dedupe", system, user, schemaFor(mode), { model: options.model, effort: options.effort });
  for (const j of judged.items ?? []) {
    if (!out[j.n]) continue;
    for (const c of j.candidates ?? []) if (out[j.n][c.m] && (VERDICTS as readonly string[]).includes(c.verdict)) {
      // 어휘: two words with the same meaning stay two items, joined as 비슷한 말.
      const sameWordsOnly = c.verdict === "same" && vocabPair(work[j.n].item, work[j.n].cands[c.m]);
      out[j.n][c.m] = { verdict: sameWordsOnly ? "related" : c.verdict, reason: (sameWordsOnly ? "뜻이 같은 다른 단어(비슷한 말)라 합치지 않아요. " : "") + (c.reason ?? "").slice(0, 200),
        note: LINKS.has(c.verdict) ? (c.note ?? "").trim().slice(0, 80) : "" };
    }
    // A few strong links are worth more than many weak ones: per new item at most two 활용 and two 선수, closest first;
    // the rest are only 가까움.
    const count: Record<string, number> = {};
    for (const v of out[j.n]) {
      const group = v.verdict.replace(/_by$/, "").replace(/^requires$|^required$/, "requires");
      if (["uses", "needs", "requires"].includes(group) && (count[group] = (count[group] ?? 0) + 1) > MAX_RELATED) { v.verdict = "near"; v.note = ""; }
    }
  }
  return out;
}

type Full = Awaited<ReturnType<typeof getKnowledge>>;
type Work = Array<{ d: Full; cands: Array<{ d: Full; score: number }> }>;
/**
 * Candidates for each item: the closest by meaning, same 주제 first. Pairs already answered are skipped, and so are
 * pairs already linked — unless `ignoreAuto`, when links this check made itself do not count (다시 판정·미리보기).
 */
async function gather(ids: string[], known: Set<string>, ignoreAuto = false): Promise<Work> {
  const work: Work = [];
  const rootOf = new Map((await tree()).folders.map((f) => [f.id, f] as const));
  const rootName = (folderId: string | null) => { let f = folderId ? rootOf.get(folderId) : undefined; let g = 0; while (f?.parentId && g++ < 20) f = rootOf.get(f.parentId); return f?.name ?? ""; };
  for (const id of ids) {
    const d = await getKnowledge(id).catch(() => null);
    if (!d) continue;
    // Candidates from the same 주제 (first level: CS, 경제, 어학 …) first; another field only when very close.
    const mine = d.path.split(" / ")[0] ?? "";
    const { hits: wide } = await similarKnowledge({ id }, { limit: CANDIDATES * 2 });
    const hits = wide.filter((h) => !mine || !rootName(h.folderId) || rootName(h.folderId) === mine || h.score >= OTHER_FIELD_SCORE).slice(0, CANDIDATES);
    const handLinked = (other: string) => [...d.links.filter((l) => l.item.id === other), ...d.backlinks.filter((l) => l.item.id === other)].some((l) => !AUTO_RELATIONS.has(l.relation));
    const cands = [];
    for (const h of hits) {
      if (known.has(`${id}|${h.id}`) || (h.linked && (!ignoreAuto || handLinked(h.id)))) continue;
      const c = await getKnowledge(h.id).catch(() => null);
      if (c) cands.push({ d: c, score: h.score });
    }
    if (cands.length) work.push({ d, cands });
  }
  return work;
}
type Planned = { pair: DupPair; link?: { from: string; to: string; relation: string; note: string } };
/** Verdicts → pairs and the links to make. Every link reads "A —관계→ B" (포함 from the broader, 씀 from the user, 먼저/조건 from the one to know first). */
function plan(work: Work, verdicts: Awaited<ReturnType<typeof judgeBatch>>, known: Set<string>, mode: LinkMode): Planned[] {
  const at = new Date().toISOString();
  const out: Planned[] = [];
  for (const [n, w] of work.entries()) for (const [m, cand] of w.cands.entries()) {
    const { verdict, reason, note } = verdicts[n][m];
    if (verdict === "different" || known.has(`${w.d.item.id}|${cand.d.item.id}`)) continue;
    known.add(`${w.d.item.id}|${cand.d.item.id}`); known.add(`${cand.d.item.id}|${w.d.item.id}`);
    const [a, b] = [w.d.item.id, cand.d.item.id];
    const L = LABEL[mode];
    const link = ({ narrower: [b, a, "포함"], broader: [a, b, "포함"], uses: [a, b, "씀"], used_by: [b, a, "씀"], requires: [b, a, L.requires], required_by: [a, b, L.requires],
      needs: [b, a, L.needs], needed_by: [a, b, L.needs], related: [a, b, "비슷한 말"] } as Partial<Record<Verdict, [string, string, string]>>)[verdict];
    out.push({ pair: { id: `dup_${randomBytes(6).toString("hex")}`, newId: a, otherId: b, verdict, reason, ...(note ? { note } : {}), score: cand.score, at,
      status: verdict === "same" ? "open" : verdict === "near" ? "near" : "linked" }, ...(link ? { link: { from: link[0], to: link[1], relation: link[2], note } } : {}) });
  }
  return out;
}

/** One batch: candidates by meaning, one model call, then pairs and links. */
async function checkBatch(ids: string[], data: DupFile): Promise<DupPair[]> {
  const known = new Set(data.pairs.flatMap((p) => [`${p.newId}|${p.otherId}`, `${p.otherId}|${p.newId}`]));
  const work = await gather(ids, known);
  if (!work.length) return [];
  const mode = linkMode();
  const planned = plan(work, await judgeBatch(work.map((w) => ({ item: asJudgeItem(w.d), cands: w.cands.map((c) => asJudgeItem(c.d)) })), { ...judgeModel(), mode }), known, mode);
  for (const p of planned) if (p.link) await linkKnowledge(p.link.from, p.link.to, p.link.relation, p.link.note).catch(() => undefined);
  return planned.map((p) => p.pair);
}

const PRE = new Set(["먼저", "먼저 알기", "조건"]);
/**
 * 군더더기 고리 빼기: A —먼저→ Y is not needed when A —먼저→ Z and Z —포함→ Y already say it (정렬 → 이분 탐색 → lower_bound).
 * Works on a list of links; returns the ones to drop.
 */
export function impliedLinks(links: Array<{ from: string; to: string; relation: string }>) {
  const has = (from: string, to: string, rel: (r: string) => boolean) => links.some((l) => l.from === from && l.to === to && rel(l.relation));
  return links.filter((l) => PRE.has(l.relation) && links.some((z) => z.from === l.from && PRE.has(z.relation) && z.to !== l.to && has(z.to, l.to, (r) => r === "포함")));
}
async function pruneImplied() {
  const { items } = await tree();
  const full = await Promise.all(items.map((i) => getKnowledge(i.id).then((d) => d.item)));
  const links = full.flatMap((i) => i.links.map((l) => ({ from: i.id, to: l.to, relation: l.relation })));
  for (const l of impliedLinks(links)) await unlinkKnowledge(l.from, l.to).catch(() => undefined);
}
const state = globalThis as unknown as { __dedupeTimer?: ReturnType<typeof setTimeout>; __dedupeRunning?: Promise<unknown> };
/** Items not checked yet, newest first, a few batches; the rest wait for the next run. */
export async function runDuplicateCheck(options: { batches?: number } = {}) {
  if (state.__dedupeRunning) return state.__dedupeRunning as Promise<{ checked: number; found: number; left: number }>;
  const run = (async () => {
    const done = new Set((await read()).checked);
    const { items } = await tree();
    // Only items already sorted into a 주제 (classify.ts runs first), so candidates can be taken from the same field.
    const todo = items.filter((i) => !done.has(i.id) && i.kind).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    let checked = 0, found = 0;
    for (let b = 0; b < (options.batches ?? BATCHES_PER_RUN) && checked < todo.length; b++) {
      const ids = todo.slice(checked, checked + BATCH).map((i) => i.id);
      const pairs = await checkBatch(ids, await read());
      checked += ids.length; found += pairs.length;
      await serialFile(async () => {
        const fresh = await read();
        const live = new Set((await tree()).items.map((i) => i.id));
        fresh.pairs.push(...pairs);
        // Only ids still alive stay in the record.
        fresh.checked = [...new Set([...fresh.checked, ...ids])].filter((id) => live.has(id));
        await write(fresh);
      });
    }
    if (found) await pruneImplied();
    return { checked, found, left: todo.length - checked };
  })();
  state.__dedupeRunning = run.finally(() => { state.__dedupeRunning = undefined; });
  return run;
}
/** Called after saves that made new items: wait a little (more may be coming), then check. */
export function scheduleDuplicateCheck() {
  if (process.env.RECALLER_DEDUPE === "off") return;
  if (state.__dedupeTimer) clearTimeout(state.__dedupeTimer);
  state.__dedupeTimer = setTimeout(() => { state.__dedupeTimer = undefined; void runDuplicateCheck().catch((e) => console.warn("[knowledge:dedupe]", e instanceof Error ? e.message : e)); }, WAIT_MS);
}

/** 가까운 지식: items the judge found close to this one without a clear link (가까움), still there. */
export async function nearOf(id: string) {
  const data = await read();
  const ids = [...new Set(data.pairs.filter((p) => p.status === "near" && (p.newId === id || p.otherId === id)).map((p) => (p.newId === id ? p.otherId : p.newId)))];
  const { items } = await tree();
  return ids.flatMap((x) => { const i = items.find((y) => y.id === x); return i ? [{ id: i.id, title: i.title, line: i.line }] : []; });
}


/**
 * 고리 다시 판정 (2026-10-28, 고리 종류를 바꾸면서): the links this check made earlier are taken off, their pairs and the
 * 가까움 pairs are forgotten, and every item is checked again with the current rules. Pairs the learner answered (합치기,
 * 다른 지식) and open 같음 pairs stay; links the learner or a PDF made are not touched.
 */
export async function rejudgeLinks(options: { batches?: number } = {}) {
  await serialFile(async () => {
    const data = await read();
    for (const p of data.pairs.filter((x) => x.status === "linked")) {
      for (const [from, to] of [[p.newId, p.otherId], [p.otherId, p.newId]]) {
        const d = await getKnowledge(from).catch(() => null);
        if (d?.item.links.some((l) => l.to === to && AUTO_RELATIONS.has(l.relation))) await unlinkKnowledge(from, to).catch(() => undefined);
      }
    }
    data.pairs = data.pairs.filter((x) => x.status !== "linked" && x.status !== "near");
    data.checked = [];
    await write(data);
  });
  return runDuplicateCheck({ batches: options.batches ?? 20 });
}

/**
 * 고리 미리보기: what 다시 판정 would make with a link mode, without changing anything (to compare B and C on real data).
 * One model call per 25 items.
 */
export async function previewLinks(mode: LinkMode) {
  const started = Date.now();
  const data = await read();
  const known = new Set(data.pairs.filter((p) => p.status !== "linked" && p.status !== "near").flatMap((p) => [`${p.newId}|${p.otherId}`, `${p.otherId}|${p.newId}`]));
  const { items } = await tree();
  const ids = items.filter((i) => i.kind).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((i) => i.id);
  const planned: Planned[] = [];
  let calls = 0;
  for (let k = 0; k < ids.length; k += BATCH) {
    const work = await gather(ids.slice(k, k + BATCH), known, true);
    if (!work.length) continue;
    calls++;
    planned.push(...plan(work, await judgeBatch(work.map((w) => ({ item: asJudgeItem(w.d), cands: w.cands.map((c) => asJudgeItem(c.d)) })), { ...judgeModel(), mode }), known, mode));
  }
  const title = new Map(items.map((i) => [i.id, i.title]));
  const links = planned.flatMap((p) => (p.link ? [p.link] : []));
  const dropped = new Set(impliedLinks(links));
  return { mode, calls, seconds: Math.round((Date.now() - started) / 1000),
    links: links.filter((l) => !dropped.has(l)).map((l) => ({ from: title.get(l.from), relation: l.relation, to: title.get(l.to), note: l.note })),
    dropped: [...dropped].map((l) => `${title.get(l.from)} —${l.relation}→ ${title.get(l.to)}`),
    near: planned.filter((p) => p.pair.verdict === "near").map((p) => `${title.get(p.pair.newId)} ~ ${title.get(p.pair.otherId)}`),
    same: planned.filter((p) => p.pair.verdict === "same").map((p) => `${title.get(p.pair.newId)} = ${title.get(p.pair.otherId)}`) };
}

/** For the 점검 보고서: which items were checked, and every pair the check found (any status). */
export async function dupeStatus() { return read(); }
export type DupView = DupPair & { newTitle: string; newLine: string; otherTitle: string; otherLine: string };
/** 중복 의심: open pairs whose two items still exist, newest first. */
export async function openDuplicates(): Promise<DupView[]> {
  const data = await read();
  const { items } = await tree();
  const byId = new Map(items.map((i) => [i.id, i]));
  return data.pairs.filter((p) => p.status === "open" && byId.has(p.newId) && byId.has(p.otherId)).reverse().map((p) => ({ ...p,
    newTitle: byId.get(p.newId)!.title, newLine: byId.get(p.newId)!.line, otherTitle: byId.get(p.otherId)!.title, otherLine: byId.get(p.otherId)!.line }));
}
/** The learner's answer on a pair: 합치기 (into the one they keep, the older by default) or 다른 지식. */
export async function resolveDuplicate(pairId: string, action: "merge" | "dismiss", keepId?: string) {
  return serialFile(async () => {
    const data = await read();
    const pair = data.pairs.find((p) => p.id === pairId);
    if (!pair) throw new Error("중복 의심 항목을 찾을 수 없어요.");
    if (action === "merge") {
      const keep = keepId === pair.newId ? pair.newId : pair.otherId;
      await mergeKnowledge(keep, keep === pair.newId ? pair.otherId : pair.newId);
      pair.status = "merged";
    } else pair.status = "dismissed";
    await write(data);
    return pair;
  });
}
