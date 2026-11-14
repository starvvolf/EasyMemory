// 14 시간 순서 표 (설계 3번 실습 전용, 8번 FPS "A와 B의 읽기 → 빼기 → 쓰기 걸음을 끌어 놓아 한 번이 사라지는 순서 만들기").
// 진짜 스레드를 돌리지 않고 코드가 그 순서대로 흉내 내어 계산한다 — 매번 같은 결과. AI 0번(상황은 은행에서 고른다).
//   ① 보여 준 순서의 최종 값 맞히기  ② 값 하나가 사라지는 순서 만들기. 그때 생각(mine) = "한 요청의 걸음은 한 번에 끝난다"(하나씩 처리한 값).
import { createHash } from "node:crypto";
import type { Graded } from "../grade.ts";
import type { Distance, Gap, Scene } from "../types.ts";

export type Who = "A" | "B";
export type TStep = { id: string; who: Who; op: "read" | "calc" | "write"; text: string; delta?: number };
export type Timeline = { name: string; label: string; unit: string; init: number; steps: TStep[]; shown: string[]; story: string };
export type SimOk = { ok: true; final: number; trace: Array<{ id: string; value: number; reg: Partial<Record<Who, number>> }> };
export type Sim = SimOk | { ok: false; error: string };

/** 그 순서대로 흉내 내기. 걸음마다 그 요청 안의 순서는 지켜야 하고, 걸음은 한 번씩 */
export function simulate(tl: Pick<Timeline, "init" | "steps">, order: string[]): Sim {
  const byId = new Map(tl.steps.map((s) => [s.id, s]));
  if (order.length !== tl.steps.length) return { ok: false, error: `걸음 ${tl.steps.length}개를 모두 한 번씩 놓아야 해요.` };
  const seen = new Set<string>();
  const next: Record<Who, number> = { A: 0, B: 0 };
  const own = (w: Who) => tl.steps.filter((s) => s.who === w);
  let value = tl.init;
  const reg: Partial<Record<Who, number>> = {};
  const trace: SimOk["trace"] = [];
  for (const id of order) {
    const s = byId.get(id);
    if (!s) return { ok: false, error: `없는 걸음이에요: ${id}` };
    if (seen.has(id)) return { ok: false, error: `${id}를 두 번 놓았어요.` };
    seen.add(id);
    if (own(s.who)[next[s.who]]?.id !== id) return { ok: false, error: `${s.who}의 걸음은 순서대로여야 해요(${id}가 너무 빨라요).` };
    next[s.who]++;
    if (s.op === "read") reg[s.who] = value;
    else if (s.op === "calc") reg[s.who] = (reg[s.who] ?? 0) + (s.delta ?? 0);
    else value = reg[s.who] ?? value;
    trace.push({ id, value, reg: { ...reg } });
  }
  return { ok: true, final: value, trace };
}
/** 하나씩 처리했을 때(A 다 하고 B, 또는 그 반대) — 그때 생각대로 계산한 값 */
export const serialValue = (tl: Pick<Timeline, "init" | "steps">) => tl.init + tl.steps.reduce((n, s) => n + (s.op === "calc" ? s.delta ?? 0 : 0), 0);
/** 두 요청의 걸음을 섞는 모든 순서 */
export function interleavings(tl: Pick<Timeline, "steps">): string[][] {
  const a = tl.steps.filter((s) => s.who === "A").map((s) => s.id), b = tl.steps.filter((s) => s.who === "B").map((s) => s.id);
  const out: string[][] = [];
  const go = (i: number, j: number, acc: string[]) => { if (i === a.length && j === b.length) { out.push(acc); return; } if (i < a.length) go(i + 1, j, [...acc, a[i]]); if (j < b.length) go(i, j + 1, [...acc, b[j]]); };
  go(0, 0, []);
  return out;
}

