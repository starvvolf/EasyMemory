import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RECOVERY_COMMIT = "150138f73301365b7d07fbfab4b8093c8f4409ca";
export const COMPARISON_COMMIT = "115c895df9bc9d279103fc71902855c3a2be27e9";
export const DEFAULT_GOAL = "이 자료의 핵심 내용을 반복학습 문제로 익힌다.";

const SOURCE_FILES = [
  "src/lib/pipeline/analyze.ts",
  "src/lib/pipeline/plan.ts",
  "src/lib/pipeline/recall.ts",
  "src/lib/pipeline/generate.ts",
  "src/lib/model-config.ts",
  "src/lib/types.ts",
  "scripts/eval-full-runner.ts",
  "scripts/eval-runner.ts",
];

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    values.set(argv[index], argv[index + 1]);
  }
  const pdf = values.get("--pdf");
  const envFile = values.get("--env-file");
  const nodeModules = values.get("--node-modules");
  if (!pdf || !envFile || !nodeModules) {
    throw new Error(
      "사용법: node tools/api-generation-baseline/run.mjs --pdf <lecture8.pdf> --env-file <.env.local> --node-modules <node_modules>",
    );
  }
  return { pdf, envFile, nodeModules };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(repoRoot, args, options = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: options.encoding === "buffer" ? null : options.encoding ?? "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function compareCandidates(repoRoot) {
  const parent150 = git(repoRoot, ["show", "-s", "--format=%P", RECOVERY_COMMIT]).trim();
  const parent115 = git(repoRoot, ["show", "-s", "--format=%P", COMPARISON_COMMIT]).trim();
  if (!parent150 || parent150 !== parent115) {
    throw new Error("복구 후보 두 개가 같은 부모의 형제 스냅샷이라는 전제가 깨졌습니다.");
  }
  const changedFiles = git(repoRoot, [
    "diff",
    "--name-status",
    RECOVERY_COMMIT,
    COMPARISON_COMMIT,
    "--",
    "src/lib/pipeline",
    "src/lib/model-config.ts",
    "src/lib/types.ts",
    "scripts",
  ]).trim().split(/\r?\n/).filter(Boolean);
  const coreDiff = git(repoRoot, [
    "diff",
    "--numstat",
    RECOVERY_COMMIT,
    COMPARISON_COMMIT,
    "--",
    "src/lib/pipeline/analyze.ts",
    "src/lib/pipeline/plan.ts",
    "src/lib/pipeline/generate.ts",
  ]).trim().split(/\r?\n/).filter(Boolean);
  const identicalSupportFiles = [
    "src/lib/model-config.ts",
    "src/lib/pipeline/recall.ts",
    "scripts/eval-full-runner.ts",
    "scripts/eval-runner.ts",
  ].every((file) => {
    const diff = git(repoRoot, ["diff", RECOVERY_COMMIT, COMPARISON_COMMIT, "--", file]);
    return diff.length === 0;
  });
  return { parent: parent150, changedFiles, coreDiff, identicalSupportFiles };
}

function sourceChecksums(repoRoot) {
  return Object.fromEntries(SOURCE_FILES.map((file) => {
    const content = git(repoRoot, ["show", `${RECOVERY_COMMIT}:${file}`], { encoding: "buffer" });
    return [file, sha256(content)];
  }));
}

async function ensureReadable(target, label) {
  try {
    await access(target);
  } catch {
    throw new Error(`${label}을(를) 읽을 수 없습니다: ${target}`);
  }
}

async function extractCommit(repoRoot, workspace) {
  const archive = path.join(workspace, "snapshot.tar");
  await mkdir(workspace, { recursive: true });
  execFileSync(
    "git",
    [
      "archive",
      "--format=tar",
      `--output=${archive}`,
      RECOVERY_COMMIT,
      "src",
      "scripts",
      "package.json",
      "tsconfig.json",
    ],
    { cwd: repoRoot, stdio: "pipe" },
  );
  execFileSync("tar", ["-xf", archive, "-C", workspace], { cwd: repoRoot, stdio: "pipe" });
  await rm(archive, { force: true });
}

function summarizeCalls(calls) {
  const totals = calls.reduce(
    (sum, call) => {
      const usage = call.response?.usage ?? {};
      sum.inputTokens += Number(usage.input_tokens ?? 0);
      sum.outputTokens += Number(usage.output_tokens ?? 0);
      sum.totalTokens += Number(usage.total_tokens ?? 0);
      sum.durationMs += call.durationMs;
      return sum;
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: 0 },
  );
  return { callCount: calls.length, ...totals };
}

