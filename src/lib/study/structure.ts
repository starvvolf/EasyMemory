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
// 3차 (11/8 사용자 "예방·회피·탐지와 회복·자원 할당 그래프는 더 큰 개념인데 안의 카드와 나란히 있다, 안전 ↔ 불안전은 대비, 발생 조건 넷은
// 모두 성립해야 — 위와 아래, 레벨을 나눠서"): 묶음마다 대표 카드(head, 그 묶음이 가리키는 개념 자체), 안의 것이 대표와 맺는 관계(members),
// 견주는 카드 쌍(versus)을 더 받는다.
export const MEMBER_KINDS = ["부분", "종류", "모두", "순서", "묶음"] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number];
// 메인·바탕·곁 (11/9 사용자 "구조 묶을 때 쉬운 설명으로 메인 포인트를 잡게 — 기울기·절편 방정식이 메인은 아니잖아, 사전에 알아야 하는 지식을
// 다시 적어 놓은 느낌"): 묶음마다 이 강의에서 맡는 몫을 고르고, 메인 묶음 안에 섞인 바탕 카드는 base로 따로 받는다.
export const ROLES = ["메인", "바탕", "곁"] as const;
export type GroupRole = (typeof ROLES)[number];
export type StructGroup = { id: string; name: string; parent: string; head?: string; cards: string[]; members?: MemberKind; explain: string; role?: GroupRole;
  /** 차례로 세운 단계(11/8 큰 상자 다시 정리): 앞 단계에서 이어받는 것 한 줄 */ link?: string };
export type StructVersus = { a: string; b: string; on: string };
export type StructEdge = { a: string; b: string; type: EdgeType; why: string };
export type StructPair = { a: string; b: string; why: string };
export type BoxNote = { box: string; name: string; mode: string; reason: string; ms: number; ok: boolean };
export type Structure = { at: string; ms: number; model: string; effort: string; sig: string;
  /** 무엇을 묶었나: 카드(예전) 또는 줄기의 기억(11/9 "구조는 줄기 기반으로") — memory면 cards·head·짝은 기억 id(m1…) */ unit?: "card" | "memory"; boxes?: BoxNote[]; groups: StructGroup[]; edges: StructEdge[]; pairs: StructPair[]; versus?: StructVersus[];
  /** 메인 묶음 안에 있지만 바탕(미리 알아야 할 것을 다시 적은) 카드 */ base?: string[]; fixes: string[] };

const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");
const fileOf = (id: string) => { if (!/^gen_[a-z0-9]{8,64}$/.test(id)) throw Object.assign(new Error("자료 id가 올바르지 않아요."), { status: 400 }); return path.join(dataDir(), "study-gen", id, "structure.json"); };
/** Which cards the structure was made from: when the cards change, the screen offers to make it again. */
export const cardSig = (map: MaterialMap) => map.sections.flatMap((s) => s.cards.map((c) => c.id)).join(",");

export async function loadStructure(id: string): Promise<Structure | null> {
  try { return JSON.parse(await readFile(fileOf(id), "utf8")) as Structure; } catch { return null; }
}

