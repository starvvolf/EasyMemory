// 실험 자료 비우기 (2026-11-06 사용자 "자료 비우기 기능 실험용으로 작게"): 지우지 않고 보관으로 옮긴다.
//   실습 자료: 이 폴더 .data/ 의 대화 · 목표 · 학습자 메모리 · 진행 기록 → .data/보관/<날짜-시각-이름>/ (control · opencode는 남김)
//   앱 자료(기억): 앱이 꺼져 있을 때만 scripts/recaller-data.mjs archive (켜져 있으면 건너뛰고 알림)
//   node tools/reset-data.mjs [이름] [--practice-only]
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEEP = new Set(["control", "opencode", "보관", "package.json"]);
const stamp = () => { const d = new Date(); const p = (x) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };

// practiceDir: Recaller 밖 학습자 작업 폴더 모음(11/8). 있으면 그 안의 폴더도 같은 보관 칸의 practice/로 옮긴다
export function archivePractice(dataDir, name = "", practiceDir = "") {
  if (!existsSync(dataDir)) return null;
  const entries = readdirSync(dataDir).filter((e) => !KEEP.has(e));
  const outside = practiceDir && existsSync(practiceDir) ? readdirSync(practiceDir) : [];
  if (!entries.length && !outside.length) return { label: null, count: 0 };
  const label = `${stamp()}${name ? `-${name.replace(/[\\/:*?"<>|\s]+/g, "_")}` : ""}`;
  const dest = path.join(dataDir, "보관", label);
  mkdirSync(dest, { recursive: true });
  for (const e of entries) renameSync(path.join(dataDir, e), path.join(dest, e));
  if (outside.length) { mkdirSync(path.join(dest, "practice"), { recursive: true }); for (const e of outside) { try { renameSync(path.join(practiceDir, e), path.join(dest, "practice", e)); } catch (er) { if (er.code !== "EXDEV") throw er; cpSync(path.join(practiceDir, e), path.join(dest, "practice", e), { recursive: true }); } } }
  return { label, count: entries.length + outside.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), only = args.includes("--practice-only"), name = args.find((a) => !a.startsWith("--")) ?? "실험";
  const data = process.env.PC_DATA_DIR ? path.resolve(process.env.PC_DATA_DIR) : path.join(here, ".data");
  const practice = process.env.PC_PRACTICE_DIR ? path.resolve(process.env.PC_PRACTICE_DIR) : process.env.PC_DATA_DIR ? path.join(data, "practice") : path.join(os.homedir(), "RecallerPractice");
  const r = archivePractice(data, name, practice);
  console.log(r?.label ? `실습 자료 보관: .data/보관/${r.label} (${r.count}개)` : "실습 자료는 이미 비어 있어요.");
  if (!only) {
    const app = spawnSync(process.execPath, [path.join(here, "..", "..", "scripts", "recaller-data.mjs"), "archive", name], { stdio: "inherit" });
    if (app.status !== 0) console.log("앱 자료(기억)는 그대로예요. Recaller 앱을 끈 뒤 다시 하면 같이 비워요.");
  }
}
