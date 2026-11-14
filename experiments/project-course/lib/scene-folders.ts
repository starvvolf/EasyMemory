// 상황 재현의 편집기 장면(11/15, 설계 3번 16 · 17, 7번 "16 · 17은 앱 안 편집기(VSCodium, 4103)에 따로 만든 폴더(<데이터>/scenes/<id>/)를 열어요. 원래 실습 폴더는 건드리지 않아요").
//   16 작은 재현 프로젝트: AI 1번이 같은 종류의 문제가 든 파일 1~3개(80줄 안쪽) + 검사 스크립트(check.mjs) + 모범 고침을 만들고,
//      코드가 확인한다 — 받은 그대로는 검사가 늘 실패 · 모범 고침은 늘 통과(두 번씩). 채점은 그 검사를 돌려서(학습자가 check.mjs를 고쳐도 원본으로).
//   17 원래 자리로: 그 빈틈의 코드를 자른 저장본 시점의 파일을 새 폴더에 되살리고(작업 폴더는 읽기만), 채점은 그 목표의 검사 그대로([해 봤어요] 판정, judge.ts).
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA, read, writeAtomic } from "./store.ts";

export const SCENES = () => path.join(DATA, "scenes");
const ID = /^sc_[a-f0-9]{12}$/;
export function sceneDir(id: string) { if (!ID.test(id)) throw Object.assign(new Error("장면 id가 올바르지 않아요."), { status: 400 }); return path.join(SCENES(), id); }
const metaFile = (id: string) => `${sceneDir(id)}.json`;
const now = () => new Date().toISOString();
const CHECK = "check.mjs";
const TASK = "과제.md";

type FileMap = Record<string, string>;
export type ProjectMeta = { id: string; kind: "project"; lang: string; story: string; ask: string; explain: string; run: string; files: FileMap; fix: FileMap; mine: FileMap; check: string;
  fails: string[]; mineFails: string[] | null; verified: boolean; problems: string[]; at: string };
export type OriginMeta = { id: string; kind: "origin"; runId: string; gapId: string; goal: { title: string; done: string }; file: string; from: number; to: number; code: string; wrong: string;
  saveAt: string; snapshot: FileMap; copied: number; at: string };
export type SceneMeta = ProjectMeta | OriginMeta;
export const metaOf = (id: string) => read<SceneMeta | null>(metaFile(id), null);

/* ---------- 파일 다루기 ---------- */
/** 폴더 안 상대 경로만(.. · 절대 경로 · 숨은 폴더 안 됨) */
export function safeRel(p: string) {
  const s = String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!s || s.startsWith("/") || /^[A-Za-z]:/.test(s) || s.split("/").some((x) => !x || x === "." || x === ".." || x.startsWith("."))) return null;
  return s.length <= 120 ? s : null;
}
async function writeFiles(dir: string, files: FileMap) {
  for (const [rel, text] of Object.entries(files)) { const f = path.join(dir, rel); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, text); }
}
/** 학습자 폴더 데이터 위쪽(실습 코스)의 package.json을 Node · npm이 따라가지 않게(server/main.ts와 같은 빈 파일) */
async function guardData() {
  const f = path.join(DATA, "package.json");
  await stat(f).catch(() => writeFile(f, `${JSON.stringify({ name: "recaller-practice-data", private: true, description: "학습자 작업 폴더가 위쪽(실습 코스) 설정을 따르지 않게 막는 빈 파일" }, null, 2)}\n`).catch(() => {}));
}
const SKIP = new Set(["node_modules", ".git", "bin", "obj", ".vs", ".vscode", "__pycache__", "dist", ".venv", "venv", ".recaller"]);
/** 폴더를 그대로 복사(빌드 결과 · 의존 폴더 · 큰 파일은 뺌) */
async function copyTree(from: string, to: string, limits = { files: 1500, bytes: 40 * 1048576, file: 1048576 }) {
  let files = 0, bytes = 0;
  await cp(from, to, { recursive: true, force: true, errorOnExist: false, filter: async (src) => {
    const rel = path.relative(from, src);
    if (!rel) return true;
    if (rel.split(path.sep).some((x) => SKIP.has(x))) return false;
    const st = await stat(src).catch(() => null);
    if (!st) return false;
    if (st.isDirectory()) return true;
    if (st.size > limits.file || files >= limits.files || bytes + st.size > limits.bytes) return false;
    files++; bytes += st.size; return true;
  } });
  return files;
}
async function listFiles(dir: string, base = dir, out: string[] = []) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) await listFiles(f, base, out); else out.push(path.relative(base, f).split(path.sep).join("/"));
  }
  return out;
}
const tmpDir = async (tag: string) => { const d = path.join(DATA, "tmp", `${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`); await mkdir(d, { recursive: true }); return d; };

