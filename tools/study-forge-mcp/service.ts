import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  stageOutputJsonSchema,
  stageValidationGuidance,
  prepareResultSchema,
  validateStageResult,
} from "./contracts.ts";
import {
  activityDesignSchema,
  cardsSchema,
  materializeCards,
} from "../../src/lib/pipeline/generate.ts";
import { createPdfMaskActivities } from "../../src/lib/pdf-mask-activity.ts";
import { pdfAnalysisResponseSchema } from "../../src/lib/pipeline/analyze.ts";
import { combineSourceOutlines } from "../../src/lib/pipeline/analyze.ts";
import { studyGuidelineDraftSchema } from "../../src/lib/pipeline/plan.ts";
import {
  generationStages,
  type ArtifactMetadata,
  type GenerationStage,
  type MaterialRecord,
  type ProjectGenerationConfig,
  type RunRecord,
  type RunSettings,
  type StoredArtifact,
  type SubmissionAttempt,
} from "./types.ts";
import { ProjectSourceAdapter, type ResolvedProjectMaterial } from "./project-source-adapter.ts";

const materialSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  learningGoal: z.string(),
  instruction: z.string(),
  mode: z.enum(["flashcard", "cloze", "translation"]),
  subject: z.string().optional(),
  tags: z.array(z.string()).optional(),
  sourceExpressionMode: z.enum(["preserve", "adapt"]).optional(),
  activitySelectionMode: z.enum(["automatic", "manual"]).optional(),
  source: z.object({
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    content: z.string().min(1),
  }),
});

const legacyDataRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "data",
);
const canonicalDataRoot = process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");
const defaultDataRoot = path.join(canonicalDataRoot, "mcp");

export class StudyForgeMcpService {
  private readonly dataRoot: string;
  private readonly materialRoot: string;
  private readonly projectSources: ProjectSourceAdapter;

  constructor(dataRoot = defaultDataRoot, materialRoot = dataRoot === defaultDataRoot ? legacyDataRoot : dataRoot) {
    this.dataRoot = dataRoot;
    this.materialRoot = materialRoot;
    this.projectSources = new ProjectSourceAdapter();
  }

  async listProjects() {
    return this.projectSources.listProjects();
  }

  async getProject(projectId: string) {
    return this.projectSources.getProject(projectId);
  }

  async getActiveCodingSession(projectId?: string) {
    return {
      session: await this.projectSources.getActiveCodingSession(projectId) ?? null,
    };
  }

  async listMaterials() {
    const materialDirectory = path.join(this.materialRoot, "materials");
    const names = (await readdir(materialDirectory)).filter((name) => name.endsWith(".json"));
    const materials = await Promise.all(
      names.map((name) => this.readMaterialFile(path.join(materialDirectory, name))),
    );
    return materials.map(({ source, ...material }) => ({
      ...material,
      sourceFileName: source.fileName,
      sourceBytes: Buffer.byteLength(source.content, "utf8"),
      sourceChecksum: checksum(source.content),
    }));
  }

  async getStageInput(input: {
    materialId: string;
    stage: GenerationStage;
    runId?: string;
  }) {
    const run = input.runId ? await this.getRun(input.runId) : undefined;
    const resolved = run?.projectId
      ? await this.resolveProjectRun(run)
      : undefined;
    const material = resolved?.material ?? await this.getMaterial(input.materialId);
    this.assertRunMaterial(run, material.id);
    const prior = await this.readPriorArtifacts(input.stage, run);
    const settings = normalizeRunSettings(run?.settings);
    const selectedSourceOutline = selectSourceOutline(
      prior.analyze,
      settings.selectedSourceOutlineLeafIds,
    );
    const payload = buildStagePayload(input.stage, material, prior, settings, selectedSourceOutline, resolved);
    const outputContract = stageOutputJsonSchema(input.stage, settings.runMode);
    const sourceChecksum = run?.sourceChecksum ?? checksum(material.source.content);
    const inputChecksum = checksum({
      materialId: material.id,
      sourceChecksum,
      stage: input.stage,
      parentArtifacts: artifactLineage(input.stage, run),
      settings,
      payload,
    });
    return {
      materialId: material.id,
      runId: run?.id ?? null,
      stage: input.stage,
      inputChecksum,
      sourceChecksum,
      instructions: stageInstructions[input.stage],
      outputContract,
      validationGuidance: stageValidationGuidance(input.stage, outputContract, settings.runMode),
      input: payload,
    };
  }

