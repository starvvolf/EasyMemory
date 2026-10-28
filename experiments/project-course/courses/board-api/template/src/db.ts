// @from 2
// 부품: DB 연결 — 파일 하나(SQLite)에 표를 만들고 연결을 하나 열어 둔다. 서버를 껐다 켜도 남는 곳.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const file = process.env.DB_PATH || "data/board.db";
mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

export const db = new DatabaseSync(file);
db.exec("PRAGMA foreign_keys = ON");

// <from 4>
db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
)`);
// </from>

const postColumns = [
  "id INTEGER PRIMARY KEY AUTOINCREMENT",
  "title TEXT NOT NULL",
  "body TEXT NOT NULL DEFAULT ''",
  // <from 4>
  "author_id INTEGER NOT NULL REFERENCES users(id)",
  // </from>
  "created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
];
db.exec(`CREATE TABLE IF NOT EXISTS posts (${postColumns.join(", ")})`);
