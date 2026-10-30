// 실험 (사용자 10/31): a web article with pictures (blog post) turned into knowledge cards without making it a PDF. The page is
// read in the learner's browser (as the extension would: headings, paragraphs, pictures in order) and sent here; this tries
// several ways of cutting and sending it, cards and 자료 전체 정리 only (no questions), and records time, tokens and the cards.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callModel, type ModelCaller, type ModelRequest } from "../../ai/model.ts";
import { astraJsonSchema } from "./astra.ts";
import { cardLine, checkCards, ORGANIZE, organizeSchema, type Card } from "./cards.ts";
import { MERGE, mergeReplySchema, coreMax, sameNames, unfoldMerge } from "./recaller.ts";
import { dataRoot, GenError, partialJson } from "./runner.ts";

export const webBlockSchema = z.object({
  kind: z.enum(["h2", "h3", "p", "li", "code", "quote", "table", "img"]),
  text: z.string().max(20000).default(""),
  /** img: a data URL (browser-resized), its size before resizing, alt and caption */
  dataUrl: z.string().max(3_000_000).optional(), w: z.number().optional(), h: z.number().optional(), gif: z.boolean().optional(),
});
export type WebBlock = z.infer<typeof webBlockSchema>;
export const webArticleSchema = z.object({ title: z.string().max(300), url: z.string().max(2000), blocks: z.array(webBlockSchema).max(2000) });
type Article = z.infer<typeof webArticleSchema>;

export const webMethods = ["text-chunks", "image-chunks", "image-chunks-context", "whole"] as const;
type Method = (typeof webMethods)[number];
const METHOD_LABEL: Record<Method, string> = {
  "text-chunks": "글만 · 소제목 덩어리",
  "image-chunks": "글+그림 · 소제목 덩어리",
  "image-chunks-context": "글+그림 · 덩어리 + 글 전체 맥락",
  whole: "글+그림 · 통째 한 번",
};
type Call = { method: Method; step: "organize" | "merge"; chunk: number | null; ms: number; ttft: number | null; ok: boolean; error?: string;
  usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningTokens?: number }; images: number; replyChars: number };
export type WebTrial = { id: string; createdAt: string; title: string; url: string; status: "running" | "done" | "failed"; message?: string;
  chunks: Array<{ n: number; title: string; chars: number; images: number; skipped: number }>;
  runs: Array<{ method: Method; label: string; ms: number; cards: Array<Card & { chunk: number }>; merge?: { topics: Array<{ name: string; gist: string; cards: number[] }>;
    principles: Array<{ title: string; line: string; cards: number[] }>; core: number[]; same: Array<{ n: number; of: number }> }; error?: string }>;
  calls: Call[] };

const dir = () => path.join(dataRoot(), "web-trials");
export async function saveArticle(raw: unknown) {
  const article = webArticleSchema.parse(raw);
  const id = `wt_${randomBytes(6).toString("hex")}`;
  await mkdir(dir(), { recursive: true });
  await writeFile(path.join(dir(), `${id}.article.json`), JSON.stringify(article));
  return { id, blocks: article.blocks.length, images: article.blocks.filter((b) => b.kind === "img").length };
}
export async function loadTrial(id: string): Promise<WebTrial | null> {
  if (!/^wt_[a-f0-9]{12}$/.test(id)) return null;
  try { return JSON.parse(await readFile(path.join(dir(), `${id}.json`), "utf8")) as WebTrial; } catch { return null; }
}

