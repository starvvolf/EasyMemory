// @from 4
// 부품: 인증 — 비밀번호를 안전하게 저장·확인하고, 로그인 상태(세션)로 "누구인지"를 알아낸다.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { db } from "./db.ts";
import { HttpError, cookies } from "./http.ts";

export type User = { id: number; username: string };

/** DB에 넣을 값. 같은 비밀번호라도 사람마다 다른 값이 되어야 한다. */
export function hashPassword(password: string): string {
  // <swap 4>
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `scrypt:${salt}:${hash}`;
  // <start>
  // TODO(4단계): 비밀번호를 그대로 저장하면 DB가 새는 순간 모두의 비밀번호가 샌다.
  //   소금(salt)을 무작위로 만들고 scryptSync로 해시해서 "scrypt:소금:해시" 꼴로 돌려준다.
  return password;
  // </swap>
}

/** 로그인할 때 들어온 비밀번호가 저장된 값과 맞는지. */
export function verifyPassword(password: string, stored: string): boolean {
  // <swap 4>
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
  // <start>
  // TODO(4단계): hashPassword와 짝이 맞게 확인한다.
  return password === stored;
  // </swap>
}

const SESSION_DAYS = 7;

export function createSession(userId: number): string {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expires);
  return token;
}

export const sessionCookie = (token: string) => `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86_400}`;
export const clearCookie = "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";

/** 쿠키의 세션으로 지금 요청한 사람을 찾는다. 없거나 만료면 null. */
export function currentUser(req: IncomingMessage): User | null {
  const token = cookies(req).sid;
  if (!token) return null;
  const row = db.prepare(
    "SELECT users.id AS id, users.username AS username, sessions.expires_at AS expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ?",
  ).get(token) as { id: number; username: string; expires_at: string } | undefined;
  if (!row || row.expires_at < new Date().toISOString()) return null;
  return { id: row.id, username: row.username };
}

/** 로그인이 꼭 필요한 처리의 맨 앞에서 부른다. 모르는 사람이면 401. */
export function requireUser(req: IncomingMessage): User {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, "로그인이 필요해요.");
  return user;
}
