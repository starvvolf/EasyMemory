// 실습 서버의 경로와 줄 비교(2026-11-11 정해진 코스를 뺀 뒤 남은 것). 예전 코스 읽기(courses/ · 단계 · 템플릿)는 git 기록에 있다.
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 이 실습 서버 폴더(experiments/project-course) */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** 앱 저장소 맨 위 */
export const APP_ROOT = path.resolve(ROOT, "..", "..");

/** 줄 단위 차이(앞뒤 context줄). "+ 더함" · "- 뺌" · "  같음", 떨어진 곳은 "  …" */
export function lineDiff(a: string[], b: string[], context = 2) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: { t: " " | "+" | "-"; text: string; line: number }[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { ops.push({ t: " ", text: b[j], line: j + 1 }); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { ops.push({ t: "+", text: b[j], line: j + 1 }); j++; }
    else { ops.push({ t: "-", text: a[i], line: j + 1 }); i++; }
  }
  const keep = ops.map((_, k) => ops.slice(Math.max(0, k - context), k + context + 1).some((o) => o.t !== " "));
  const out: string[] = [];
  ops.forEach((o, k) => {
    if (!keep[k]) return;
    if (k > 0 && !keep[k - 1]) out.push("  …");
    out.push(`${o.t} ${o.text}`);
  });
  return out.join("\n");
}
