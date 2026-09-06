import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseConceptTreeOutline } from "./outline-parser.ts";
import type {
  ConceptTree,
  ConceptTreeRun,
  ConceptTreeSourceFile,
} from "./types.ts";

const defaultDataRoot = path.join(
  process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"),
  "concept-tree-experiment",
);

export class ConceptTreeMcpService {
  private readonly dataRoot: string;

  constructor(dataRoot = defaultDataRoot) {
    this.dataRoot = dataRoot;
  }

  async startPdfRun(input: {
    title: string;
    files: ConceptTreeSourceFile[];
    instruction?: string;
  }) {
    const title = requiredText(input.title, "트리 제목", 120);
    const files = validateFiles(input.files);
    const run = await this.createRun({
      title,
      sourceMode: "pdf",
      sourceLabel: files.map((file) => file.fileName).join(", "),
      files,
      instruction: optionalText(input.instruction, 1000),
    });
    return {
      ...this.authoringResponse(run),
      nextAction: "현재 대화에 첨부된 PDF를 직접 읽고 개념어만 자연어 트리로 작성한 뒤 submit_concept_tree_outline을 호출하세요.",
    };
  }

  async startTopicRun(input: {
    topic: string;
    title?: string;
    instruction?: string;
  }) {
    const topic = requiredText(input.topic, "주제", 300);
    const title = optionalText(input.title, 120) || topic;
    const run = await this.createRun({
      title,
      sourceMode: "topic",
      sourceLabel: `GPT 주제: ${topic}`,
      topic,
      files: [],
      instruction: optionalText(input.instruction, 1000),
    });
    return {
      ...this.authoringResponse(run),
      nextAction: "대화에서 요청받은 범위에 맞춰 개념어만 자연어 트리로 작성한 뒤 submit_concept_tree_outline을 호출하세요.",
    };
  }

  async submitOutline(input: { runId: string; outlineText: string }) {
    const run = await this.readRun(input.runId);
    if (run.status === "completed" && run.tree) return run.tree;
    const outlineText = requiredText(input.outlineText, "자연어 트리", 30_000);
    const nodes = parseConceptTreeOutline(outlineText, run.files);
    const warnings: string[] = [];
    if (run.sourceMode === "pdf") {
      const missing = nodes.filter((node) => node.depth > 0 && node.sourceRefs.length === 0).length;
      if (missing > 0) {
        warnings.push(`PDF 개념 ${missing}개에 페이지 근거가 없습니다. 트리는 저장되지만 원문 위치 확인은 제한됩니다.`);
      }
    }
    const tree: ConceptTree = {
      id: randomUUID(),
      runId: run.id,
      title: run.title,
      sourceMode: run.sourceMode,
      sourceLabel: run.sourceLabel,
      topic: run.topic,
      files: run.files,
      outlineText,
      nodes,
      warnings,
      createdAt: new Date().toISOString(),
    };
    run.status = "completed";
    run.tree = tree;
    await this.writeRun(run);
    return tree;
  }

  async getTree(runId: string) {
    const run = await this.readRun(runId);
    if (!run.tree) throw new Error("아직 자연어 개념트리가 제출되지 않았습니다.");
    return run.tree;
  }

  private authoringResponse(run: ConceptTreeRun) {
    return {
      runId: run.id,
      sourceMode: run.sourceMode,
      title: run.title,
      sourceLabel: run.sourceLabel,
      instruction: run.instruction,
      outlineContract: {
        format: "첫 줄은 최상위 개념, 자식은 '- 개념어', 하위 자식은 두 칸 들여쓰기합니다.",
        optionalRelation: "관계는 개념어 앞에 '[관계]'로 적습니다.",
        optionalDescription: "짧은 정의는 '— 설명'으로 적습니다.",
        pdfEvidence: "PDF 트리는 각 개념 끝에 '(p.12)' 또는 '(파일명 p.12-13)'을 적습니다.",
        rules: [
          "노드는 문장이 아니라 짧은 개념어로 작성합니다.",
          "예시, 문제, 풀이, 학습 안내, 반복 문장은 개념 노드로 만들지 않습니다.",
          "같은 부모 아래 같은 개념을 반복하지 않습니다.",
          "트리 깊이는 최대 6단계, 노드는 최대 200개입니다.",
          "PDF 모드에서는 자료에 실제로 존재하는 개념만 사용합니다.",
          "주제 모드에서는 사용자가 요청한 범위를 넘어 불필요하게 확장하지 않습니다.",
        ],
        example: [
          "데드락",
          "- [필요조건] 상호 배제 — 하나의 자원을 동시에 공유할 수 없음 (p.12)",
          "- [필요조건] 점유와 대기 — 자원을 가진 상태에서 다른 자원을 기다림 (p.12)",
          "- [처리 방식] 예방 (p.14)",
          "  - [방법] 순환 대기 제거 (p.15)",
        ].join("\n"),
      },
    };
  }

  private async createRun(input: Omit<ConceptTreeRun, "id" | "status" | "createdAt">) {
    const run: ConceptTreeRun = {
      ...input,
      id: randomUUID(),
      status: "awaiting_outline",
      createdAt: new Date().toISOString(),
    };
    await this.writeRun(run);
    return run;
  }

  private async readRun(runId: string) {
    const safeRunId = safeId(runId);
    try {
      return JSON.parse(await readFile(path.join(this.dataRoot, "runs", `${safeRunId}.json`), "utf8")) as ConceptTreeRun;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error("개념트리 run을 찾지 못했습니다.");
      }
      throw error;
    }
  }

  private async writeRun(run: ConceptTreeRun) {
    const runDirectory = path.join(this.dataRoot, "runs");
    await mkdir(runDirectory, { recursive: true });
    await writeFile(path.join(runDirectory, `${safeId(run.id)}.json`), JSON.stringify(run, null, 2), "utf8");
  }
}

function validateFiles(files: ConceptTreeSourceFile[]) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("PDF 파일을 한 개 이상 입력하세요.");
  if (files.length > 20) throw new Error("한 트리에는 PDF를 최대 20개까지 사용할 수 있습니다.");
  const seen = new Set<string>();
  return files.map((file) => {
    const fileName = requiredText(file.fileName, "PDF 파일명", 240);
    if (!fileName.toLowerCase().endsWith(".pdf")) throw new Error("PDF 파일만 사용할 수 있습니다.");
    if (seen.has(fileName)) throw new Error(`중복된 PDF 파일명입니다: ${fileName}`);
    seen.add(fileName);
    if (file.pageCount !== undefined && (!Number.isInteger(file.pageCount) || file.pageCount < 1 || file.pageCount > 500)) {
      throw new Error("PDF 페이지 수는 1~500 사이여야 합니다.");
    }
    return { fileName, pageCount: file.pageCount };
  });
}

function requiredText(value: string, label: string, maximumLength: number) {
  const clean = value?.trim() ?? "";
  if (!clean) throw new Error(`${label}을 입력하세요.`);
  if (clean.length > maximumLength) throw new Error(`${label}은 ${maximumLength}자 이내로 입력하세요.`);
  return clean;
}

function optionalText(value: string | undefined, maximumLength: number) {
  const clean = value?.trim() ?? "";
  if (clean.length > maximumLength) throw new Error(`추가 지시는 ${maximumLength}자 이내로 입력하세요.`);
  return clean;
}

function safeId(value: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(value)) throw new Error("run ID가 올바르지 않습니다.");
  return value;
}
