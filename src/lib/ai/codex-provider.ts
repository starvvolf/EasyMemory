import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getCodexAppServer } from "../codex-app-server.ts";
import {
  bindStudyProjectCodexThread,
  getStudyProjectCodexContext,
  replaceStudyProjectCodexThread,
} from "../study-project-store.ts";
import {
  CodexRuntimeError,
  isReplaceableProjectThreadError,
} from "./codex-errors.ts";

export type CodexPdfInput = {
  filename: string;
  mimeType: string;
  base64: string;
};

type CodexProjectInput = {
  projectId?: string;
};

export type CodexJsonThreadScope = "project" | "job";

export function selectCodexJsonThreadId({
  scope,
  projectThreadId,
  requestedThreadId,
}: {
  scope: CodexJsonThreadScope;
  projectThreadId?: string;
  requestedThreadId?: string;
}) {
  return scope === "job"
    ? requestedThreadId
    : projectThreadId ?? requestedThreadId;
}

type CodexTextInput = {
  message: string;
  threadId?: string;
  model?: string;
  reasoningEffort?: string;
} & CodexProjectInput;

const codexProviderGlobal = globalThis as typeof globalThis & {
  __studyForgeProjectCallQueues?: Map<string, Promise<void>>;
};

const projectCallQueues =
  codexProviderGlobal.__studyForgeProjectCallQueues ??
  (codexProviderGlobal.__studyForgeProjectCallQueues = new Map());

export async function assertCodexSubscriptionReady() {
  const server = await getCodexAppServer();
  const status = await server.getAccount();
  if (status.account?.type !== "chatgpt") {
    throw new CodexRuntimeError(
      "login_required",
      "Study Forge의 Codex 연결 화면에서 ChatGPT 구독 계정으로 먼저 로그인하세요.",
    );
  }
  return status.account;
}

export async function callCodexJson(input: {
  schemaName: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  files?: CodexPdfInput[];
  model?: string;
  reasoningEffort?: string;
  threadId?: string;
  threadScope?: CodexJsonThreadScope;
} & CodexProjectInput) {
  const result = await callCodexJsonWithThread(input);
  return result.data;
}

export async function callCodexJsonWithThread(input: {
  schemaName: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  files?: CodexPdfInput[];
  model?: string;
  reasoningEffort?: string;
  threadId?: string;
  threadScope?: CodexJsonThreadScope;
} & CodexProjectInput) {
  const projectId = input.projectId?.trim();
  if (projectId) {
    return runInProjectQueue(projectId, () => executeCodexJson(input, projectId));
  }
  return executeCodexJson(input);
}

export async function callCodexTextWithThread(input: CodexTextInput) {
  const projectId = input.projectId?.trim();
  if (projectId) {
    return runInProjectQueue(projectId, () => executeCodexText(input, projectId));
  }
  return executeCodexText(input);
}

async function executeCodexText(input: CodexTextInput, projectId?: string) {
  await assertCodexSubscriptionReady();
  const server = await getCodexAppServer();
  const project = projectId
    ? await getStudyProjectCodexContext(projectId)
    : null;
  if (
    project?.codexThreadId &&
    input.threadId &&
    project.codexThreadId !== input.threadId
  ) {
    throw new Error("현재 대화가 이 프로젝트의 Codex 스레드와 일치하지 않습니다.");
  }
  const request = (threadId?: string) => server.chat({
      message: input.message,
      threadId,
      model: input.model,
      effort: input.reasoningEffort,
      cwd: project?.workspacePath,
      threadName: project ? `Study Forge · ${project.projectName}` : undefined,
    });
  const result = await callWithProjectThreadRecovery({
    project,
    requestedThreadId: project?.codexThreadId ?? input.threadId,
    request,
  });
  if (project && !project.codexThreadId) {
    await bindStudyProjectCodexThread(project.projectId, result.threadId);
  }
  return result;
}

