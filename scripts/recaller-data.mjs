// 데이터 보관하고 새로 시작 (2026-11-05, 사용자 "시연 중에는 데이터 싹 밀어버릴거니까 실험한 데이터는 보관"):
// the app's data folder (STUDY_FORGE_DATA_DIR in .env.local, normally ../RecallerData) keeps its history in git, so a
// "fresh start" is a move, not a delete: everything the app wrote goes into 보관/<날짜-이름>/ inside the same folder and
// the app starts empty. Nothing is lost, and a move is cheap for git. Run with the app closed.
//   node scripts/recaller-data.mjs list                    보관본 목록과 지금 데이터 크기
//   node scripts/recaller-data.mjs archive [이름]           지금 데이터를 보관/<날짜-이름>/ 으로 옮기고 비운다
//   node scripts/recaller-data.mjs restore <보관본 이름>     보관본을 다시 지금 데이터로 (지금 데이터는 먼저 보관)
// Sign-in tokens are not in the data folder (.study-forge-data/chatgpt-auth in the project), so sign-in stays.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEEP = new Set([".git", ".gitignore", ".gitattributes", "README.md", "보관"]);

function dataDir() {
  if (process.env.STUDY_FORGE_DATA_DIR?.trim()) return path.resolve(root, process.env.STUDY_FORGE_DATA_DIR.trim());
  try {
    const line = readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/).find((l) => /^\s*STUDY_FORGE_DATA_DIR\s*=/.test(l));
    const v = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
    if (v) return path.resolve(root, v);
  } catch { /* no .env.local */ }
  return path.resolve(root, "..", "RecallerData");
}
function size(p) {
  let s; try { s = statSync(p); } catch { return 0; }
  if (!s.isDirectory()) return s.size;
  let n = 0; for (const e of readdirSync(p)) n += size(path.join(p, e)); return n;
}
const mb = (n) => `${(n / 1048576).toFixed(1)}MB`;
async function appRunning() {
  try { return (await (await fetch("http://127.0.0.1:3000/api/local-experiment/status", { signal: AbortSignal.timeout(1500) })).json()).active === true; }
  catch { return false; }
}
const stamp = () => { const d = new Date(); const p = (x) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
const live = (dir) => readdirSync(dir).filter((e) => !KEEP.has(e));

function archive(dir, name) {
  const entries = live(dir);
  if (!entries.length) { console.log("지금 데이터가 비어 있어요. 보관할 것이 없어요."); return null; }
  const label = `${stamp()}${name ? `-${name.replace(/[\\/:*?"<>|\s]+/g, "_")}` : ""}`;
  const dest = path.join(dir, "보관", label);
  mkdirSync(dest, { recursive: true });
  const total = entries.reduce((n, e) => n + size(path.join(dir, e)), 0);
  for (const e of entries) renameSync(path.join(dir, e), path.join(dest, e));
  // The study screen also keeps records in the app window's browser storage and merges them back in; the app clears it
  // once on its next start when this mark is there (desktop/main.js).
  mkdirSync(path.join(root, "tmp"), { recursive: true });
  writeFileSync(path.join(root, "tmp", "fresh-start"), label);
  console.log(`보관했어요: 보관/${label} (${entries.length}개 항목, ${mb(total)}). 지금 데이터는 비었어요.`);
  return label;
}

const [cmd, arg] = process.argv.slice(2);
const dir = dataDir();
if (!existsSync(dir)) { console.error(`데이터 폴더가 없어요: ${dir}`); process.exit(1); }
if (cmd === "list" || !cmd) {
  console.log(`데이터 폴더: ${dir}`);
  console.log(`지금 데이터: ${live(dir).join(", ") || "(비어 있음)"} · ${mb(live(dir).reduce((n, e) => n + size(path.join(dir, e)), 0))}`);
  const box = path.join(dir, "보관");
  const list = existsSync(box) ? readdirSync(box).filter((e) => statSync(path.join(box, e)).isDirectory()) : [];
  console.log(list.length ? `보관본:\n${list.map((e) => `  ${e} · ${mb(size(path.join(box, e)))}`).join("\n")}` : "보관본이 없어요.");
} else if (cmd === "archive" || cmd === "restore") {
  if (await appRunning()) { console.error("Recaller가 켜져 있어요. 앱을 끈 뒤 다시 해 주세요(쓰는 중인 파일을 옮기면 기록이 깨질 수 있어요)."); process.exit(1); }
  if (cmd === "archive") archive(dir, arg);
  else {
    const src = path.join(dir, "보관", arg ?? "");
    if (!arg || !existsSync(src)) { console.error("되돌릴 보관본 이름을 적어 주세요 (list로 확인)."); process.exit(1); }
    archive(dir, "되돌리기-전");
    for (const e of readdirSync(src)) renameSync(path.join(src, e), path.join(dir, e));
    console.log(`되돌렸어요: 보관/${arg} → 지금 데이터.`);
  }
  console.log("다음에 Recaller 앱을 끌 때 이 변경도 같이 올라가요(데이터 올리기).");
} else { console.error("사용법: list | archive [이름] | restore <보관본>"); process.exit(1); }
