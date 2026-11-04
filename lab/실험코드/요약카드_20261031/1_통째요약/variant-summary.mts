// One-off timing probe: deadlock PDF as (a) page images only or (b) our preprocessing output, in ONE streaming call.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

if (!process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY) {
  const key = readFileSync(path.join(homedir(), ".study-forge", "chatgpt-token-key"), "utf8").trim();
  if (/^[a-f0-9]{64}$/i.test(key)) process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY = key;
}
const [mode, pdfPath, outPath, model = "gpt-6.1-terra", effort = "low"] = process.argv.slice(2);
const mod = (p: string) => import(pathToFileURL(path.join(process.cwd(), p)).href);
const { callModel } = await mod("src/lib/ai/model.ts");
const { renderPageImages, renderPageFigures, pageEmphasis } = await mod("src/lib/study/gen/pages.ts");
const { preparePdf, pageText } = await mod("src/lib/study/gen/prep.ts");

const WIDTH = 1024; // runner.ts studyRecallerLab default imageWidth
const system = [
  "너는 대학 강의 자료를 공부용 요약으로 정리한다. 한국어 존댓말(~해요).",
  "형식(마크다운): 맨 위 두세 문장 개요 → '## 소제목'마다 본문 → 그 아래 '**쉬운 설명**' 한 문단(비유) → 한 줄 정리. 끝에 '## 핵심 정리' 목록.",
  "문장 끝마다 근거 쪽을 (p.N)으로 단다. 자료에 없는 내용은 쓰지 않는다. 표·수식이 있으면 살린다.",
].join("\n");

const bytes = new Uint8Array(readFileSync(pdfPath));
const pages = Array.from({ length: 14 }, (_, i) => i + 1);
const t0 = performance.now();
let user = "";
const images: Array<{ label: string; dataUrl: string; detail: "high" }> = [];
const routes: Array<{ page: number; route: string; title: string; chars: number; images: number }> = [];

if (mode === "images") {
  const drawn: Map<number, string> = await renderPageImages(bytes.slice(), pages, WIDTH);
  for (const p of pages) if (drawn.get(p)) images.push({ label: `[p.${p}]`, dataUrl: drawn.get(p)!, detail: "high" });
  user = `첨부한 PDF의 모든 쪽 이미지(${images.length}장, 각 이미지 앞에 [p.N] 표시)를 위 형식으로 요약해 주세요.`;
} else {
  const prep = await preparePdf(bytes.slice(), pages, "prep-2");
  const emphasis: Map<number, string[]> = await pageEmphasis(bytes.slice(), pages).catch(() => new Map());
  const figPages = prep.pages.filter((p: any) => p.route === "figures").map((p: any) => p.page);
  const figs: Map<number, Array<{ label: string; dataUrl: string }>> = figPages.length ? await renderPageFigures(bytes.slice(), figPages, WIDTH) : new Map();
  const wholeWanted = prep.pages.filter((p: any) => p.route === "page" || (p.route === "figures" && !(figs.get(p.page)?.length))).map((p: any) => p.page);
  const wholes: Map<number, string> = wholeWanted.length ? await renderPageImages(bytes.slice(), wholeWanted, WIDTH) : new Map();
  const blocks: string[] = [];
  for (const p of prep.pages) {
    const text = pageText(p) + (emphasis.get(p.page)?.length ? `\n[색 강조] ${emphasis.get(p.page)!.join(" · ")}` : "");
    blocks.push(`[p.${p.page}]\n${text}`);
    const before = images.length;
    const f = figs.get(p.page) ?? [];
    if (f.length) images.push(...f.map((x) => ({ label: `[p.${p.page}] ${x.label}`, dataUrl: x.dataUrl, detail: "high" as const })));
    else if (wholes.get(p.page)) images.push({ label: `[p.${p.page}] 원문 쪽 전체`, dataUrl: wholes.get(p.page)!, detail: "high" });
    routes.push({ page: p.page, route: p.route, title: p.title, chars: text.length, images: images.length - before });
  }
  user = `아래는 PDF를 전처리한 결과예요. 쪽마다 [p.N] 글자 층이 있고, 그림이 필요한 쪽은 그 쪽의 그림(또는 쪽 전체) 이미지를 [p.N] 표시와 함께 붙였어요. 전체를 위 형식으로 요약해 주세요.\n\n${blocks.join("\n\n")}`;
}
const prepSec = (performance.now() - t0) / 1000;

const started = performance.now();
let firstText: number | null = null;
const result = await callModel({
  purpose: `probe:${mode}-summary`, system, user, model, effort,
  caller: { uid: "local-experiment" }, images,
  onText: () => { if (firstText === null) firstText = performance.now(); },
});
const total = (performance.now() - started) / 1000;
writeFileSync(outPath, result.text, "utf8");
const pageTags = result.text.match(/p\.\s?\d+/g) ?? [];
const report = JSON.stringify({
  mode, model: result.model, effort, width: WIDTH,
  prepSec: +prepSec.toFixed(1),
  firstTextSec: firstText === null ? null : +((firstText - started) / 1000).toFixed(1),
  totalSec: +total.toFixed(1),
  usage: result.usage,
  chars: result.text.length,
  pageTags: pageTags.length,
  uniquePages: new Set(pageTags.map((t: string) => t.replace(/\D/g, ""))).size,
  easy: (result.text.match(/쉬운 설명/g) ?? []).length,
  images: images.length, userChars: user.length,
  routes,
}, null, 1);
writeFileSync(`${outPath}.json`, report, "utf8");
console.log(report);
