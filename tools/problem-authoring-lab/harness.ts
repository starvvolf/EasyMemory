import { applyRevision, validateDocument, type AuthoringDocument, type InspectionIssue, type ModelUsage, type RevisionPatch } from "./contract.ts";
import { renderDocument } from "./renderer.ts";

export type HarnessArtifact = {
  iteration: number;
  document: AuthoringDocument;
  beforeAnswerHtml: string;
  afterAnswerHtml: string;
  issues: InspectionIssue[];
  patch?: RevisionPatch;
  usage: ModelUsage[];
};

export type HarnessResult = {
  status: "ready-for-independent-review" | "revision-limit";
  artifacts: HarnessArtifact[];
  totalUsage: { inputTokens: number; outputTokens: number };
};

export type HarnessAdapters = {
  author: () => Promise<{ document: AuthoringDocument; usage: ModelUsage }>;
  inspect: (document: AuthoringDocument, previews: { before: string; after: string }) => Promise<{ issues: InspectionIssue[]; usage: ModelUsage }>;
  revise: (document: AuthoringDocument, issues: InspectionIssue[]) => Promise<{ patch: RevisionPatch; usage: ModelUsage }>;
};

export async function runHarness(adapters: HarnessAdapters, maxRevisions = 1): Promise<HarnessResult> {
  if (!Number.isInteger(maxRevisions) || maxRevisions < 0 || maxRevisions > 3) throw new Error("maxRevisions는 0~3이어야 합니다.");
  const authored = await adapters.author();
  let document = authored.document;
  const artifacts: HarnessArtifact[] = [];
  let carriedUsage = [authored.usage];

  for (let iteration = 0; iteration <= maxRevisions; iteration += 1) {
    const contractIssues = validateDocument(document);
    const before = renderDocument(document, { revealAnswers: false });
    const after = renderDocument(document, { revealAnswers: true });
    const inspected = await adapters.inspect(document, { before, after });
    const issues = [...contractIssues, ...inspected.issues];
    const artifact: HarnessArtifact = {
      iteration,
      document: structuredClone(document),
      beforeAnswerHtml: before,
      afterAnswerHtml: after,
      issues,
      usage: [...carriedUsage, inspected.usage],
    };
    artifacts.push(artifact);
    if (!issues.some((issue) => issue.severity === "error")) return summarize("ready-for-independent-review", artifacts);
    if (iteration === maxRevisions) return summarize("revision-limit", artifacts);
    const revised = await adapters.revise(document, issues);
    artifact.patch = revised.patch;
    document = applyRevision(document, revised.patch);
    carriedUsage = [revised.usage];
  }
  return summarize("revision-limit", artifacts);
}

function summarize(status: HarnessResult["status"], artifacts: HarnessArtifact[]): HarnessResult {
  const usage = artifacts.flatMap((artifact) => artifact.usage);
  return {
    status,
    artifacts,
    totalUsage: {
      inputTokens: usage.reduce((sum, item) => sum + item.inputTokens, 0),
      outputTokens: usage.reduce((sum, item) => sum + item.outputTokens, 0),
    },
  };
}
