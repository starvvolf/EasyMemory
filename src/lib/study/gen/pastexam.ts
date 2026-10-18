// Only abstract, bounded numeric axes cross into the author prompt. Exam text stays in private storage.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const ratio = z.number().min(0).max(1);
const distribution = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape).refine(
  (value) => Math.abs(Object.values(value).reduce<number>((sum, n) => sum + Number(n), 0) - 1) < 0.015,
  "Ratios must sum to one",
);
export const vibeCardSchema = z.strictObject({
  version: z.literal(1),
  asking: distribution({ recall: ratio, explain: ratio, apply: ratio, discriminate: ratio }),
  answer: distribution({ choice: ratio, short: ratio, worked: ratio }),
  conditions: distribution({ plain: ratio, scenario: ratio, diagram: ratio }),
  traps: distribution({ none: ratio, boundary: ratio, signOrOrder: ratio, similarConcept: ratio }),
  size: z.strictObject({ minSteps: z.number().int().min(1).max(10), maxSteps: z.number().int().min(1).max(10) })
    .refine((v) => v.minSteps <= v.maxSteps, "Invalid step range"),
  difficulty: distribution({ direct: ratio, linked: ratio, transfer: ratio }),
  highWeight: distribution({ explanation: ratio, calculation: ratio, construction: ratio }),
});
export type VibeCard = z.infer<typeof vibeCardSchema>;
export const vibeJsonSchema = z.toJSONSchema(vibeCardSchema);
export const copyVerdictSchema = z.strictObject({ verdicts: z.array(z.strictObject({
  objectiveId: z.string(), copied: z.boolean(), reason: z.enum(["none", "wording", "values", "scenario"]),
})) });
export const copyVerdictJsonSchema = z.toJSONSchema(copyVerdictSchema);
export type PastExamEvidence = { hashes: string[]; texts: string[]; images: Array<{ label: string; dataUrl: string }> };
export async function registeredPastExams(ids: string[]): Promise<PastExamEvidence> {
  const [{ getRegisteredMcpSource, readRegisteredMcpSourcePdf }, { extractPdfPageTexts }, { renderPageImages }] = await Promise.all([
    import("../../mcp-source-registry.ts"), import("../../../../tools/study-forge-mcp/source-evidence.ts"), import("./pages.ts"),
  ]);
  const evidence: PastExamEvidence = { hashes: [], texts: [], images: [] };
  for (const id of [...new Set(ids)]) {
    const source = await getRegisteredMcpSource(id);
    const bytes = source && await readRegisteredMcpSourcePdf(id);
    if (!source || !bytes) throw new Error("선택한 기출 PDF를 읽을 수 없습니다.");
    if (source.pageCount > 20) throw new Error("기출은 파일별 20쪽 이하로 나누어 등록해 주세요.");
    const pages = Array.from({ length: source.pageCount }, (_, i) => i + 1);
    evidence.hashes.push(source.sha256);
    const texts = await extractPdfPageTexts(bytes, pages);
    evidence.texts.push([...texts].map(([page, text]) => `[p.${page}] ${text}`).join("\n"));
    const images = await renderPageImages(bytes, pages);
    evidence.images.push(...[...images].map(([page, dataUrl]) => ({ label: `${id} p.${page}`, dataUrl })));
  }
  return evidence;
}

export function vibeCacheKey(pdfHashes: string[]) {
  if (!pdfHashes.length || pdfHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) throw new Error("PDF content hashes required");
  return createHash("sha256").update(JSON.stringify([1, [...new Set(pdfHashes)].sort()])).digest("hex");
}
const cacheFile = (root: string, key: string) => {
  if (!path.isAbsolute(root) || !/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid private cache path");
  return path.join(root, "past-exam-vibes", key + ".json");
};
export async function readVibeCache(root: string, key: string): Promise<VibeCard | null> {
  try { return vibeCardSchema.parse(JSON.parse(await readFile(cacheFile(root, key), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function writeVibeCache(root: string, key: string, card: VibeCard) {
  const file = cacheFile(root, key);
  const value = vibeCardSchema.parse(card);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, file);
}

/** Numeric axes are tendencies across the set, not a quota for each individual objective. */
export function vibePrompt(card: VibeCard) {
  return "[기출 느낌: 수치는 전체 문항의 경향이며 개별 목표에 억지로 맞추지 않는다]\n" +
    JSON.stringify(vibeCardSchema.parse(card)) +
    "\n선택한 강의 범위와 목표는 모두 유지한다. 기출의 문장·고유 수치·상황은 재사용하지 않는다. " +
    "worked는 풀이가 있는 self-check 답안으로 표현한다. 근거가 뒷받침하는 범위에서 조건을 새로 구성한다.";
}

const normalized = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
/** Deterministic screening only. A passing result is NOT a semantic originality guarantee. */
export function lexicalCopyCheck(candidate: string, examQuestions: string[]) {
  const text = normalized(candidate);
  const numbers = (value: string) => [...value.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => match[0]);
  const candidateNumbers = numbers(candidate);
  return examQuestions.flatMap((source, index) => {
    const original = normalized(source);
    const reasons: string[] = [];
    if (text.length >= 32 && Array.from({ length: Math.max(0, text.length - 31) }, (_, n) => text.slice(n, n + 32)).some((part) => original.includes(part))) reasons.push("shared-text");
    const sourceNumbers = numbers(source);
    // Ignore isolated universal constants; an ordered set of four values is a screening signal, not proof.
    if (candidateNumbers.length >= 4 && sourceNumbers.length >= 4 && candidateNumbers.some((_, n) => {
      const sequence = candidateNumbers.slice(n, n + 4);
      return sequence.length === 4 && new Set(sequence).size >= 3 && sourceNumbers.some((_, m) => sequence.every((v, k) => sourceNumbers[m + k] === v));
    })) reasons.push("shared-values");
    return reasons.length ? [{ sourceIndex: index, reasons }] : [];
  });
}
