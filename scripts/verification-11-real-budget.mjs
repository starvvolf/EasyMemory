import { existsSync, readFileSync, writeFileSync } from "node:fs";
const endpoint = "https://api.openai.com/v1/responses";
export function budgetFetch(file, delegate, context = () => ({})) {
  return async (input, options) => {
    const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url !== endpoint) return delegate(input, options);
    const ledger = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { limit: 60, calls: [] };
    if (ledger.limit !== 60 || ledger.calls.length >= 60 || ledger.stopped) throw new Error("Verification real model call limit reached.");
    const body = JSON.parse(options?.body ?? "{}");
    ledger.calls.push({ n: ledger.calls.length + 1, at: new Date().toISOString(), model: body.model,
      effort: body.reasoning?.effort ?? null, ...context() });
    writeFileSync(file, JSON.stringify(ledger, null, 2), { mode: 0o600 });
    return delegate(input, options);
  };
}
export async function proveBudget(file) {
  let outgoing = 0;
  const guarded = budgetFetch(file, async () => { outgoing += 1; return new Response("{}", { status: 200 }); });
  for (let i = 0; i < 60; i++) await guarded(endpoint, { body: "{}" });
  let blocked = false;
  try { await guarded(endpoint, { body: "{}" }); } catch { blocked = true; }
  if (!blocked || outgoing !== 60) throw new Error("Budget proof failed.");
  return { outgoingFakeCalls: outgoing, sixtyFirstBlocked: blocked, realCalls: 0 };
}
