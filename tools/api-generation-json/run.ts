import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createOpenAiJsonGenerator, runJsonPipeline } from "./pipeline.ts";

function parseArgs(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--resume") {
      values.set(key, "true");
      continue;
    }
    if (!key.startsWith("--") || !argv[index + 1]) throw new Error(`인자가 올바르지 않습니다: ${key}`);
    values.set(key, argv[index + 1]);
    index += 1;
  }
  for (const key of ["--pdf", "--output", "--goal"]) if (!values.get(key)) throw new Error(`${key}가 필요합니다.`);
  return {
    pdfPath: path.resolve(values.get("--pdf")!),
    outputDirectory: path.resolve(values.get("--output")!),
    title: values.get("--title") ?? path.basename(values.get("--pdf")!, ".pdf"),
    learningGoal: values.get("--goal")!,
    instruction: values.get("--instruction") ?? "",
    sourceExpressionMode: values.get("--source-expression-mode") === "preserve" ? "preserve" as const : "adapt" as const,
    maxAttemptsPerStage: Number(values.get("--max-attempts") ?? "3"),
    resume: values.get("--resume") === "true",
    envFile: values.get("--env-file"),
  };
}

async function pageCount(pdfPath: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: new Uint8Array(await readFile(pdfPath)) }).promise;
  return document.numPages;
}

export async function main(argv: string[]) {
  const options = parseArgs(argv);
  if (options.envFile) process.loadEnvFile(path.resolve(options.envFile));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 환경변수가 필요합니다.");
  const completed = await runJsonPipeline({
    ...options,
    pageCount: await pageCount(options.pdfPath),
    generateStage: createOpenAiJsonGenerator({ apiKey: process.env.OPENAI_API_KEY }),
  });
  console.log(JSON.stringify({
    outputDirectory: completed.outputDirectory,
    status: completed.manifest.status,
    model: completed.manifest.model,
    reasoningEffort: completed.manifest.reasoningEffort,
    attemptsByStage: completed.manifest.attemptsByStage,
    totalUsage: completed.manifest.totalUsage,
    contentPreserved: completed.result.contentPreserved,
  }, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
