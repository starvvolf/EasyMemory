// 비슷한 지식 찾기 (2026-10-28 결정: docs/DECISIONS.md "같은 지식 찾기: 임베딩", 협업/결과보고/결과보고_임베딩비교_Claude_20261028.md).
//
// Each item is turned into a vector by EmbeddingGemma (308M, one model for Korean and English) on the app server, and the
// vectors are kept next to the knowledge (knowledge/vectors.json, about 3 KB per item). A score alone cannot tell "same"
// from "different" (깊이/너비 우선 탐색 come out closer than 깊이 우선 탐색/DFS), so this only finds candidates; the learner
// decides (합치기 · 잇기). Exact names and aliases are still matched first, by the store.
//
// The model loads only when candidates are asked for, once per server, and its files (about 300 MB, 8-bit) are kept
// outside the data folder (RecallerData is synced through git): RECALLER_MODEL_DIR, else ~/.study-forge/models.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getKnowledge, tree, type ItemLite, type Knowledge } from "./store.ts";

export const EMBED_MODEL = "onnx-community/embeddinggemma-300m-ONNX";
const EMBED_DTYPE = "q8";
/** EmbeddingGemma's prompt for comparing two short texts (the same one the comparison used). */
const PREFIX = "task: sentence similarity | query: ";

export type Embedder = (texts: string[]) => Promise<Float32Array[]>;
let custom: Embedder | null = null;
/** Tests (and anything without the model) put their own embedder here; null goes back to EmbeddingGemma. */
export function setEmbedder(embedder: Embedder | null) { custom = embedder; }

type Loaded = { run: Embedder };
const holder = globalThis as unknown as { __recallerEmbed?: Promise<Loaded> };
async function loadGemma(): Promise<Loaded> {
  const hf = await import("@huggingface/transformers");
  hf.env.cacheDir = process.env.RECALLER_MODEL_DIR?.trim() || path.join(os.homedir(), ".study-forge", "models");
  const tokenizer = await hf.AutoTokenizer.from_pretrained(EMBED_MODEL);
  const model = await hf.AutoModel.from_pretrained(EMBED_MODEL, { dtype: EMBED_DTYPE });
  const run: Embedder = async (texts) => {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16).map((t) => PREFIX + t);
      const inputs = await tokenizer(batch, { padding: true, truncation: true, max_length: 256 });
      const { sentence_embedding } = await model(inputs) as { sentence_embedding: { data: Float32Array; dims: number[] } };
      const dim = sentence_embedding.dims[1];
      for (let j = 0; j < batch.length; j++) out.push(unit(Float32Array.from(sentence_embedding.data.subarray(j * dim, (j + 1) * dim))));
    }
    return out;
  };
  return { run };
}
async function embed(texts: string[]): Promise<Float32Array[]> {
  if (!texts.length) return [];
  if (custom) return (await custom(texts)).map(unit);
  // One load per server (next dev keeps globalThis across reloads); a failed load is retried on the next request.
  holder.__recallerEmbed ??= loadGemma().catch((error) => { holder.__recallerEmbed = undefined; throw error; });
  return (await holder.__recallerEmbed).run(texts);
}
/** Vectors for texts that are not saved items (the duplicate-check evaluation); unit length, so a dot product is the cosine. */
export const embedTexts = (texts: string[]) => embed(texts.map((t) => t));
function unit(v: Float32Array) {
  let s = 0; for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}
const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i]; return s; };

/** What is compared: the name, its other names and the first line of its meaning (a name alone when there is none). */
export function embedText(item: Pick<Knowledge, "title" | "aliases" | "body">) {
  const meaning = item.body.split("\n").map((l) => l.trim()).find((l) => l && !/^헷갈림:/.test(l)) ?? "";
  return [item.title, item.aliases.length ? `(${item.aliases.slice(0, 6).join(", ")})` : "", meaning ? `: ${meaning.slice(0, 200)}` : ""].join(" ").replace(/\s+/g, " ").trim();
}