// Chunks = the article cut at its h2 headings (h3 stays inside); a picture is kept when it is big enough to carry content
// (icons, emoji and thin dividers are not) and is not the cover above the first heading.
export function chunksOf(article: Article) {
  const chunks: Array<{ n: number; title: string; text: string; images: Array<{ label: string; dataUrl: string }>; skipped: number }> = [];
  let cur = { n: 0, title: "들어가며", text: "", images: [] as Array<{ label: string; dataUrl: string }>, skipped: 0 };
  let pic = 0;
  for (const b of article.blocks) {
    if (b.kind === "h2") { if (cur.text.trim() || cur.images.length) chunks.push(cur); cur = { n: chunks.length, title: b.text.trim().slice(0, 120), text: "", images: [], skipped: 0 }; continue; }
    if (b.kind === "img") {
      pic += 1;
      const small = (b.w ?? 0) < 200 || (b.h ?? 0) < 120;
      const cover = chunks.length === 0 && !cur.text.trim();
      if (!b.dataUrl || small || cover) { cur.skipped += 1; continue; }
      const label = `§${cur.n + 1} 그림 ${pic}${b.text ? ` (${b.text.slice(0, 80)})` : ""}${b.gif ? " · 움직이는 그림의 첫 장면" : ""}`;
      cur.images.push({ label, dataUrl: b.dataUrl });
      cur.text += `\n[그림 ${pic}${b.text ? `: ${b.text.slice(0, 80)}` : ""}]\n`;
      continue;
    }
    const lead = b.kind === "h3" ? "### " : b.kind === "li" ? "- " : b.kind === "quote" ? "> " : "";
    cur.text += `${b.kind === "code" ? `\n\`\`\`\n${b.text}\n\`\`\`` : `${lead}${b.text}`}\n`;
  }
  if (cur.text.trim() || cur.images.length) chunks.push(cur);
  return chunks.map((c, i) => ({ ...c, n: i + 1 }));
}

const WEB = "source는 블로그 글의 한 구역(§번호)이다. evidence.page에는 그 구역 번호를 쓴다. 글은 PDF 쪽보다 길고 이어진다: 이 구역이 중심인 지식만 카드로 만들고, 구역당 카드 수는 내용에 맞춘다(보통 2~6장). 광고·댓글·구독 안내·다른 글 홍보는 카드로 만들지 않는다.";
const IMAGES = "그림이 첨부되어 있다(라벨에 구역·그림 번호). 그림에서만 알 수 있는 지식(도식의 단계·전환·구조)도 카드로 만들고, 그 근거의 quote는 빈 문자열로 둔다. 장식용 그림은 무시한다.";
const OUTLINE = "outline은 글 전체의 소제목이다(맥락용, 원문 근거 아님). 다른 구역이 따로 다루는 지식은 이 구역에서 카드로 만들지 않는다. 카드 title은 소제목을 반복하지 말고 그 카드가 담은 지식의 구체적인 이름으로 쓴다.";
const CONTEXT = "첫 메시지의 article은 글 전체다(맥락용). 앞뒤 구역의 흐름(왜 이 내용이 나오는지, '위 그림'이 무엇인지)은 거기서 읽되, 카드는 이번 구역(source)의 지식으로만 만든다.";
const LEAN = "links·takes·gives는 빈 배열로 두고, mistakes는 카드마다 1개만, evidence는 1개만 쓴다.";
const WHOLE = "source는 블로그 글 전체다(구역마다 §번호). evidence.page에는 구역 번호를 쓴다. 글 전체에서 시험에 나올 지식을 빠짐없이 카드로 만든다. 광고·댓글·구독 안내는 카드로 만들지 않는다.";

export async function runWebTrial(id: string, caller: ModelCaller, options: { methods?: Method[]; model?: string; effort?: string } = {}) {
  const article = webArticleSchema.parse(JSON.parse(await readFile(path.join(dir(), `${id}.article.json`), "utf8")));
  const chunks = chunksOf(article);
  const trial: WebTrial = { id, createdAt: new Date().toISOString(), title: article.title, url: article.url, status: "running",
    chunks: chunks.map((c) => ({ n: c.n, title: c.title, chars: c.text.length, images: c.images.length, skipped: c.skipped })), runs: [], calls: [] };
  const save = () => writeFile(path.join(dir(), `${id}.json`), JSON.stringify(trial));
  await save();
  const model = options.model ?? "gpt-6.1-terra", effort = options.effort ?? "low";
  const outline = chunks.map((c) => `§${c.n} ${c.title}`);
  const full = chunks.map((c) => `§${c.n} ${c.title}\n${c.text}`).join("\n\n");
  const schema = astraJsonSchema(organizeSchema);

  const ask = async (method: Method, step: Call["step"], chunk: number | null, request: Omit<ModelRequest, "caller" | "model" | "effort" | "purpose">) => {
    const t0 = Date.now(); let ttft: number | null = null;
    const call: Call = { method, step, chunk, ms: 0, ttft: null, ok: false, images: request.images?.length ?? 0, replyChars: 0 };
    trial.calls.push(call);
    try {
      const reply = await callModel({ ...request, purpose: `webtrial:${method}:${step}`, caller, model, effort, provider: "chatgpt",
        onText: () => { ttft ??= Date.now() - t0; } });
      Object.assign(call, { ok: true, ms: Date.now() - t0, ttft, usage: reply.usage, replyChars: reply.text.length });
      return reply.text;
    } catch (error) {
      Object.assign(call, { ms: Date.now() - t0, ttft, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  const organize = async (method: Method, c: (typeof chunks)[number] | null) => {
    const withImages = method !== "text-chunks";
    const images = c ? (withImages ? c.images : []) : chunks.flatMap((x) => x.images);
    // With the whole article as context the instructions are the same on every chunk (one cached prefix: instructions, article).
    const context = method === "image-chunks-context";
    const system = c ? `${ORGANIZE}\n${WEB}\n${OUTLINE}${withImages && (images.length || context) ? `\n${IMAGES}` : ""}${context ? `\n${CONTEXT}` : ""}\n${LEAN}`
      : `${ORGANIZE}\n${WHOLE}${images.length ? `\n${IMAGES}` : ""}\n${LEAN}`;
    const source = c ? c.text : full;
    const user = JSON.stringify(c ? { material: article.title, section: { n: c.n, title: c.title }, outline, source } : { material: article.title, outline, source });
    const text = await ask(method, "organize", c?.n ?? null, { system: context ? `이번 구역은 §${c!.n}이다. 이 구역의 지식만 카드로 만든다.` : system, user, schema, schemaName: "web_organize", json: true,
      ...(images.length ? { images } : {}), ...(context ? { cachePrefix: system, sharedContext: JSON.stringify({ article: full }) } : {}) });
    const reply = organizeSchema.parse((partialJson(text) ?? {}) as unknown);
    const pages = c ? [c.n] : chunks.map((x) => x.n);
    const texts = new Map(chunks.map((x) => [x.n, x.text]));
    return checkCards(reply, { pages }, texts, { lenientQuotes: true }).cards.map((card) => ({ ...card, chunk: card.evidence[0]?.page ?? c?.n ?? 0 }));
  };
  const merge = async (method: Method, cards: Card[]) => {
    const text = await ask(method, "merge", null, { system: MERGE, schema: astraJsonSchema(mergeReplySchema), schemaName: "web_merge", json: true,
      user: JSON.stringify({ material: article.title, count: cards.length, coreMax: coreMax(cards.length), sameNames: sameNames(cards), outline,
        cards: cards.map((c, n) => ({ n, pages: [...new Set(c.evidence.map((e) => e.page))], line: cardLine(c).replace(/ ⟨받음:.*$/, "").slice(0, 220) })) }) });
    const reply = mergeReplySchema.parse(JSON.parse(text));
    unfoldMerge(reply, cards);
    return { topics: reply.topics, principles: reply.principles, core: reply.core, same: reply.same };
  };

  // The methods one after another (each one's own calls at once), so their times do not crowd each other.
  for (const method of options.methods ?? [...webMethods]) {
    const t0 = Date.now();
    const run: WebTrial["runs"][number] = { method, label: METHOD_LABEL[method], ms: 0, cards: [] };
    trial.runs.push(run);
    try {
      const parts = method === "whole" ? [await organize(method, null)] : await Promise.all(chunks.map((c) => organize(method, c)));
      run.cards = parts.flat();
      await save();
      if (run.cards.length >= 2) run.merge = await merge(method, run.cards);
    } catch (error) { run.error = error instanceof Error ? error.message : String(error); }
    run.ms = Date.now() - t0;
    await save();
  }
  trial.status = "done";
  await save();
  return trial;
}
export function assertTrialId(id: string) { if (!/^wt_[a-f0-9]{12}$/.test(id)) throw new GenError(404, "실험을 찾을 수 없습니다."); }
