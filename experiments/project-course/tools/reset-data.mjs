// 실험 자료 비우기 (2026-11-06 사용자 "자료 비우기 기능 실험용으로 작게"): 지우지 않고 보관으로 옮긴다.
//   실습 자료: 이 폴더 .data/ 의 대화 · 목표 · 학습자 메모리 · 진행 기록 → .data/보관/<날짜-시각-이름>/ (control · opencode는 남김)
//   앱 자료(기억): 앱이 꺼져 있을 때만 scripts/recaller-data.mjs archive (켜져 있으면 건너뛰고 알림)
//   node tools/reset-data.mjs [이름] [--practice-only]
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEEP = new Set(["control", "opencode", "보관"]);
const stamp = () => { const d = new Date(); const p = (x) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };

export function archivePractice(dataDir, name = "") {
  if (!existsSync(dataDir)) return null;
  const entries = readdirSync(dataDir).filter((e) => !KEEP.has(e));
  if (!entries.length) return { label: null, count: 0 };
  const label = `${stamp()}${name ? `-${name.replace(/[\\/:*?"<>|\s]+/g, "_")}` : ""}`;
  const dest = path.join(dataDir, "보관", label);
  mkdirSync(dest, { recursive: true });
  for (const e of entries) renameSync(path.join(dataDir, e), path.join(dest, e));
  return { label, count: entries.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), only = args.includes("--practice-only"), name = args.find((a) => !a.startsWith("--")) ?? "실험";
  const r = archivePractice(process.env.PC_DATA_DIR ? path.resolve(process.env.PC_DATA_DIR) : path.join(here, ".data"), name);
  console.log(r?.label ? `실습 자료 보관: .data/보관/${r.label} (${r.count}개)` : "실습 자료는 이미 비어 있어요.");
  if (!only) {
    const app = spawnSync(process.execPath, [path.join(here, "..", "..", "scripts", "recaller-data.mjs"), "archive", name], { stdio: "inherit" });
    if (app.status !== 0) console.log("앱 자료(기억)는 그대로예요. Recaller 앱을 끈 뒤 다시 하면 같이 비워요.");
  }
}
