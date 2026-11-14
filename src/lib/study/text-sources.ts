// 글 자료 (11/15): PDF가 아닌 자료(유튜브 자막 · 요약 글 등)를 쪽 글로 나눠 두는 곳. 엔진(gen/runner.ts)은 PDF가 없으면 여기서 쪽 글을 읽는다.
// 저장: STUDY_FORGE_DATA_DIR/text-sources/<id>.json — { id, title, kind, url?, createdAt, pages: { "1": "...", ... } }
// id는 txt_ + 내용의 sha256(같은 글이면 같은 id).
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type TextSource = { id: string; title: string; kind: "youtube" | "text"; url?: string; createdAt: string; pages: Record<string, string>;
  /** 유튜브(src/lib/youtube): 영상 정보 · 자막(패널의 [분:초] 줄) · 내용 정리. 정리가 끝나면 그 단원들이 쪽(pages)이 된다. */
  video?: { id: string; channel?: string; duration?: string; description?: string };
  transcript?: string;
  notes?: { status: "waiting" | "writing" | "done" | "failed"; text: string; from: "recaller" | "panel"; startedAt?: string; ms?: number; error?: string } };
/** 글 자료를 쓰기 전에 필요한 AI 한 번(유튜브 내용 정리). runner의 호출 기록 · 상한 · 멈춤을 그대로 탄다. */
export type SourceAsk = (step: "yt-notes", system: string, user: string, onPartial?: (text: string) => void) => Promise<string>;
export const textSourceId = /^txt_[a-f0-9]{64}$/;
const root = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "text-sources");
const fileOf = (id: string) => { if (!textSourceId.test(id)) throw new Error("글 자료 id가 올바르지 않아요."); return path.join(root(), `${id}.json`); };

/** 긴 글을 쪽으로: 빈 줄(문단) 단위로 모아 쪽마다 about 글자 수 안팎. 시간 표시([12:34])가 있으면 그 줄에서 끊기 좋다. */
export function splitPages(text: string, about = 1800): string[] {
  const paras = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pages: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) pages.push(cur.trim()); cur = ""; };
  for (const para of paras.length ? paras : [text.trim()]) {
    // 한 문단이 너무 길면(자막은 문단이 없다) 줄 · 문장 단위로 나눈다.
    const pieces = para.length > about * 1.5 ? para.split(/(?<=[.!?。])\s+|\n/).filter(Boolean) : [para];
    for (const piece of pieces) {
      if (cur && cur.length + piece.length > about) push();
      cur += (cur ? (pieces.length > 1 ? " " : "\n\n") : "") + piece;
    }
  }
  push();
  return pages.length ? pages : [text.trim()];
}

export async function saveTextSource(input: { title: string; kind: TextSource["kind"]; url?: string; text: string; pages?: string[] }): Promise<TextSource> {
  const pages = (input.pages?.length ? input.pages : splitPages(input.text)).map((p) => p.trim()).filter(Boolean);
  if (!pages.length) throw new Error("글이 비어 있어요.");
  const id = `txt_${createHash("sha256").update(`${input.kind}\n${input.url ?? ""}\n${pages.join("\n\f\n")}`).digest("hex")}`;
  const found = await readTextSourceFile(id);
  if (found) return found;
  const source: TextSource = { id, title: input.title.trim().slice(0, 200) || "글 자료", kind: input.kind, ...(input.url ? { url: input.url } : {}), createdAt: new Date().toISOString(),
    pages: Object.fromEntries(pages.map((p, i) => [String(i + 1), p])) };
  await writeTextSource(source);
  return source;
}
export async function writeTextSource(source: TextSource) {
  await mkdir(root(), { recursive: true });
  const tmp = `${fileOf(source.id)}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(source, null, 2), { mode: 0o600 });
  await rename(tmp, fileOf(source.id));
}
async function readTextSourceFile(id: string): Promise<TextSource | null> {
  try { return JSON.parse(await readFile(fileOf(id), "utf8")) as TextSource; } catch { return null; }
}
export const getTextSource = (id: string) => textSourceId.test(id) ? readTextSourceFile(id) : Promise.resolve(null);
/** 엔진이 읽는 모양: 쪽 번호 → 글 */
export async function readTextSource(id: string): Promise<Map<number, string> | null> {
  const source = await getTextSource(id);
  return source ? new Map(Object.entries(source.pages).map(([k, v]) => [Number(k), v])) : null;
}

/** 엔진이 쪽 글을 읽기 전: 쪽이 아직 없는 자료(유튜브 자막만 온 것)는 내용 정리부터. 돌려주는 값은 쪽 번호들. */
export async function readyTextSource(id: string, ask: SourceAsk): Promise<number[]> {
  let source = await getTextSource(id);
  if (!source) return [];
  if (source.kind === "youtube" && source.notes?.status !== "done") {
    const { writeNotes } = await import("../youtube/ingest.ts");
    source = await writeNotes(source, ask);
  }
  return Object.keys(source.pages).map(Number).sort((a, b) => a - b);
}