/* ---------- vectors file: knowledge/vectors.json ---------- */
type VectorFile = { model: string; items: Record<string, { hash: string; v: string }> };
const vectorsFile = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "knowledge", "vectors.json");
const modelKey = () => (custom ? "custom" : `${EMBED_MODEL}:${EMBED_DTYPE}`);
const hashOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const pack = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
const unpack = (s: string) => { const b = Buffer.from(s, "base64"); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
async function readVectors(): Promise<VectorFile> {
  try {
    const data = JSON.parse(await readFile(vectorsFile(), "utf8")) as VectorFile;
    // Vectors from another model cannot be compared with this one's: start over.
    return data.model === modelKey() ? data : { model: modelKey(), items: {} };
  } catch { return { model: modelKey(), items: {} }; }
}
async function writeVectors(data: VectorFile) {
  await mkdir(path.dirname(vectorsFile()), { recursive: true });
  const tmp = `${vectorsFile()}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data), "utf8");
  await rename(tmp, vectorsFile());
}

/** For the 점검 보고서: how many items have a vector that matches their text now (no model is loaded). */
export async function vectorStatus(items: Array<Pick<Knowledge, "id" | "title" | "aliases" | "body">>) {
  const data = await readVectors();
  const fresh = items.filter((i) => data.items[i.id]?.hash === hashOf(embedText(i))).length;
  const live = new Set(items.map((i) => i.id));
  return { model: data.model, fresh, stale: items.length - fresh, orphan: Object.keys(data.items).filter((id) => !live.has(id)).length };
}

/** Vectors for every item, made only for items that are new or whose name, other names or meaning changed. */
async function allVectors() {
  const { items } = await tree();
  const full = await Promise.all(items.map(async (i) => (await getKnowledge(i.id)).item));
  const data = await readVectors();
  const texts = new Map(full.map((i) => [i.id, embedText(i)]));
  const stale = full.filter((i) => data.items[i.id]?.hash !== hashOf(texts.get(i.id)!));
  if (stale.length) {
    const made = await embed(stale.map((i) => texts.get(i.id)!));
    stale.forEach((i, n) => { data.items[i.id] = { hash: hashOf(texts.get(i.id)!), v: pack(made[n]) }; });
  }
  const live = new Set(full.map((i) => i.id));
  let dropped = false;
  for (const id of Object.keys(data.items)) if (!live.has(id)) { delete data.items[id]; dropped = true; }
  if (stale.length || dropped) await writeVectors(data);
  return { items, vectors: new Map(full.map((i) => [i.id, unpack(data.items[i.id].v)])), made: stale.length };
}

export type SimilarHit = ItemLite & { score: number; linked: boolean };
/**
 * 비슷한 지식 후보: the items closest in meaning to one item (or to a text not saved yet), best first. Candidates only —
 * close can be "the same", "part of it", "related" or even "the opposite"; the learner (or later a model) decides.
 */
export async function similarKnowledge(target: { id: string } | { text: string }, options: { limit?: number } = {}): Promise<{ hits: SimilarHit[]; made: number }> {
  const { items, vectors, made } = await allVectors();
  const self = "id" in target ? target.id : null;
  const q = "text" in target ? (await embed([target.text]))[0] : vectors.get(target.id);
  if (!q) return { hits: [], made };
  const linkedTo = new Set<string>();
  if (self) {
    const d = await getKnowledge(self);
    for (const l of d.links) linkedTo.add(l.item.id);
    for (const l of d.backlinks) linkedTo.add(l.item.id);
  }
  const hits = items.filter((i) => i.id !== self).map((i) => ({ ...i, score: Math.round(dot(q, vectors.get(i.id)!) * 1000) / 1000, linked: linkedTo.has(i.id) }))
    .sort((a, b) => b.score - a.score).slice(0, options.limit ?? 8);
  return { hits, made };
}
