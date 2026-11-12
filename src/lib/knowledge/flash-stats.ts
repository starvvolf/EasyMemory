// 기억 탭 "모르는 것 분석" (2026-11-13 사용자 "플래시카드를 계속 돌려 보면서 알았어요·몰랐어요 누를 거 아니야. 그걸 데이터 분석적으로 접근해서 보여 주는 거"):
// AI 없이 기록(events.jsonl)만으로 자료 하나의 카드마다 몇 번 봤고 몇 번 몰랐는지, 최근 흐름, 생각한 시간, 분류(계속 모름 · 왔다 갔다 · 이제 앎 · 잘 앎 · 아직 안 봄),
// 그리고 회차(한 번에 쭉 돌려 본 묶음)마다 알았어요 비율을 낸다. 순수 함수 — 저장소 읽기는 store.ts의 materialStats.

export type StatEvent = { at: string; kind: string; detail: string; refs: string[] };
export type CardGroup = "stuck" | "shaky" | "learned" | "solid" | "unseen";
export type CardStat = {
  ref: string;
  tries: number;
  wrong: number;
  /** 오래된 것부터 최근 8번: o = 알았어요 · 맞힘, x = 몰랐어요 · 틀림 · 물어봄 */
  seq: Array<"o" | "x">;
  lastAt: string | null;
  /** 플래시카드에서 답 보기까지 걸린 시간 평균(초), 기록 없으면 null */
  think: number | null;
  /** 강의 · 문제에서 남은 "왜 몰랐나" 글(플래시카드 버튼 글은 빼고, 최근 것부터 3개) */
  notes: string[];
  group: CardGroup;
};
export type Round = { at: string; n: number; known: number };
export type MaterialStats = { cards: Record<string, CardStat>; rounds: Round[] };

export const GROUP_LABEL: Record<CardGroup, string> = { stuck: "계속 모름", shaky: "왔다 갔다", learned: "이제 앎", solid: "잘 앎", unseen: "아직 안 봄" };
const GOOD = new Set(["correct"]);
const BAD = new Set(["wrong", "asked", "hint"]);
/** 한 회차: 앞 기록과 20분 넘게 떨어지면 새 회차 */
const ROUND_GAP = 20 * 60_000;

export const thinkOf = (detail: string) => { const m = /생각 (\d+)초/.exec(detail); return m ? Number(m[1]) : null; };

/** 어느 무리인가: 최근 기록으로만 정한다(옛날에 몰랐어도 지금 계속 알면 '이제 앎'). */
export function groupOf(seq: Array<"o" | "x">): CardGroup {
  if (!seq.length) return "unseen";
  const last2 = seq.slice(-2);
  if (last2.every((r) => r === "x")) return "stuck";
  const recent = seq.slice(-5);
  const flips = recent.slice(1).filter((r, i) => r !== recent[i]).length;
  if (recent.length >= 3 && flips >= 2) return "shaky";
  if (seq.at(-1) === "x") return "stuck";
  if (seq.includes("x")) return last2.length === 2 && last2.every((r) => r === "o") ? "learned" : "shaky";
  return "solid";
}

export function analyze(refs: string[], events: StatEvent[]): MaterialStats {
  const sorted = [...events].filter((e) => GOOD.has(e.kind) || BAD.has(e.kind)).sort((a, b) => a.at.localeCompare(b.at));
  const cards: Record<string, CardStat> = {};
  for (const ref of refs) {
    const mine = sorted.filter((e) => e.refs.includes(ref));
    const all = mine.map((e) => (GOOD.has(e.kind) ? "o" : "x") as "o" | "x");
    const thinks = mine.map((e) => thinkOf(e.detail)).filter((n): n is number => n !== null);
    const notes = mine.filter((e) => BAD.has(e.kind) && e.detail && !e.detail.startsWith("플래시카드")).map((e) => e.detail).reverse().slice(0, 3);
    cards[ref] = { ref, tries: all.length, wrong: all.filter((r) => r === "x").length, seq: all.slice(-8), lastAt: mine.at(-1)?.at ?? null,
      think: thinks.length ? Math.round(thinks.reduce((a, b) => a + b, 0) / thinks.length) : null, notes, group: groupOf(all) };
  }
  // 회차는 플래시카드 기록만(문제 · 강의 기록은 한 번에 돌려 본 묶음이 아니다)
  const flash = sorted.filter((e) => e.detail.startsWith("플래시카드") && e.refs.some((r) => refs.includes(r)));
  const rounds: Round[] = [];
  let prev = 0;
  for (const e of flash) {
    const t = Date.parse(e.at);
    if (!rounds.length || t - prev > ROUND_GAP) rounds.push({ at: e.at, n: 0, known: 0 });
    const r = rounds[rounds.length - 1];
    r.n += 1; if (GOOD.has(e.kind)) r.known += 1;
    prev = t;
  }
  return { cards, rounds: rounds.slice(-12) };
}
