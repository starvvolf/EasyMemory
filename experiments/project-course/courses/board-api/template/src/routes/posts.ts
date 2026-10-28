// @from 2
// 부품: 글 처리 — 글 목록·쓰기·읽기·고치기·지우기.
import type { Ctx } from "../router.ts";
import { db } from "../db.ts";
import { HttpError, readJson, sendJson } from "../http.ts";
// <from 3>
import { validatePost } from "../validate.ts";
// </from>
// <from 4>
import { requireUser } from "../auth.ts";
// </from>

type Post = { id: number; title: string; body: string; author_id?: number; created_at: string };

function findPost(id: string): Post {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(Number(id)) as Post | undefined;
  if (!post) throw new HttpError(404, "글이 없어요.");
  return post;
}

export function list({ res, query }: Ctx) {
  // <until 5>
  void query;
  const rows = db.prepare("SELECT * FROM posts ORDER BY id").all();
  sendJson(res, 200, rows);
  // </until>
  // <from 6>
  // 요구 변경(6단계): 최신 글부터, 한 쪽에 10개씩. ?page=1 이 첫 쪽.
  const PAGE_SIZE = 10;
  const page = Math.max(1, Math.floor(Number(query.get("page") ?? "1")) || 1);
  // <swap 6>
  const rows = db.prepare("SELECT * FROM posts ORDER BY id DESC LIMIT ? OFFSET ?").all(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  // <start>
  const rows = db.prepare("SELECT * FROM posts ORDER BY id DESC LIMIT ? OFFSET ?").all(PAGE_SIZE, page * PAGE_SIZE);
  // </swap>
  const total = (db.prepare("SELECT COUNT(*) AS n FROM posts").get() as { n: number }).n;
  sendJson(res, 200, rows, { "x-total-count": String(total) });
  // </from>
}

export async function create({ req, res }: Ctx) {
  // <from 4>
  const user = requireUser(req);
  // </from>
  const input = await readJson(req);
  // <until 2>
  const post = { title: String(input.title ?? ""), body: String(input.body ?? "") };
  // </until>
  // <from 3>
  const post = validatePost(input);
  // </from>
  // <swap 2>
  // <until 3>
  const result = db.prepare("INSERT INTO posts (title, body) VALUES (?, ?)").run(post.title, post.body);
  // </until>
  // <from 4>
  const result = db.prepare("INSERT INTO posts (title, body, author_id) VALUES (?, ?, ?)").run(post.title, post.body, user.id);
  // </from>
  const created = findPost(String(result.lastInsertRowid));
  // <start>
  // TODO(2단계): 글을 posts 표에 저장하고, 저장된 글(번호가 붙은)을 다시 읽어서 돌려준다.
  //   지금은 저장하지 않고 받은 내용만 그대로 돌려준다.
  const created = { id: 1, ...post, created_at: new Date().toISOString() };
  // </swap>
  sendJson(res, 201, created, { location: `/posts/${created.id}` });
}

export function get({ res, params }: Ctx) {
  sendJson(res, 200, findPost(params.id));
}

export async function update({ req, res, params }: Ctx) {
  // <from 4>
  const user = requireUser(req);
  // </from>
  const post = findPost(params.id);
  // <swap 5>
  if (post.author_id !== user.id) throw new HttpError(403, "내 글만 고칠 수 있어요.");
  // <start>
  // </swap>
  const input = await readJson(req);
  // <until 2>
  const next = { title: String(input.title ?? post.title), body: String(input.body ?? post.body) };
  // </until>
  // <from 3>
  const next = validatePost({ title: input.title ?? post.title, body: input.body ?? post.body });
  // </from>
  db.prepare("UPDATE posts SET title = ?, body = ? WHERE id = ?").run(next.title, next.body, post.id);
  sendJson(res, 200, findPost(params.id));
}

export function remove({ req, res, params }: Ctx) {
  // <until 3>
  void req;
  // </until>
  // <from 4>
  const user = requireUser(req);
  // </from>
  const post = findPost(params.id);
  // <swap 5>
  if (post.author_id !== user.id) throw new HttpError(403, "내 글만 지울 수 있어요.");
  // <start>
  // </swap>
  db.prepare("DELETE FROM posts WHERE id = ?").run(post.id);
  sendJson(res, 204);
}
