import { existsSync, readFileSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { budgetFetch, proveBudget } from "./verification-11-real-budget.mjs";
import envModule from "@next/env";

const { loadEnvConfig } = envModule;
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
if (!process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY) {
  const keyFile = path.join(homedir(), ".study-forge", "chatgpt-token-key");
  if (existsSync(keyFile)) process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY = readFileSync(keyFile, "utf8").trim();
}
const resultsRoot = path.join(process.cwd(), "협업", "검증_11", "real");
mkdirSync(resultsRoot, { recursive: true });
const proofRoot = mkdtempSync(path.join(tmpdir(), "verification-real-budget-"));
const proof = await proveBudget(path.join(proofRoot, "proof.json"));
const ledgerFile = path.join(resultsRoot, "call-budget.json");
globalThis.fetch = budgetFetch(ledgerFile, globalThis.fetch.bind(globalThis));
const { chatgptBackend } = await import("../src/lib/ai/chatgpt-provider.ts");
const { chatGptStorageReady, credentialFor } = await import("../src/lib/ai/chatgpt-auth.ts");
let credentialStored = false;
try { credentialStored = Boolean((await credentialFor("local-experiment"))?.refreshToken); } catch { /* No secret or raw filesystem error is recorded. */ }
const status = await chatgptBackend.status({ uid: "local-experiment" });
const result = { checkedAt: new Date().toISOString(), proof, provider: "chatgpt", storageReady: chatGptStorageReady(),
  credentialStored, ready: status.ready, message: status.message,
  notesModel: process.env.STUDY_FORGE_NOTE_MODEL?.trim() || process.env.STUDY_FORGE_EXECUTOR_MODEL?.trim() || "gpt-6-sol",
  notesEffort: process.env.STUDY_FORGE_NOTE_EFFORT?.trim() || "low",
  modelCalls: existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")).calls.length : 0,
};
writeFileSync(path.join(resultsRoot, "preflight.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (!status.ready) process.exitCode = 2;
