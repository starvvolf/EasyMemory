// Verification 11 only: fixed fixtures, isolated data, and no external fetches.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { labFakeReply } from "../src/lib/study/lab-fake.ts";
import { ModelError } from "../src/lib/ai/model.ts";

if (process.env.STUDY_FORGE_VERIFICATION_11 !== "1" || !process.env.STUDY_FORGE_DATA_DIR) {
  throw new Error("Verification 11 bootstrap requires the isolated verification server.");
}
process.env.STUDY_FORGE_MODEL_PROVIDER = "fake";
const root = process.env.STUDY_FORGE_DATA_DIR;
const ledgerFile = path.join(root, "fake-call-ledger.jsonl");
const faultFile = path.join(root, "fault.json");

const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Verification 11 blocks external network requests.");
  }
  return originalFetch(input, options);
};

globalThis.__studyForgeFakeResponder = async (request) => {
  const purpose = request.purpose;
  const permitted = /^(stage:(analyze|concept-tree|learning-design|activity-design|cards)|authoring|note:(ask|follow|chat|title))$/;
  if (!permitted.test(purpose)) throw new Error("Unconfigured verification fixture purpose.");
  const n = existsSync(ledgerFile) ? readFileSync(ledgerFile, "utf8").trim().split("\n").filter(Boolean).length + 1 : 1;
  appendFileSync(ledgerFile, JSON.stringify({ n, purpose }) + "\n", { mode: 0o600 });
  if (existsSync(faultFile)) {
    const fault = JSON.parse(readFileSync(faultFile, "utf8"));
    if (fault.purpose === purpose && fault.remaining > 0) {
      const allowed = ["login_required", "usage_limit", "transient", "invalid_output", "not_configured"];
      if (!allowed.includes(fault.code)) throw new Error("Unknown verification fault code.");
      writeFileSync(faultFile, JSON.stringify({ ...fault, remaining: fault.remaining - 1 }), { mode: 0o600 });
      throw new ModelError(fault.code, `Verification fixture: ${fault.code}`);
    }
  }
  if (purpose === "note:ask") return JSON.stringify({ kind: "term", lead: "BFS는 시작점에서 가까운 노드부터 살펴보는 탐색입니다.", steps: [], quote: "Then all nodes that are 1 edge from u.", extra: null, outsideSource: null });
  if (purpose === "note:follow" || purpose === "note:chat") return "큐에 먼저 들어온 노드를 먼저 꺼내므로 가까운 거리부터 방문합니다.";
  if (purpose === "note:title") return "BFS 방문 순서와 큐";
  const stage = purpose.startsWith("stage:") ? purpose.slice(6) : purpose;
  const fileName = /\[자료\] ([^\r\n]+)/.exec(request.user)?.[1] ?? "cornell-bfs-2pages.pdf";
  if (stage === "analyze") {
    const pages = (/\[쪽\] ([^\r\n]+)/.exec(request.user)?.[1] ?? "1")
      .split(",").map(Number).filter((page) => Number.isInteger(page) && page > 0).sort((a, b) => a - b);
    const range = pages.length > 1 ? `${pages[0]}-${pages.at(-1)}` : `${pages[0] ?? 1}`;
    return JSON.stringify({ outlineText: `@file ${fileName}\n# 너비 우선 탐색 [${range}]` });
  }
  return labFakeReply(stage, request.user, fileName, "normal", 1);
};
