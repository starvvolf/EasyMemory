// 가짜 AI (--dry, 설계 9번의 4): AI 0번. 연출가 · 검사 · 정답지 · 드라이버가 끝까지 도는지만 본다.
//   - 가짜 튜터: 코드에 틀린 조각의 흔적이 있으면 그 맞는 조각을, 실수(지도 코드와 한두 줄 다름)면 그 줄을, 걸음 이름을 물으면 그 걸음의 조각을,
//     방법을 물으면 정석 길의 틀 · 도구를 알려 준다. 조각 예시(3~8줄)만 보여 주고 풀이 전체는 주지 않는다.
//   - 앱이 부르는 다른 AI 자리(문제 한 장 · 총정리 · 빈틈 뽑기 …)는 스키마 모양의 빈 답. 빈틈 뽑기는 빈 목록 → 채점에서 "AI 필요"로 적는다.
import { setFakeModelResponder, type ModelRequest } from "../ai/model.ts";
import { program, rightPicks } from "./map.ts";
import type { Fragment, ProblemMap } from "./types.ts";

const norm = (s: string) => s.replace(/#[^\n]*/g, "").replace(/\s+/g, " ").trim();
const teach = (fs: Fragment[], lead: string) => [lead, ...fs.map((f) => `- ${f.what}\n  예:\n${f.example.split("\n").map((l) => `    ${l}`).join("\n")}`)].join("\n");

/** 가짜 튜터 답 */
export function dryTutorAnswer(map: ProblemMap, question: string, code: string): string {
  const c = norm(code);
  const frag = (id: string) => map.fragments.find((f) => f.id === id);
  // 1 틀린 조각의 흔적(자리 코드 · 그 조각을 쓰는 걸음 코드)
  for (const w of map.fragments.filter((f) => f.wrong)) {
    // 자리 코드: 틀린 쪽이 있고 맞는 쪽이 없어야(한쪽만 넣기는 양쪽 넣기 코드의 일부라서)
    const inSlot = map.routes.some((r) => Object.values(r.slots).some((s) => {
      const wa = norm(s.alts[w.id] ?? ""), ra = norm(s.alts[s.right] ?? "");
      return wa.length >= 8 && c.includes(wa) && !(ra && c.includes(ra));
    }));
    const inStep = map.routes.some((r) => r.steps.some((s) => s.uses.includes(w.id) && norm(s.code).length >= 8 && c.includes(norm(s.code))));
    const right = w.right ? frag(w.right) : undefined;
    if (right && (inSlot || inStep)) return teach([right], `(가짜 튜터) 지금 코드는 "${w.what}"라고 생각하고 짠 것 같아요. 그런데 그러면 안 돼요.`);
  }
  // 2 실수: 어떤 길의 맞는 코드와 한두 줄만 다름 → 그 줄을 짚는다(조각은 안 가르침)
  const mine = code.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  // 실수 줄은 어느 길에도 없는 줄이다(다른 길의 줄이면 실수가 아니라 다른 생각)
  const known = new Set(map.routes.flatMap((r) => [program(r, rightPicks(r)), ...Object.values(r.slots).flatMap((s) => Object.values(s.alts))].join("\n").split("\n").map((l) => l.trimEnd())));
  for (const r of map.routes) {
    const ref = program(r, rightPicks(r)).split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
    if (Math.abs(ref.length - mine.length) > 0) continue;
    const diff = ref.map((l, i) => (l !== mine[i] ? i : -1)).filter((i) => i >= 0);
    if (diff.length >= 1 && diff.length <= 2 && diff.every((i) => !known.has(mine[i]))) return `(가짜 튜터) 생각은 맞아요. ${diff[0] + 1}번째 줄 \`${mine[diff[0]].trim()}\`을 다시 보세요. 쓰려던 것과 다르게 쳤어요.`;
  }
  // 3 걸음 이름을 물음 → 그 걸음의 조각
  const step = map.routes.flatMap((r) => r.steps).find((s) => s.text && question.includes(s.text));
  if (step) {
    const fs = step.uses.map(frag).filter((f): f is Fragment => Boolean(f && !f.wrong));
    if (fs.length) return teach(fs, `(가짜 튜터) "${step.text}"는 이렇게 해요.`);
  }
  // 4 방법 → 정석 길(흔한 맞는 길)의 방법 · 틀 · 도구
  const best = [...map.routes].filter((r) => r.measured?.verdict === "AC" && !r.needs.some((n) => frag(n)?.wrong)).sort((a, b) => (b.prior ?? 0) - (a.prior ?? 0))[0];
  if (!best) return "(가짜 튜터) 문제를 다시 읽어 봐요.";
  const fs = best.needs.map(frag).filter((f): f is Fragment => Boolean(f && !f.wrong && f.layer >= 2 && (f.id.startsWith("idea.") || f.id.startsWith("frame.") || f.id.startsWith("tool."))));
  return teach(fs.slice(0, 4), `(가짜 튜터) ${best.name} 방법으로 풀 수 있어요.`);
}

/** 스키마 모양의 빈 답 */
export function emptyOf(schema: unknown): unknown {
  const s = (schema ?? {}) as { type?: string | string[]; properties?: Record<string, unknown>; enum?: unknown[]; items?: unknown };
  if (s.enum?.length) return s.enum[0];
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  if (t === "object") return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, emptyOf(v)]));
  if (t === "array") return [];
  if (t === "integer" || t === "number") return 0;
  if (t === "boolean") return false;
  return "";
}
const between = (text: string, start: string, end: string) => { const i = text.indexOf(start); if (i < 0) return ""; const rest = text.slice(i + start.length); const j = end ? rest.indexOf(end) : -1; return j >= 0 ? rest.slice(0, j) : rest; };
const DRY_REVIEW = `# 학습 총평\n\n(가짜 AI 총정리) 이 글은 --dry 실행에서 만든 빈 틀이에요. 실제 총정리는 AI가 기록을 읽고 써요. 채점에서는 이 글을 쓰지 않아요.\n\n# 핵심 학습 리뷰\n\n(가짜 AI) 대화와 제출 기록은 그대로 남아 있어요. 실제 AI로 다시 돌리면(--replay) 이 자리에 이 풀이의 약한 곳이 들어가요.\n`;

/** 가짜 AI 깔기: 앱이 부르는 AI 자리마다 답한다. 몇 번 불렸는지 센다(목적별). */
export function installDry(map: ProblemMap) {
  const calls: Record<string, number> = {};
  setFakeModelResponder((req: ModelRequest) => {
    calls[req.purpose] = (calls[req.purpose] ?? 0) + 1;
    const all = `${req.user}\n\n${req.tail ?? ""}`;
    if (req.purpose === "code:explain") return dryTutorAnswer(map, between(all, "[질문] ", "\n\n") || all, between(all, "[지금 코드]\n", "\n\n[학습자가 드래그한 부분]"));
    if (req.purpose === "code:hint") return dryTutorAnswer(map, "", between(all, "[학습자 코드]\n", "\n\n["));
    if (req.purpose === "code:review-sheet") return DRY_REVIEW;
    if (req.json || req.schema) return JSON.stringify(emptyOf(req.schema));
    return "(가짜 AI 답)";
  });
  return { calls, uninstall: () => setFakeModelResponder(null) };
}
