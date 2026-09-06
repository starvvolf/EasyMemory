import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  API_ALIGNED_STAGES,
  createOpenAiStageGenerator,
  runAlignedPipeline,
  type ReasoningEffort,
} from "./pipeline.ts";

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`알 수 없는 인자입니다: ${key}`);
    if (key === "--resume") {
      flags.set(key, "true");
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${key} 값이 필요합니다.`);
    flags.set(key, value);
    index += 1;
  }
  const required = ["--pdf", "--output", "--goal"];
  for (const key of required) if (!flags.get(key)) throw new Error(`${key}가 필요합니다.`);
  const reasoning = (flags.get("--reasoning") ?? "medium") as ReasoningEffort;
  if (!new Set(["none", "low", "medium", "high", "xhigh", "max"]).has(reasoning)) {
    throw new Error("--reasoning 값이 올바르지 않습니다.");
  }
  const stopAfter = flags.get("--stop-after");
  if (stopAfter && !API_ALIGNED_STAGES.includes(stopAfter as never)) {
    throw new Error("--stop-after 단계가 올바르지 않습니다.");
  }
  return {
    pdfPath: path.resolve(flags.get("--pdf")!),
    outputDirectory: path.resolve(flags.get("--output")!),
    learningGoal: flags.get("--goal")!,
    title: flags.get("--title") ?? path.basename(flags.get("--pdf")!, ".pdf"),
    instruction: flags.get("--instruction") ?? "",
    subject: flags.get("--subject") ?? "",
    tags: (flags.get("--tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
    sourceExpressionMode: flags.get("--source-expression-mode") === "preserve" ? "preserve" as const : "adapt" as const,
    model: flags.get("--model") ?? process.env.OPENAI_MODEL ?? "gpt-5.6-terra",
    reasoningEffort: reasoning,
    maxAttemptsPerStage: Number(flags.get("--max-attempts") ?? "3"),
    resume: flags.get("--resume") === "true",
    stopAfter: stopAfter as typeof API_ALIGNED_STAGES[number] | undefined,
    envFile: flags.get("--env-file"),
  };
}

async function pageCount(pdfPath: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = new Uint8Array(await readFile(pdfPath));
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  return document.numPages;
}

export async function main(argv: string[]) {
  const options = parseArgs(argv);
  if (options.envFile) process.loadEnvFile(path.resolve(options.envFile));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 환경변수가 필요합니다.");
  const result = await runAlignedPipeline({
    ...options,
    pageCount: await pageCount(options.pdfPath),
    generateStage: createOpenAiStageGenerator({ apiKey: process.env.OPENAI_API_KEY }),
  });
  console.log(JSON.stringify({
    outputDirectory: result.outputDirectory,
    status: result.manifest.status,
    nextStage: result.manifest.nextStage,
    totalUsage: result.manifest.totalUsage,
    totalApiDurationMs: result.manifest.totalApiDurationMs,
  }, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
