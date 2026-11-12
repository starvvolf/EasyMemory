#!/usr/bin/env node
// 시연 상태 저장 · 되돌리기 (11/13 사용자 "내일 와서 하면 바로 가능하게, 세팅도 재현 가능하게").
// 앱 데이터의 몇 폴더(기본: code, knowledge)를 통째로 떠 두었다가, 시연 전에 그때 상태로 되돌린다.
// 앱(3000)은 이 파일들을 요청마다 새로 읽으므로 켜 둔 채로 되돌려도 된다.
//
//   node scripts/demo-state.mjs save <이름> [폴더…]   지금 상태를 <데이터 폴더>/../RecallerDemo/<이름>에 저장
//   node scripts/demo-state.mjs restore <이름>         저장한 상태로 되돌림(그 뒤에 생긴 파일은 지움)
//   node scripts/demo-state.mjs list
//
// 데이터 폴더: --data <경로> > STUDY_FORGE_DATA_DIR(환경 변수) > .env.local의 STUDY_FORGE_DATA_DIR
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const dataArg = flag("--data");

async function dataDir() {
  if (dataArg) return path.resolve(dataArg);
  if (process.env.STUDY_FORGE_DATA_DIR) return path.resolve(ROOT, process.env.STUDY_FORGE_DATA_DIR);
  const env = await readFile(path.join(ROOT, ".env.local"), "utf8").catch(() => "");
  const m = /^\s*STUDY_FORGE_DATA_DIR\s*=\s*(.+?)\s*$/m.exec(env);
  if (!m) throw new Error("데이터 폴더를 모르겠어요. --data <경로>로 알려 주세요.");
  return path.resolve(ROOT, m[1].replace(/^["']|["']$/g, ""));
}

async function files(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await files(p, base)); else out.push(path.relative(base, p));
  }
  return out;
}

async function main() {
  const [cmd, name, ...dirs] = args;
  const data = await dataDir();
  const store = path.join(path.dirname(data), "RecallerDemo");
  if (cmd === "list") { console.log((await readdir(store).catch(() => [])).join("\n") || "(없음)"); return; }
  if (!name || !/^[\w-]+$/.test(name)) throw new Error("이름을 영문 · 숫자로 주세요. 예: algo");
  const snap = path.join(store, name);
  if (cmd === "save") {
    const pick = dirs.length ? dirs : ["code", "knowledge"];
    await rm(snap, { recursive: true, force: true });
    await mkdir(snap, { recursive: true });
    for (const d of pick) {
      const from = path.join(data, d);
      if (!(await stat(from).catch(() => null))) { console.log(`- ${d}: 없음, 건너뜀`); continue; }
      await cp(from, path.join(snap, d), { recursive: true });
      console.log(`- ${d}: ${(await files(from)).length}개 파일 저장`);
    }
    await writeFile(path.join(snap, "meta.json"), JSON.stringify({ name, dirs: pick, savedAt: new Date().toISOString() }, null, 1));
    console.log(`저장했어요: ${snap}`);
    return;
  }
  if (cmd === "restore") {
    const meta = JSON.parse(await readFile(path.join(snap, "meta.json"), "utf8"));
    for (const d of meta.dirs) {
      const from = path.join(snap, d), to = path.join(data, d);
      if (!(await stat(from).catch(() => null))) continue;
      const keep = new Set(await files(from));
      let gone = 0, stuck = 0;
      for (const f of await files(to)) {
        if (keep.has(f)) continue;
        try { await rm(path.join(to, f), { force: true }); gone++; } catch { stuck++; }
      }
      await cp(from, to, { recursive: true, force: true });
      console.log(`- ${d}: ${keep.size}개 되돌림${gone ? `, 새로 생긴 ${gone}개 지움` : ""}${stuck ? `, 못 지운 ${stuck}개` : ""}`);
    }
    console.log(`"${name}" 상태로 되돌렸어요 (저장: ${meta.savedAt}).`);
    return;
  }
  throw new Error("save · restore · list 중 하나를 주세요.");
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
