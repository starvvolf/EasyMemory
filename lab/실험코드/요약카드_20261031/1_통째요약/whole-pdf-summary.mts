// One-off timing probe: whole PDF → one streaming summary call (not part of the app).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Same key source as scripts/run-local-experiment.mjs (read only, never printed).
if (!process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY) {
  const { homedir } = await import("node:os");
  const keyFile = path.join(homedir(), ".study-forge", "chatgpt-token-key");
  const key = readFileSync(keyFile, "utf8").trim();
  if (/^[a-f0-9]{64}$/i.test(key)) process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY = key;
}
const [pdfPath, outPath, model = "gpt-6.1-terra", effort = "low"] = process.argv.slice(2);
const { callModel } = await import(pathToFileURL(path.join(process.cwd(), "src/lib/ai/model.ts")).href);

const system = [
  "너는 대학 강의 자료를 공부용 요약으로 정리한다. 한국어 존댓말(~해요).",
  "형식(마크다운): 맨 위 두세 문장 개요 → '## 소제목'마다 본문 → 그 아래 '**쉬운 설명**' 한 문단(비유) → 한 줄 정리. 끝에 '## 핵심 정리' 목록.",
  "문장 끝마다 근거 쪽을 (p.N)으로 단다. 자료에 없는 내용은 쓰지 않는다. 표·수식이 있으면 살린다.",
].join("\n");

const file = readFileSync(pdfPath);
const started = performance.now();
let firstText: number | null = null;
const result = await callModel({
  purpose: "probe:whole-pdf-summary",
  system,
  user: "첨부한 PDF 전체를 위 형식으로 요약해 주세요.",
  model, effort,
  caller: { uid: "local-experiment" },
  files: [{ filename: path.basename(pdfPath), dataUrl: `data:application/pdf;base64,${file.toString("base64")}` }],
  onText: () => { if (firstText === null) firstText = performance.now(); },
});
const total = (performance.now() - started) / 1000;
writeFileSync(outPath, result.text, "utf8");
const pageTags = result.text.match(/p\.\s?\d+/g) ?? [];
const report = JSON.stringify({
  model: result.model, effort,
  firstTextSec: firstText === null ? null : +((firstText - started) / 1000).toFixed(1),
  totalSec: +total.toFixed(1),
  usage: result.usage,
  chars: result.text.length,
  pageTags: pageTags.length,
  uniquePages: new Set(pageTags.map((t: string) => t.replace(/\D/g, ""))).size,
  easy: (result.text.match(/쉬운 설명/g) ?? []).length,
}, null, 1);
writeFileSync(`${outPath}.json`, report, "utf8");
console.log(report);