// 고정 지시문은 앞(프롬프트 캐시), 자료마다 다른 것은 user에.
// 2차 (11/7 사용자 "목차와 거의 같고 위에서 아래로 내리는 느낌 — 집합으로, 가까운 것·먼 것, 조건이 발생 조건과 예방에 두 번 나오는 연계까지"):
// 목차를 따르지 말 것, 3단까지 뜻으로 쪼갤 것, 이웃 순서, 카드끼리 짝(pairs)을 더 받는다. 흐름 카드는 넣지 않는다(카드 만들 때만 쓰는 것).
export const STRUCTURE_SYSTEM = `너는 강의 자료 한 편에서 뽑은 지식 카드들을 "구조"로 다시 묶는다. 학습자가 이 구조를 집합 그림(큰 상자 안에 작은 상자)으로 본다.
목차는 자료가 쪽 순서로 보여 준 차례다. 구조는 뜻으로 본 차례다: 무엇이 무엇의 부분이고, 무엇이 더 큰 개념이고, 무엇과 무엇을 견주는지.
목차 순서를 그대로 따르면 실패다. 쪽 순서가 아니라 "이것은 저것의 한 갈래다"로 묶는다.

묶음 만들기
- 묶음은 나무다. 맨 위 묶음은 2~3개: 자료의 중심 대상 자체(무엇인가·어떻게 생기나·어떻게 나타내나)와 그것을 다루는 쪽(어떻게 다루나) 같은 큰 갈래.
- 맨 위 묶음 아래를 다시 갈래로 나눈다. 셋 이상의 방법·종류가 있으면 그 사이에도 공통점으로 한 단을 더 둔다
  (예: "다루는 방법" 아래 "일어나기 전에"(막기, 피하기)와 "일어난 뒤에"(찾기, 되돌리기)). 깊이는 3단까지.
- 같은 부모 아래 묶음은 가까운 것끼리 이웃하게 순서를 정한다(서로 견주는 것, 앞의 결과를 쓰는 것이 옆에).
- 카드는 정확히 한 곳(어느 묶음의 head 또는 cards)에만 넣고, 모든 카드를 넣는다. 카드가 없는 묶음은 아래 묶음이 있을 때만 둔다.
- 다른 쪽에 떨어져 있던 카드라도 같은 갈래면 한 묶음에 넣는다.
- 이름: 자료의 말로 짧은 명사구(2~8자 안팎). 목차 제목을 베끼지 않는다.
- explain: 이 묶음이 위 묶음 안에서 맡는 몫을 한 문장. 카드 내용을 되풀이하지 않는다.

대표 카드 (head) — 큰 개념과 작은 개념을 나누는 일
- 묶음이 가리키는 개념 그 자체를 정의하는 카드가 있으면 그 묶음의 head다(예: 묶음 "막기" ↔ 카드 "막기(Prevention): 조건 하나를 깨서…"). head는 cards에 넣지 않는다. 없으면 0.
- 더 큰 개념의 카드는 더 큰 묶음의 head다. 두 하위 묶음을 아우르는 카드(예: "찾기와 되돌리기" 정의 카드)는 하위 묶음("찾기") 안이 아니라 둘의 부모 묶음 head다.
- "이것들이 모두 성립해야 한다" 같이 안의 카드들을 한데 말하는 카드는 그 카드들이 든 묶음의 head다. 자료의 중심 대상을 정의하는 카드는 맨 위 묶음의 head다.
- 전체(그래프·모형)와 그 부분(간선·정점)이 함께 있으면 전체 카드가 head, 부분 카드가 cards다.

안의 것과 대표의 관계 (members): 이 묶음의 cards와 하위 묶음이 head(또는 묶음 이름)와 맺는 관계 하나
- 부분(head를 이루는 것) · 종류(head의 갈래들) · 모두(모두 성립해야 head가 된다) · 순서(차례로 일어나거나 한다) · 묶음(그 밖, 관계가 뚜렷하지 않음)

묶음 사이 연결 (edges, 0~10개)
- type: 막음(a가 b의 조건을 깨서 b를 막는다) · 씀(a의 결과를 b가 받아 쓴다) · 이어짐(a 다음에 b) · 대비(a와 b를 견준다) · 예시(b가 a의 예다)
- 부모·자식 사이는 잇지 않는다(상자가 이미 말한다). why: 15자 안팎.

견주는 카드 (versus, 0~8개)
- 둘을 나란히 놓고 견주어야 뜻이 서는 카드 쌍: 반대 상태(켜짐 ↔ 꺼짐), 경우 나누기(하나일 때 ↔ 여러 개일 때), 같은 일의 두 방법. 같은 묶음 안이면 더 좋다.
- a·b는 카드 번호. on: 무엇을 기준으로 견주는지 8자 안팎.

카드끼리 짝 (pairs, 0~15개)
- 서로 다른 묶음에 있는 두 카드가 같은 것의 두 모습일 때: 조건 ↔ 그 조건을 깨는 방법, 정의 ↔ 그것으로 하는 판정, 판정 ↔ 그 판정을 다시 쓰는 곳.
- a·b는 카드 번호. why: 무엇으로 이어지는지 12자 안팎. 후보 연결은 참고만 한다.

이 강의에서 맡는 몫 (role) — 메인 포인트 잡기
- 쉽게 말해, 이 강의를 듣고 나서 "오늘 새로 배운 것"이 메인이다. 강의 제목이 약속하는 것, 시험에 이 강의 몫으로 나올 것.
- 바탕: 이 강의 전에 이미 알고 와야 하는 것을 다시 적어 둔 것. 앞 과목·앞 강의에서 배운 정의·공식·기호를 떠올려 주려고 적은 것
  (예: 선 그리기 강의의 "기울기·절편 직선 방정식", 운영체제 강의의 "프로세스란"). 강의가 그 위에서 새것을 쌓으면, 그 밑돌은 바탕이다.
- 곁: 메인을 돕지만 없어도 되는 것. 역사·배경·사례·제품 이름·덧붙인 이야기.
- 묶음마다 role을 하나 고른다. 맨 위 묶음만이 아니라 아래 묶음도 따로 고른다(메인 안에 바탕 하위 묶음이 있을 수 있다). 메인은 보통 전체의 절반 안팎이다.
- base: 메인 묶음에 들어 있지만 그 카드만 보면 바탕인 카드 번호(0~15개). 따로 묶음을 만들 만큼 많지 않을 때 쓴다.

id는 g1, g2 … 순서대로. parent는 맨 위면 빈 문자열.`;

