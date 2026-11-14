// 15 명령 · 설정 한 줄 (설계 3번 실습 전용 "작은 예제 폴더에서 실제 실행 (안 되는 환경이면 모양 비교)", 8번 FPS "서버만 실행하기 명령 한 줄").
// 모양 비교: 프로그램 이름(python3 = python …) · 옵션 순서 · --a=b와 --a b · 별칭(-p = --project) · 경로 모양(./a/ = a)을 맞춰 놓고 비교한다.
// 실제 실행: 예제 폴더가 있고, 프로그램이 허용 목록(node · python · dotnet)에 있고 이 PC에 있으면, 임시 폴더에서 셸 없이 돌려 출력을 모범 명령과 비교한다.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Graded } from "../grade.ts";
import type { Gap, Scene } from "../types.ts";

/** 따옴표를 지키며 나누기 */
export function tokenize(cmd: string): string[] {
  const out: string[] = [];
  let cur = "", q: string | null = null, has = false;
  for (const ch of cmd.trim()) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ""; has = false; continue; }
    cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}
const PROGRAM: Record<string, string> = { python3: "python", py: "python", "python.exe": "python", "node.exe": "node", "dotnet.exe": "dotnet", "npm.cmd": "npm", "npx.cmd": "npx" };
/** 프로그램별 별칭 · 값을 받는 옵션 */
const ALIAS: Record<string, Record<string, string>> = {
  dotnet: { "-p": "--project", "-c": "--configuration", "-f": "--framework", "-o": "--output", "-v": "--verbosity", "-r": "--runtime" },
  npm: { i: "install", "-D": "--save-dev", "-g": "--global", "-S": "--save", t: "test" },
  git: { "-m": "--message", "-b": "-b" },
  python: {},
  node: {},
};
const VALUED: Record<string, string[]> = {
  dotnet: ["--project", "--configuration", "--framework", "--output", "--verbosity", "--runtime", "--urls", "--launch-profile"],
  npm: ["--prefix", "--workspace"], git: ["--message", "-b"], python: ["-m", "-c"], node: ["--env-file", "-e", "-r", "--require", "--import"],
};
const normPath = (v: string) => v.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "") || ".";
/** 명령의 모양(비교용 글 한 줄) */
export function commandShape(cmd: string, extraValued: string[] = []): string {
  let toks = tokenize(cmd.replace(/\r?\n/g, " "));
  // cd 폴더 && 명령 → 폴더에서 그 명령
  let cwd = "";
  const and = toks.indexOf("&&");
  if (toks[0]?.toLowerCase() === "cd" && and === 2) { cwd = normPath(toks[1]); toks = toks.slice(3); }
  if (!toks.length) return "";
  const raw = toks[0].replace(/^\.\//, "").replace(/\\/g, "/").toLowerCase();
  const prog = PROGRAM[raw] ?? raw.replace(/\.exe$/, "");
  const alias = ALIAS[prog] ?? {}, valued = new Set([...(VALUED[prog] ?? []), ...extraValued]);
  const pos: string[] = [], flags: string[] = [];
  for (let i = 1; i < toks.length; i++) {
    let t = toks[i];
    if (/^--?[\w-]+=/.test(t)) { const [k, ...v] = t.split("="); flags.push(`${alias[k] ?? k}=${normPath(v.join("="))}`); continue; }
    if (/^-[A-Za-z]{2,}$/.test(t) && !valued.has(t) && !alias[t]) { for (const c of t.slice(1)) flags.push(alias[`-${c}`] ?? `-${c}`); continue; }
    if (t.startsWith("-") && t !== "-") {
      t = alias[t] ?? t;
      if (valued.has(t) && i + 1 < toks.length) { flags.push(`${t}=${t === "--project" ? projectPath(toks[++i]) : normPath(toks[++i])}`); continue; }
      flags.push(t); continue;
    }
    pos.push(alias[t] && pos.length === 0 ? alias[t] : normPath(t));
  }
  return [cwd ? `@${cwd}` : "", prog, ...pos, ...flags.sort()].filter(Boolean).join(" ");
}
/** dotnet --project Server/Server.csproj = Server */
function projectPath(v: string) {
  const p = normPath(v);
  const m = /^(.*\/)?([^/]+)\/\2\.csproj$/i.exec(p);
  return m ? `${m[1] ?? ""}${m[2]}` : p;
}
const valuedIn = (cmds: string[]) => [...new Set(cmds.flatMap((c) => tokenize(c).filter((t) => /^--[\w-]+=/.test(t)).map((t) => t.split("=")[0])))];

export type CommandMaterial = { task: string; reference: string; alsoRight: string[]; mine: { what: string; command: string }; others: Array<{ id: string; what: string; command: string }>;
  files: Array<{ path: string; text: string }>; run?: { expected: string; mine?: string } | null };
const matOf = (s: Scene) => (s.practice as { command?: CommandMaterial } | undefined)?.command;
const ALLOWED = ["node", "python", "dotnet"];
const SAFE = /^[^;&|<>`$]*$/;

async function hasProgram(prog: string) {
  if (prog === "node") return process.execPath;
  const tries = prog === "python" ? ["python3", "python", "py"] : [prog];
  for (const t of tries) { const ok = await new Promise<boolean>((r) => execFile(t, ["--version"], { timeout: 8000, windowsHide: true }, (e) => r(!e))); if (ok) return t; }
  return null;
}
/** 예제 폴더에서 셸 없이 한 번 돌림. 허용 안 되는 명령이면 null */
export async function runCommand(cmd: string, files: CommandMaterial["files"], timeoutMs = 60_000): Promise<{ code: number; out: string } | null> {
  let toks = tokenize(cmd);
  let sub = "";
  if (toks[0]?.toLowerCase() === "cd" && toks[2] === "&&") { sub = normPath(toks[1]); toks = toks.slice(3); }
  if (!toks.length || !SAFE.test(cmd.replace(/&&/, "")) || sub.split("/").includes("..")) return null;
  const prog = PROGRAM[toks[0].toLowerCase()] ?? toks[0].toLowerCase();
  if (!ALLOWED.includes(prog)) return null;
  const exe = await hasProgram(prog);
  if (!exe) return null;
  const dir = await mkdtemp(path.join(os.tmpdir(), "recaller-cmd-"));
  try {
    for (const f of files) {
      const rel = normPath(f.path);
      if (rel.split("/").some((x) => x === ".." || !x) || path.isAbsolute(rel)) continue;
      await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await writeFile(path.join(dir, rel), f.text);
    }
    const cwd = sub ? path.join(dir, sub) : dir;
    return await new Promise((resolve) => execFile(exe, toks.slice(1), { cwd, timeout: timeoutMs, maxBuffer: 256 * 1024, windowsHide: true,
      env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" } }, (e, stdout, stderr) => {
      const code = e ? (typeof (e as { code?: unknown }).code === "number" ? (e as { code: number }).code : 1) : 0;
      resolve({ code, out: `${stdout}${code ? stderr : ""}`.replace(/\r/g, "").trim().split(dir).join(".") });
    }));
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

/** 검사: 모범 · 다른 맞는 명령은 같은 뜻, 그때 명령은 다른 모양. 예제 폴더에서 돌릴 수 있으면 모범 명령이 성공해야 하고 그때 명령과 출력이 달라야 함 */
export async function checkCommand(scene: Scene): Promise<Scene> {
  const m = matOf(scene);
  if (!m) return { ...scene, check: { ok: false, problems: ["재료가 없어요."] } };
  const problems: string[] = [];
  const valued = valuedIn([m.reference, ...m.alsoRight, m.mine.command]);
  const ref = commandShape(m.reference, valued);
  if (!ref) problems.push("모범 명령이 비어 있어요.");
  if (commandShape(m.mine.command, valued) === ref) problems.push("그때 명령이 모범 명령과 같은 모양이에요.");
  let run: CommandMaterial["run"] = null;
  if (m.files.length) {
    const r = await runCommand(m.reference, m.files);
    if (r && r.code !== 0) problems.push(`예제 폴더에서 모범 명령이 실패해요: ${r.out.slice(-200)}`);
    if (r && r.code === 0) {
      const mine = await runCommand(m.mine.command, m.files);
      run = { expected: r.out, ...(mine ? { mine: `${mine.code}:${mine.out}` } : {}) };
      if (mine && mine.code === 0 && mine.out === r.out) problems.push("예제 폴더에서 그때 명령도 같은 결과를 내요.");
    }
  }
  return { ...scene, check: { ok: !problems.length, problems }, practice: { ...scene.practice, command: { ...m, run } }, computed: { expected: [ref], shapes: { mine: [commandShape(m.mine.command, valued)] } } };
}
/** 채점: 모양이 모범 · 다른 맞는 명령과 같으면 통과. 아니면 돌릴 수 있을 때 돌려 같은 출력이면 통과. 그때 명령과 같은 모양(또는 같은 결과)이면 같은 실수 */
export async function gradeCommand(scene: Scene, gap: Pick<Gap, "wrongVerified">, answer: string): Promise<Graded> {
  const m = matOf(scene)!;
  const valued = valuedIn([m.reference, ...m.alsoRight, m.mine.command]);
  const got = commandShape(answer, valued);
  const outputs = [got];
  if (!got) return { verdict: "unclear", errors: ["명령이 비어 있어요."] };
  if ([m.reference, ...m.alsoRight].some((c) => commandShape(c, valued) === got)) return { verdict: "pass", outputs };
  const mineShape = commandShape(m.mine.command, valued);
  const firstDiff = { index: 0, stdin: m.task, expected: m.reference, got: answer.trim() };
  if (m.run) {
    const r = await runCommand(answer, m.files);
    if (r) {
      outputs.push(r.out.slice(-600));
      if (r.code === 0 && r.out === m.run.expected) return { verdict: "pass", outputs };
      if (gap.wrongVerified !== false && (got === mineShape || (m.run.mine !== undefined && `${r.code}:${r.out}` === m.run.mine))) return { verdict: "same", matched: "mine", outputs, firstDiff };
      return { verdict: "unclear", outputs, firstDiff, ...(r.code ? { errors: [r.out.slice(-300)] } : {}) };
    }
  }
  if (got === mineShape && gap.wrongVerified !== false) return { verdict: "same", matched: "mine", outputs, firstDiff };
  const o = m.others.find((x) => commandShape(x.command, valued) === got);
  if (o) return { verdict: "other", matched: o.id, outputs, firstDiff };
  return { verdict: "unclear", outputs, firstDiff };
}
export function commandPublic(scene: Scene) {
  const m = matOf(scene)!;
  return { kind: "command", task: m.task, files: m.files.map((f) => f.path), runs: !!m.run };
}
/** 은행(설계 8번 FPS "서버만 실행하기", AI 0번): 알맹이 · 그때 코드에 dotnet run이 있을 때 */
export function commandBankScene(gap: Gap, id: string): Scene | null {
  if (!/dotnet\s+run/i.test(`${gap.kernel.code}\n${gap.wrongCode ?? ""}\n${gap.missed}`)) return null;
  return commandFromReply(gap, id, { story: "솔루션 폴더에 Server와 Client 두 프로젝트가 있어요. 지금 폴더는 솔루션 폴더예요.", ask: "서버(Server 프로젝트)만 실행하는 명령을 한 줄로 써 보세요.",
    explain: "프로젝트가 여럿이면 어느 것을 돌릴지 --project로 알려 줘요.", task: "솔루션 폴더에서 Server 프로젝트만 실행", reference: "dotnet run --project Server",
    alsoRight: ["cd Server && dotnet run", "dotnet run --project Server/Server.csproj"], mineWhat: "프로젝트를 고르지 않고 dotnet run만 침", mine: "dotnet run",
    others: [{ id: "build", what: "실행 대신 빌드", command: "dotnet build Server" }], files: [] });
}
export type CommandReply = { story: string; ask: string; explain: string; task: string; reference: string; alsoRight: string[]; mineWhat: string; mine: string;
  others: Array<{ id: string; what: string; command: string }>; files: Array<{ path: string; text: string }> };
export function commandFromReply(gap: Gap, id: string, r: CommandReply): Scene {
  const m: CommandMaterial = { task: r.task, reference: r.reference.trim(), alsoRight: (r.alsoRight ?? []).map((x) => x.trim()).filter(Boolean), mine: { what: r.mineWhat, command: r.mine.trim() },
    others: (r.others ?? []).filter((o) => o.command?.trim()).map((o, i) => ({ id: o.id && o.id !== "mine" ? o.id : `w${i + 1}`, what: o.what, command: o.command.trim() })),
    files: (r.files ?? []).filter((f) => f.path).slice(0, 4).map((f) => ({ path: f.path, text: String(f.text ?? "").slice(0, 4000) })) };
  return { id, gapId: gap.id, format: "command", lang: "shell", distance: gap.state.distance, target: gap.target, story: r.story, ask: r.ask, explain: r.explain || gap.missed,
    setup: "", after: "", reference: m.reference, alsoRight: m.alsoRight, wrongs: [{ id: "mine", what: m.mine.what, code: m.mine.command }, ...m.others.map((o) => ({ id: o.id, what: o.what, code: o.command }))],
    inputs: [], practice: { kind: "command", command: m }, createdAt: new Date().toISOString(), madeBy: "ai" };
}
