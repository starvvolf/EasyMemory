// 자료 지도의 [구조] (2026-11-07 사용자: lecture8 교착 상태를 공부하며 "목차 기준으로 정리돼 있는데, 목차는 유지하면서 뜻으로
// 재배치" → "지식 한 번에 여러 개 뽑은 다음 재편성하는 과정을 거치니까 그걸 이용" → "목차 그리고 구조 두 탭, 테라로 한번").
// 이미 만든 카드(자료 전체 정리까지 끝난 것)를 AI 한 번(terra low)으로 뜻 묶음의 나무로 다시 묶는다. 카드는 바꾸지 않는다.
//   넣는 것: 카드마다 번호·목차 자리·종류·핵심·한 줄·받음/냄, 후보 연결(받음→냄, 정리의 연결)
//   받는 것: 묶음 {id, name, parent, cards[번호], explain}, 묶음 사이 연결 {a, b, type, why}
// 코드가 검사한다: 카드는 한 묶음에만(겹치면 먼저 것, 빠진 카드는 "그 밖"), 부모 고리는 끊고, 빈 묶음은 뺀다, 연결 종류는 다섯 중 하나.
// 결과는 study-gen/<id>/structure.json에만 둔다(GenState는 그대로). 카드가 바뀌면(정리 다시) 화면이 "다시 만들기"를 띄운다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { askJson, S } from "../assist/model.ts";
import { withTrace } from "../ai/trace.ts";
import { cardLine, type Card } from "./gen/cards.ts";
import type { MaterialMap } from "./material-map.ts";

export const EDGE_TYPES = ["막음", "씀", "이어짐", "대비", "예시"] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];
export type StructGroup = { id: string; name: string; parent: string; cards: string[]; explain: string };
export type StructEdge = { a: string; b: string; type: EdgeType; why: string };
export type Structure = { at: string; ms: number; model: string; effort: string; sig: string; groups: StructGroup[]; edges: StructEdge[]; fixes: string[] };

const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");
const fileOf = (id: string) => { if (!/^gen_[a-z0-9]{8,64}$/.test(id)) throw Object.assign(new Error("자료 id가 올바르지 않아요."), { status: 400 }); return path.join(dataDir(), "study-gen", id, "structure.json"); };
/** Which cards the structure was made from: when the cards change, the screen offers to make it again. */
export const cardSig = (map: MaterialMap) => map.sections.flatMap((s) => s.cards.map((c) => c.id)).join(",");

export async function loadStructure(id: string): Promise<Structure | null> {
  try { return JSON.parse(await readFile(fileOf(id), "utf8")) as Structure; } catch { return null; }
}

// 고정 지시문은 앞(프롬프트 캐시), 자료마다 다른 것은 user에.
export const STRUCTURE_SYSTEM = `너는 강의 자료 한 편에서 뽑은 지식 카드들을 "구조"로 다시 묶는다.
목차는 자료가 쪽 순서로 보여 준 차례다. 구조는 뜻으로 본 차례다: 무엇이 무엇의 일부이고, 무엇이 무엇을 막거나 쓰고, 무엇이 무엇의 예인지.

묶음 만들기
- 묶음은 나무다. 맨 위 묶음은 자료가 다루는 큰 덩어리 2~4개(예: "그것이 무엇인가" 쪽과 "그것을 어떻게 다루나" 쪽). 깊이는 3단까지.
- 아래 묶음은 위 묶음의 한 부분이어야 한다(예: "발생 조건"은 "교착 상태"의 부분, "예방"은 "처리 방법"의 부분).
- 카드는 정확히 한 묶음에만 넣고, 모든 카드를 넣는다. 묶음 하나에 카드 1~6장. 카드가 없는 묶음은 아래 묶음이 있을 때만 둔다.
- 목차에서 떨어져 있던 카드라도 뜻이 같은 덩어리면 한 묶음에 넣는다(예: 정의 쪽의 조건 카드와 뒤쪽 예제의 같은 조건 카드).
- 이름: 자료의 말로 짧은 명사구. 목차 제목을 그대로 베끼지 말고, 그 묶음이 무엇인지가 보이게.
- [흐름] 표시 카드는 설명용 카드다. 그 내용이 맞는 묶음에 넣고, 그 묶음의 explain에 녹여 쓴다.
- explain: 이 묶음 안의 카드들이 어떻게 이어지는지(무엇을 받아 무엇을 정하는지) 한두 문장. 카드 내용을 되풀이하지 않는다.

연결 만들기 (묶음과 묶음 사이, 0~10개)
- type: 막음(a가 b의 조건 하나를 깨서 b를 막는다) · 씀(a의 결과를 b가 받아 쓴다) · 이어짐(a 다음에 b를 봐야 한다) · 대비(a와 b를 견준다) · 예시(b가 a의 예다)
- 부모·자식 사이는 연결로 잇지 않는다(나무가 이미 말한다). 후보 연결은 참고만 한다.
- why: 무엇이 무엇을, 15자 안팎.

id는 g1, g2 … 순서대로. parent는 맨 위면 빈 문자열.`;