const SCHEMA = S.obj({
  groups: S.arr(S.obj({ id: S.str, name: S.str, parent: S.str, head: S.int, cards: S.arr(S.int), members: S.oneOf(...MEMBER_KINDS), role: S.oneOf(...ROLES), explain: S.str })),
  base: S.arr(S.int),
  edges: S.arr(S.obj({ a: S.str, b: S.str, type: S.oneOf(...EDGE_TYPES), why: S.str })),
  versus: S.arr(S.obj({ a: S.int, b: S.int, on: S.str })),
  pairs: S.arr(S.obj({ a: S.int, b: S.int, why: S.str })),
});

/** The user part: cards numbered in outline order, then candidate links. Numbers keep the reply short (no long ids). */
export function structureInput(map: MaterialMap) {
  const cards = map.sections.flatMap((s) => s.cards.filter((c) => !c.title.startsWith("흐름: ")).map((c) => ({ c, s })));
  const num = new Map(cards.map(({ c }, i) => [c.id, i + 1]));
  const lines = cards.map(({ c, s }, i) => {
    const line = cardLine({ kind: c.kind, title: c.title, shape: c.shape, takes: c.takes, gives: c.gives } as Card).replace(/\s+/g, " ").slice(0, 260);
    return `${i + 1}|${s.title}|${c.core ? "핵심" : "보조"}|${line}`;
  });
  const links = map.chains.filter((x) => num.has(x.from) && num.has(x.to)).slice(0, 80)
    .map((x) => `${num.get(x.from)}→${num.get(x.to)}|${x.by === "wording" ? "받음/냄" : x.by === "meaning" ? "정리" : "함께 묻기"}|${x.what.slice(0, 40)}`);
  const user = `자료: ${map.title}\n${map.topics?.length ? `큰 주제(자료 전체 정리): ${map.topics.join(" / ")}\n` : ""}\n카드 (번호|나온 곳(목차)|핵심·보조|카드)\n${lines.join("\n")}\n\n후보 연결 (앞→뒤|어디서|무엇)\n${links.join("\n") || "(없음)"}`;
  return { user, ids: cards.map(({ c }) => c.id) };
}

