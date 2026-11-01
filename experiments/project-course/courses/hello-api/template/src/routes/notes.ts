// @from 2
// 부품: 방명록 — 남긴 글을 서버 안의 배열(메모리)에 모아 둔다.
import type { Ctx } from "../router.ts";
import { HttpError, readJson, sendJson } from "../http.ts";

type Note = { id: number; text: string };

// 방명록 글이 모이는 곳: 서버 프로그램 안의 변수(메모리)
const notes: Note[] = [];

export function list({ res }: Ctx) {
  sendJson(res, 200, notes);
}

export async function add({ req, res }: Ctx) {
  const input = await readJson(req);
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) throw new HttpError(400, "text를 적어 주세요.");
  const note: Note = { id: notes.length + 1, text };
  // <swap 2>
  notes.push(note);
  // <start>
  // TODO(2단계): 새 글을 notes 배열에 넣는다. 지금은 넣지 않고 답장만 한다.
  // </swap>
  sendJson(res, 201, note);
}