/* ---------- 상황 은행 ---------- */
type Ctx = { name: string; label: string; unit: string; init: number; a: number; b: number; story: string; words: RegExp };
export const CONTEXTS: Ctx[] = [
  { name: "hp", label: "체력", unit: "", init: 100, a: -30, b: -20, story: "두 공격 요청 A · B가 같은 플레이어의 체력 hp를 동시에 깎아요.", words: /\b(hp|health|체력)\b/i },
  { name: "ammo", label: "탄약", unit: "발", init: 30, a: -1, b: -2, story: "두 발사 요청 A · B가 같은 총의 탄약 ammo를 동시에 줄여요.", words: /\b(ammo|bullet|탄약)\b/i },
  { name: "stock", label: "재고", unit: "개", init: 10, a: -3, b: -2, story: "두 주문 A · B가 같은 상품의 재고 stock을 동시에 줄여요.", words: /\b(stock|inventory|재고)\b/i },
  { name: "balance", label: "잔액", unit: "원", init: 5000, a: 3000, b: 2000, story: "두 입금 A · B가 같은 계좌의 잔액 balance에 동시에 더해져요.", words: /\b(balance|money|잔액|계좌)\b/i },
  { name: "score", label: "점수", unit: "점", init: 40, a: 10, b: 5, story: "두 득점 요청 A · B가 같은 점수판의 score를 동시에 올려요.", words: /\b(score|points|점수)\b/i },
  { name: "views", label: "조회수", unit: "", init: 41, a: 1, b: 1, story: "두 사람이 같은 글을 동시에 열어 조회수 views를 1씩 올려요.", words: /\b(views|count|counter|조회수|카운터)\b/i },
];
const seedOf = (s: string) => parseInt(createHash("sha1").update(s).digest("hex").slice(0, 8), 16);
const verb = (d: number) => (d < 0 ? `${-d} 빼기` : `${d} 더하기`);
/** 상황 하나로 표 만들기. 보여 주는 순서는 둘 다 읽은 뒤에 쓰는 것(값 하나가 사라짐) */
export function timelineOf(c: Ctx): Timeline {
  const steps: TStep[] = [];
  for (const [who, d] of [["A", c.a], ["B", c.b]] as const) {
    const r = who.toLowerCase();
    steps.push({ id: `${who}1`, who, op: "read", text: `${who}: ${c.name}를 읽어 ${r}에 담기 (${r} = ${c.name})` },
      { id: `${who}2`, who, op: "calc", delta: d, text: `${who}: ${r}에서 ${verb(d)} (${r} = ${r} ${d < 0 ? "-" : "+"} ${Math.abs(d)})` },
      { id: `${who}3`, who, op: "write", text: `${who}: ${r}를 ${c.name}에 쓰기 (${c.name} = ${r})` });
  }
  return { name: c.name, label: c.label, unit: c.unit, init: c.init, steps, shown: ["A1", "B1", "A2", "B2", "A3", "B3"], story: c.story };
}
/** 비슷하게 = 그 실습의 값(코드에 나온 이름)과 같은 상황, 응용 = 다른 상황. 같은 빈틈이라도 만들 때마다 조금씩 다르게 */
export function pickContext(gap: Pick<Gap, "id" | "kernel" | "wrongCode" | "missed" | "title">, distance: Distance, salt = "") {
  const text = `${gap.kernel.code}\n${gap.wrongCode ?? ""}\n${gap.missed}\n${gap.title}`;
  const own = CONTEXTS.find((c) => c.words.test(text));
  const seed = seedOf(`${gap.id}:${salt}`);
  if (distance !== "far" && own) return own;
  const pool = CONTEXTS.filter((c) => c !== own);
  return pool[seed % pool.length];
}

/** 장면 만들기(AI 0번) + 코드 검사 */
export function makeTimelineScene(gap: Gap, id: string, salt = new Date().toISOString()): Scene {
  const tl = timelineOf(pickContext(gap, gap.state.distance, salt));
  return checkTimeline({ id, gapId: gap.id, format: "timeline", lang: gap.origin.lang, distance: gap.state.distance, target: gap.target,
    story: tl.story, ask: `① 아래 순서대로 돌면 ${tl.name}는 마지막에 얼마일까요?  ② 걸음을 끌어 놓아, 두 요청 중 하나의 변화가 사라지는 순서를 만들어 보세요.`,
    explain: "읽기 → 계산 → 쓰기 사이에 다른 요청이 끼어들면, 늦게 쓴 쪽이 먼저 쓴 값을 덮어써서 한 번이 사라져요. 읽기부터 쓰기까지를 한 번에(잠금 · 원자적 연산) 해야 해요.",
    setup: "", after: "", reference: JSON.stringify(tl.shown), alsoRight: [], wrongs: [{ id: "mine", what: "한 요청의 걸음은 한 번에 끝난다고 봄(하나씩 처리한 값)", code: "" }],
    inputs: [], practice: { kind: "timeline", timeline: tl }, createdAt: new Date().toISOString(), madeBy: "bank" });
}
const tlOf = (s: Scene) => (s.practice as { timeline?: Timeline } | undefined)?.timeline;
/** 검사: 보여 준 순서가 맞게 돌고 · 그 값이 하나씩 처리한 값과 다르고 · 사라지는 순서가 있고 · 하나씩 처리한 순서는 안 사라짐 */
export function checkTimeline(scene: Scene): Scene {
  const tl = tlOf(scene);
  const problems: string[] = [];
  if (!tl) return { ...scene, check: { ok: false, problems: ["표가 없어요."] } };
  const shown = simulate(tl, tl.shown);
  const serial = serialValue(tl);
  if (!shown.ok) problems.push(`보여 준 순서가 돌지 않아요: ${shown.error}`);
  else if (shown.final === serial) problems.push("보여 준 순서의 값이 하나씩 처리한 값과 같아요(가를 수 없어요).");
  const all = interleavings(tl).map((o) => simulate(tl, o));
  if (!all.some((r) => r.ok && r.final !== serial)) problems.push("값이 사라지는 순서가 없어요.");
  for (const o of [[...tl.steps.filter((s) => s.who === "A"), ...tl.steps.filter((s) => s.who === "B")].map((s) => s.id)]) {
    const r = simulate(tl, o);
    if (!r.ok || r.final !== serial) problems.push("하나씩 처리한 순서가 하나씩 처리한 값을 내지 않아요.");
  }
  return { ...scene, check: { ok: !problems.length, problems }, computed: { expected: [String(shown.ok ? shown.final : "")], shapes: { mine: [String(serial)] } } };
}