const SCHEMA = S.obj({
  groups: S.arr(S.obj({ id: S.str, name: S.str, parent: S.str, cards: S.arr(S.int), explain: S.str })),
  edges: S.arr(S.obj({ a: S.str, b: S.str, type: S.oneOf(...EDGE_TYPES), why: S.str })),
});

/** The user part: cards numbered in outline order, then candidate links. Numbers keep the reply short (no long ids). */
export function structureInput(map: MaterialMap) {
  const cards = map.sections.flatMap((s) => s.cards.map((c) => ({ c, s })));
  const num = new Map(cards.map(({ c }, i) => [c.id, i + 1]));
  const lines = cards.map(({ c, s }, i) => {
    const flow = c.title.startsWith("흐름: ");
    const line = cardLine({ kind: c.kind, title: c.title, shape: c.shape, takes: c.takes, gives: c.gives } as Card).replace(/\s+/g, " ").slice(0, 260);
    return `${i + 1}|${s.title}|${c.core ? "핵심" : "보조"}${flow ? "|[흐름]" : ""}|${line}`;
  });
  const links = map.chains.filter((x) => num.has(x.from) && num.has(x.to)).slice(0, 80)
    .map((x) => `${num.get(x.from)}→${num.get(x.to)}|${x.by === "wording" ? "받음/냄" : x.by === "meaning" ? "정리" : "함께 묻기"}|${x.what.slice(0, 40)}`);
  const user = `자료: ${map.title}\n${map.topics?.length ? `큰 주제(자료 전체 정리): ${map.topics.join(" / ")}\n` : ""}\n카드 (번호|목차 자리|핵심·보조|카드)\n${lines.join("\n")}\n\n후보 연결 (앞→뒤|어디서|무엇)\n${links.join("\n") || "(없음)"}`;
  return { user, ids: cards.map(({ c }) => c.id) };
}