async function executeCodexJson(
  input: Parameters<typeof callCodexJsonWithThread>[0],
  projectId?: string,
) {
  await assertCodexSubscriptionReady();
  const server = await getCodexAppServer();
  const project = projectId
    ? await getStudyProjectCodexContext(projectId)
    : null;
  const usesProjectThread = input.threadScope !== "job";
  if (
    usesProjectThread &&
    project?.codexThreadId &&
    input.threadId &&
    project.codexThreadId !== input.threadId
  ) {
    throw new Error("현재 학습 설계가 이 프로젝트의 Codex 스레드와 일치하지 않습니다.");
  }
  const threadId = selectCodexJsonThreadId({
    scope: input.threadScope ?? "project",
    projectThreadId: project?.codexThreadId,
    requestedThreadId: input.threadId,
  });
  const materialized = await materializePdfInputs(input.files ?? []);

  try {
    const request = (nextThreadId?: string) => server.chat({
        message: [
          input.user,
          "",
          `출력 계약 이름: ${input.schemaName}`,
          "반드시 지정된 JSON Schema를 만족하는 JSON 값만 반환하세요.",
        ].join("\n"),
        system: input.system,
        model: input.model,
        effort: input.reasoningEffort,
        outputSchema: input.schema,
        attachments: materialized.attachments,
        threadId: nextThreadId,
        cwd: project?.workspacePath,
        threadName: project
          ? usesProjectThread
            ? `Study Forge · ${project.projectName}`
            : `Study Forge · ${project.projectName} · 학습 생성`
          : undefined,
      });
    let result;
    if (usesProjectThread) {
      result = await callWithProjectThreadRecovery({
          project,
          requestedThreadId: threadId,
          request,
        });
    } else {
      try {
        result = await request(threadId);
      } catch (error) {
        if (!threadId || !isReplaceableProjectThreadError(error)) throw error;
        result = await request(undefined);
      }
    }
    if (usesProjectThread && project && !project.codexThreadId) {
      await bindStudyProjectCodexThread(project.projectId, result.threadId);
    }
    try {
      return {
        data: JSON.parse(result.text) as unknown,
        threadId: result.threadId,
      };
    } catch (error) {
      throw new CodexRuntimeError(
        "invalid_output",
        `Codex가 유효한 JSON을 반환하지 않았습니다: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  } finally {
    await materialized.cleanup();
  }
}

async function callWithProjectThreadRecovery({
  project,
  requestedThreadId,
  request,
}: {
  project: Awaited<ReturnType<typeof getStudyProjectCodexContext>> | null;
  requestedThreadId?: string;
  request: (threadId?: string) => ReturnType<Awaited<ReturnType<typeof getCodexAppServer>>["chat"]>;
}) {
  try {
    return await request(requestedThreadId);
  } catch (error) {
    if (!project?.codexThreadId || !isReplaceableProjectThreadError(error)) {
      throw error;
    }

    const replacement = await request(undefined);
    await replaceStudyProjectCodexThread(
      project.projectId,
      project.codexThreadId,
      replacement.threadId,
    );
    return replacement;
  }
}

async function runInProjectQueue<T>(projectId: string, task: () => Promise<T>) {
  const previous = projectCallQueues.get(projectId) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(task);
  const tail = operation.then(() => undefined, () => undefined);
  projectCallQueues.set(projectId, tail);
  try {
    return await operation;
  } finally {
    if (projectCallQueues.get(projectId) === tail) {
      projectCallQueues.delete(projectId);
    }
  }
}

async function materializePdfInputs(files: CodexPdfInput[]) {
  if (files.length === 0) {
    return {
      attachments: [] as Array<{ name: string; path: string }>,
      cleanup: async () => undefined,
    };
  }

  const directory = await mkdtemp(path.join(tmpdir(), "study-forge-codex-"));
  const attachments: Array<{ name: string; path: string }> = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const safeName = sanitizeFileName(file.filename, index);
      const filePath = path.join(directory, safeName);
      await writeFile(filePath, Buffer.from(file.base64, "base64"));
      attachments.push({ name: file.filename, path: filePath });
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  return {
    attachments,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function sanitizeFileName(filename: string, index: number) {
  const extension = path.extname(filename).toLowerCase() === ".pdf" ? ".pdf" : ".pdf";
  const stem = path.basename(filename, path.extname(filename)).replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `${String(index + 1).padStart(2, "0")}-${stem || "source"}${extension}`;
}
