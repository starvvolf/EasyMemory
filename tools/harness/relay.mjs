#!/usr/bin/env node
// 중계 모델 도우미 (자체 시험 하네스, 11/15). 앱이 STUDY_FORGE_MODEL_PROVIDER=relay로 돌면 AI 호출마다 <dir>/req-<id>.json을 내놓고
// <dir>/res-<id>.json을 기다린다. 대역 모델 에이전트(agents/model.md)가 이 도구로 요청을 읽고 답을 써 넣는다.
//   node tools/harness/relay.mjs list <dir>                 기다리는 요청 id들
//   node tools/harness/relay.mjs show <dir> <id>            요청 하나(목적 · 모델 · 지시문 · 사용자 메시지 · 스키마)
//   node tools/harness/relay.mjs answer <dir> <id> <file>   답(JSON 파일 또는 글)을 스키마로 확인하고 써 넣음
//   node tools/harness/relay.mjs fail <dir> <id> <message>  이 호출을 실패로(앱 쪽은 오류로 받음)
//   node tools/harness/relay.mjs wait <dir> [초]            새 요청이 올 때까지 기다림(기본 120초)
import { readdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";

const [cmd, dir, id, arg] = process.argv.slice(2);
if (!cmd || !dir) { console.log("사용법: list|show|answer|fail|wait <dir> …"); process.exit(1); }
const pending = async () => (await readdir(dir).catch(() => [])).filter((n) => n.startsWith("req-") && n.endsWith(".json"))
  .map((n) => n.slice(4, -5)).filter((x) => true).sort();
const answered = async (x) => (await readdir(dir).catch(() => [])).includes(`res-${x}.json`);

/** 아주 작은 JSON 스키마 확인: type · required · properties · items · enum. 틀린 곳 목록. */
function check(v, s, at = "$") {
  if (!s || typeof s !== "object") return [];
  const out = [];
  const t = s.type;
  const typeOf = (x) => Array.isArray(x) ? "array" : x === null ? "null" : Number.isInteger(x) ? "integer" : typeof x;
  if (t) {
    const ts = Array.isArray(t) ? t : [t];
    const got = typeOf(v);
    if (!ts.some((x) => x === got || (x === "number" && got === "integer"))) return [`${at}: ${ts.join("|")}여야 하는데 ${got}`];
  }
  if (s.enum && !s.enum.includes(v)) out.push(`${at}: ${JSON.stringify(s.enum)} 중 하나여야 함`);
  if (typeOf(v) === "object") {
    for (const k of s.required ?? []) if (!(k in v)) out.push(`${at}.${k}: 빠짐`);
    for (const [k, sub] of Object.entries(s.properties ?? {})) if (k in v) out.push(...check(v[k], sub, `${at}.${k}`));
    if (s.additionalProperties === false) for (const k of Object.keys(v)) if (!(k in (s.properties ?? {}))) out.push(`${at}.${k}: 스키마에 없는 칸`);
  }
  if (typeOf(v) === "array" && s.items) v.forEach((x, i) => out.push(...check(x, s.items, `${at}[${i}]`)));
  return out;
}

if (cmd === "list") {
  const ids = [];
  for (const x of await pending()) if (!(await answered(x))) ids.push(x);
  console.log(ids.join("\n") || "(없음)");
} else if (cmd === "wait") {
  const until = Date.now() + Number(id || 120) * 1000;
  for (;;) {
    const ids = [];
    for (const x of await pending()) if (!(await answered(x))) ids.push(x);
    if (ids.length) { console.log(ids.join("\n")); break; }
    if (Date.now() > until) { console.log("(없음)"); break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
} else if (cmd === "show") {
  const r = JSON.parse(await readFile(path.join(dir, `req-${id}.json`), "utf8"));
  console.log(`# 요청 ${r.id}\n목적: ${r.purpose} · 모델: ${r.model || "-"} ${r.effort || ""} · JSON: ${r.json ? "예" : "아니오(글로 답함)"}\n`);
  console.log(`## 지시문(system)\n${r.system}\n\n## 사용자 메시지(user)\n${r.user}${r.tail ? `\n\n## 이어지는 메시지(tail)\n${r.tail}` : ""}`);
  if (r.schema) console.log(`\n## 답의 JSON 스키마\n${JSON.stringify(r.schema, null, 1)}`);
} else if (cmd === "answer") {
  const r = JSON.parse(await readFile(path.join(dir, `req-${id}.json`), "utf8"));
  const raw = await readFile(arg, "utf8");
  let text = raw;
  if (r.json) {
    let v;
    try { v = JSON.parse(raw); } catch (e) { console.log(`JSON으로 읽지 못함: ${e.message}`); process.exit(2); }
    const errs = r.schema ? check(v, r.schema) : [];
    if (errs.length) { console.log(`스키마와 다름(${errs.length}):\n- ${errs.slice(0, 20).join("\n- ")}`); process.exit(2); }
    text = JSON.stringify(v);
  }
  const res = path.join(dir, `res-${id}.json`);
  await writeFile(`${res}.tmp`, JSON.stringify({ text }), "utf8");
  await rename(`${res}.tmp`, res);
  console.log("써 넣음");
} else if (cmd === "fail") {
  const res = path.join(dir, `res-${id}.json`);
  await writeFile(`${res}.tmp`, JSON.stringify({ error: arg || "대역 모델이 답하지 않음" }), "utf8");
  await rename(`${res}.tmp`, res);
  console.log("실패로 써 넣음");
}
