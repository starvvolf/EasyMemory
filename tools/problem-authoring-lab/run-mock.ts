import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runHarness } from "./harness.ts";
import { mockDraft, mockInspection, mockPatch } from "./fixtures/mock-adapters.ts";
import type { SourceContent } from "./contract.ts";

const root = path.resolve("tools/problem-authoring-lab");
const outputDir = path.resolve(process.argv[2] ?? path.join(root, "runs", "mock"));
const packetText = await readFile(path.join(root, "fixtures", "science-source-packet.json"), "utf8");
const skillText = await readFile(path.join(root, "skill", "problem-authoring", "SKILL.md"), "utf8");
const packet = JSON.parse(packetText) as { items: SourceContent[] };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

const result = await runHarness({
  author: async () => ({ document: mockDraft(packet.items), usage: { model: "mock-author", inputTokens: 0, outputTokens: 0 } }),
  inspect: async (document) => ({ issues: mockInspection(document), usage: { model: "mock-inspector", inputTokens: 0, outputTokens: 0 } }),
  revise: async () => ({ patch: mockPatch, usage: { model: "mock-reviser", inputTokens: 0, outputTokens: 0 } }),
}, 1);

await mkdir(outputDir, { recursive: true });
for (const artifact of result.artifacts) {
  const directory = path.join(outputDir, `iteration-${artifact.iteration}`);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, "document.json"), JSON.stringify(artifact.document, null, 2)),
    writeFile(path.join(directory, "before-answer.html"), artifact.beforeAnswerHtml),
    writeFile(path.join(directory, "after-answer.html"), artifact.afterAnswerHtml),
    writeFile(path.join(directory, "inspection.json"), JSON.stringify(artifact.issues, null, 2)),
    ...(artifact.patch ? [writeFile(path.join(directory, "patch.json"), JSON.stringify(artifact.patch, null, 2))] : []),
  ]);
}
await writeFile(path.join(outputDir, "manifest.json"), JSON.stringify({
  artifactType: "problem-authoring-lab-run",
  status: result.status,
  inputHash: hash(packetText),
  skillVersion: "problem-authoring-hypothesis-v1",
  skillHash: hash(skillText),
  revisionLimit: 1,
  questionCount: result.artifacts.at(-1)?.document.questions.length ?? 0,
  totalUsage: result.totalUsage,
}, null, 2));
console.log(outputDir);
