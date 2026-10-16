import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { adaptLearningDesignArtifact } from "./learning-design-bridge.ts";

const inputPath = path.resolve(process.argv[2] ?? "");
const outputDirectory = path.resolve(process.argv[3] ?? "");
if (!process.argv[2] || !process.argv[3]) {
  throw new Error("사용법: run-learning-design-bridge.ts <engine-artifact.json> <output-directory>");
}

const input = JSON.parse(await readFile(inputPath, "utf8"));
const result = adaptLearningDesignArtifact(input);
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDirectory, "source-packet.json"), JSON.stringify(result.packet, null, 2)),
  writeFile(path.join(outputDirectory, "bridge-report.json"), JSON.stringify({
    ...result.report,
    inputPath: path.relative(process.cwd(), inputPath).replaceAll("\\", "/"),
    outputPath: path.relative(process.cwd(), outputDirectory).replaceAll("\\", "/"),
  }, null, 2)),
]);
console.log(outputDirectory);
