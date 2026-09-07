import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AuthoringDocument } from "./contract.ts";
import { renderDocument } from "./renderer.ts";

const sourceDocument = path.resolve(process.argv[2] ?? "");
const outputDirectory = path.resolve(process.argv[3] ?? "");

if (!process.argv[2] || !process.argv[3]) {
  throw new Error("사용법: rerender-existing.ts <document.json> <output-directory>");
}

const documentText = await readFile(sourceDocument, "utf8");
const document = JSON.parse(documentText) as AuthoringDocument;
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  copyFile(sourceDocument, path.join(outputDirectory, "document.json")),
  writeFile(path.join(outputDirectory, "before-answer.html"), renderDocument(document, { revealAnswers: false })),
  writeFile(path.join(outputDirectory, "after-answer.html"), renderDocument(document, { revealAnswers: true })),
  writeFile(path.join(outputDirectory, "design-change.json"), JSON.stringify({
    artifactType: "renderer-only-comparison",
    sourceDocument: path.relative(process.cwd(), sourceDocument).replaceAll("\\", "/"),
    documentSha256: createHash("sha256").update(documentText).digest("hex"),
    contentChanged: false,
    rendererRevision: "modern-soft-v1",
  }, null, 2)),
]);

console.log(outputDirectory);
