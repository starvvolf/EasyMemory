import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { adaptMcpLearningDesign, hashText } from "./mcp-learning-design-packet.ts";

const [outputFile, submissionFile, publishedFile, runId] = process.argv.slice(2);
if (!outputFile || !submissionFile || !publishedFile || !runId || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(runId)) {
  throw new Error("사용법: run-mcp-learning-design-packet.ts <learning-design-output.json> <submit-learning-design.json> <published.json> <run-id>");
}
const [outputText, submissionText, publishedText] = await Promise.all([outputFile, submissionFile, publishedFile].map((file) => readFile(file, "utf8")));
const packet = adaptMcpLearningDesign(JSON.parse(outputText), JSON.parse(submissionText), JSON.parse(publishedText), {
  output: hashText(outputText), submission: hashText(submissionText), published: hashText(publishedText),
});
const directory = path.resolve("tools/problem-authoring-lab/runs", runId);
await mkdir(directory, { recursive: false });
await writeFile(path.join(directory, "source-packet.json"), `${JSON.stringify(packet, null, 2)}\n`);
console.log(path.join(directory, "source-packet.json"));