export type TimelineAnswer = { final?: string | number; order?: string[] };
export function parseTimelineAnswer(answer: string): TimelineAnswer {
  try { const a = JSON.parse(answer) as TimelineAnswer; return { final: a.final, order: Array.isArray(a.order) ? a.order.map(String) : undefined }; } catch { return {}; }
}
/**
 * 채점(코드만): ① 값 = 흉내 낸 값이면 맞음 · 하나씩 처리한 값이면 그때 생각 ② 순서 = 돌려 보아 사라지면 맞음 · 안 사라지면(하나씩 처리한 값) 그때 생각 · 규칙을 어기면 미확정.
 * 둘 다 맞아야 통과. 하나라도 그때 생각과 같으면 같은 실수(그때 생각이 틀렸다는 증거가 있을 때만).
 */
export function gradeTimeline(scene: Scene, gap: Pick<Gap, "wrongVerified">, answer: string): Graded {
  const tl = tlOf(scene)!;
  const a = parseTimelineAnswer(answer);
  const serial = serialValue(tl);
  const shown = simulate(tl, tl.shown) as SimOk;
  const num = Number(String(a.final ?? "").replace(/[^\d.-]/g, ""));
  const predict = !Number.isFinite(num) || String(a.final ?? "").trim() === "" ? "none" : num === shown.final ? "right" : num === serial ? "mine" : "wrong";
  const sim = a.order ? simulate(tl, a.order) : null;
  const lose = !sim ? "none" : !sim.ok ? "invalid" : sim.final !== serial ? "right" : "mine";
  const outputs = [String(a.final ?? ""), sim ? (sim.ok ? String(sim.final) : sim.error) : ""];
  const errors = sim && !sim.ok ? [sim.error] : undefined;
  if (predict === "right" && lose === "right") return { verdict: "pass", outputs };
  const firstDiff = predict !== "right" ? { index: 0, stdin: tl.shown.join(" → "), expected: String(shown.final), got: String(a.final ?? "") }
    : { index: 1, stdin: (a.order ?? []).join(" → "), expected: `${serial}가 아닌 값(하나가 사라짐)`, got: sim ? (sim.ok ? String(sim.final) : sim.error) : "" };
  if ((predict === "mine" || lose === "mine") && gap.wrongVerified !== false) return { verdict: "same", matched: "mine", outputs, firstDiff, ...(errors ? { errors } : {}) };
  return { verdict: "unclear", outputs, firstDiff, ...(errors ? { errors } : {}) };
}
/** 화면에 보낼 것: 걸음(섞어서) · 보여 줄 순서 · 처음 값. 정답 값은 안 보냄 */
export function timelinePublic(scene: Scene) {
  const tl = tlOf(scene)!;
  const seed = seedOf(scene.id);
  const pool = [...tl.steps].sort((x, y) => (seedOf(`${seed}${x.id}`) % 97) - (seedOf(`${seed}${y.id}`) % 97));
  return { kind: "timeline", name: tl.name, label: tl.label, unit: tl.unit, init: tl.init, shown: tl.shown.map((id) => tl.steps.find((s) => s.id === id)!).map((s) => ({ id: s.id, who: s.who, text: s.text })),
    steps: pool.map((s) => ({ id: s.id, who: s.who, text: s.text })) };
}