/* ---------- 검사 스크립트 돌리기 ---------- */
export type CheckRun = { code: number | null; out: string; fails: string[]; timedOut: boolean };
/** node check.mjs (그 폴더에서). 한 줄에 하나 "통과: 이름" · "실패: 이름 — 이유", 모두 통과면 0으로 끝남 */
export function runCheck(dir: string, timeoutMs = 60_000) {
  return new Promise<CheckRun>((resolve) => {
    execFile(process.execPath, [CHECK], { cwd: dir, timeout: timeoutMs, maxBuffer: 512 * 1024, windowsHide: true, env: { ...process.env, NODE_NO_WARNINGS: "1", DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" } }, (err, stdout, stderr) => {
      const out = `${stdout}${stderr ? `\n${stderr}` : ""}`.replace(/\r/g, "").trim();
      const timedOut = !!err && ((err as { killed?: boolean }).killed === true);
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
      resolve({ code: timedOut ? null : code, out: out.slice(-4000), timedOut, fails: failsOf(out) });
    });
  });
}
/** 실패한 검사 이름들(이유는 빼고) — 같은 실수인지 볼 "오답 모양" */
export const failsOf = (out: string) => [...new Set(out.split("\n").map((l) => /^\s*실패\s*[:：]\s*(.+?)(?:\s+[—-]\s+.*)?$/.exec(l)?.[1]?.trim()).filter((x): x is string => !!x))].sort();
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
async function checkWith(files: FileMap, check: string, timeoutMs: number) {
  const d = await tmpDir("chk");
  try { await writeFiles(d, { ...files, [CHECK]: check }); return await runCheck(d, timeoutMs); } finally { await rm(d, { recursive: true, force: true }).catch(() => {}); }
}
const limitFor = (lang: string) => (lang === "csharp" || lang === "cpp" ? 120_000 : 30_000);

/* ---------- 16 작은 재현 프로젝트 ---------- */
export const PROJECT_SYSTEM = `너는 실습 복습용 "작은 재현 프로젝트"를 만든다. 학습자가 실습에서 막혔던 생각(빈틈) 하나와 같은 종류의 문제가 든 아주 작은 프로젝트다.
학습자는 이 프로젝트를 편집기에서 열어 고치고, check.mjs가 통과하면 끝난다. 무엇이 문제인지 story · ask에 쓰지 않는다(응용 확인이다). 겉모습(주제 · 이름)은 원래 실습과 다르게.

## 만들 것
- files: 프로젝트 파일 1~3개(합쳐서 80줄 안쪽). 학습자 언어로. 그 빈틈 때문에 생기는 문제가 들어 있다. 다른 문제는 넣지 않는다.
- fix: 모범 고침. files 중 고친 파일만, 고친 뒤의 전체 내용.
- mine: 그때 학습자가 한 틀린 생각대로 고쳤을 때의 파일(예: 잠금을 쓰기 줄에만 검). 그 생각을 코드로 옮길 수 없으면 빈 목록.
- check: check.mjs 전체. Node.js 기본 모듈만 쓰는 ES 모듈. 프로젝트를 실행해(child_process로 run 명령을 돌리거나 모듈을 불러) 결과를 본다.
  · 한 줄에 하나: "통과: 검사 이름" 또는 "실패: 검사 이름 — 이유". 모두 통과면 process.exit(0), 하나라도 실패면 process.exit(1).
  · 매번 같은 결과여야 한다. 동시성 문제면 읽기와 쓰기 사이에 일부러 쉬게(sleep · Thread.Sleep · await) 만들어 고치지 않으면 늘 어긋나게.
  · 네트워크 · 포트 · 파일 쓰기 · 설치 없이, 20초 안에(C#은 빌드 포함 90초) 끝난다. 검사 이름은 짧은 한국어.
- run: 프로젝트를 실행하는 명령 한 줄(예: "node main.js", "python main.py", "dotnet run").
- story: 무엇을 하는 프로그램인지 2문장. ask: 학습자가 할 일 한 문장("검사가 통과하게 고쳐 보세요" 꼴). explain: 맞는 생각 한 문장.
- 코드는 실제로 돌아가야 한다. 정답 출력 값을 check에 하드코딩하지 말고, 프로그램이 지켜야 할 성질(예: 100번 더하면 100)을 본다.`;
type ProjectReply = { story: string; ask: string; explain: string; run: string; files: Array<{ path: string; text: string }>; fix: Array<{ path: string; text: string }>; mine: Array<{ path: string; text: string }>; check: string };
async function projectSchema() {
  const { S } = await import("./ai.ts");
  const file = S.obj({ path: S.str, text: S.str });
  return S.obj({ story: S.str, ask: S.str, explain: S.str, run: S.str, files: S.arr(file), fix: S.arr(file), mine: S.arr(file), check: S.str });
}
export type ProjectIn = { title: string; kind: string; missed: string; wrong: string; lang: string; topic: string; kernel?: string; origin?: string };
export function projectUser(g: ProjectIn) {
  return [`[빈틈] ${g.title} (종류 ${g.kind}, 주제 ${g.topic})`, `떠올렸어야 할 생각: ${g.missed}`, g.wrong ? `그때 생각(mine): ${g.wrong}` : "",
    g.kernel ? `맞는 생각이 담긴 코드:\n${g.kernel}` : "", g.origin ? `[원래 실습] ${g.origin}` : "", `[언어] ${g.lang}`].filter(Boolean).join("\n\n");
}
const toMap = (xs: Array<{ path: string; text: string }> | undefined) => {
  const out: FileMap = {}; const bad: string[] = [];
  for (const x of xs ?? []) { const p = safeRel(x.path); if (!p || p === CHECK) bad.push(String(x.path)); else out[p] = String(x.text ?? "").replace(/\r/g, ""); }
  return { out, bad };
};
/** 받은 프로젝트를 코드로 확인: 모양(파일 수 · 줄 수 · 경로) → 받은 그대로 실패(두 번 같은 실패) → 모범 고침 통과(두 번) → 그때 생각 고침의 실패 모양 */
export async function verifyProject(r: ProjectReply, lang: string) {
  const problems: string[] = [];
  const files = toMap(r.files), fix = toMap(r.fix), mine = toMap(r.mine);
  for (const b of [...files.bad, ...fix.bad, ...mine.bad]) problems.push(`쓸 수 없는 파일 이름이에요: ${b}`);
  const names = Object.keys(files.out);
  if (names.length < 1 || names.length > 3) problems.push(`프로젝트 파일은 1~3개여야 해요(지금 ${names.length}개).`);
  const lines = Object.values(files.out).reduce((n, t) => n + t.split("\n").length, 0);
  if (lines > 80) problems.push(`프로젝트가 80줄을 넘어요(${lines}줄).`);
  for (const p of [...Object.keys(fix.out), ...Object.keys(mine.out)]) if (!names.includes(p)) problems.push(`고침에 없는 파일이 있어요: ${p}`);
  if (!Object.keys(fix.out).length) problems.push("모범 고침(fix)이 없어요.");
  if (!/process\.exit/.test(r.check ?? "")) problems.push("check.mjs가 process.exit로 끝나지 않아요.");
  if (problems.length) return { ok: false, problems, files: files.out, fix: fix.out, mine: mine.out, fails: [] as string[], mineFails: null as string[] | null };
  const t = limitFor(lang);
  const a1 = await checkWith(files.out, r.check, t), a2 = await checkWith(files.out, r.check, t);
  if (a1.code === 0 || a2.code === 0) problems.push("받은 그대로인데 검사가 통과해요(문제가 드러나지 않아요).");
  else if (a1.timedOut || a2.timedOut) problems.push("검사가 시간 안에 끝나지 않아요.");
  else if (!a1.fails.length) problems.push(`실패한 검사 이름이 안 나와요("실패: 이름" 줄이 없어요). 출력: ${a1.out.slice(-300)}`);
  else if (!sameSet(a1.fails, a2.fails)) problems.push("받은 그대로 두 번 돌렸는데 실패한 검사가 달라요(매번 같아야 해요).");
  const fixed = { ...files.out, ...fix.out };
  const b1 = await checkWith(fixed, r.check, t), b2 = await checkWith(fixed, r.check, t);
  if (b1.code !== 0 || b2.code !== 0) problems.push(`모범 고침으로도 검사가 통과하지 않아요: ${(b1.code !== 0 ? b1 : b2).out.slice(-300)}`);
  let mineFails: string[] | null = null;
  if (Object.keys(mine.out).length) {
    const m = await checkWith({ ...files.out, ...mine.out }, r.check, t);
    // 그때 생각대로 고쳐도 통과하면 그 생각은 이 장면에서 틀리지 않는다 → 같은 실수 모양으로 쓰지 않는다
    mineFails = m.code !== 0 && m.fails.length ? m.fails : null;
  }
  return { ok: !problems.length, problems, files: files.out, fix: fix.out, mine: mine.out, fails: a1.fails, mineFails };
}
/** AI 1번(검사에서 떨어지면 걸린 것을 붙여 한 번 더) → 확인 → 폴더 <데이터>/scenes/<id>/ */
export async function makeProject(sceneId: string, g: ProjectIn) {
  const dir = sceneDir(sceneId);
  const { aiJson } = await import("./ai.ts");
  const schema = await projectSchema();
  let problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const user = projectUser(g) + (problems.length ? `\n\n[앞 프로젝트 검사에서 걸린 것 — 고쳐서 다시]\n- ${problems.join("\n- ")}` : "");
    // 기본 모델 · 강도(무거운 쪽이 더 낫다는 실측이 아직 없음). 떨어지면 코드 검사가 걸러 한 번 더
    const r = await aiJson<ProjectReply>("scene-project", PROJECT_SYSTEM, user, schema).catch((e) => { problems = [`AI: ${(e as Error).message.slice(0, 200)}`]; return null; });
    if (!r) continue;
    const v = await verifyProject(r, g.lang);
    if (!v.ok) { problems = v.problems; continue; }
    const meta: ProjectMeta = { id: sceneId, kind: "project", lang: g.lang, story: String(r.story ?? ""), ask: String(r.ask ?? ""), explain: String(r.explain ?? g.missed), run: String(r.run ?? ""),
      files: v.files, fix: v.fix, mine: v.mine, check: r.check, fails: v.fails, mineFails: v.mineFails, verified: true, problems: [], at: now() };
    await guardData();
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFiles(dir, { ...v.files, [CHECK]: r.check, [TASK]: taskText(meta.story, meta.ask, `검사: 터미널에서 \`node ${CHECK}\` (실행: \`${meta.run}\`)`) });
    await writeAtomic(metaFile(sceneId), JSON.stringify(meta, null, 1));
    return { ok: true as const, ...projectPublic(meta) };
  }
  return { ok: false as const, problems };
}
const taskText = (story: string, ask: string, how: string) => `# 복습 과제\n\n${story}\n\n${ask}\n\n${how}\n\n다 했으면 Recaller의 장면 카드에서 [제출]을 눌러요.\n`;
export const projectPublic = (m: ProjectMeta) => ({ id: m.id, kind: m.kind, lang: m.lang, story: m.story, ask: m.ask, run: m.run, files: Object.keys(m.files), check: CHECK });

