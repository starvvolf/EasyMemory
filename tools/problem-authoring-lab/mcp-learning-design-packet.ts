import { createHash } from "node:crypto";
import type { SourceContent } from "./contract.ts";

type Target = {
  number: number;
  content: string;
  objective: string;
  successCriterion: string;
  sourceEvidence: string;
  concepts: Array<{ number: number; title: string }>;
};

type StageOutput = { structuredContent?: { runId?: string; stageInput?: { input?: { learningTargets?: Target[] } } } };
type StageSubmission = { runId?: string; stage?: string; result?: { learningDesignText?: string } };
type Published = { id?: string; title?: string; sourceFileName?: string; studyGuideline?: { summary?: string }; sourceText?: string };

export function adaptMcpLearningDesign(output: StageOutput, submission: StageSubmission, published: Published, hashes: { output: string; submission: string; published: string }) {
  const runId = output.structuredContent?.runId;
  const targets = output.structuredContent?.stageInput?.input?.learningTargets;
  const designText = submission.result?.learningDesignText;
  if (!runId || submission.runId !== runId || submission.stage !== "learning-design" || !designText || !published.id || !published.sourceFileName || !published.sourceText || !targets?.length) throw new Error("MCP 학습설계 산출물의 연결이 불완전합니다.");
  if (new Set(targets.map((target) => target.number)).size !== targets.length) throw new Error("학습대상 번호가 중복됩니다.");
  const items = targets.map((target): SourceContent & { knowledgeContent: string; concepts: Target["concepts"] } => {
    const pagesText = target.sourceEvidence.match(/\(PDF ([\d, ]+)쪽\)/)?.[1];
    const sourcePages = pagesText?.split(",").map((value) => Number(value.trim())) ?? [];
    if (!target.content || !target.objective || !target.successCriterion || !target.sourceEvidence || !sourcePages.length || sourcePages.some((page) => !Number.isInteger(page) || page < 2 || page > 7)) throw new Error(`학습대상 ${target.number}의 목표·출처가 불완전합니다.`);
    if (![target.content, target.objective, target.successCriterion, target.sourceEvidence].every((value) => designText.includes(value))) throw new Error(`학습대상 ${target.number}가 제출된 설계 원문과 다릅니다.`);
    if (!published.sourceText.includes(target.sourceEvidence)) throw new Error(`학습대상 ${target.number}의 근거가 확정 원문에 없습니다.`);
    return {
      learningUnitId: `mcp-learning-${target.number}`,
      objectiveId: `mcp-objective-${target.number}`,
      sourceId: published.sourceFileName!,
      sourcePage: sourcePages[0]!,
      sourcePages,
      sourceRange: `PDF ${sourcePages.join(", ")}쪽`,
      sourceText: target.sourceEvidence,
      target: target.objective,
      successCriteria: [target.successCriterion],
      knowledgeContent: target.content,
      concepts: structuredClone(target.concepts),
    };
  });
  return {
    schemaVersion: "authoring-source-packet-v3",
    packetId: `mcp-${runId}`,
    title: published.title,
    learningGoal: published.studyGuideline?.summary ?? "",
    sourceFileName: published.sourceFileName,
    selectedPdfPages: [2, 3, 4, 5, 6, 7],
    origin: { runId, publishedId: published.id, sha256: hashes },
    authoringRequest: { independentQuestions: 2, sharedSetQuestions: 2, revisionLimit: 1, format: "author-choice" },
    items,
  };
}

export function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}
