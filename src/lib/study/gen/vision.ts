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
import { renderPageImages, TRANSCRIBE_SYSTEM } from "./pages.ts";

export const VISION_SYSTEM = TRANSCRIBE_SYSTEM;

export type VisionProbe = {
  id: string; createdAt: string; sourceId: string; fileName: string; page: number; mode?: "image" | "pdf";
  model: string; effort: string; ms: number; ok: boolean; error: string | null;
  textLayer: string; reply: string | null; usage?: { inputTokens?: number; outputTokens?: number }; imageBytes: number;
};

const probeSchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(200),
  page: z.number().int().positive().max(2000),
  model: z.string().trim().min(1).max(80).default("gpt-6-sol"),
  effort: z.enum(["low", "medium", "high", "xhigh"]).default("medium"),
  provider: z.enum(["chatgpt", "fake"]).default("chatgpt"),
  /** image: one rendered page. pdf: the whole PDF file, asking for one page (the file route may bill every page). */
  mode: z.enum(["image", "pdf"]).default("image"),
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
    page: input.page, mode: input.mode, model: input.model, effort: input.effort, ms: 0, ok: false, error: null, textLayer, reply: null, imageBytes: Math.round(image.length * 0.75) };
  const started = Date.now();
  try {
    const asPdf = input.mode === "pdf";
    const reply = await callModel({ purpose: `vision:probe:${input.mode}`, system: VISION_SYSTEM,
      user: `[자료] ${pdf.fileName} p.${input.page}${asPdf ? `\n첨부한 PDF 전체 중 ${input.page}쪽만 옮긴다.` : ""}\n\n[글자 층]\n${textLayer || "(없음)"}`,
      ...(asPdf ? { files: [{ filename: pdf.fileName, dataUrl: `data:application/pdf;base64,${Buffer.from(pdf.bytes).toString("base64")}` }] }
        : { images: [{ label: `p.${input.page}`, dataUrl: image }] }),
      model: input.model, effort: input.effort, caller, provider: input.provider,
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
