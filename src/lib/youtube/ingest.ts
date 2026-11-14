// 유튜브 → Recaller (11/15 사용자 "유튜브 보다가 딸깍 한 번 누르면 알아서 리콜러에 들어오게"):
// 정리 패널(크롬 Tampermonkey)이 자막(그리고 이미 정리했으면 그 정리)을 POST /api/youtube로 보낸다 →
// 글 자료(txt_)로 저장 → 실행을 만든다 → 엔진이 먼저 내용 정리(yt-notes, 패널과 같은 지시문)를 쓰고, 그 단원들을 쪽으로 기억 카드를 만든다.
import { createHash } from "node:crypto";
import { z } from "zod";
import { getTextSource, writeTextSource, type SourceAsk, type TextSource } from "../study/text-sources.ts";
import { notesPages } from "./notes.ts";
import { NOTES_SYSTEM, notesUser } from "./prompt.ts";

export const youtubeInput = z.object({
  url: z.string().url().max(500),
  title: z.string().trim().min(1).max(300),
  channel: z.string().max(200).optional(),
  duration: z.string().max(20).optional(),
  description: z.string().max(3000).optional(),
  /** 패널의 compactTranscript 꼴: "[분:초] 내용" 줄과 "=== [챕터] … ===" 줄 */
  transcript: z.string().max(400_000).optional(),
  /** 패널에서 이미 정리한 영상이면 그 정리(마크다운). 있으면 Recaller는 정리를 다시 쓰지 않는다. */
  notes: z.string().max(200_000).optional(),
  lecture: z.boolean().optional(),
}).refine((x) => (x.transcript?.trim().length ?? 0) > 20 || (x.notes?.trim().length ?? 0) > 20, { message: "자막이나 정리 글이 필요해요." });
export type YoutubeInput = z.infer<typeof youtubeInput>;

export function videoIdOf(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1, 12);
    return u.searchParams.get("v") ?? (/\/(?:shorts|live|embed)\/([\w-]{6,})/.exec(u.pathname)?.[1] ?? "");
  } catch { return ""; }
}

/** 받은 영상을 글 자료로. 같은 영상 · 같은 자막(정리)이면 같은 자료. */
export async function saveYoutubeSource(input: YoutubeInput): Promise<TextSource> {
  const vid = videoIdOf(input.url);
  const body = input.notes?.trim() || input.transcript?.trim() || "";
  const id = `txt_${createHash("sha256").update(`youtube\n${vid}\n${body}`).digest("hex")}`;
  const found = await getTextSource(id);
  if (found) return found;
  const notes = input.notes?.trim();
  const source: TextSource = {
    id, title: input.title.slice(0, 200), kind: "youtube", url: vid ? `https://www.youtube.com/watch?v=${vid}` : input.url, createdAt: new Date().toISOString(),
    video: { id: vid, ...(input.channel ? { channel: input.channel } : {}), ...(input.duration ? { duration: input.duration } : {}), ...(input.description ? { description: input.description } : {}) },
    ...(input.transcript?.trim() ? { transcript: input.transcript.trim() } : {}),
    notes: notes ? { status: "done", text: notes, from: "panel" } : { status: "waiting", text: "", from: "recaller" },
    pages: notes ? Object.fromEntries(notesPages(notes).map((p, i) => [String(i + 1), p])) : {},
  };
  await writeTextSource(source);
  return source;
}

/** 내용 정리 쓰기: 흘러오는 글을 1초마다 저장해 [정리] 탭이 쓰는 대로 보여 준다. 끝나면 단원들이 쪽이 된다. */
export async function writeNotes(source: TextSource, ask: SourceAsk): Promise<TextSource> {
  if (!source.transcript) throw new Error("자막이 없어 내용 정리를 쓸 수 없어요. 정리 패널에서 먼저 정리한 뒤 보내 주세요.");
  const t0 = Date.now();
  source.notes = { status: "writing", text: "", from: "recaller", startedAt: new Date(t0).toISOString() };
  await writeTextSource(source);
  let saved = 0, saving: Promise<void> = Promise.resolve();
  const onPartial = (text: string) => {
    source.notes!.text = text;
    if (Date.now() - saved < 1000) return;
    saved = Date.now();
    saving = saving.then(() => writeTextSource(source)).catch(() => undefined);
  };
  try {
    const text = await ask("yt-notes", NOTES_SYSTEM, notesUser({ title: source.title, ...source.video }, source.transcript), onPartial);
    await saving;
    source.notes = { status: "done", text: text.trim(), from: "recaller", startedAt: source.notes.startedAt, ms: Date.now() - t0 };
    source.pages = Object.fromEntries(notesPages(text).map((p, i) => [String(i + 1), p]));
  } catch (error) {
    await saving;
    // 멈춤(로그인 · 사용량 · 상한)이면 실패가 아니라 기다림: 이어 만들기를 누르면 처음부터 다시 쓴다.
    const paused = String((error as { status?: string } | null)?.status ?? "").startsWith("paused");
    source.notes = { ...source.notes!, text: paused ? "" : source.notes!.text, status: paused ? "waiting" : "failed", error: error instanceof Error ? error.message : String(error), ms: Date.now() - t0 };
    await writeTextSource(source);
    throw error;
  }
  await writeTextSource(source);
  return source;
}

/** 보내기 한 번 = 자료 하나. 같은 영상을 다시 보내면(실패한 것이 아니면) 그 자료를 그대로 연다. */
export async function startYoutube(raw: unknown, confirmed: boolean) {
  const input = youtubeInput.parse(raw);
  const source = await saveYoutubeSource(input);
  const { createGen, enqueueGen, listGens } = await import("../study/gen/runner.ts");
  const same = (await listGens()).find((g) => g.input.sourceId === source.id && g.status !== "failed");
  if (same) {
    if (same.status !== "done") await enqueueGen(same.id, { uid: "local-experiment" }, { confirmedRealCalls: confirmed }).catch(() => undefined);
    return { genId: same.id, sourceId: source.id, again: true };
  }
  const pages = Object.keys(source.pages).map(Number).sort((a, b) => a - b);
  const gen = await createGen({ sourceId: source.id, fileName: source.title, pageNumbers: pages.length ? pages : [1], origin: "study", ...(input.lecture ? { lecture: true } : {}) });
  await enqueueGen(gen.id, { uid: "local-experiment" }, { confirmedRealCalls: confirmed });
  return { genId: gen.id, sourceId: source.id, again: false };
}

/** [정리] 탭 · 원문 보기가 읽는 것 */
export async function youtubeView(sourceId: string) {
  const s = await getTextSource(sourceId);
  if (!s || s.kind !== "youtube") return null;
  return { id: s.id, title: s.title, url: s.url ?? "", video: s.video ?? null, notes: s.notes ?? null, pages: s.pages };
}

/** 가짜 모델(테스트): 자막 줄을 셋씩 묶어 대단원으로 */
export function notesFakeReply(user: string) {
  const lines = user.split("\n").filter((l) => /^\[[\d:]+\]/.test(l));
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i += 3) {
    const ts = /^\[([\d:]+)\]/.exec(lines[i])![1];
    parts.push(`# 단원 ${parts.length + 1} [${ts}]\n${lines.slice(i, i + 3).map((l) => `- ${l.replace(/^\[[\d:]+\]\s*/, "")}`).join("\n")}\n> [!핵심] 단원 ${parts.length + 1}의 요점`);
  }
  return `@유형: 강의·설명\n@한줄: 가짜 정리\n@키워드: 가짜\n\n${parts.join("\n\n")}\n\n# 복습 질문\n1. 무엇을 배웠나?`;
}