/* ---------- 17 원래 자리로 ---------- */
/** 그 빈틈의 저장본 시점 = 그 저장 때까지 파일마다 마지막 저장본. 작업 폴더의 나머지(저장한 적 없는 파일)는 지금 것을 복사(읽기만) */
export async function makeOrigin(sceneId: string, x: { runId: string; gapId: string }) {
  const { ledgerOf } = await import("./gaps.ts");
  const g = (await ledgerOf(x.runId)).find((y) => y.id === x.gapId);
  if (!g?.code) return { ok: false as const, problems: ["그때 코드 위치가 없는 빈틈이에요(원래 자리로 갈 수 없어요)."] };
  const { savesOf } = await import("./goal-record.ts");
  const saves = await savesOf(x.runId);
  const { findSave } = await import("./scene-gaps.ts");
  const hit = findSave(saves, g.code);
  if (!hit) return { ok: false as const, problems: ["그 시점 저장본을 찾지 못했어요."] };
  const snapshot: FileMap = {};
  for (const sv of saves.slice(0, hit.index + 1)) { const p = safeRel(sv.file); if (p) snapshot[p] = sv.text; }
  const dir = sceneDir(sceneId);
  const ws = await (await import("./goals.ts")).runWorkspace(x.runId).catch(() => undefined);
  await guardData();
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  let copied = 0;
  if (ws) {
    const root = path.resolve(ws);
    // 장면 폴더가 작업 폴더 안 · 위면 복사하지 않는다(원래 폴더를 건드리지 않게)
    const inside = (a: string, b: string) => a === b || a.startsWith(b + path.sep);
    if (!inside(dir, root) && !inside(root, dir) && await stat(root).then((s) => s.isDirectory(), () => false)) copied = await copyTree(root, dir);
  }
  await writeFiles(dir, snapshot);
  const meta: OriginMeta = { id: sceneId, kind: "origin", runId: x.runId, gapId: g.id, goal: { title: g.goal.title, done: g.unit.done }, file: g.code.file, from: g.code.from, to: g.code.to,
    code: g.code.code, wrong: g.wrong, saveAt: hit.save.at, snapshot, copied, at: now() };
  await writeFile(path.join(dir, TASK), taskText(`"${g.goal.title}"을(를) 하던 그때(${hit.save.at.slice(0, 16).replace("T", " ")})의 파일이에요.`,
    `${g.code.file} ${g.code.from}~${g.code.to}줄 근처에서 막혔어요. 그 자리를 다시 고쳐 목표의 완료 조건을 채워 보세요.`, `완료 조건: ${g.unit.done}`));
  await writeAtomic(metaFile(sceneId), JSON.stringify(meta, null, 1));
  return { ok: true as const, ...originPublic(meta) };
}
export const originPublic = (m: OriginMeta) => ({ id: m.id, kind: m.kind, goal: m.goal.title, done: m.goal.done, file: m.file, from: m.from, to: m.to, files: Object.keys(m.snapshot), saveAt: m.saveAt });