export async function runRecovery({ repoRoot, pdf, envFile, nodeModules }) {
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedPdf = path.resolve(pdf);
  const resolvedEnv = path.resolve(envFile);
  const resolvedModules = path.resolve(nodeModules);
  await Promise.all([
    ensureReadable(resolvedPdf, "고정 PDF"),
    ensureReadable(resolvedEnv, "API 환경 파일"),
    ensureReadable(resolvedModules, "node_modules"),
  ]);
  process.loadEnvFile(resolvedEnv);
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("지정한 환경 파일에 OPENAI_API_KEY가 없습니다.");
  }

  // 환경 파일의 모델 override가 과거 코드 기본값을 바꾸지 못하게 고정한다.
  process.env.OPENAI_MODEL = "gpt-5.6-terra";
  process.env.OPENAI_EXTRACTION_MODEL = "gpt-5.6-terra";
  process.env.OPENAI_CRITIC_MODEL = "gpt-5.6-terra";
  process.env.OPENAI_CRITIC_ENABLED = "false";

  const comparison = compareCandidates(resolvedRoot);
  const checksums = sourceChecksums(resolvedRoot);
  const workspace = path.join(resolvedRoot, ".recovery-work", `openai-api-150138f-${process.pid}`);
  const startedAt = new Date();
  let activeStage = "bootstrap";
  const calls = [];
  const nativeFetch = globalThis.fetch;

  try {
    await extractCommit(resolvedRoot, workspace);
    await symlink(resolvedModules, path.join(workspace, "node_modules"), "junction");

    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== "https://api.openai.com/v1/responses") return nativeFetch(input, init);
      const callStartedAt = new Date();
      const requestBody = JSON.parse(String(init?.body ?? "{}"));
      const response = await nativeFetch(input, init);
      const rawResponse = await response.clone().json();
      calls.push({
        sequence: calls.length + 1,
        stage: activeStage,
        startedAt: callStartedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - callStartedAt.getTime(),
        httpStatus: response.status,
        requestConfiguration: {
          model: requestBody.model,
          reasoning: requestBody.reasoning,
          schemaName: requestBody.text?.format?.name,
          schema: requestBody.text?.format?.schema,
        },
        response: rawResponse,
      });
      return response;
    };

    const runnerUrl = pathToFileURL(path.join(workspace, "scripts", "eval-full-runner.ts")).href;
    const { runFullEval } = await import(runnerUrl);
    const result = await runFullEval({
      pdfPath: resolvedPdf,
      learningGoal: DEFAULT_GOAL,
      label: "recovered-openai-api-150138f",
      caseId: "recovered-openai-api-150138f-lecture8",
      repoRoot: workspace,
      onEvent: ({ stage }) => { activeStage = stage; },
    });

    const finalDirectory = path.join(
      resolvedRoot,
      "eval",
      "runs",
      "provider-comparison",
      "deadlock",
      "api",
      result.runId,
    );
    await mkdir(path.dirname(finalDirectory), { recursive: true });
    await cp(result.outputDirectory, finalDirectory, { recursive: true, errorOnExist: true });
    const completedAt = new Date();
    const metadata = {
      artifactType: "study-forge-recovered-openai-api-baseline",
      recoveryCommit: RECOVERY_COMMIT,
      comparisonCommit: COMPARISON_COMMIT,
      independentOfCurrentMcpOutput: true,
      fixedInput: {
        pdfPath: resolvedPdf,
        pdfSha256: sha256(await readFile(resolvedPdf)),
        scope: "전체 문서",
        learningGoal: DEFAULT_GOAL,
        runCount: 1,
      },
      modelConfiguration: {
        default: { model: "gpt-5.6-terra", reasoningEffort: "medium" },
        extraction: { model: "gpt-5.6-terra", reasoningEffort: "medium" },
        critic: { enabled: false, model: "gpt-5.6-terra", reasoningEffort: "medium" },
      },
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      wallDurationMs: completedAt.getTime() - startedAt.getTime(),
      apiSummary: summarizeCalls(calls),
      candidateComparison: comparison,
      restoredSourceChecksums: checksums,
      historicalSnapshotEvidence: [
        "eval/snapshots/2026-08-17-pre-data-structure-shrink/README.md",
        "eval/snapshots/2026-08-17-card-token-shrink/README.md",
      ],
    };
    await writeFile(path.join(finalDirectory, "raw-openai-responses.json"), `${JSON.stringify(calls, null, 2)}\n`);
    await writeFile(path.join(finalDirectory, "recovery-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
    return { ...result, outputDirectory: finalDirectory, metadata };
  } finally {
    globalThis.fetch = nativeFetch;
    const allowedParent = path.join(resolvedRoot, ".recovery-work") + path.sep;
    if (workspace.startsWith(allowedParent)) await rm(workspace, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const result = await runRecovery({ repoRoot: process.cwd(), ...parseArgs(process.argv.slice(2)) });
    console.log(JSON.stringify({
      runId: result.runId,
      outputDirectory: result.outputDirectory,
      apiSummary: result.metadata.apiSummary,
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
