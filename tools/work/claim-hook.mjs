#!/usr/bin/env node
// Claude Code 훅 (PostToolUse: Edit·Write·MultiEdit·NotebookEdit, .claude/settings.json): 고친 파일을 "이 세션이 고치는 중"으로 남긴다.
// 작업 현황 탭(tools/usage-report, 127.0.0.1:3091 [작업 현황])이 읽는다. 무슨 일이 있어도 조용히 0으로 끝난다(작업을 막지 않는다).
// 세션 이름: 그 세션을 RECALLER_WHO=A 처럼 켜면 붙는다. 없으면 작업 현황이 그 세션이 고친 파일의 영역으로 "A?"처럼 짐작한다.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

try {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const raw = readFileSync(0, "utf8");
  const ev = JSON.parse(raw || "{}");
  const input = ev.tool_input || {};
  const target = input.file_path || input.notebook_path || input.path;
  if (target) {
    const rel = path.relative(root, path.resolve(ev.cwd || root, target)).replace(/\\/g, "/");
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel) && !rel.startsWith(".git/") && !rel.startsWith(".recaller-work/")) {
      mkdirSync(path.join(root, ".recaller-work"), { recursive: true });
      const line = { at: new Date().toISOString(), session: String(ev.session_id || "").slice(0, 36), file: rel, tool: ev.tool_name || "", ...(process.env.RECALLER_WHO ? { who: process.env.RECALLER_WHO } : {}) };
      appendFileSync(path.join(root, ".recaller-work", "claims.jsonl"), JSON.stringify(line) + "\n");
    }
  }
} catch { /* never block the edit */ }
process.exit(0);
