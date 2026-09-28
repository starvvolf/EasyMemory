import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateDocument, type AuthoringDocument } from "./contract.ts";
import { renderDocument, renderInteractiveDocument } from "./renderer.ts";

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) throw new Error("사용법: render-typeset-matrix-example.ts <document.json> <output-directory>");

const document = JSON.parse(await readFile(input, "utf8")) as AuthoringDocument;
const firstQuestion = document.questions.find((item) => item.id === "q-matrix-roles");
const firstData = firstQuestion?.blocks.find((block) => block.id === "q1-data");
const firstChoices = firstQuestion?.blocks.find((block) => block.id === "q1-choices");
const firstReveal = firstQuestion?.blocks.find((block) => block.id === "q1-reveal");
if (!firstQuestion || !firstData || !firstChoices || firstChoices.kind !== "choice-set" || !firstReveal || firstReveal.kind !== "answer-reveal") throw new Error("첫 문항의 기존 계약이 다릅니다.");
firstQuestion.blocks = firstQuestion.blocks.map((block) => block.id === "q1-data"
  ? {
      id: block.id,
      kind: "math" as const,
      frame: { x: 55, y: 113, width: 650, height: 120 },
      latex: "\\begin{aligned}P&=(1,2)\\\\M_1&=\\begin{bmatrix}2&0\\\\0&3\\end{bmatrix}\\\\M_2&=(-4,1)\\end{aligned}",
    }
  : block);
firstQuestion.page.height = 480;
firstChoices.frame.y = 250;
firstReveal.frame.y = 418;

const question = document.questions.find((item) => item.id === "q-set-translation-matrix");
if (!question) throw new Error("기하변환 행렬 문항이 없습니다.");
const response = question.responses.find((item) => item.id === "r-set-translation-matrix");
const choices = question.blocks.find((block) => block.id === "q4-choices");
const note = question.blocks.find((block) => block.id === "q4-reminder");
const reveal = question.blocks.find((block) => block.id === "q4-reveal");
if (!response || response.kind !== "single-choice" || !choices || choices.kind !== "choice-set" || !reveal || reveal.kind !== "answer-reveal") throw new Error("행렬 문항의 기존 계약이 다릅니다.");

const matrixByOption = new Map([
  ["q4-a", "\\begin{bmatrix}1&0&3\\\\0&1&-2\\\\0&0&1\\end{bmatrix}"],
  ["q4-b", "\\begin{bmatrix}1&0&-3\\\\0&1&2\\\\0&0&1\\end{bmatrix}"],
  ["q4-c", "\\begin{bmatrix}1&0&0\\\\0&1&0\\\\-3&2&1\\end{bmatrix}"],
  ["q4-d", "\\begin{bmatrix}1&0&2\\\\0&1&-3\\\\0&0&1\\end{bmatrix}"],
]);
response.options = response.options.map((option) => {
  const latex = matrixByOption.get(option.id);
  if (!latex) throw new Error(`예상하지 않은 선지: ${option.id}`);
  return { id: option.id, latex };
});
if (note?.kind === "box") note.label = "T는 동차좌표 (x,y,1)에 왼쪽에서 곱한다.";
question.page.height = 785;
choices.columns = 1;
choices.frame.height = 445;
reveal.frame.y = 660;
reveal.frame.height = 85;

const errors = validateDocument(document).filter((issue) => issue.severity === "error");
if (errors.length) throw new Error(JSON.stringify(errors));
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(path.join(output, "document.json"), `${JSON.stringify(document, null, 2)}\n`),
  writeFile(path.join(output, "before-answer.html"), renderDocument(document, { revealAnswers: false })),
  writeFile(path.join(output, "after-answer.html"), renderDocument(document, { revealAnswers: true })),
  writeFile(path.join(output, "interactive.html"), renderInteractiveDocument(document)),
]);
