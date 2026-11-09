// 기억 합치기 (11/9 사용자 "119개의 중구난방한 기억을 컴팩트하게 — 그래픽스 PDF가 가르치려는 게 뭔지 생각하면서", "알고리즘은 한 장으로 합친다
// — 하드코딩 안 하고 가능하면 ㅇㅋ", 참고: GPT 정리 "52쪽을 슬라이드 52개로 외우는 게 아니라 서로 연결된 몇 가지 원리와 알고리즘으로").
// 카드(조각)는 그대로 두고, AI 한 번(terra low)이 학습자가 외우고 복습할 "기억" 단위로 묶는다. 무엇을 합칠지는 자료마다 AI가 정한다
// (알고리즘 이름·과목을 코드에 적지 않는다). 코드는 검사만: 카드는 한 기억에만, 빠진 카드는 따로, 없는 번호는 뺀다.
// 구조(structure.json)가 있으면 카드마다 그 자리(묶음 경로·메인/바탕/곁)를 같이 준다. 결과는 study-gen/<id>/compact.json.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { askJson, S } from "../assist/model.ts";
import { withTrace } from "../ai/trace.ts";
import { cardLine, type Card } from "./gen/cards.ts";
import { loadGen } from "./gen/runner.ts";
import { materialMap, type MaterialMap } from "./material-map.ts";
import { loadStructure, type Structure } from "./structure.ts";

export const MEMORY_KINDS = ["알고리즘", "원리", "개념", "비교", "판정", "구조"] as const;
export const MEMORY_ROLES = ["메인", "바탕", "곁"] as const;
export type Memory = { id: string; name: string; kind: (typeof MEMORY_KINDS)[number]; role: (typeof MEMORY_ROLES)[number]; area: number;
  question: string; line: string; steps: string[]; cards: string[] };
export type Compact = { at: string; ms: number; model: string; effort: string; cards: number; areas: Array<{ name: string; question: string }>; memories: Memory[]; fixes: string[] };

const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");
const fileOf = (id: string) => { if (!/^gen_[a-z0-9]{8,64}$/.test(id)) throw Object.assign(new Error("자료 id가 올바르지 않아요."), { status: 400 }); return path.join(dataDir(), "study-gen", id, "compact.json"); };
export async function loadCompact(id: string): Promise<Compact | null> { try { return JSON.parse(await readFile(fileOf(id), "utf8")) as Compact; } catch { return null; } }

