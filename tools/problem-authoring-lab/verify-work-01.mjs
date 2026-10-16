import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderDocument, renderInteractiveDocument } from "./renderer.ts";

const root = process.cwd();
// Use a new directory so the earlier browser-inspection evidence remains untouched.
const outputDir = path.join(root, "eval/local/full-study-20260928/r02/work-01-static-recheck");
const inputs = [
  ["geometry", "eval/local/full-study-20260928/inputs/r02-geometry-authoring-document.json"],
  ["semiconductor", "eval/local/full-study-20260928/inputs/r02-semiconductor-authoring-document.json"],
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const results = [];
await mkdir(outputDir, { recursive: true });

for (const [subject, relativeInput] of inputs) {
  const input = path.join(root, relativeInput);
  const raw = await readFile(input);
  const document = JSON.parse(raw.toString("utf8"));
  const htmls = {
    before: renderDocument(document, { revealAnswers: false }),
    after: renderDocument(document, { revealAnswers: true }),
    interactive: renderInteractiveDocument(document),
  };
  const leaked = document.questions.flatMap((question) => ["sourceRange", "knowledgeContent"]
    .filter((field) => question.source[field] && (htmls.before.includes(question.source[field]) || htmls.interactive.includes(question.source[field])))
    .map((field) => `${question.id}:${field}`));
  const missingAfter = document.questions.flatMap((question) => ["sourceRange", "knowledgeContent"]
    .filter((field) => question.source[field] && !htmls.after.includes(question.source[field]))
    .map((field) => `${question.id}:${field}`));
  for (const [state, html] of Object.entries(htmls)) await writeFile(path.join(outputDir, `${subject}-${state}.html`), html);
  const staticChecks = {
    inlineKatexStyle: htmls.before.includes(".katex .katex-mathml{") && htmls.before.includes("url(data:font/woff2;base64,"),
    noExternalKatexPath: Object.values(htmls).every((html) => !html.includes("url(fonts/") && !html.includes('<link rel="stylesheet"')),
    revealInsertionCode: htmls.interactive.includes("sourceLine.append(detail)"),
    postRevealMessageCode: htmls.interactive.includes("정답 공개 후 제출(독립 풀이 기록 제외)"),
  };
  const unchanged = sha256(await readFile(input)) === sha256(raw);
  const result = { subject, input: relativeInput, inputSha256: sha256(raw), questionCount: document.questions.length, outputDir, leaked, missingAfter, staticChecks, inputUnchanged: unchanged };
  results.push(result);
}

await writeFile(path.join(outputDir, "verification.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(({ subject, questionCount, inputSha256, leaked, missingAfter, staticChecks, inputUnchanged }) => ({ subject, questionCount, inputSha256, leaked, missingAfter, staticChecks, inputUnchanged })), null, 2));
if (results.some((item) => item.leaked.length || item.missingAfter.length || Object.values(item.staticChecks).some((passed) => !passed) || !item.inputUnchanged)) process.exitCode = 1;
