// 모델 가격표 (2026-11-06, AI 호출 실험실): API로 냈다면 얼마인지 보는 값이다. 앱은 ChatGPT 구독으로 부르므로 실제로 돈이
// 나가지는 않는다 — 사용량을 가늠하는 잣대. 100만 토큰당 달러, 짧은 입력(272K 이하) 기준.
// 출처: tokencost.app(gpt-6.1-terra), mixed-news(gpt-6.1-sol·gpt-6-sol·astra), eesel(gpt-6-luna). 바뀌면 여기만 고친다.
export type Price = { in: number; cached: number; out: number };
const TABLE: Array<[RegExp, Price]> = [
  [/^gpt-6\.1-terra/, { in: 1, cached: 0.05, out: 5 }],
  [/^gpt-6\.1-sol/, { in: 2, cached: 0.1, out: 10 }],
  [/^gpt-6-sol/, { in: 2, cached: 0.2, out: 10 }],
  [/luna/, { in: 0.1, cached: 0.01, out: 0.5 }],
  [/astra/, { in: 10, cached: 1, out: 50 }],
];
export function priceOf(model: string | undefined): Price | null {
  const m = String(model ?? "").toLowerCase();
  return TABLE.find(([re]) => re.test(m))?.[1] ?? null;
}
export type Tokens = { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number };
/** 달러. 입력 토큰 수에는 캐시된 것도 들어 있다(API 보고 방식) → 캐시 아닌 몫만 입력 값으로. 가격을 모르면 null. */
export function costOf(model: string | undefined, u: Tokens | undefined): number | null {
  const p = priceOf(model);
  if (!p || !u) return null;
  const cached = u.cachedInputTokens ?? 0;
  const fresh = Math.max(0, (u.inputTokens ?? 0) - cached);
  return (fresh * p.in + cached * p.cached + (u.outputTokens ?? 0) * p.out) / 1e6;
}