export const COMPACT_SYSTEM = `너는 강의 자료 한 편에서 뽑은 기억 카드(조각)들을, 학습자가 실제로 외우고 복습할 "기억"으로 합친다.
카드는 자료를 쪽마다 읽으며 잘게 뽑은 것이라 같은 알고리즘의 단계·식·조건이 여러 장으로 흩어져 있다. 목표는 카드 N장을 낱장으로 외우는 게 아니라,
서로 이어진 몇 가지 원리·알고리즘·개념으로 이해하게 하는 것이다.

먼저 (쓰지 말고) 생각한다: 이 강의가 가르치려는 것은 무엇인가? 큰 영역 몇 개로 나뉘고, 영역마다 "배우는 질문"은 무엇인가?
그다음 areas에 영역(보통 3~7개)을 자료 흐름 순서로 쓰고, 기억을 만든다.

기억 만들기
- 하나의 알고리즘·절차·방법은 기억 하나다: 그 방법의 목적·후보·판정식·결정값·점화식·초깃값·방향별 경우·구현 단계 카드를 모두 그 기억에 넣고, steps에 차례(3~7단계, 한 단계 한 줄)를 쓴다.
- 같은 것을 다른 꼴로 적은 카드(같은 식의 다른 표기·전개, 같은 성질의 여러 장, 같은 대칭의 좌표 목록)는 기억 하나다.
- 두 방법이 같은 틀(같은 생각)을 쓰면, 그 틀 자체를 원리 기억 하나로 둘 수 있다. 이때 각 방법의 카드는 각 방법 기억에 두고, 원리 기억에는 그 틀을 직접 말하는 카드만 넣는다(없으면 원리 기억을 만들지 않는다).
- 따로 서는 정의·개념·판정 규칙은 혼자 기억이 된다. 억지로 합치지 않는다. 비교 카드는 견주는 둘이 한 기억이면 그 기억에, 아니면 비교 기억으로.
- role: 메인 = 이 강의에서 새로 배우는 것(강의 제목이 약속하는 것, 시험에 이 강의 몫으로 나올 것). 바탕 = 이 강의 전에 알고 와야 하는 것을 다시 적은 것(앞 과목의 수학 식·정의, 예: 선 그리기 강의의 기울기·절편 방정식, 외적, 행렬식). 곁 = 배경·종류 나열·제품 이름·덧붙인 예.
- 바탕·곁 카드도 비슷한 것끼리 기억으로 합친다(바탕은 "어디에 쓰이는지"가 line에 보이게).
- 모든 카드를 정확히 한 기억에 넣는다. 메인 기억 하나는 보통 카드 1~14장이다.

쓰는 법
- name: 자료의 말로 짧게(2~14자). 원어가 있으면 괄호로(예: "중점 원 알고리즘(Midpoint circle)").
- question: 이 기억이 답하는 질문 한 줄(예: "원을 화소로 그릴 때 다음 화소를 어떻게 고르나?").
- line: 이 기억의 요지 한 줄(40~90자). 카드 내용을 늘어놓지 말고 핵심 생각을.
- steps: 알고리즘·절차일 때만, 아니면 빈 배열.
- area: areas의 번호(1부터). cards: 카드 번호.
- kind: 알고리즘 / 원리 / 개념 / 비교 / 판정 / 구조(자료 구조·표·표현 방식) 중 하나.`;

const SCHEMA = S.obj({
  areas: S.arr(S.obj({ name: S.str, question: S.str })),
  memories: S.arr(S.obj({ name: S.str, kind: S.oneOf(...MEMORY_KINDS), role: S.oneOf(...MEMORY_ROLES), area: S.int, question: S.str, line: S.str, steps: S.arr(S.str), cards: S.arr(S.int) })),
});
type Reply = { areas: Array<{ name: string; question: string }>; memories: Array<{ name: string; kind: string; role: string; area: number; question: string; line: string; steps: string[]; cards: number[] }> };

/** 카드 줄: 번호|구조 자리|역할|핵심·보조|카드. 흐름 카드는 뺀다. */
export function compactInput(map: MaterialMap, structure: Structure | null) {
  const cards = map.sections.flatMap((s) => s.cards).filter((c) => !c.title.startsWith("흐름: "));
  const groups = new Map((structure?.groups ?? []).map((g) => [g.id, g]));
  const where = new Map<string, string>();
  for (const g of structure?.groups ?? []) {
    const trail: string[] = []; let role = "";
    for (let at: typeof g | undefined = g; at; at = groups.get(at.parent)) { trail.unshift(at.name); if (!role && at.role) role = at.role; }
    for (const id of [...(g.head ? [g.head] : []), ...g.cards]) where.set(id, `${trail.join(">")}|${structure?.base?.includes(id) ? "바탕" : role || "?"}`);
  }
  const lines = cards.map((c, i) => `${i + 1}|${where.get(c.id) ?? "?|?"}|${c.core ? "핵심" : "보조"}|${cardLine({ kind: c.kind, title: c.title, shape: c.shape } as Card).replace(/\s+/g, " ").slice(0, 220)}`);
  const user = `자료: ${map.title}\n${map.topics?.length ? `큰 주제(자료 전체 정리): ${map.topics.join(" / ")}\n` : ""}\n카드 (번호|구조 자리|구조 역할|핵심·보조|카드)\n${lines.join("\n")}`;
  return { user, ids: cards.map((c) => c.id), titles: cards.map((c) => c.title) };
}

