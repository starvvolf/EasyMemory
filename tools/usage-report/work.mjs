// 작업 현황 (2026-11-02 A, 사용자 "누가 건드리고 있어서 주의해야 하는 상황을 실시간으로, 구조도 기반으로"):
// 같은 PC 폴더에서 여러 세션(A·B·C·D·Codex)이 동시에 고칠 때, 지금 커밋 안 된 파일·누가 잡았는지·겹침·약속 파일·남은 git 잠금을 모은다.
// 모델 호출 없음. 읽는 것: git status/diff/log, 파일 시각, .recaller-work/claims.jsonl(세션이 남긴 "고치는 중" 표시), 협업/구조도/파일지도.json.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const git = (root, args, timeout = 30000) => new Promise((resolve) => {
  execFile("git", ["-c", "core.quotepath=false", ...args], { cwd: root, timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)));
});

/** "src/**\/x.ts" style globs → one RegExp. ** = any folders, * = any name part. */
function globRe(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") { re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*"; i += glob[i + 2] === "/" ? 2 : 1; }
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
const matcher = (globs) => { const res = (globs || []).map(globRe); return (p) => res.some((r) => r.test(p)); };

export function loadMap(root) {
  const file = path.join(root, "협업", "구조도", "파일지도.json");
  let raw = { areas: [], nodes: {}, contracts: [], ignore: [] };
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch { /* no map yet: everything is 기타 */ }
  return {
    areas: raw.areas.map((a) => ({ ...a, test: matcher(a.globs) })),
    nodes: Object.entries(raw.nodes || {}).map(([id, n]) => ({ id, name: n.name, test: matcher(n.globs) })),
    contracts: raw.contracts || [],
    ignore: matcher(raw.ignore),
  };
}

/** Claims: one JSON line per edit or per manual mark. {at, who?, session?, file, tool?, note?, done?} */
function readClaims(root) {
  const file = path.join(root, ".recaller-work", "claims.jsonl");
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split("\n").slice(-5000);
  const out = [];
  for (const l of lines) { try { const j = JSON.parse(l); if (j && j.at) out.push(j); } catch { /* half line */ } }
  return out;
}
const AREA_IDS = ["A", "B", "C", "D"];
const ago = (ms) => Math.max(0, Math.round((Date.now() - ms) / 60000));

let fetchState = { at: 0, error: "" };
async function maybeFetch(root) {
  // GitHub와의 차이는 2분에 한 번만 확인한다(fetch는 느리고, 몇 초마다 할 일은 아니다).
  if (Date.now() - fetchState.at < 120_000) return;
  fetchState = { at: Date.now(), error: "" };
  const r = await git(root, ["fetch", "--quiet", "origin"], 30000);
  if (r === null) fetchState.error = "GitHub 확인 실패(인터넷·인증)";
}

