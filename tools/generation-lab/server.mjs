import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listRuns, loadRun } from "./artifact-reader.mjs";
import { renderRun } from "./renderers.mjs";
import { GenerationLabRunExecutor } from "./run-executor.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(moduleDirectory, "public");
const repoRoot = path.resolve(moduleDirectory, "..", "..");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": contentTypes[".json"], "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("PDF 용량은 최대 50MB입니다.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveStatic(response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!/^[a-zA-Z0-9._/-]+$/.test(relative) || relative.includes("..")) return false;
  try {
    const filePath = path.join(publicDirectory, relative);
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] ?? "application/octet-stream" });
    response.end(body);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function createGenerationLabServer(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const executor = options.executor ?? new GenerationLabRunExecutor(options.executorOptions);
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/api/runs") {
        return json(response, 200, { runs: await listRuns(root) });
      }
      if (request.method === "POST" && url.pathname === "/api/experiments") {
        if (executor.isRunning()) return json(response, 409, { error: "다른 실험이 실행 중입니다." });
        if (request.headers["content-type"] !== "application/pdf") return json(response, 415, { error: "PDF 파일만 실행할 수 있습니다." });
        const fileName = url.searchParams.get("fileName") ?? "source.pdf";
        const learningGoal = url.searchParams.get("learningGoal")?.trim() ?? "";
        if (!fileName.toLowerCase().endsWith(".pdf")) return json(response, 400, { error: "PDF 파일만 실행할 수 있습니다." });
        if (!learningGoal) return json(response, 400, { error: "학습 목표를 입력하세요." });
        const pdfBytes = await readBody(request, 50 * 1024 * 1024);
        if (!pdfBytes.length) return json(response, 400, { error: "PDF 파일을 선택하세요." });
        const job = executor.start({ pdfBytes, fileName, learningGoal, repoRoot: root });
        return json(response, 202, { jobId: job.jobId });
      }
      const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (request.method === "GET" && jobMatch) {
        const job = executor.get(decodeURIComponent(jobMatch[1]));
        return job ? json(response, 200, job) : json(response, 404, { error: "실행 작업을 찾을 수 없습니다." });
      }
      const match = url.pathname.match(/^\/api\/runs\/([^/]+)\/([^/]+)$/);
      if (request.method === "GET" && match) {
        const [, caseId, runId] = match.map(decodeURIComponent);
        try {
          return json(response, 200, renderRun(await loadRun(root, caseId, runId)));
        } catch (error) {
          return json(response, 422, { error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (request.method === "GET" && (await serveStatic(response, url.pathname))) return;
      json(response, 404, { error: "찾을 수 없습니다." });
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function listenWithFallback(server, preferredPort) {
  for (let port = preferredPort; port < preferredPort + 10; port += 1) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => { server.off("listening", onListening); reject(error); };
        const onListening = () => { server.off("error", onError); resolve(); };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
      });
      return port;
    } catch (error) {
      if (error?.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("Generation Lab이 사용할 포트를 찾지 못했습니다.");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createGenerationLabServer();
  const port = await listenWithFallback(server, Number(process.env.GENERATION_LAB_PORT ?? 4310));
  console.log(`Generation Lab: http://127.0.0.1:${port}`);
}