/** 코드 검사 (테스트용으로 내보냄): ids[n-1]이 카드 n. */
export function checkCompact(reply: Reply, ids: string[], titles: string[]): Pick<Compact, "areas" | "memories" | "fixes"> {
  const fixes: string[] = [];
  const areas = (reply.areas ?? []).map((a) => ({ name: String(a.name ?? "").trim(), question: String(a.question ?? "").trim() })).filter((a) => a.name);
  const placed = new Set<number>();
  const memories: Memory[] = [];
  for (const m of reply.memories ?? []) {
    const cards: string[] = [];
    for (const n of m.cards ?? []) {
      if (!Number.isInteger(n) || n < 1 || n > ids.length) { fixes.push(`${m.name}: 없는 카드 ${n} 뺌`); continue; }
      if (placed.has(n)) { fixes.push(`카드 ${n} 두 번 → 먼저 것`); continue; }
      placed.add(n); cards.push(ids[n - 1]);
    }
    if (!cards.length) { fixes.push(`빈 기억 ${m.name} 뺌`); continue; }
    memories.push({ id: `m${memories.length + 1}`, name: String(m.name ?? "").trim().slice(0, 40) || titles[ids.indexOf(cards[0])],
      kind: (MEMORY_KINDS as readonly string[]).includes(m.kind) ? m.kind as Memory["kind"] : "개념",
      role: (MEMORY_ROLES as readonly string[]).includes(m.role) ? m.role as Memory["role"] : "메인",
      area: Number.isInteger(m.area) && m.area >= 1 && m.area <= areas.length ? m.area : 0,
      question: String(m.question ?? "").trim().slice(0, 120), line: String(m.line ?? "").trim().slice(0, 200),
      steps: (m.steps ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 9), cards });
  }
  // 빠진 카드는 혼자 기억으로(내용은 카드 제목). 지우지 않는다.
  ids.forEach((id, i) => { if (!placed.has(i + 1)) { fixes.push(`빠진 카드 ${i + 1} → 혼자 기억`); memories.push({ id: `m${memories.length + 1}`, name: titles[i], kind: "개념", role: "메인", area: 0, question: "", line: "", steps: [], cards: [id] }); } });
  return { areas, memories, fixes };
}

export const COMPACT_MODEL = { model: "gpt-6.1-terra", effort: "low" };
export async function makeCompact(id: string): Promise<Compact> {
  const state = await loadGen(id);
  const map = state ? materialMap(state, {}) : null;
  if (!map) throw Object.assign(new Error("자료를 찾을 수 없어요."), { status: 404 });
  const { user, ids, titles } = compactInput(map, await loadStructure(id));
  if (ids.length < 3) throw Object.assign(new Error("카드가 너무 적어요."), { status: 422 });
  const t0 = Date.now();
  const reply = await withTrace({ area: "pdf", action: "compact", ref: id }, () => askJson<Reply>("map:compact", COMPACT_SYSTEM, user, SCHEMA, COMPACT_MODEL));
  const checked = checkCompact(reply, ids, titles);
  const missing = checked.fixes.filter((f) => f.startsWith("빠진 카드")).length;
  if (missing > ids.length / 4) throw Object.assign(new Error(`AI가 카드 ${ids.length}장 중 ${missing}장을 빠뜨렸어요. 다시 해 보세요.`), { status: 502 });
  const out: Compact = { at: new Date().toISOString(), ms: Date.now() - t0, ...COMPACT_MODEL, cards: ids.length, ...checked };
  await mkdir(path.dirname(fileOf(id)), { recursive: true });
  await writeFile(fileOf(id), JSON.stringify(out, null, 1));
  return out;
}

/** /api/study-map/<id>/compact: GET 저장된 것, POST 새로 합치기(AI 1번). */
export async function compactApi(request: Request, id: string) {
  const { NextResponse } = await import("next/server");
  if (request.method === "GET") return NextResponse.json({ compact: await loadCompact(id) });
  return NextResponse.json({ compact: await makeCompact(id) });
}
