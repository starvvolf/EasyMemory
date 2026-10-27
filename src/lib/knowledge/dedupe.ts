// 같은 지식 찾기 3단계 (2026-10-28 결정: docs/DECISIONS.md "같은 지식 찾기: 임베딩").
//
//   1. 이름·별칭 비교 — at save time, in the store (sameAs): an exact match merges right away.
//   2. 임베딩 후보 — for each item that check did not catch, the 5 closest items by meaning (embed.ts).
//   3. AI 판정 — one model call for a batch of new items and their candidates: 같음 / 포함 / 관련 / 다름.
//      같음 → a "중복 의심" pair for the learner (합치기 or 다른 지식) — never merged automatically, not yet.
//      포함 · 관련 → a link (고리), which the learner can remove.
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
import { getKnowledge, linkKnowledge, mergeKnowledge, tree } from "./store.ts";

export type Verdict = "same" | "narrower" | "broader" | "related" | "different";
export type DupPair = { id: string; newId: string; otherId: string; verdict: Exclude<Verdict, "different">; reason: string; score: number; at: string;
  status: "open" | "merged" | "dismissed" | "linked" };
type DupFile = { checked: string[]; pairs: DupPair[] };

const BATCH = 25, CANDIDATES = 5, BATCHES_PER_RUN = 3, WAIT_MS = 4000, MAX_RELATED = 2;
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

const JUDGE_SYSTEM = `학습자의 지식 저장소에 새 지식이 들어왔다. 새 지식마다 뜻이 가까운 기존 지식 후보가 있다. 후보마다 관계를 하나 고른다.
- same: 같은 개념을 다른 말로 부른 것(이진 탐색 = 이분 탐색 = Binary Search, 깊이 우선 탐색 = DFS). 둘을 합쳐도 아무것도 잃지 않을 때만.
- narrower: 새 지식이 후보의 한 부분·하위 개념·특수한 경우(lower_bound는 이분 탐색의 하위).
- broader: 후보가 새 지식의 한 부분·하위 개념.
- related: 한쪽이 다른 쪽의 정의나 대표적인 방법에 직접 들어가는 사이만(다익스트라는 우선순위 큐를 쓴다, 구간 합은 누적 합으로 구한다). 학습자가 고리로 이어 두면 복습할 때 도움이 될 만큼 가까워야 한다.
- different: 그 밖의 모든 것. 관계가 약하거나("X의 시간 복잡도를 분석할 수 있다", "X에도 주의할 수 있다", "둘 다 순서를 쓴다"), 같은 과목일 뿐이거나, 반대·대비되는 개념(깊이 우선 탐색 ↔ 너비 우선 탐색, 기준금리 ↔ 시장금리).
대부분의 후보는 different다. 애매하면 same이 아니라 different를 고른다. 잘못 합치거나 억지로 잇는 것이 놓치는 것보다 나쁘다. 새 지식 하나에 related는 많아야 2개.
reason: 한국어 한 문장. n과 m은 받은 번호를 그대로 쓴다.`;
type Judged = { items: Array<{ n: number; candidates: Array<{ m: number; verdict: Verdict; reason: string }> }> };
const JUDGE_SCHEMA = S.obj({ items: S.arr(S.obj({ n: S.int, candidates: S.arr(S.obj({ m: S.int, verdict: S.oneOf("same", "narrower", "broader", "related", "different"), reason: S.str })) })) });

const line = (d: { item: { title: string; aliases: string[]; body: string }; path: string }) =>
  `${d.item.title}${d.item.aliases.length ? ` (다른 이름: ${d.item.aliases.slice(0, 5).join(", ")})` : ""} [${d.path || "폴더 없음"}] ${d.item.body.split("\n").find((l) => l.trim() && !l.startsWith("헷갈림:"))?.slice(0, 160) ?? "(뜻 없음)"}`;

/** One batch: candidates by meaning, one model call, then pairs and links. */
async function checkBatch(ids: string[], data: DupFile): Promise<DupPair[]> {
  const known = new Set(data.pairs.flatMap((p) => [`${p.newId}|${p.otherId}`, `${p.otherId}|${p.newId}`]));
  const work: Array<{ d: Awaited<ReturnType<typeof getKnowledge>>; cands: Array<{ d: Awaited<ReturnType<typeof getKnowledge>>; score: number }> }> = [];
  for (const id of ids) {
    const d = await getKnowledge(id).catch(() => null);
    if (!d) continue;
    const { hits } = await similarKnowledge({ id }, { limit: CANDIDATES });
    const cands = [];
    for (const h of hits) {
      if (h.linked || known.has(`${id}|${h.id}`)) continue;
      const c = await getKnowledge(h.id).catch(() => null);
      if (c) cands.push({ d: c, score: h.score });
    }
    if (cands.length) work.push({ d, cands });
  }
  if (!work.length) return [];
  const user = work.map((w, n) => `[새 지식 ${n}] ${line(w.d)}\n${w.cands.map((c, m) => `  후보 ${m}. ${line(c.d)}`).join("\n")}`).join("\n\n");
  const judged = await askJson<Judged>("knowledge:dedupe", JUDGE_SYSTEM, user, JUDGE_SCHEMA);
  const at = new Date().toISOString();
  const found: DupPair[] = [];
  for (const j of judged.items ?? []) {
    const w = work[j.n];
    if (!w) continue;
    let related = 0;
    for (const c of j.candidates ?? []) {
      const cand = w.cands[c.m];
      if (!cand || c.verdict === "different" || known.has(`${w.d.item.id}|${cand.d.item.id}`)) continue;
      // A few strong links are worth more than many weak ones: at most two 관련 per new item, closest first.
      if (c.verdict === "related" && ++related > MAX_RELATED) continue;
      known.add(`${w.d.item.id}|${cand.d.item.id}`); known.add(`${cand.d.item.id}|${w.d.item.id}`);
      const pair: DupPair = { id: `dup_${randomBytes(6).toString("hex")}`, newId: w.d.item.id, otherId: cand.d.item.id, verdict: c.verdict, reason: (c.reason ?? "").slice(0, 200),
        score: cand.score, at, status: c.verdict === "same" ? "open" : "linked" };
      // 포함: the broader one points to the narrower one; 관련: the new one points to the other.
      if (c.verdict === "narrower") await linkKnowledge(cand.d.item.id, w.d.item.id, "포함").catch(() => undefined);
      else if (c.verdict === "broader") await linkKnowledge(w.d.item.id, cand.d.item.id, "포함").catch(() => undefined);
      else if (c.verdict === "related") await linkKnowledge(w.d.item.id, cand.d.item.id, "관련").catch(() => undefined);
      found.push(pair);
    }
  }
  return found;
}

const state = globalThis as unknown as { __dedupeTimer?: ReturnType<typeof setTimeout>; __dedupeRunning?: Promise<unknown> };
/** Items not checked yet, newest first, a few batches; the rest wait for the next run. */
export async function runDuplicateCheck(options: { batches?: number } = {}) {
  if (state.__dedupeRunning) return state.__dedupeRunning as Promise<{ checked: number; found: number; left: number }>;
  const run = (async () => {
    const done = new Set((await read()).checked);
    const { items } = await tree();
    const todo = items.filter((i) => !done.has(i.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
