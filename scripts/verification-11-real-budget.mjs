import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const endpoint = "https://api.openai.com/v1/responses";
export function budgetFetch(file, delegate, context = () => ({})) {
  return async (input, options) => {
    const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url !== endpoint) return delegate(input, options);
    const ledger = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { limit: 60, calls: [] };
    if (ledger.limit !== 60 || ledger.calls.length >= 60 || ledger.stopped) throw new Error("Verification real model call limit reached.");
    const body = JSON.parse(options?.body ?? "{}");
    if (ledger.unavailableModels?.includes(body.model)) throw new Error("Verification model unavailable; substitution is forbidden.");
    const user = body.input?.[0]?.content ?? "";
    const correction = /\[검사 오류\]\n([\s\S]*?)\n\n이전 답/.exec(user)?.[1];
    const meta = context();
    const stage = /\[단계\] ([^\r\n]+)/.exec(user)?.[1] ?? (user.includes("[출제 패킷]") ? "authoring" : "note:ask");
    if (correction) {
      const signature = createHash("sha256").update(correction).digest("hex");
      ledger.correctionCounts ??= {};
      ledger.correctionCounts[signature] = (ledger.correctionCounts[signature] ?? 0) + 1;
      if (ledger.correctionCounts[signature] >= 2) {
        ledger.stopped = "same-validation-failure-twice";
        writeFileSync(file, JSON.stringify(ledger, null, 2), { mode: 0o600 });
        throw new Error("Verification stops after two identical validation failures.");
      }
    }
    ledger.calls.push({ n: ledger.calls.length + 1, at: new Date().toISOString(), model: body.model,
      effort: body.reasoning?.effort ?? null, stage, ...meta });
    writeFileSync(file, JSON.stringify(ledger, null, 2), { mode: 0o600 });
    let response;
    try { response = await delegate(input, options); }
    catch (error) {
      const updated = JSON.parse(readFileSync(file, "utf8"));
      const causeCode = error?.cause?.code ?? error?.code;
      updated.calls.at(-1).transportFailed = true;
      updated.calls.at(-1).transportCode = typeof causeCode === "string" && /^[a-zA-Z0-9_]{1,100}$/.test(causeCode) ? causeCode : "unknown";
      writeFileSync(file, JSON.stringify(updated, null, 2), { mode: 0o600 });
      throw error;
    }
    const updated = JSON.parse(readFileSync(file, "utf8"));
    updated.calls.at(-1).httpStatus = response.status;
    if (!response.ok) {
      let failure = {};
      try { failure = await response.clone().json(); } catch { /* Status is sufficient when the gateway has no JSON. */ }
      const rawCode = failure.error?.code;
      const code = typeof rawCode === "string" && /^[a-zA-Z0-9_]{1,100}$/.test(rawCode) ? rawCode : `http_${response.status}`;
      updated.calls.at(-1).errorCode = code;
      if (/unsupported|model_not_found|not_found_model/.test(code)) updated.unavailableModels = [...new Set([...(updated.unavailableModels ?? []), body.model])];
      const signature = `${body.model}:${stage}:${code}`;
      updated.repeatedHttpErrors = updated.lastHttpError === signature ? (updated.repeatedHttpErrors ?? 0) + 1 : 1;
      updated.lastHttpError = signature;
      if (updated.repeatedHttpErrors >= 2) updated.stopped = "same-http-failure-twice";
      globalThis.__verification11Event?.({ type: "http-failure", model: body.model, stage, status: response.status, code });
    } else { updated.lastHttpError = null; updated.repeatedHttpErrors = 0; }
    writeFileSync(file, JSON.stringify(updated, null, 2), { mode: 0o600 });
    return response;
  };
}
export function stopRepeatedRecordedFailures(file, calls) {
  const ledger = JSON.parse(readFileSync(file, "utf8"));
  const counts = {};
  for (const call of calls.filter((call) => !call.ok && call.error)) {
    const signature = createHash("sha256").update(call.error).digest("hex");
    counts[signature] = (counts[signature] ?? 0) + 1;
  }
  ledger.recordedFailureCounts = counts;
  if (Object.values(counts).some((count) => count >= 2)) ledger.stopped = "same-recorded-failure-twice";
  writeFileSync(file, JSON.stringify(ledger, null, 2));
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
