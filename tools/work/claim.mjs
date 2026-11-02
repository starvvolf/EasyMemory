#!/usr/bin/env node
// "고치는 중" 표시를 손으로 남긴다 (Codex·사람·훅이 없는 도구용). 작업 현황 탭이 읽는다. 2026-11-02 A.
//   node tools/work/claim.mjs A src/lib/code/service.ts src/app/api/code/route.ts --note "힌트 단계"   이 파일들 고치는 중
//   node tools/work/claim.mjs A --done [파일 …]                                                     다 고침(파일 없으면 전부 놓음)
//   node tools/work/claim.mjs --list                                                                지금 남은 표시
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const file = path.join(root, ".recaller-work", "claims.jsonl");
const args = process.argv.slice(2);
if (args[0] === "--list" || !args.length) {
  if (!existsSync(file)) { console.log("남은 표시가 없어요."); process.exit(0); }
  const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-40);
  for (const r of rows) { try { const j = JSON.parse(r); console.log(`${j.at.slice(5, 16).replace("T", " ")}  ${(j.who || j.session?.slice(0, 8) || "?").padEnd(8)} ${j.done ? "놓음" : "잡음"}  ${j.file || "(전부)"}${j.note ? `  · ${j.note}` : ""}`); } catch { /* skip */ } }
  if (!args.length) console.log("\n쓰는 법: node tools/work/claim.mjs <A|B|C|D|이름> <파일 …> [--note 메모] | <이름> --done [파일 …]");
  process.exit(0);
}
const who = args.shift();
const noteAt = args.indexOf("--note"); const note = noteAt >= 0 ? args.splice(noteAt, 2)[1] : "";
const done = args.includes("--done"); const files = args.filter((a) => a !== "--done").map((f) => path.relative(root, path.resolve(f)).replace(/\\/g, "/"));
mkdirSync(path.dirname(file), { recursive: true });
const at = new Date().toISOString();
if (done && !files.length) appendFileSync(file, JSON.stringify({ at, who, done: true }) + "\n");
for (const f of files) appendFileSync(file, JSON.stringify({ at, who, file: f, ...(done ? { done: true } : {}), ...(note ? { note } : {}) }) + "\n");
console.log(done ? `${who}: ${files.length ? files.join(", ") : "전부"} 놓음` : `${who}: ${files.join(", ")} 고치는 중으로 남김`);
