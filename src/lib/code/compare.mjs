// 출력 비교 (2026-10-26, docs/DECISIONS.md "로컬 채점"): one place that decides whether an output matches the expected
// one, used by the learner's judge (run.ts) and by the test maker (testgen/harness.mjs, plain Node, so this is .mjs).
//
// Modes:
//   exact  — as most judges: \r\n as \n, spaces/tabs at line ends and blank lines at the end ignored, everything else exact.
//   approx — token by token; numbers may differ by an absolute or relative error up to `eps` (default 1e-6), other
//            tokens must be equal. Not yet offered to AI-made problems (they are refused before saving).
// The result says where the first difference is, so a wrong answer can say "3번째 줄, 2번째 값" instead of only "WA".

/** @param {string} text */
export const normalizeOutput = (text) => String(text).replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").replace(/\n+$/, "");

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * @param {string} got
 * @param {string} want
 * @param {{ mode?: "exact" | "approx", eps?: number }} [how]
 * @returns {{ ok: true } | { ok: false, line: number, token?: number, want: string, got: string, why: string }}
 */
export function compareOutput(got, want, how = {}) {
  const a = normalizeOutput(got).split("\n"), b = normalizeOutput(want).split("\n");
  const mode = how.mode ?? "exact";
  if (mode === "approx") return approx(a, b, how.eps ?? 1e-6);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (a[i] === undefined) return { ok: false, line: i + 1, want: b[i], got: "", why: `${i + 1}번째 줄이 없어요 (출력이 짧음)` };
    if (b[i] === undefined) return { ok: false, line: i + 1, want: "", got: a[i], why: `${i + 1}번째 줄은 없어야 해요 (출력이 김)` };
    const ta = a[i].split(" "), tb = b[i].split(" ");
    const j = ta.findIndex((t, k) => t !== tb[k]);
    const token = j === -1 ? tb.length : j;
    return { ok: false, line: i + 1, token: token + 1, want: b[i], got: a[i],
      why: ta.join("") === tb.join("") ? `${i + 1}번째 줄: 띄어쓰기가 달라요` : `${i + 1}번째 줄 ${token + 1}번째 값이 달라요` };
  }
  return { ok: true };
}

/** @param {string[]} a @param {string[]} b @param {number} eps */
function approx(a, b, eps) {
  const words = (lines) => lines.flatMap((l, i) => l.split(/\s+/).filter(Boolean).map((w, k) => ({ w, line: i + 1, token: k + 1 })));
  const wa = words(a), wb = words(b);
  for (let i = 0; i < Math.max(wa.length, wb.length); i++) {
    const x = wa[i], y = wb[i];
    if (!x) return { ok: false, line: y.line, token: y.token, want: y.w, got: "", why: "값이 모자라요" };
    if (!y) return { ok: false, line: x.line, token: x.token, want: "", got: x.w, why: "값이 너무 많아요" };
    if (x.w === y.w) continue;
    if (NUMBER.test(x.w) && NUMBER.test(y.w)) {
      const p = Number(x.w), q = Number(y.w);
      if (Math.abs(p - q) <= eps || Math.abs(p - q) <= eps * Math.abs(q)) continue;
      return { ok: false, line: y.line, token: y.token, want: y.w, got: x.w, why: `${y.line}번째 줄 ${y.token}번째 값: 오차가 ${eps}보다 커요` };
    }
    return { ok: false, line: y.line, token: y.token, want: y.w, got: x.w, why: `${y.line}번째 줄 ${y.token}번째 값이 달라요` };
  }
  return { ok: true };
}