/* ---------- 채점 ---------- */
export type SceneGrade = { verdict: "pass" | "same" | "other" | "unclear"; matched?: string; outputs?: string[]; errors?: string[]; note?: string };
const numbered = (t: string, max = 200) => t.replace(/\r/g, "").split("\n").slice(0, max).map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n");
export async function gradeScene(sceneId: string, opts: { wrongVerified?: boolean } = {}): Promise<SceneGrade> {
  const m = await metaOf(sceneId);
  if (!m) throw Object.assign(new Error("장면 폴더를 찾지 못했어요."), { status: 404 });
  const dir = sceneDir(sceneId);
  const wv = opts.wrongVerified !== false;
  if (m.kind === "project") {
    const now = await readMap(dir, Object.keys(m.files));
    const changed = Object.keys(m.files).some((f) => (now[f] ?? "") !== m.files[f]);
    if (!changed) return { verdict: "unclear", matched: "unchanged", note: "아직 아무 파일도 안 바꿨어요." };
    // 학습자 폴더를 복사해 원래 check.mjs로 돌린다(검사 파일을 고쳐서 통과하는 일이 없게)
    const d = await tmpDir("grade");
    try {
      await copyTree(dir, d);
      await writeFile(path.join(d, CHECK), m.check);
      const r = await runCheck(d, limitFor(m.lang));
      const outputs = [r.out.slice(-1500)];
      if (r.code === 0) return { verdict: "pass", outputs };
      if (r.timedOut) return { verdict: "unclear", outputs, errors: ["검사가 시간 안에 끝나지 않았어요."] };
      // 같은 실수: 그때 생각대로 고친 것과 같은 검사가 실패(없으면 받은 그대로와 같은 실패 = 그 문제가 그대로 남음)
      const shape = m.mineFails ?? m.fails;
      if (wv && r.fails.length && sameSet(r.fails, shape)) return { verdict: "same", matched: "mine", outputs };
      return { verdict: "unclear", outputs };
    } finally { await rm(d, { recursive: true, force: true }).catch(() => {}); }
  }
  // 원래 자리로: 그 목표의 검사([해 봤어요] 판정)를 그대로
  const now = await readMap(dir, Object.keys(m.snapshot));
  const changed = Object.keys(m.snapshot).filter((f) => (now[f] ?? "") !== m.snapshot[f]);
  if (!changed.length) return { verdict: "unclear", matched: "unchanged", note: "아직 아무 파일도 안 바꿨어요." };
  const task = `[원래 자리로] 이 목표를 하던 그때의 저장본이에요. ${m.file} ${m.from}~${m.to}줄에서 막혔어요${m.wrong ? `(그때: ${m.wrong})` : ""}. 그 자리를 고쳐 완료 조건을 채워요.\n\n[과제가 가리키는 코드 ${m.file} — 그때 저장본]\n${numbered(m.snapshot[m.file] ?? m.code)}`;
  const answer = changed.slice(0, 3).map((f) => `[저장한 코드 ${f} — 최신본]\n${numbered(now[f] ?? "")}`).join("\n\n");
  const { judgeApply } = await import("./judge.ts");
  const v = await judgeApply({ title: m.goal.title, done: m.goal.done }, task, answer);
  const outputs = [`${v.verdict}${v.gap ? ` · ${v.gap}` : ""}`];
  if (v.verdict === "correct") return { verdict: "pass", outputs, note: v.right };
  // 그때 그 줄이 그대로 남아 있으면 같은 자리 · 같은 생각(오답 모양)
  const still = (now[m.file] ?? "").replace(/\r/g, "").includes(m.code.replace(/\r/g, "").trim());
  if ((v.verdict === "incorrect" || v.verdict === "partial") && still && wv) return { verdict: "same", matched: "mine", outputs, note: v.gap };
  return { verdict: "unclear", outputs, note: v.gap };
}
async function readMap(dir: string, files: string[]) {
  const out: FileMap = {};
  for (const f of files) { const t = await readFile(path.join(dir, f), "utf8").catch(() => null); if (t !== null) out[f] = t.replace(/\r/g, ""); }
  return out;
}