type Reply = { groups: Array<{ id: string; name: string; parent: string; cards: number[]; explain: string }>; edges: Array<{ a: string; b: string; type: string; why: string }> };
/** Code checks on the model's tree (exported for tests). `ids[n-1]` is card n. */
export function checkStructure(reply: Reply, ids: string[]): { groups: StructGroup[]; edges: StructEdge[]; fixes: string[] } {
  const fixes: string[] = [];
  const seenGroup = new Set<string>();
  const groups: StructGroup[] = [];
  const asked: Array<[StructGroup, number[]]> = [];
  for (const g of reply.groups ?? []) {
    const id = String(g.id ?? "").trim();
    if (!id || id === "g_rest" || seenGroup.has(id)) { fixes.push(`겹친 묶음 id ${id} 뺌`); continue; }
    seenGroup.add(id);
    const mine: StructGroup = { id, name: String(g.name ?? "").trim() || id, parent: String(g.parent ?? "").trim(), cards: [], explain: String(g.explain ?? "").trim() };
    groups.push(mine); asked.push([mine, g.cards ?? []]);
  }
  const byId = new Map(groups.map((g) => [g.id, g]));
  // 부모: 없는 묶음이면 맨 위로, 고리면 끊는다.
  for (const g of groups) if (g.parent && (!byId.has(g.parent) || g.parent === g.id)) { fixes.push(`${g.id}의 부모 ${g.parent} 없음 → 맨 위`); g.parent = ""; }
  for (const g of groups) {
    const path = new Set([g.id]);
    for (let at = byId.get(g.parent); at; at = byId.get(at.parent)) {
      if (path.has(at.id)) { fixes.push(`${g.id} 부모 고리 끊음`); g.parent = ""; break; }
      path.add(at.id);
    }
  }
  // 카드: 한 묶음에만.
  const placed = new Set<number>();
  for (const [mine, nums] of asked) {
    for (const n of nums) {
      if (!Number.isInteger(n) || n < 1 || n > ids.length) { fixes.push(`${mine.id}의 없는 카드 ${n} 뺌`); continue; }
      if (placed.has(n)) { fixes.push(`카드 ${n} 두 번 → 먼저 것`); continue; }
      placed.add(n); mine.cards.push(ids[n - 1]);
    }
  }
  const missing = ids.filter((_, i) => !placed.has(i + 1));
  if (missing.length) { fixes.push(`빠진 카드 ${missing.length}장 → 그 밖`); groups.push({ id: "g_rest", name: "그 밖", parent: "", cards: missing, explain: "" }); }
  // 빈 묶음(카드도 아래 묶음도 없음)은 뺀다, 아래에서부터.
  for (let changed = true; changed;) {
    changed = false;
    for (const g of [...groups]) if (!g.cards.length && !groups.some((x) => x.parent === g.id)) { groups.splice(groups.indexOf(g), 1); changed = true; }
  }
  const alive = new Set(groups.map((g) => g.id));
  const isAncestor = (a: string, b: string) => { for (let at = groups.find((g) => g.id === b)?.parent; at; at = groups.find((g) => g.id === at)?.parent) if (at === a) return true; return false; };
  const edgeSeen = new Set<string>();
  const edges: StructEdge[] = [];
  for (const e of reply.edges ?? []) {
    const a = String(e.a ?? "").trim(), b = String(e.b ?? "").trim(), type = e.type as EdgeType;
    if (!alive.has(a) || !alive.has(b) || a === b || !EDGE_TYPES.includes(type)) { fixes.push(`연결 ${a}→${b} 뺌`); continue; }
    if (isAncestor(a, b) || isAncestor(b, a)) { fixes.push(`부모·자식 연결 ${a}→${b} 뺌`); continue; }
    const key = `${a}>${b}>${type}`; if (edgeSeen.has(key)) continue; edgeSeen.add(key);
    edges.push({ a, b, type, why: String(e.why ?? "").trim().slice(0, 60) });
  }
  return { groups, edges, fixes };
}

export const STRUCTURE_MODEL = { model: "gpt-6.1-terra", effort: "low" };
/** One AI call (terra low, about 15 s). Fails when more than a third of the cards had to be put under 그 밖. */
export async function makeStructure(id: string, map: MaterialMap): Promise<Structure> {
  const { user, ids } = structureInput(map);
  if (ids.length < 3) throw Object.assign(new Error("카드가 너무 적어 구조를 만들 수 없어요."), { status: 422 });
  const t0 = Date.now();
  const reply = await withTrace({ area: "pdf", action: "structure", ref: id }, () =>
    askJson<Reply>("map:structure", STRUCTURE_SYSTEM, user, SCHEMA, STRUCTURE_MODEL));
  const checked = checkStructure(reply, ids);
  const rest = checked.groups.find((g) => g.id === "g_rest")?.cards.length ?? 0;
  if (rest > ids.length / 3) throw Object.assign(new Error(`AI가 카드 ${ids.length}장 중 ${rest}장을 묶지 못했어요. 다시 해 보세요.`), { status: 502 });
  const s: Structure = { at: new Date().toISOString(), ms: Date.now() - t0, ...STRUCTURE_MODEL, sig: cardSig(map), ...checked };
  const file = fileOf(id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(s, null, 1), "utf8");
  return s;
}