  async submitStageResult(input: {
    materialId: string;
    stage: GenerationStage;
    inputChecksum: string;
    result: unknown;
    runId?: string;
  }) {
    const existingRun = input.runId ? await this.getRun(input.runId) : undefined;
    const resolved = existingRun?.projectId ? await this.resolveProjectRun(existingRun) : undefined;
    const material = resolved?.material ?? await this.getMaterial(input.materialId);
    const run = existingRun ?? await this.createRun(material);
    this.assertRunMaterial(run, material.id);
    const expected = await this.getStageInput({
      materialId: input.materialId,
      stage: input.stage,
      runId: run.id,
    });
    try {
      if (expected.inputChecksum !== input.inputChecksum) {
        throw new Error("단계 입력이 바뀌었습니다. 현재 단계 입력을 다시 조회하세요.");
      }
      this.assertSubmissionOrder(input.stage, run);
    } catch (error) {
      await this.recordRejectedAttempt(run, input.stage, input.inputChecksum, error);
      throw attemptError(run.id, error);
    }
    const prior = await this.readPriorArtifacts(input.stage, run);
    const settings = normalizeRunSettings(run.settings);
    const effectivePrior = applyRunSettingsToPrior(prior, settings);
    let validated: unknown;
    try {
      validated = validateStageResult(
        input.stage,
        input.result,
        effectivePrior,
        material.mode,
        material.activitySelectionMode ?? "automatic",
        settings.runMode,
        selectSourceOutline(
          prior.analyze,
          settings.selectedSourceOutlineLeafIds,
        ),
        material.title,
      );
      if (input.stage === "analyze" && resolved) {
        validated = await this.normalizeAndSaveProjectAnalysis(validated, resolved);
      }
    } catch (error) {
      await this.recordRejectedAttempt(run, input.stage, input.inputChecksum, error);
      throw attemptError(run.id, error);
    }
    const createdAt = new Date().toISOString();
    const artifactId = `${input.stage}-${createdAt.replace(/[:.]/g, "-")}-${randomUUID()}`;
    const fileName = `${artifactId}.json`;
    const metadata: ArtifactMetadata = {
      id: artifactId,
      stage: input.stage,
      checksum: checksum(validated),
      inputChecksum: input.inputChecksum,
      sourceChecksum: run.sourceChecksum,
      parentArtifactIds: immediateParentIds(input.stage, run),
      createdAt,
      fileName,
    };
    const artifact: StoredArtifact = {
      ...metadata,
      runId: run.id,
      materialId: material.id,
      result: validated,
    };

    const artifactDirectory = path.join(this.dataRoot, "runs", run.id, "artifacts");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(
      path.join(artifactDirectory, fileName),
      `${JSON.stringify(artifact, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    const updatedRun: RunRecord = {
      ...run,
      updatedAt: createdAt,
      artifacts: [...run.artifacts, metadata],
      attempts: [
        ...(run.attempts ?? []),
        createAttempt(input.stage, input.inputChecksum, createdAt, "accepted", {
          artifactId,
        }),
      ],
    };
    await writeRun(this.dataRoot, updatedRun);
    return {
      runId: run.id,
      artifactId,
      stage: input.stage,
      checksum: metadata.checksum,
      sourceChecksum: metadata.sourceChecksum,
      parentArtifactIds: metadata.parentArtifactIds,
      createdAt,
    };
  }

  async getRunStatus(runId: string) {
    const run = await this.getRun(runId);
    const completedStages = generationStages.filter((stage) =>
      run.artifacts.some((artifact) => artifact.stage === stage),
    );
    const nextStage = generationStages.find((stage) => !completedStages.includes(stage)) ?? null;
    return { ...run, attempts: run.attempts ?? [], completedStages, nextStage };
  }

  async getNextStage(input: {
    materialId?: string;
    projectId?: string;
    sourceIds?: string[];
    config?: ProjectGenerationConfig;
    runId?: string;
    runMode?: RunSettings["runMode"];
  }) {
    if (!input.runId && !input.materialId && !input.projectId) {
      throw new Error("새 run에는 projectId+sourceIds 또는 legacy materialId가 필요합니다.");
    }
    let run: RunRecord;
    if (input.runId) {
      run = await this.getRun(input.runId);
    } else if (input.projectId) {
      if (!input.config) throw new Error("프로젝트 run에는 config가 필요합니다.");
      const resolved = await this.projectSources.resolve(input.projectId, input.sourceIds ?? [], input.config);
      run = await this.createRun(resolved.material, {
        ...defaultRunSettings,
        runMode: input.runMode ?? defaultRunSettings.runMode,
      }, resolved, input.config);
    } else {
      run = await this.createRun(await this.getMaterial(input.materialId!), {
        ...defaultRunSettings,
        runMode: input.runMode ?? defaultRunSettings.runMode,
      });
    }
    if (input.materialId) this.assertRunMaterial(run, input.materialId);
    const status = await this.getRunStatus(run.id);
    if (!status.nextStage) {
      return { runId: run.id, completed: true, nextStage: null, stageInput: null };
    }
    const stageInput = await this.getStageInput({
      materialId: run.materialId,
      stage: status.nextStage,
      runId: run.id,
    });
    return { runId: run.id, completed: false, nextStage: status.nextStage, stageInput };
  }

  async configureRun(input: {
    runId: string;
    runMode?: RunSettings["runMode"];
    selectedSourceOutlineLeafIds?: string[];
    selectedFocusGroupId?: string;
    selectedOutlineLeafIds?: string[];
    excludedLearningUnitIds?: string[];
  }) {
    const run = await this.getRun(input.runId);
    if (input.runMode && run.artifacts.some((artifact) => artifact.stage === "plan")) {
      throw new Error("runMode는 plan 결과를 저장하기 전에만 바꿀 수 있습니다.");
    }
    if (input.selectedSourceOutlineLeafIds) {
      const analyze = await this.readLatestArtifact(run, "analyze");
      const outline = analyze
        ? pdfAnalysisResponseSchema.parse(analyze.result).sourceOutline
        : undefined;
      assertIdsExist(input.selectedSourceOutlineLeafIds, outline?.nodes.map((node) => node.id) ?? [], "원문 목차");
    }
    if (input.selectedFocusGroupId) {
      const plan = await this.readLatestArtifact(run, "plan");
      const draft = plan ? studyGuidelineDraftSchema.parse(plan.result) : undefined;
      assertIdsExist([input.selectedFocusGroupId], draft?.groups.map((group) => group.id) ?? [], "학습 영역");
    }
    if (input.selectedOutlineLeafIds) {
      const plan = await this.readLatestArtifact(run, "plan");
      const outline = plan && plan.result && typeof plan.result === "object"
        ? (plan.result as { learningOutline?: { nodes?: Array<{ id: string }> } }).learningOutline
        : undefined;
      assertIdsExist(input.selectedOutlineLeafIds, outline?.nodes?.map((node) => node.id) ?? [], "최종 목차");
    }
    if (input.excludedLearningUnitIds) {
      const prepared = await this.readLatestArtifact(run, "prepare");
      const unitIds = prepared
        ? prepareResultSchema.parse(prepared.result).analysis.learningUnits.map((unit) => unit.id)
        : [];
      assertIdsExist(input.excludedLearningUnitIds, unitIds, "학습내용");
    }
    const current = normalizeRunSettings(run.settings);
    const next = normalizeRunSettings({
      ...current,
      ...(input.runMode ? { runMode: input.runMode } : {}),
      ...(input.selectedSourceOutlineLeafIds
        ? { selectedSourceOutlineLeafIds: uniqueIds(input.selectedSourceOutlineLeafIds) }
        : {}),
      ...(input.selectedFocusGroupId
        ? { selectedFocusGroupId: input.selectedFocusGroupId }
        : {}),
      ...(input.selectedOutlineLeafIds
        ? { selectedOutlineLeafIds: uniqueIds(input.selectedOutlineLeafIds) }
        : {}),
      ...(input.excludedLearningUnitIds
        ? { excludedLearningUnitIds: uniqueIds(input.excludedLearningUnitIds) }
        : {}),
    });
    const updated = { ...run, settings: next, updatedAt: new Date().toISOString() };
    await writeRun(this.dataRoot, updated);
    const status = await this.getRunStatus(run.id);
    return { runId: run.id, settings: next, nextStage: status.nextStage };
  }

  async submitNextStageResult(input: { runId: string; result: unknown }) {
    const run = await this.getRun(input.runId);
    const status = await this.getRunStatus(run.id);
    if (!status.nextStage) throw new Error("이미 모든 단계가 완료된 run입니다.");
    const expected = await this.getStageInput({
      materialId: run.materialId,
      stage: status.nextStage,
      runId: run.id,
    });
    const submitted = await this.submitStageResult({
      materialId: run.materialId,
      stage: status.nextStage,
      runId: run.id,
      inputChecksum: expected.inputChecksum,
      result: input.result,
    });
    const next = await this.getNextStage({ runId: run.id });
    return { submitted, ...next };
  }

  async getRunResult(runId: string) {
    const run = await this.getRun(runId);
    const material = run.projectId
      ? (await this.resolveProjectRun(run)).material
      : await this.getMaterial(run.materialId);
    const cardsArtifact = await this.readLatestArtifact(run, "cards");
    if (!cardsArtifact) throw new Error("cards 단계가 아직 완료되지 않았습니다.");
    const parsed = cardsSchema.parse(cardsArtifact.result);
    return {
      runId: run.id,
      materialId: run.materialId,
      projectId: run.projectId,
      sourceIds: run.sourceIds,
      title: material.title,
      sourceFileName: material.source.fileName,
      artifactId: cardsArtifact.id,
      cardCount: parsed.cards.length,
      cards: parsed.cards,
    };
  }

  async publishRunToDeck(input: { runId: string; confirmPublish: boolean }) {
    if (!input.confirmPublish) {
      throw new Error("완성된 run을 학습 덱으로 발행하려면 confirmPublish=true가 필요합니다.");
    }
    const run = await this.getRun(input.runId);
    const material = run.projectId
      ? (await this.resolveProjectRun(run)).material
      : await this.getMaterial(run.materialId);
    const preparedArtifact = await this.readLatestArtifact(run, "prepare");
    const planArtifact = await this.readLatestArtifact(run, "plan");
    const activityArtifact = await this.readLatestArtifact(run, "activity-design");
    const cardsArtifact = await this.readLatestArtifact(run, "cards");
    if (!preparedArtifact || !activityArtifact || !cardsArtifact) {
      throw new Error("prepare, activity-design, cards가 모두 완료되어야 합니다.");
    }
    const settings = normalizeRunSettings(run.settings);
    const prepared = prepareResultSchema.parse(
      applyRunSettingsToPrior({ prepare: preparedArtifact.result }, settings).prepare,
    );
    const activityDesign = activityDesignSchema.parse(activityArtifact.result);
    const cardDrafts = cardsSchema.parse(cardsArtifact.result);
    const now = new Date().toISOString();
    const deck = {
      id: `mcp-${run.id}`,
      title: prepared.organizedMaterial.title || material.title,
      boardColumn: "new",
      subject: material.subject ?? "",
      tags: material.tags?.length ? material.tags : ["MCP"],
      mode: material.mode,
      sourceText: material.source.content,
      sourceFileName: material.source.fileName,
      projectId: run.projectId,
      sourceIds: run.sourceIds,
      instruction: material.instruction,
      studyGuideline: planArtifact
        ? buildConfirmedGuideline(planArtifact.result, settings)
        : undefined,
      activityDesign,
      activitySelectionMode: material.activitySelectionMode ?? "automatic",
      sourceExpressionMode: material.sourceExpressionMode ?? "adapt",
      pdfMaskActivities: createPdfMaskActivities(
        prepared.analysis.learningUnits,
      ),
      outlineSelection:
        settings.runMode !== "focused_area" &&
        planArtifact?.result &&
        typeof planArtifact.result === "object" &&
        "learningOutline" in planArtifact.result
          ? {
              outline: (planArtifact.result as { learningOutline: unknown }).learningOutline,
              selectedLeafIds: settings.selectedOutlineLeafIds,
            }
          : undefined,
      analysis: prepared.analysis,
      organizedMaterial: prepared.organizedMaterial,
      cards: materializeCards(cardDrafts.cards, material.mode),
      createdAt: now,
      updatedAt: now,
    };
    const publishedDirectory = path.join(this.dataRoot, "published");
    await mkdir(publishedDirectory, { recursive: true });
    const filePath = path.join(publishedDirectory, `${safeId(run.id)}.json`);
    try {
      await writeFile(filePath, `${JSON.stringify(deck, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
    return { runId: run.id, deckId: deck.id, title: deck.title, cardCount: deck.cards.length };
  }

  async listPublishedDecks() {
    const directory = path.join(this.dataRoot, "published");
    await mkdir(directory, { recursive: true });
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    return Promise.all(names.map(async (name) => JSON.parse(
      await readFile(path.join(directory, name), "utf8"),
    ) as Record<string, unknown>));
  }

  private async getMaterial(materialId: string): Promise<MaterialRecord> {
    const materials = await this.listMaterialRecords();
    const material = materials.find((candidate) => candidate.id === materialId);
    if (!material) throw new Error(`자료를 찾을 수 없습니다: ${materialId}`);
    return material;
  }

  private async listMaterialRecords() {
    const materialDirectory = path.join(this.materialRoot, "materials");
    const names = (await readdir(materialDirectory)).filter((name) => name.endsWith(".json"));
    return Promise.all(
      names.map((name) => this.readMaterialFile(path.join(materialDirectory, name))),
    );
  }

  private async readMaterialFile(filePath: string) {
    return materialSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
  }

  private async createRun(
    material: MaterialRecord,
    settings: RunSettings = defaultRunSettings,
    project?: ResolvedProjectMaterial,
    projectConfig?: ProjectGenerationConfig,
  ): Promise<RunRecord> {
    const now = new Date().toISOString();
    const run: RunRecord = {
      id: `run-${now.replace(/[:.]/g, "-")}-${randomUUID()}`,
      materialId: material.id,
      projectId: project?.projectId,
      sourceIds: project?.sourceIds,
      sourceChecksums: project?.sourceChecksums,
      projectConfig,
      sourceChecksum: project ? checksum(project.sourceChecksums) : checksum(material.source.content),
      createdAt: now,
      updatedAt: now,
      artifacts: [],
      attempts: [],
      settings,
    };
    await mkdir(path.join(this.dataRoot, "runs", run.id, "artifacts"), { recursive: true });
    if (project) {
      await writeFile(
        path.join(this.dataRoot, "runs", run.id, "source-context.json"),
        `${JSON.stringify(project, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
    }
    await writeRun(this.dataRoot, run);
    return run;
  }

  private async resolveProjectRun(run: RunRecord) {
    if (!run.projectId || !run.sourceIds || !run.projectConfig) {
      throw new Error("프로젝트 run의 source snapshot이 불완전합니다.");
    }
    const project = await this.projectSources.getProject(run.projectId);
    const currentChecksums = Object.fromEntries(
      project.sources
        .filter((source) => run.sourceIds!.includes(source.id as string))
        .map((source) => [source.id as string, source.checksum as string]),
    );
    if (stableStringify(currentChecksums) !== stableStringify(run.sourceChecksums ?? {})) {
      throw new Error("run 생성 후 원본 PDF가 변경되었습니다. 새 run을 시작하세요.");
    }
    return JSON.parse(await readFile(
      path.join(this.dataRoot, "runs", run.id, "source-context.json"),
      "utf8",
    )) as ResolvedProjectMaterial;
  }

  private async normalizeAndSaveProjectAnalysis(value: unknown, resolved: ResolvedProjectMaterial) {
    const parsed = pdfAnalysisResponseSchema.parse(value);
    if (parsed.files.length !== resolved.sources.length) {
      throw new Error("analyze 결과는 선택한 PDF마다 정확히 하나씩 필요합니다.");
    }
    const sourceById = new Map(resolved.sources.map((source) => [source.sourceId, source]));
    const sourcesByName = new Map<string, typeof resolved.sources>();
    for (const source of resolved.sources) {
      sourcesByName.set(source.fileName, [...(sourcesByName.get(source.fileName) ?? []), source]);
    }
    const remaining = new Set(resolved.sourceIds);
    const files = parsed.files.map((file) => {
      const declaredIds = new Set(file.sourceOutline.nodes.flatMap((node) =>
        node.sourceRefs.flatMap((ref) => ref.sourceId ? [ref.sourceId] : [])));
      if (declaredIds.size > 1) throw new Error(`${file.fileName} 분석에 여러 sourceId가 섞여 있습니다.`);
      const declaredId = [...declaredIds][0];
      const sameName = sourcesByName.get(file.fileName) ?? [];
      const source = declaredId ? sourceById.get(declaredId) : sameName.length === 1 ? sameName[0] : undefined;
      if (!source) throw new Error(`선택한 PDF와 일치하지 않는 analyze 결과입니다: ${file.fileName}`);
      if (source.fileName !== file.fileName) throw new Error(`sourceId와 fileName이 일치하지 않습니다: ${file.fileName}`);
      if (!remaining.delete(source.sourceId)) throw new Error(`같은 PDF 분석이 중복되었습니다: ${source.sourceId}`);
      return {
        ...file,
        sourceOutline: {
          ...file.sourceOutline,
          nodes: file.sourceOutline.nodes.map((node) => ({
            ...node,
            sourceRefs: node.sourceRefs.map((ref) => ({ ...ref, sourceId: source.sourceId, fileName: source.fileName })),
          })),
        },
      };
    });
    if (remaining.size > 0) throw new Error("일부 선택 PDF의 analyze 결과가 없습니다.");
    for (const file of files) {
      const sourceId = file.sourceOutline.nodes[0]?.sourceRefs[0]?.sourceId;
      if (!sourceId) throw new Error("analyze sourceId 정규화에 실패했습니다.");
      await this.projectSources.saveStudyAnalysis(sourceId, file);
    }
    return pdfAnalysisResponseSchema.parse({ files, sourceOutline: combineSourceOutlines(files) });
  }

  private async getRun(runId: string): Promise<RunRecord> {
    const filePath = path.join(this.dataRoot, "runs", safeId(runId), "run.json");
    return JSON.parse(await readFile(filePath, "utf8")) as RunRecord;
  }

  private assertRunMaterial(run: RunRecord | undefined, materialId: string) {
    if (run && run.materialId !== materialId) {
      throw new Error("run과 material의 연결이 일치하지 않습니다.");
    }
  }

  private assertSubmissionOrder(stage: GenerationStage, run?: RunRecord) {
    const stageIndex = generationStages.indexOf(stage);
    const completed = new Set(run?.artifacts.map((artifact) => artifact.stage) ?? []);
    const missing = generationStages.slice(0, stageIndex).find((item) => !completed.has(item));
    if (missing) throw new Error(`먼저 ${missing} 단계 결과가 필요합니다.`);
    if (!run && stage !== "analyze") throw new Error("analyze 단계부터 새 run을 시작하세요.");
  }

  private async readPriorArtifacts(
    stage: GenerationStage,
    run?: RunRecord,
  ): Promise<Partial<Record<GenerationStage, unknown>>> {
    if (!run) return {};
    const prior: Partial<Record<GenerationStage, unknown>> = {};
    const stageIndex = generationStages.indexOf(stage);
    for (const priorStage of generationStages.slice(0, stageIndex)) {
      const metadata = [...run.artifacts].reverse().find((item) => item.stage === priorStage);
      if (!metadata) continue;
      const artifact = JSON.parse(
        await readFile(
          path.join(this.dataRoot, "runs", run.id, "artifacts", metadata.fileName),
          "utf8",
        ),
      ) as StoredArtifact;
      prior[priorStage] = artifact.result;
    }
    return prior;
  }

  private async readLatestArtifact(run: RunRecord, stage: GenerationStage) {
    const metadata = [...run.artifacts].reverse().find((item) => item.stage === stage);
    if (!metadata) return undefined;
    return JSON.parse(await readFile(
      path.join(this.dataRoot, "runs", run.id, "artifacts", metadata.fileName),
      "utf8",
    )) as StoredArtifact;
  }

  private async recordRejectedAttempt(
    run: RunRecord,
    stage: GenerationStage,
    inputChecksum: string,
    error: unknown,
  ) {
    const createdAt = new Date().toISOString();
    await writeRun(this.dataRoot, {
      ...run,
      updatedAt: createdAt,
      attempts: [
        ...(run.attempts ?? []),
        createAttempt(stage, inputChecksum, createdAt, "rejected", {
          error: validationErrorMessage(error),
        }),
      ],
    });
  }
}

function buildStagePayload(
  stage: GenerationStage,
  material: MaterialRecord,
  prior: Partial<Record<GenerationStage, unknown>>,
  settings: RunSettings,
  selectedSourceOutline?: unknown,
  project?: ResolvedProjectMaterial,
) {
  if (stage === "analyze") {
    return {
      learningGoal: material.learningGoal,
      instruction: material.instruction,
      ...(project
        ? {
            sources: project.sources.map((source) => ({
              sourceId: source.sourceId,
              fileName: source.fileName,
              mimeType: source.mimeType,
              content: source.content,
              cachedAnalysis: source.cachedAnalysis,
            })),
          }
        : { source: material.source }),
    };
  }
  if (stage === "plan") {
    return {
      learningGoal: material.learningGoal,
      instruction: material.instruction,
      analysis: prior.analyze,
      runMode: settings.runMode,
      ...(settings.runMode !== "focused_area"
        ? { selectedSourceOutline }
        : {}),
    };
  }
  if (stage === "prepare") {
    return {
      learningGoal: material.learningGoal,
      instruction: material.instruction,
      source: material.source,
      analysisContext: prior.analyze,
      studyGuideline: buildConfirmedGuideline(prior.plan, settings),
    };
  }
  if (stage === "activity-design") {
    const prepared = prepareResultSchema.parse(prior.prepare);
    return {
      instruction: material.instruction,
      sourceExpressionMode: material.sourceExpressionMode ?? "adapt",
      learningUnits: selectedLearningUnits(prepared, settings),
    };
  }
  const prepared = prepareResultSchema.parse(prior.prepare);
  const activityDesign = activityDesignSchema.parse(prior["activity-design"]);
  return {
    instruction: material.instruction,
    mode: material.mode,
    sourceExpressionMode: material.sourceExpressionMode ?? "adapt",
    cardTasks: buildCardTasks(selectedLearningUnits(prepared, settings), activityDesign),
  };
}

function selectedLearningUnits(
  prepared: z.infer<typeof prepareResultSchema>,
  settings: RunSettings,
) {
  const selectedIds = new Set(
    prepared.organizedMaterial.sections.flatMap((section) => section.learningUnitIds),
  );
  const excludedIds = new Set(settings.excludedLearningUnitIds);
  return prepared.analysis.learningUnits.filter(
    (unit) => selectedIds.has(unit.id) && !excludedIds.has(unit.id),
  );
}

function buildCardTasks(
  learningUnits: z.infer<typeof prepareResultSchema>["analysis"]["learningUnits"],
  design: z.infer<typeof activityDesignSchema>,
) {
  const unitById = new Map(learningUnits.map((unit) => [unit.id, unit]));
  const objectiveById = new Map((design.objectives ?? []).map((item) => [item.id, item]));
  const blueprintById = new Map((design.blueprints ?? []).map((item) => [item.id, item]));
  return design.recommendations
    .filter((recommendation) => recommendation.includeInGeneration)
    .map((recommendation) => {
      const unit = unitById.get(recommendation.learningUnitId);
      if (!unit) throw new Error(`Activity Design의 LearningUnit이 없습니다: ${recommendation.learningUnitId}`);
      const objective = recommendation.objectiveId
        ? objectiveById.get(recommendation.objectiveId)
        : undefined;
      const blueprint = recommendation.blueprintId
        ? blueprintById.get(recommendation.blueprintId)
        : undefined;
      return {
        learningUnitId: unit.id,
        objectiveId: recommendation.objectiveId ?? null,
        blueprintId: recommendation.blueprintId ?? null,
        activityType: recommendation.recommendedType,
        recommendationReason: recommendation.reason,
        source: {
          sourceId: unit.sourceId,
          sourcePage: unit.sourcePage,
          sourceRange: unit.sourceRange,
          sourceText: unit.sourceText,
        },
        knowledge: {
          knowledgeType: unit.knowledgeType,
          fixedPart: unit.fixedPart,
          variableSlots: unit.variableSlots,
          generalizedForm: unit.generalizedForm,
          target: unit.target,
          operation: unit.operation,
          successCriterion: unit.successCriterion,
        },
        objective: objective
          ? {
              target: objective.target,
              terminalOperation: objective.terminalOperation,
              successCriteria: objective.successCriteria,
              importance: objective.importance,
            }
          : null,
        blueprint: blueprint
          ? {
              relationToObjective: blueprint.relationToObjective,
              elicitedOperation: blueprint.elicitedOperation,
              given: blueprint.given,
              hidden: blueprint.hidden,
              expectedResponse: blueprint.expectedResponse,
              scoringRubric: blueprint.scoringRubric,
              difficulty: blueprint.difficulty,
            }
          : null,
      };
    });
}

function applyRunSettingsToPrior(
  prior: Partial<Record<GenerationStage, unknown>>,
  settings: RunSettings,
) {
  if (!prior.prepare || settings.excludedLearningUnitIds.length === 0) return prior;
  const prepared = prepareResultSchema.parse(prior.prepare);
  const excluded = new Set(settings.excludedLearningUnitIds);
  return {
    ...prior,
    prepare: {
      ...prepared,
      organizedMaterial: {
        ...prepared.organizedMaterial,
        sections: prepared.organizedMaterial.sections.flatMap((section) => {
          const learningUnitIds = section.learningUnitIds.filter((id) => !excluded.has(id));
          return learningUnitIds.length > 0 ? [{ ...section, learningUnitIds }] : [];
        }),
      },
    },
  };
}

const stageInstructions: Record<GenerationStage, string> = {
  analyze:
    "원문 구조를 보존해 문서 종류, 요약, 핵심 주제, 목차와 페이지 근거를 작성하세요. 원문에 없는 내용을 추가하지 마세요.",
  plan:
    "분석 결과와 학습 목표를 바탕으로 사용자가 고를 수 있는 서로 다른 학습 영역을 만드세요. 추천 ID는 실제 groups 중 하나여야 합니다.",
  prepare:
    "선택 범위에서 독립적으로 인출할 LearningUnit을 추출·일반화하세요. 반복 예시는 공통 패턴의 근거로 쓰고, 모든 unit을 organizedMaterial에 정확히 한 번 연결하세요.",
  "activity-design":
    "각 LearningUnit마다 학습 목표와 문제 설계도를 하나 만들고 현재 지원 형식을 정하세요. 정답을 front에 노출하지 말고 모든 ID 연결을 유지하세요.",
  cards:
    "cardTasks 항목마다 카드 초안 하나를 만드세요. 각 task의 형식과 출처·목표·설계 ID를 그대로 유지하고 원문 밖 사실을 추가하지 마세요.",
};

function immediateParentIds(stage: GenerationStage, run: RunRecord) {
  const index = generationStages.indexOf(stage);
  if (index === 0) return [];
  const parent = [...run.artifacts]
    .reverse()
    .find((artifact) => artifact.stage === generationStages[index - 1]);
  return parent ? [parent.id] : [];
}

function artifactLineage(stage: GenerationStage, run?: RunRecord) {
  const index = generationStages.indexOf(stage);
  return generationStages.slice(0, index).flatMap((priorStage) => {
    const artifact = [...(run?.artifacts ?? [])]
      .reverse()
      .find((candidate) => candidate.stage === priorStage);
    return artifact ? [{ id: artifact.id, checksum: artifact.checksum }] : [];
  });
}

async function writeRun(dataRoot: string, run: RunRecord) {
  const filePath = path.join(dataRoot, "runs", run.id, "run.json");
  await writeFile(filePath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

function safeId(value: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error("ID 형식이 올바르지 않습니다.");
  return value;
}

function checksum(value: unknown) {
  const text = typeof value === "string" ? value : stableStringify(value);
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function createAttempt(
  stage: GenerationStage,
  inputChecksum: string,
  createdAt: string,
  outcome: SubmissionAttempt["outcome"],
  detail: Pick<SubmissionAttempt, "artifactId" | "error">,
): SubmissionAttempt {
  return {
    id: `attempt-${createdAt.replace(/[:.]/g, "-")}-${randomUUID()}`,
    stage,
    inputChecksum,
    createdAt,
    outcome,
    ...detail,
  };
}

function validationErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "result";
      return `${location}: ${issue.message}`;
    }).join(" | ");
  }
  return error instanceof Error ? error.message : "알 수 없는 검증 오류";
}

function attemptError(runId: string, error: unknown) {
  return new Error(`runId=${runId}; 저장 전 검증에서 거부됨: ${validationErrorMessage(error)}`);
}

function isAlreadyExistsError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

const defaultRunSettings: RunSettings = {
  runMode: "focused_area",
  selectedSourceOutlineLeafIds: [],
  selectedOutlineLeafIds: [],
  excludedLearningUnitIds: [],
};

function normalizeRunSettings(settings: Partial<RunSettings> | undefined): RunSettings {
  return {
    ...defaultRunSettings,
    ...settings,
    selectedSourceOutlineLeafIds: uniqueIds(settings?.selectedSourceOutlineLeafIds ?? []),
    selectedOutlineLeafIds: uniqueIds(settings?.selectedOutlineLeafIds ?? []),
    excludedLearningUnitIds: uniqueIds(settings?.excludedLearningUnitIds ?? []),
  };
}

function uniqueIds(values: string[]) {
  const ids = values.map((value) => safeId(value.trim()));
  return [...new Set(ids)];
}

function assertIdsExist(selected: string[], available: string[], label: string) {
  const availableIds = new Set(available);
  const missing = selected.find((id) => !availableIds.has(id));
  if (missing) throw new Error(`${label}에 없는 ID입니다: ${missing}`);
}

function selectSourceOutline(analysis: unknown, selectedLeafIds: string[]) {
  if (!analysis) return undefined;
  const outline = pdfAnalysisResponseSchema.parse(analysis).sourceOutline;
  if (!outline) return undefined;
  const selected = new Set(
    selectedLeafIds.length > 0
      ? selectedLeafIds
      : outline.nodes.filter((node) => node.selectedByDefault).map((node) => node.id),
  );
  const nodeById = new Map(outline.nodes.map((node) => [node.id, node]));
  const included = new Set<string>();
  for (const id of selected) {
    let current = nodeById.get(id);
    while (current && !included.has(current.id)) {
      included.add(current.id);
      current = current.parentId ? nodeById.get(current.parentId) : undefined;
    }
  }
  const nodes = outline.nodes
    .filter((node) => included.has(node.id))
    .map((node) => ({
      ...node,
      selectedByDefault: selected.has(node.id),
      ...(selected.has(node.id) ? {} : { sourceEvidence: "" }),
    }));
  return { ...outline, nodes };
}

function buildConfirmedGuideline(plan: unknown, settings: RunSettings) {
  if (settings.runMode === "focused_area") {
    const draft = studyGuidelineDraftSchema.parse(plan);
    const selectedGroup = draft.groups.find(
      (group) => group.id === (settings.selectedFocusGroupId ?? draft.recommendedGroupId),
    );
    if (!selectedGroup) throw new Error("선택한 학습 영역이 plan 결과에 없습니다.");
    return { summary: draft.summary, selectedGroup };
  }
  if (!plan || typeof plan !== "object") throw new Error("전체 핵심 학습 plan이 없습니다.");
  const wholeDocumentCore = plan as Record<string, unknown>;
  const outline = wholeDocumentCore.learningOutline &&
      typeof wholeDocumentCore.learningOutline === "object"
    ? filterLearningOutline(
        wholeDocumentCore.learningOutline as {
          title: string;
          summary: string;
          nodes: Array<{ id: string; parentId: string | null; selectedByDefault: boolean }>;
        },
        settings.selectedOutlineLeafIds,
      )
    : undefined;
  const maxLearningUnitCount = Number(wholeDocumentCore.maxLearningUnitCount);
  return {
    summary: String(wholeDocumentCore.summary ?? ""),
    selectedGroup: {
      id: "whole-document-core",
      title: "전체 자료 핵심 학습 범위",
      description: String(wholeDocumentCore.selectionRationale ?? ""),
      itemCount: maxLearningUnitCount,
      itemLabel: "핵심 LearningUnit",
      selectionInstruction:
        "전체 핵심 범위에서 학습 가치가 있는 독립 단위를 추출하고 낮은 가치의 예시·반복·문서 안내는 제외합니다.",
    },
    wholeDocumentCore: outline ? { ...wholeDocumentCore, learningOutline: outline } : wholeDocumentCore,
    ...(settings.runMode === "whole_document_core_soft_budget"
      ? {
          countPolicy: "soft_budget",
          learningUnitSoftBudget: { max: maxLearningUnitCount },
        }
      : {}),
  };
}

function filterLearningOutline<T extends {
  title: string;
  summary: string;
  nodes: Array<{ id: string; parentId: string | null; selectedByDefault: boolean }>;
}>(outline: T, selectedLeafIds: string[]) {
  if (selectedLeafIds.length === 0) return outline;
  const selected = new Set(selectedLeafIds);
  const nodeById = new Map(outline.nodes.map((node) => [node.id, node]));
  const included = new Set<string>();
  for (const id of selected) {
    let current = nodeById.get(id);
    while (current && !included.has(current.id)) {
      included.add(current.id);
      current = current.parentId ? nodeById.get(current.parentId) : undefined;
    }
  }
  return {
    ...outline,
    nodes: outline.nodes
      .filter((node) => included.has(node.id))
      .map((node) => ({ ...node, selectedByDefault: selected.has(node.id) })),
  };
}