type Reply = { base?: number[]; groups: Array<{ id: string; name: string; parent: string; head?: number; cards: number[]; members?: string; role?: string; explain: string }>; versus?: Array<{ a: number; b: number; on: string }>; edges: Array<{ a: string; b: string; type: string; why: string }>; pairs?: Array<{ a: number; b: number; why: string }> };
/** Code checks on the model's tree (exported for tests). `ids[n-1]` is card n. */
export function checkStructure(reply: Reply, ids: string[]): { groups: StructGroup[]; edges: StructEdge[]; pairs: StructPair[]; versus: StructVersus[]; base: string[]; fixes: string[] } {
  const fixes: string[] = [];
  const seenGroup = new Set<string>();
  const groups: StructGroup[] = [];
  const asked: Array<[StructGroup, number[], number]> = [];
  for (const g of reply.groups ?? []) {
    const id = String(g.id ?? "").trim();
    if (!id || id === "g_rest" || seenGroup.has(id)) { fixes.push(`겹친 묶음 id ${id} 뺌`); continue; }
    seenGroup.add(id);
    const mine: StructGroup = { id, name: String(g.name ?? "").trim() || id, parent: String(g.parent ?? "").trim(), cards: [], explain: String(g.explain ?? "").trim(),
      ...(MEMBER_KINDS.includes(g.members as MemberKind) ? { members: g.members as MemberKind } : {}), ...(ROLES.includes(g.role as GroupRole) ? { role: g.role as GroupRole } : {}) };
    groups.push(mine); asked.push([mine, g.cards ?? [], Number(g.head) || 0]);
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
  // 대표 카드가 먼저: 다른 묶음의 cards에도 들어 있으면 대표 자리가 이긴다.
  for (const [mine, , head] of asked) {
    if (!head) continue;
    if (!Number.isInteger(head) || head < 1 || head > ids.length) { fixes.push(`${mine.id}의 없는 대표 ${head} 뺌`); continue; }
    if (placed.has(head)) { fixes.push(`대표 ${head} 두 번 → 먼저 것`); continue; }
    placed.add(head); mine.head = ids[head - 1];
  }
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
    for (const g of [...groups]) if (!g.cards.length && !g.head && !groups.some((x) => x.parent === g.id)) { groups.splice(groups.indexOf(g), 1); changed = true; }
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
  // 카드 짝: 둘 다 있는 카드, 서로 다른 묶음, 한 번씩.
  const groupOf = new Map(groups.flatMap((g) => [...(g.head ? [g.head] : []), ...g.cards].map((c) => [c, g.id] as const)));
  const vsSeen = new Set<string>();
  const versus: StructVersus[] = [];
  for (const v of reply.versus ?? []) {
    const a = ids[v.a - 1], b = ids[v.b - 1];
    if (!a || !b || a === b) { fixes.push(`견줌 ${v.a}-${v.b} 뺌`); continue; }
    const key = [a, b].sort().join(">"); if (vsSeen.has(key)) continue; vsSeen.add(key);
    versus.push({ a, b, on: String(v.on ?? "").trim().slice(0, 30) });
  }
  const pairSeen = new Set<string>();
  const pairs: StructPair[] = [];
  for (const p of reply.pairs ?? []) {
    const a = ids[p.a - 1], b = ids[p.b - 1];
    if (!a || !b || a === b || groupOf.get(a) === groupOf.get(b)) { fixes.push(`짝 ${p.a}-${p.b} 뺌`); continue; }
    const key = [a, b].sort().join(">"); if (pairSeen.has(key)) continue; pairSeen.add(key);
    pairs.push({ a, b, why: String(p.why ?? "").trim().slice(0, 40) });
  }
  const base = [...new Set((reply.base ?? []).map((n) => ids[n - 1]).filter(Boolean))];
  return { groups, edges, pairs, versus, base, fixes };
}

// 큰 상자 다시 정리 (11/8 사용자 "15개가 있더라도 배치나 묶는 거나 중요한 거를 어떻게 정리하느냐에 따라 괜찮아질 수 있다 — 무조건 나누면 안 된다"
// → 실험: 평면 방정식 9장은 나누기, 브레젠험 12장은 차례로, 원 생성 15장은 나누기 + 그 안 차례로 → "그렇게 가자"): 카드가 6장 넘는 상자만
// 그 상자 카드로 AI를 한 번씩(동시에) 더 불러, 나누기 / 차례로 / 그대로 중 맞는 것을 고르게 한다. 코드는 몇 개로 나눌지 정하지 않는다.
// 모든 카드를 정확히 한 번 쓰지 않은 답은 버리고 원래 상자를 둔다.
export const BOX_LIMIT = 6;
export const BOX_SYSTEM = `너는 지식 구조 그림의 상자 하나를 다시 정리한다. 이 상자에는 카드가 많아 학습자가 한눈에 보기 어렵다.
상자 안 카드들을 보고, 이 상자에 맞는 정리 방식을 셋 중 하나 고른다. 억지로 나누지 않는다.
- 나누기: 카드들이 실제로 서로 다른 것(다른 대상·다른 계산·다른 판정) 몇 갈래일 때. parts는 작은 상자들(2~4개).
- 차례로: 카드들이 한 이야기·한 알고리즘의 단계일 때(문제 → 해결, 정의 → 판정 → 갱신 → 마무리). parts는 차례대로 놓인 단계(2~5개).
- 그대로: 카드들이 정말 나란한 항목일 때. parts는 하나.
규칙
- 모든 카드를 정확히 한 번 쓴다. 카드는 번호로 쓴다. part 안의 카드는 먼저 볼 것부터(차례가 있으면 차례대로).
- part 이름은 자료의 말로 짧게(2~10자). 차례로일 때는 그 단계가 하는 일이 보이게(예: "문제", "대칭으로 줄이기", "판정과 갱신").
- order: 나누기의 한 갈래 안 카드들이 다시 한 흐름의 단계면 true(그 갈래 안을 차례로 세운다), 아니면 false. 차례로·그대로에서는 false.
- link: 차례로일 때 이 단계가 앞 단계에서 무엇을 이어받는지 한 줄(12자 안팎). 첫 단계와 나누기·그대로는 빈 문자열.
- reason: 왜 이 방식인지 한 문장.`;
const BOX_SCHEMA = S.obj({ mode: S.oneOf("나누기", "차례로", "그대로"), reason: S.str, parts: S.arr(S.obj({ name: S.str, link: S.str, order: { type: "boolean" }, cards: S.arr(S.int) })) });
type BoxReply = { mode: string; reason: string; parts: Array<{ name: string; link: string; order: boolean; cards: number[] }> };

/** Apply one box's reply to the tree (exported for tests). Returns false (tree unchanged) when the reply does not use every card once. */
export function applyBox(groups: StructGroup[], box: StructGroup, reply: BoxReply): boolean {
  const ids = box.cards;
  const used = (reply.parts ?? []).flatMap((p) => p.cards ?? []);
  if (used.length !== ids.length || new Set(used).size !== ids.length || used.some((n) => !Number.isInteger(n) || n < 1 || n > ids.length)) return false;
  const parts = (reply.parts ?? []).filter((p) => p.cards?.length);
  const at = groups.indexOf(box);
  if (reply.mode === "그대로" || parts.length < 2) { box.cards = parts.flatMap((p) => p.cards.map((n) => ids[n - 1])); return true; }
  const kids: StructGroup[] = parts.map((p, i) => ({ id: `${box.id}_${i + 1}`, name: String(p.name ?? "").trim().slice(0, 30) || `${i + 1}`, parent: box.id,
    cards: p.cards.map((n) => ids[n - 1]), explain: "",
    ...(reply.mode === "차례로" ? { members: "순서" as const, ...(i && String(p.link ?? "").trim() ? { link: String(p.link).trim().slice(0, 40) } : {}) } : p.order ? { members: "순서" as const } : {}) }));
  box.cards = [];
  box.members = reply.mode === "차례로" ? "순서" : box.members && box.members !== "묶음" ? box.members : "종류";
  // 차례로: 단계 상자 안은 나란히(단계 사이에 ↓). 나누기: 갈래 안이 흐름이면 그 안을 차례로.
  if (reply.mode === "차례로") for (const k of kids) delete k.members;
  groups.splice(at + 1, 0, ...kids);
  return true;
}

async function refineBoxes(id: string, map: MaterialMap, groups: StructGroup[]): Promise<BoxNote[]> {
  const byId = new Map(map.sections.flatMap((s) => s.cards).map((c) => [c.id, c]));
  const line = (cid: string) => { const c = byId.get(cid)!; return cardLine({ kind: c.kind, title: c.title, shape: c.shape, takes: c.takes, gives: c.gives } as Card).replace(/\s+/g, " ").slice(0, 240) + (c.core ? " (핵심)" : ""); };
  const big = groups.filter((g) => g.cards.length > BOX_LIMIT && g.id !== "g_rest" && g.cards.every((c) => byId.has(c)));
  const nameOf = new Map(groups.map((g) => [g.id, g]));
  return Promise.all(big.map(async (box) => {
    const t0 = Date.now();
    const trail: string[] = []; for (let a = box.parent; a; a = nameOf.get(a)?.parent ?? "") trail.unshift(nameOf.get(a)?.name ?? "");
    const num = new Map(box.cards.map((c, i) => [c, i + 1]));
    const links = map.chains.filter((x) => num.has(x.from) && num.has(x.to)).map((x) => `${num.get(x.from)}→${num.get(x.to)} ${x.what.slice(0, 30)}`);
    const user = `자료: ${map.title}\n상자 자리: ${[...trail, box.name].join(" > ")}\n상자 대표 카드: ${box.head && byId.has(box.head) ? line(box.head) : "(없음)"}\n상자 설명: ${box.explain}\n\n카드 (번호|카드)\n${box.cards.map((c, i) => `${i + 1}|${line(c)}`).join("\n")}\n\n카드끼리 연결 (앞→뒤)\n${links.join("\n") || "(없음)"}`;
    try {
      const reply = await withTrace({ area: "pdf", action: "structure-box", ref: id }, () => askJson<BoxReply>("map:structure-box", BOX_SYSTEM, user, BOX_SCHEMA, STRUCTURE_MODEL));
      const ok = applyBox(groups, box, reply);
      return { box: box.id, name: box.name, mode: ok ? reply.mode : "그대로(답 버림)", reason: String(reply.reason ?? "").slice(0, 200), ms: Date.now() - t0, ok };
    } catch (e) { return { box: box.id, name: box.name, mode: "그대로(실패)", reason: (e as Error).message?.slice(0, 200) ?? "", ms: Date.now() - t0, ok: false }; }
  }));
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
  const boxes = await refineBoxes(id, map, checked.groups);
  const s: Structure = { at: new Date().toISOString(), ms: Date.now() - t0, ...STRUCTURE_MODEL, sig: cardSig(map), ...checked, ...(boxes.length ? { boxes } : {}) };
  const file = fileOf(id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(s, null, 1), "utf8");
  return s;
}

// 줄기 기반 구조 (11/9 사용자 "구조는 줄기 기반으로 만들면?" → "ㅇㅇ 해봐"): 카드 대신 기억 합치기(compact.ts)의 기억을 묶는다.
// 알고리즘의 단계는 이미 한 기억 안에 있으니, 구조는 기억 사이의 관계(갈래·대비·같은 틀·씀)만 본다. 메인·바탕·곁은 줄기 것을 그대로 쓰고
// (AI가 다시 고르지 않음), 바탕 기억은 그것을 쓰는 메인 옆에 둔다. 큰 상자 다시 나누기는 하지 않는다(기억이 적다).
export const STEM_STRUCTURE_SYSTEM = `너는 강의 자료 한 편을 정리한 "기억"들(알고리즘·원리·개념 하나씩)을 뜻의 구조로 묶는다. 학습자가 집합 그림(큰 상자 안 작은 상자)으로 본다.
기억들은 이미 영역(자료 순서)별로 정리되어 있다. 구조는 그 순서를 다시 보여 주는 것이 아니라, 기억들이 뜻으로 어떻게 이어지는지를 보여 준다.
영역 순서를 그대로 따라 상자를 만들면 실패다.

묶음
- 나무다. 맨 위 묶음은 2~4개: 이 강의가 다루는 큰 일(예: "외곽선 그리기"와 "내부 채우기", "무엇인가"와 "어떻게 다루나").
- 같은 일을 하는 여러 방법은 한 묶음의 갈래다(예: 선 그리기 방법들). 셋 이상이면 공통점으로 한 단 더(깊이 3단까지).
- head: 묶음이 가리키는 것 자체인 기억이 있으면 그 번호(없으면 0). cards: 그 밖에 이 묶음에 든 기억 번호.
- members: 안의 것과 대표의 관계 하나: 부분 · 종류(갈래들) · 모두(모두 성립해야) · 순서(차례로 한다) · 묶음(뚜렷하지 않음).
- 바탕 기억(역할이 바탕)은 그것을 가장 많이 쓰는 메인 기억과 같은 묶음에 넣는다. 곁 기억은 맨 위 아무 데나 넣지 말고 관련 묶음의 끝에.
- 모든 기억을 정확히 한 번(head 또는 cards). name은 자료의 말로 짧게(2~10자), explain은 이 묶음이 맡는 몫 한 문장.

관계 — 이것이 구조의 핵심이다
- versus (0~8): 나란히 견주어야 뜻이 서는 두 기억(같은 일의 두 방법, 반대 상태). on: 무엇으로 견주는지 8~14자(예: "실수 vs 정수 연산").
- pairs (0~12): 서로 다른 묶음의 두 기억이 이어질 때. why 12~20자로 어떻게: "같은 틀: 결정 변수 증분", "외적으로 판정", "법선을 씀", "막는 조건".
  특히 다른 대상에 같은 생각(같은 판정·같은 갱신·같은 대칭)을 쓰는 두 기억은 꼭 잇는다 — 학습자가 놓치기 쉬운 연결이다.
- edges (0~8): 묶음 사이 연결. type: 막음 · 씀(a의 결과를 b가 씀) · 이어짐 · 대비 · 예시. 부모·자식 사이는 잇지 않는다. why 15자 안팎.

id는 g1, g2 … parent는 맨 위면 빈 문자열.`;

/** 기억 줄: 번호|영역|역할|종류|이름|요지 */
export function stemStructureInput(compact: { areas: Array<{ name: string }>; memories: Array<{ id: string; name: string; role: string; kind: string; area: number; line: string; steps: string[] }> }, title: string) {
  const lines = compact.memories.map((m, i) => `${i + 1}|${compact.areas[m.area - 1]?.name ?? "그 밖"}|${m.role}|${m.kind}${m.steps.length ? `(${m.steps.length}단계)` : ""}|${m.name}|${m.line.slice(0, 120)}`);
  return { user: `자료: ${title}\n영역(자료 순서): ${compact.areas.map((a) => a.name).join(" / ")}\n\n기억 (번호|영역|역할|종류|이름|요지)\n${lines.join("\n")}`, ids: compact.memories.map((m) => m.id) };
}

export async function makeStemStructure(id: string, map: MaterialMap, compact: Parameters<typeof stemStructureInput>[0] & { at: string }): Promise<Structure> {
  const { user, ids } = stemStructureInput(compact, map.title);
  const t0 = Date.now();
  const reply = await withTrace({ area: "pdf", action: "structure-stem", ref: id }, () => askJson<Reply>("map:structure", STEM_STRUCTURE_SYSTEM, user, SCHEMA, STRUCTURE_MODEL));
  const checked = checkStructure(reply, ids);
  const roles = new Map(compact.memories.map((m) => [m.id, m.role]));
  // 메인·바탕·곁은 줄기 것으로: 묶음의 role은 안에 든 기억이 모두 같은 역할일 때만(아니면 메인).
  const walk = (g: StructGroup): string[] => [...(g.head ? [g.head] : []), ...g.cards, ...checked.groups.filter((k) => k.parent === g.id).flatMap(walk)];
  for (const g of checked.groups) { const rs = new Set(walk(g).map((x) => roles.get(x) ?? "메인")); g.role = rs.size === 1 ? [...rs][0] as GroupRole : "메인"; }
  const s: Structure = { at: new Date().toISOString(), ms: Date.now() - t0, ...STRUCTURE_MODEL, sig: `stem:${compact.at}`, unit: "memory", ...checked,
    base: compact.memories.filter((m) => m.role !== "메인").map((m) => m.id) };
  const file = fileOf(id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(s, null, 1), "utf8");
  return s;
}
