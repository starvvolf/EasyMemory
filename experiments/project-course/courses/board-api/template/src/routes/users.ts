// @from 4
// 부품: 회원 처리 — 가입, 로그인, 로그아웃, 내 정보.
import type { Ctx } from "../router.ts";
import { db } from "../db.ts";
import { HttpError, cookies, readJson, sendJson } from "../http.ts";
import { clearCookie, createSession, hashPassword, requireUser, sessionCookie, verifyPassword } from "../auth.ts";

const USERNAME = /^[a-z0-9_]{3,20}$/;

export async function signup({ req, res }: Ctx) {
  const { username, password } = await readJson(req);
  if (typeof username !== "string" || !USERNAME.test(username)) throw new HttpError(400, "아이디는 영문 소문자·숫자·_ 3~20자예요.");
  if (typeof password !== "string" || password.length < 8) throw new HttpError(400, "비밀번호는 8자 이상이에요.");
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) throw new HttpError(409, "이미 있는 아이디예요.");
  const result = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hashPassword(password));
  sendJson(res, 201, { id: Number(result.lastInsertRowid), username });
}

export async function login({ req, res }: Ctx) {
  const { username, password } = await readJson(req);
  const row = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(String(username ?? "")) as
    | { id: number; username: string; password_hash: string }
    | undefined;
  // 아이디가 없을 때와 비밀번호가 틀릴 때 같은 응답: 어느 아이디가 있는지 알려 주지 않는다.
  if (!row || typeof password !== "string" || !verifyPassword(password, row.password_hash)) throw new HttpError(401, "아이디나 비밀번호가 맞지 않아요.");
  const token = createSession(row.id);
  sendJson(res, 200, { id: row.id, username: row.username }, { "set-cookie": sessionCookie(token) });
}

export function logout({ req, res }: Ctx) {
  const token = cookies(req).sid;
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  sendJson(res, 204, undefined, { "set-cookie": clearCookie });
}

export function me({ req, res }: Ctx) {
  sendJson(res, 200, requireUser(req));
}
