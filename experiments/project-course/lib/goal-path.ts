// 지나온 목표 길(2026-11-09 사용자 "어떤 거에서 어떤 목표들을 거쳤는지 타임라인이 보이게"):
// 실습 한 번의 목표 기록(goals.log)에서 현재 목표 하나하나를 차례로 뽑는다. 목표마다 언제 시작했고, 그 안에서 무슨 일이
// 있었고(이해 · 해 봤어요 판정 · 막힘 · 보충), 어떻게 끝났나(마침 · 건너뜀 · 너무 쉬움 · 진행 중). AI 없이 코드로만.
// 목표 이름은 기록에 남은 것 그대로: [확정]의 첫 목표는 이름이 기록에 없어 그 목표가 끝날 때의 줄("이름: 마침")에서 읽는다.

export type PathEvent = { at: string; kind: "understood" | "check" | "applied" | "stuck" | "easy" | "support" | "support-done" | "back" | "refine"; text: string };
export type PathGoal = { title: string; at: string; endAt: string | null; result: "마침" | "건너뜀" | "너무 쉬움" | "진행 중" | "멈춤"; events: PathEvent[] };
type Log = { at: string; kind: string; text: string };

const RESULT = /: (마침|너무 쉬워서 넘어감|건너뜀\(이해 [✓–], 적용 [✓–]\))$/;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function goalPath(log: Log[], current: { title: string } | null): PathGoal[] {
  const out: PathGoal[] = [];
  let cur: PathGoal | null = null;
  const open = (title: string, at: string) => { cur = { title, at, endAt: null, result: "진행 중", events: [] }; out.push(cur); };
  const add = (e: PathEvent) => { if (!cur) open("", e.at); cur!.events.push(e); };
  for (const l of log) {
    if (l.kind === "confirm") open("", l.at);
    else if (l.kind === "current") {
      // 같은 목표를 다듬은 것(확정 직후 · 너무 쉬워요 뒤): 아직 끝나지 않은 목표의 이름을 바꾼다
      const c = cur as PathGoal | null;
      if (c && !c.endAt) { if (c.title && c.title !== l.text) c.events.push({ at: l.at, kind: "refine", text: `목표를 다듬음: ${cut(c.title, 60)} → ${cut(l.text, 60)}` }); c.title = l.text; }
      else open(l.text, l.at);
    } else if (l.kind === "next" || l.kind === "end") {
      const m = RESULT.exec(l.text);
      if (!m) continue;   // 목표 없이 끝낸 학습
      const title = l.text.slice(0, m.index);
      const c = cur as PathGoal | null;
      if (!c || c.endAt) open(title, l.at);
      const g = cur as unknown as PathGoal;
      if (!g.title) g.title = title;
      g.endAt = l.at;
      g.result = m[1] === "마침" ? "마침" : m[1].startsWith("너무") ? "너무 쉬움" : l.kind === "end" ? "멈춤" : "건너뜀";
    } else if (l.kind === "understood") add({ at: l.at, kind: "understood", text: l.text.startsWith("보충 ") ? `이해했어요 (${l.text})` : "이해했어요" });
    else if (l.kind === "apply-check") {
      // "단위: 판정 · 빠진 곳: … · 학습자 답: "…"" → 판정과 빠진 곳만
      const body = l.text.replace(/ · 학습자 답: ".*$/s, "");
      const i = body.indexOf(": ");
      const unit = i > 0 ? body.slice(0, i) : "";
      add({ at: l.at, kind: "check", text: `${unit.startsWith("보충 ") ? `(${unit}) ` : ""}${cut(i > 0 ? body.slice(i + 2) : body, 200)}` });
    } else if (l.kind === "applied") add({ at: l.at, kind: "applied", text: l.text.startsWith("보충 ") ? `해 봤어요 ✓ (${l.text})` : "해 봤어요 ✓" });
    else if (l.kind === "stuck") add({ at: l.at, kind: "stuck", text: cut(l.text, 160) });
    else if (l.kind === "easy") add({ at: l.at, kind: "easy", text: "너무 쉬워요" });
    else if (l.kind === "support") add({ at: l.at, kind: "support", text: cut(l.text, 200) });
    else if (l.kind === "support-done") add({ at: l.at, kind: "support-done", text: cut(l.text, 160) });
    else if (l.kind === "support-close" || l.kind === "support-back") { if (l.kind === "support-back") add({ at: l.at, kind: "back", text: "보충을 마치고 원래 목표로" }); }
  }
  // 기록이 잘려(최근 200줄) 끝나지 않은 목표가 지금 목표와 다르면 그 목표는 이름만 남는다
  const last = out.at(-1);
  if (last && !last.endAt && current && !last.title) last.title = current.title;
  if (last && !last.endAt && !current) last.result = "멈춤";
  return out.filter((g) => g.title || g.events.length);
}