/** [검사 돌려 보기](편집기 옆 칸): 채점 없이 출력만 */
export async function tryScene(sceneId: string) {
  const m = await metaOf(sceneId);
  if (!m) throw Object.assign(new Error("장면 폴더를 찾지 못했어요."), { status: 404 });
  if (m.kind === "origin") return { ok: null, out: "이 장면은 제출할 때 그 목표의 검사([해 봤어요] 판정)로 봐요." };
  const d = await tmpDir("try");
  try { await copyTree(sceneDir(sceneId), d); await writeFile(path.join(d, CHECK), m.check); const r = await runCheck(d, limitFor(m.lang)); return { ok: r.code === 0, out: r.out.slice(-3000) }; }
  finally { await rm(d, { recursive: true, force: true }).catch(() => {}); }
}
/** 장면 폴더를 연 앱 안 편집기 주소 */
export async function editorFor(sceneId: string) {
  const m = await metaOf(sceneId);
  if (!m) throw Object.assign(new Error("장면 폴더를 찾지 못했어요."), { status: 404 });
  const folder = sceneDir(sceneId);
  if (!(await stat(folder).then((s) => s.isDirectory(), () => false))) throw Object.assign(new Error("장면 폴더가 없어요. 장면을 다시 만들어 주세요."), { status: 409 });
  return { folder, url: await (await import("./editor-web.ts")).urlFor(folder) };
}
export async function scenePublic(sceneId: string) {
  const m = await metaOf(sceneId);
  if (!m) return null;
  return { ...(m.kind === "project" ? projectPublic(m) : originPublic(m)), folder: sceneDir(sceneId), files: await listFiles(sceneDir(sceneId)) };
}