export async function scanWork(root, opts = {}) {
  const map = loadMap(root);
  if (opts.fetch) await maybeFetch(root);
  const [status, numstat, branch, head, upstream, log, mine] = await Promise.all([
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(root, ["diff", "--numstat", "-z", "HEAD"]),
    git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(root, ["log", "-1", "--format=%h%x09%s%x09%cI"]),
    git(root, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]),
    git(root, ["log", "-12", "--format=%h%x09%cI%x09%an%x09%s", "@{upstream}"]),
    git(root, ["log", "-1", "--format=%cI", "@{upstream}"]),
  ]);
  const areaOf = (p) => (map.areas.find((a) => a.test(p)) || { id: "기타" }).id;
  const nodesOf = (p) => map.nodes.filter((n) => n.test(p)).map((n) => n.id);

  // 지금 커밋 안 된 파일
  const lines = new Map();
  if (numstat) {
    const parts = numstat.split("\0");
    for (let i = 0; i < parts.length; i++) {
      const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(parts[i]); if (!m) continue;
      let f = m[3]; if (!f) { f = parts[i + 2]; i += 2; } // rename: "a\tb\t" then old\0new
      lines.set(f, { plus: m[1] === "-" ? 0 : Number(m[1]), minus: m[2] === "-" ? 0 : Number(m[2]) });
    }
  }
  const files = [];
  if (status) {
    const parts = status.split("\0");
    for (let i = 0; i < parts.length; i++) {
      const e = parts[i]; if (!e) continue;
      const xy = e.slice(0, 2), p = e.slice(3);
      if (xy[0] === "R" || xy[0] === "C") i++; // the old name follows
      if (map.ignore(p)) continue;
      let mtime = 0, size = 0; try { const st = statSync(path.join(root, p)); mtime = st.mtimeMs; size = st.size; } catch { /* deleted */ }
      if (xy === "??" && size && size < 2_000_000 && !lines.has(p)) { try { lines.set(p, { plus: readFileSync(path.join(root, p), "utf8").split("\n").length, minus: 0 }); } catch { /* binary */ } }
      files.push({ path: p, status: xy === "??" ? "새 파일" : xy.includes("D") ? "지움" : xy.includes("A") ? "추가" : "고침", area: areaOf(p), nodes: nodesOf(p), mtime, ageMin: mtime ? ago(mtime) : null, ...(lines.get(p) || { plus: 0, minus: 0 }), claims: [], flags: [] });
    }
  }

  // 누가 잡고 있나: 세션마다 그 파일에 남긴 마지막 표시. "done"이면 놓은 것. 12시간 지난 표시는 보지 않는다.
  const claims = readClaims(root).filter((c) => Date.now() - Date.parse(c.at) < 12 * 3600_000);
  const bySession = new Map();
  for (const c of claims) {
    const key = c.who && !c.session ? `who:${c.who}` : `s:${c.session || c.who || "?"}`;
    if (!bySession.has(key)) bySession.set(key, { key, who: c.who || "", session: c.session || "", files: new Map(), last: 0, done: new Set() });
    const s = bySession.get(key);
    if (c.who) s.who = c.who;
    const t = Date.parse(c.at); s.last = Math.max(s.last, t);
    if (c.done) { if (c.file) s.files.delete(c.file); else s.files.clear(); continue; }
    if (c.file) s.files.set(c.file.replace(/\\/g, "/"), { at: t, note: c.note || "", tool: c.tool || "" });
  }
  // 세션 이름: 남긴 이름(A·B·C·D·Codex…), 없으면 그 세션이 고친 파일이 가장 많이 속한 영역 + 세션 앞 6자리
  const sessions = [...bySession.values()].map((s) => {
    const counts = {};
    for (const f of s.files.keys()) { const a = areaOf(f); counts[a] = (counts[a] || 0) + 1; }
    const main = Object.entries(counts).filter(([a]) => AREA_IDS.includes(a)).sort((x, y) => y[1] - x[1])[0]?.[0] || "";
    const label = s.who || (main ? `${main}?` : "세션");
    return { key: s.key, label, who: s.who, guessed: !s.who, area: AREA_IDS.includes(s.who) ? s.who : main, session: s.session.slice(0, 8), files: s.files, lastMin: ago(s.last) };
  });
  const byFile = new Map(files.map((f) => [f.path, f]));
  // 잡기만 하고 아직 안 바뀐(또는 이미 커밋한) 파일도 2시간은 보인다: 그 칸을 누가 맡고 있는지 알 수 있게
  for (const s of sessions) for (const [f, c] of s.files) {
    if (byFile.has(f) || Date.now() - c.at > 2 * 3600_000 || map.ignore(f)) continue;
    const row = { path: f, status: "잡음만", area: areaOf(f), nodes: nodesOf(f), mtime: 0, ageMin: null, plus: 0, minus: 0, claims: [], flags: [] };
    files.push(row); byFile.set(f, row);
  }
  for (const s of sessions) for (const [f, c] of s.files) {
    const file = byFile.get(f);
    if (file) file.claims.push({ label: s.label, session: s.session, guessed: s.guessed, area: s.area, sinceMin: ago(c.at), note: c.note });
  }

  // 주의 표시
  const contractOf = new Map(map.contracts.map((c) => [c.file, c]));
  for (const f of files) {
    const who = new Set(f.claims.map((c) => c.label));
    // 같은 영역의 이름 붙은 세션과 짐작한 세션("A"와 "A?")은 같은 사람일 수도 있어 노랑, 그 밖의 둘 이상은 빨강
    const named = new Set(f.claims.filter((c) => !c.guessed).map((c) => c.label)), guessedOnlySameArea = f.claims.every((c) => !c.guessed || named.has(c.area));
    if (who.size > 1) f.flags.push(named.size <= 1 && guessedOnlySameArea && f.claims.filter((c) => c.guessed).length <= 1 ? { level: "warn", text: `두 세션: ${[...who].join(" · ")} (같은 영역 — 같은 사람이면 괜찮음)` } : { level: "bad", text: `겹침: ${[...who].join(" · ")}` });
    if (!f.claims.length && f.status !== "잡음만") f.flags.push({ level: "warn", text: "누가 고치는지 모름" });
    const outside = f.claims.filter((c) => c.area && AREA_IDS.includes(f.area) && c.area !== f.area);
    if (outside.length) f.flags.push({ level: "info", text: `영역 밖(${f.area}) · 커밋에 [경계]` });
    if (contractOf.has(f.path)) f.flags.push({ level: "warn", text: `약속 파일: ${contractOf.get(f.path).name}` });
    if (f.ageMin != null && f.ageMin > 12 * 60) f.flags.push({ level: "info", text: `커밋 안 하고 ${Math.round(f.ageMin / 60)}시간` });
  }

  // 구조도 칸마다
  const nodes = {};
  for (const n of map.nodes) {
    const mineFiles = files.filter((f) => f.nodes.includes(n.id));
    const who = [...new Set(mineFiles.flatMap((f) => f.claims.map((c) => c.label)))];
    const level = mineFiles.some((f) => f.flags.some((x) => x.level === "bad")) ? "bad" : mineFiles.some((f) => !f.claims.length || f.flags.some((x) => x.text.startsWith("두 세션"))) ? "warn" : mineFiles.length ? "busy" : "idle";
    const times = mineFiles.map((f) => f.ageMin ?? (f.claims.length ? Math.min(...f.claims.map((c) => c.sinceMin)) : null)).filter((x) => x != null);
    nodes[n.id] = { name: n.name, count: mineFiles.length, who, level, lastMin: times.length ? Math.min(...times) : null, files: mineFiles.map((f) => f.path), affected: [] };
  }

  // 약속 파일: 고쳐지고 있으면 그 약속에 걸린 칸 모두에 알림
  const contracts = map.contracts.map((c) => { const f = byFile.get(c.file); return { ...c, changed: Boolean(f), who: f ? f.claims.map((x) => x.label) : [], ageMin: f?.ageMin ?? null }; });
  // 약속 파일이 고쳐지면, 그 약속을 쓰는 다른 칸에도 "영향"을 단다(파일은 그 칸 것이 아니어도)
  for (const c of contracts.filter((x) => x.changed)) for (const id of c.nodes || []) if (nodes[id]) nodes[id].affected.push(c.name);

  // 남은 git 잠금: 지워지지 않은 .lock (이 폴더에서는 다리 너머 git이 잠금을 못 지울 때가 있다)
  const locks = [];
  const gitDir = path.join(root, ".git");
  for (const name of (() => { try { return readdirSync(gitDir); } catch { return []; } })()) {
    if (!name.endsWith(".lock")) continue;
    try { locks.push({ name, ageMin: ago(statSync(path.join(gitDir, name)).mtimeMs) }); } catch { /* gone */ }
  }

  const [ahead, behind] = upstream ? upstream.trim().split(/\s+/).map(Number) : [null, null];
  const [h, subject, at] = head ? head.trim().split("\t") : ["", "", ""];
  const AREA_RE = /^\s*(\[경계\]\s*)?(A|B|C|D)\b|^\s*(\[경계\]\s*)?(C 엔진|D|프로젝트 코스)/;
  const recent = (log || "").trim().split("\n").filter(Boolean).map((l) => { const [hash, cat, author, s] = l.split("\t"); const m = AREA_RE.exec(s || ""); return { hash, at: cat, ageMin: ago(Date.parse(cat)), author, subject: s, area: m ? (m[2] || (m[4] === "C 엔진" ? "C" : "D")) : "" }; });

  const warnings = [];
  for (const f of files) for (const x of f.flags) if (x.level === "bad") warnings.push({ level: "bad", text: `${f.path} — ${x.text}` });
  for (const l of locks) warnings.push({ level: l.ageMin >= 2 ? "bad" : "warn", text: `.git/${l.name}가 ${l.ageMin}분째 남아 있음${l.ageMin >= 2 ? " — 다른 git이 막힘. 돌던 git이 없으면 지우거나 이름을 바꾼다" : " (git이 도는 중일 수 있음)"}` });
  for (const c of contracts.filter((x) => x.changed)) warnings.push({ level: "warn", text: `약속 파일 고치는 중: ${c.file} (${c.name}) — ${c.note}` });
  if (behind) warnings.push({ level: "warn", text: `GitHub에 새 커밋 ${behind}개 — 받기 전에 같은 파일을 고치면 겹칠 수 있음` });
  const unclaimed = files.filter((f) => !f.claims.length && f.status !== "잡음만");
  if (unclaimed.length) warnings.push({ level: "info", text: `누가 고치는지 모르는 파일 ${unclaimed.length}개 (Claude Code 세션은 저절로 남고, 그 밖에는 node tools/work/claim.mjs)` });

  return {
    at: new Date().toISOString(), root,
    repo: { branch: (branch || "").trim(), head: h, subject, headAt: at, ahead, behind, upstreamAt: (mine || "").trim(), fetchedAt: fetchState.at ? new Date(fetchState.at).toISOString() : null, fetchError: fetchState.error },
    sessions: sessions.map((s) => ({ label: s.label, guessed: s.guessed, area: s.area, session: s.session, files: [...s.files.keys()], lastMin: s.lastMin })).filter((s) => s.files.length),
    files: files.sort((a, b) => (a.ageMin ?? 1e9) - (b.ageMin ?? 1e9)), nodes, contracts, locks, recent, warnings,
  };
}
