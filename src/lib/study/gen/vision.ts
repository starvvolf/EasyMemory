// Image reading probe (2026-10-12): many lecture slides keep their content in pictures (matrices, diagrams, charts),
// so the text layer alone is not enough. This renders a PDF page and asks the model to read it, so we can judge
// whether page images can feed the engine. One call per probe; nothing here changes a generation.
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callModel, type ModelCaller } from "../../ai/model.ts";
import { redactCallText } from "../lab-contract.ts";
import { cleanPageText } from "./checks.ts";
import { dataRoot, GenError } from "./runner.ts";

/** Long side of the rendered page in pixels: enough for slide text and subscripts, small enough for one request. */
const RENDER_WIDTH = 1600;

/** Renders pages to JPEG data URLs (server side, @napi-rs/canvas). */
export async function renderPageImages(bytes: Uint8Array, pages: readonly number[], width = RENDER_WIDTH) {
  const [{ createCanvas }, pdfjs] = await Promise.all([import("@napi-rs/canvas"), import("pdfjs-dist/legacy/build/pdf.mjs")]);
  const document = await pdfjs.getDocument({ data: Uint8Array.from(bytes) }).promise;
  const images = new Map<number, string>();
  try {
    for (const pageNumber of [...new Set(pages)]) {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) continue;
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / Math.max(base.width, base.height) });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
      images.set(pageNumber, `data:image/jpeg;base64,${canvas.toBuffer("image/jpeg", 85).toString("base64")}`);
      page.cleanup();
    }
  } finally { await document.cleanup(); }
  return images;
}

export const VISION_SYSTEM = [
  "너는 강의 슬라이드 한 쪽을 글로 옮기는 사람이다. 이미지에 보이는 것만 옮기고, 보이지 않는 내용은 지어내지 않는다.",
  "순서: 제목 → 본문 글(글머리표 구조 유지) → 식(LaTeX, $...$) → 표(마크다운 표) → 그림·도표(무엇을 보여 주는지 한두 문장, 그림 안 글자·수치·축 이름은 그대로).",
  "원문의 언어와 표기를 그대로 둔다. 읽을 수 없는 부분은 [읽을 수 없음]으로 쓴다.",
  "아래 [글자 층]은 PDF에서 뽑은 글자다. 깨졌거나 빠진 부분이 있을 수 있으니 이미지를 기준으로 한다.",
].join("\n");

export type VisionProbe = {
  id: string; createdAt: string; sourceId: string; fileName: string; page: number;
  model: string; effort: string; ms: number; ok: boolean; error: string | null;
  textLayer: string; reply: string | null; usage?: { inputTokens?: number; outputTokens?: number }; imageBytes: number;
};

const probeSchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(200),
  page: z.number().int().positive().max(2000),
  model: z.string().trim().min(1).max(80).default("gpt-6-sol"),
  effort: z.enum(["low", "medium", "high", "xhigh"]).default("medium"),
  provider: z.enum(["chatgpt", "fake"]).default("chatgpt"),
  confirmed: z.boolean().optional(),
});
const probeDir = () => path.join(dataRoot(), "vision");

export type ProbeOptions = {
  /** Tests pass the PDF bytes and a fake image instead of the registry and the renderer. */
  pdf?: (sourceId: string) => Promise<{ bytes: Uint8Array; fileName: string } | null>;
  render?: (bytes: Uint8Array, page: number) => Promise<string | undefined>;
  texts?: (bytes: Uint8Array, page: number) => Promise<string>;
};

export async function runVisionProbe(raw: unknown, caller: ModelCaller, options: ProbeOptions = {}): Promise<VisionProbe & { image: string }> {
  const input = probeSchema.parse(raw);
  if (input.provider !== "fake" && input.confirmed !== true) throw new GenError(400, "실제 모델 호출 확인이 필요합니다.");
  const pdf = await (options.pdf ?? registeredPdf)(input.sourceId);
  if (!pdf) throw new GenError(404, "등록된 원본 PDF를 찾을 수 없습니다.");
  const image = await (options.render ?? (async (bytes, page) => (await renderPageImages(bytes, [page])).get(page)))(pdf.bytes, input.page);
  if (!image) throw new GenError(400, "그 쪽을 그릴 수 없습니다(쪽 번호 확인).");
  const textLayer = cleanPageText(await (options.texts ?? textLayerOf)(pdf.bytes, input.page));
  const probe: VisionProbe = { id: `v_${randomBytes(8).toString("hex")}`, createdAt: new Date().toISOString(), sourceId: input.sourceId, fileName: pdf.fileName,
    page: input.page, model: input.model, effort: input.effort, ms: 0, ok: false, error: null, textLayer, reply: null, imageBytes: Math.round(image.length * 0.75) };
  const started = Date.now();
  try {
    const reply = await callModel({ purpose: "vision:probe", system: VISION_SYSTEM, user: `[자료] ${pdf.fileName} p.${input.page}\n\n[글자 층]\n${textLayer || "(없음)"}`,
      images: [{ label: `p.${input.page}`, dataUrl: image }], model: input.model, effort: input.effort, caller, provider: input.provider,
      ...(input.provider === "fake" ? { fakeReply: `# p.${input.page}\n${textLayer.slice(0, 200)}\n(가짜 모델: 이미지는 읽지 않음)` } : {}) });
    Object.assign(probe, { ok: true, reply: redactCallText(reply.text), model: reply.model, usage: reply.usage });
  } catch (error) {
    probe.error = redactCallText(error instanceof Error ? error.message : String(error));
  }
  probe.ms = Date.now() - started;
  await mkdir(probeDir(), { recursive: true });
  await writeFile(path.join(probeDir(), `${probe.id}.json`), JSON.stringify(probe, null, 2), { mode: 0o600 });
  await writeFile(path.join(probeDir(), `${probe.id}.jpg`), Buffer.from(image.split(",")[1], "base64"), { mode: 0o600 });
  return { ...probe, image };
}

export async function listVisionProbes(): Promise<VisionProbe[]> {
  let names: string[];
  try { names = await readdir(probeDir()); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const probes = await Promise.all(names.filter((name) => /^v_[a-f0-9]{16}\.json$/.test(name)).map(async (name) => JSON.parse(await readFile(path.join(probeDir(), name), "utf8")) as VisionProbe));
  return probes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function readVisionImage(id: string) {
  if (!/^v_[a-f0-9]{16}$/.test(id)) throw new GenError(400, "시험 ID가 올바르지 않습니다.");
  return `data:image/jpeg;base64,${(await readFile(path.join(probeDir(), `${id}.jpg`))).toString("base64")}`;
}

async function registeredPdf(sourceId: string) {
  const { getRegisteredMcpSource, readRegisteredMcpSourcePdf } = await import("../../mcp-source-registry.ts");
  const [source, bytes] = await Promise.all([getRegisteredMcpSource(sourceId), readRegisteredMcpSourcePdf(sourceId)]);
  return source && bytes ? { bytes, fileName: source.fileName } : null;
}
async function textLayerOf(bytes: Uint8Array, page: number) {
  const { extractPdfPageTexts } = await import("../../../../tools/study-forge-mcp/source-evidence.ts");
  return (await extractPdfPageTexts(bytes, [page])).get(page) ?? "";
}
