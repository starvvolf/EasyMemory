// 부품: 메모 처리 — 개인 메모. 게시판과 달리 "남의 메모는 있는지도 몰라야 한다".
// 이 파일은 AI가 짜 준 기본 코드다. 요구사항(README)과 맞는지 확인하고 고친다.
import type { Ctx } from "../router.ts";
import { db } from "../db.ts";
import { HttpError, readJson, sendJson } from "../http.ts";
import { requireUser } from "../auth.ts";

type Memo = { id: number; owner_id: number; text: string; created_at: string };

export function list({ req, res }: Ctx) {
  const user = requireUser(req);
  // <swap 7>
  const rows = db.prepare("SELECT * FROM memos WHERE owner_id = ? ORDER BY id DESC").all(user.id);
  // <start>
  void user;
  const rows = db.prepare("SELECT * FROM memos ORDER BY id DESC").all();
  // </swap>
  sendJson(res, 200, rows);
}

export async function create({ req, res }: Ctx) {
  const user = requireUser(req);
  const { text } = await readJson(req);
  if (typeof text !== "string" || !text.trim() || text.length > 2000) throw new HttpError(400, "메모는 1~2000자 글자예요.");
  const result = db.prepare("INSERT INTO memos (owner_id, text) VALUES (?, ?)").run(user.id, text.trim());
  sendJson(res, 201, db.prepare("SELECT * FROM memos WHERE id = ?").get(Number(result.lastInsertRowid)));
}

function findMemo(id: string, ownerId: number): Memo {
  // <swap 7>
  const memo = db.prepare("SELECT * FROM memos WHERE id = ? AND owner_id = ?").get(Number(id), ownerId) as Memo | undefined;
  // <start>
  void ownerId;
  const memo = db.prepare("SELECT * FROM memos WHERE id = ?").get(Number(id)) as Memo | undefined;
  // </swap>
  if (!memo) throw new HttpError(404, "메모가 없어요.");
  return memo;
}

export function get({ req, res, params }: Ctx) {
  const user = requireUser(req);
  sendJson(res, 200, findMemo(params.id, user.id));
}

export function remove({ req, res, params }: Ctx) {
  const user = requireUser(req);
  const memo = findMemo(params.id, user.id);
  db.prepare("DELETE FROM memos WHERE id = ?").run(memo.id);
  sendJson(res, 204);
}
