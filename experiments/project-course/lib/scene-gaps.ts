// 상황 재현 복습의 실습 빈틈(11/15, 설계 docs/상황재현_설계_v2(+gpt).md 1번 "실습: 이미 구조로 남아 있는 빈틈(Gap)에 종류 · 확인할 것 · 알맹이 칸을 더해요").
// 부족함 원장(gaps.ts)의 칸을 앱(src/lib/scene/practice/)이 읽는 모양으로 내준다. 종류 · 확인할 것 · 주제 · 알맹이는 목표 정리 글이 같이 쓰고(AI 호출 늘리지 않음),
// 여기서는 코드만: 알맹이가 돌아가나(checkKernels) · 막힌 정도 신호(signalsOf) · 그때 생각이 정말 틀렸다는 증거(wrongVerified) · 장면 재료(sceneMaterial).
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA, update } from "./store.ts";
import type { Gap, KernelCheck } from "./gaps.ts";
import { KERNEL_LANGS, langOfFile, type SceneKind } from "./scene-kinds.ts";

/* ---------- 알맹이 검사 ---------- */
const run = (cmd: string, args: string[], opts: { cwd?: string; timeout?: number } = {}) => new Promise<{ ok: boolean; out: string; missing: boolean }>((resolve) => {
  execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeout ?? 8000, maxBuffer: 256 * 1024, windowsHide: true }, (err, stdout, stderr) => {
    const missing = (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
    resolve({ ok: !err, out: `${stdout}${stderr}`.slice(-2000), missing });
  });
});
let pythonCmd: Promise<string[] | null> | null = null;
/** 이 PC의 파이썬(python3 · python · py -3) */
export function python() {
  pythonCmd ??= (async () => {
    for (const c of [["python3"], ["python"], ["py", "-3"]]) { const r = await run(c[0], [...c.slice(1), "--version"], { timeout: 5000 }); if (r.ok && /Python 3/.test(r.out)) return c; }
    return null;
  })();
  return pythonCmd;
}
/** 괄호 · 따옴표 짝(실행기가 없는 언어 · 조각만 있는 코드의 "모양" 검사). 문제가 있으면 그 말 */
export function shapeProblem(code: string, lang = "") {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: string[] = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "/" && code[i + 1] === "/" && lang !== "python") { while (i < code.length && code[i] !== "\n") i++; continue; }
    if (c === "#" && (lang === "python" || lang === "shell")) { while (i < code.length && code[i] !== "\n") i++; continue; }
    if (c === "/" && code[i + 1] === "*") { const e = code.indexOf("*/", i + 2); if (e < 0) return "주석이 닫히지 않았어요."; i = e + 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      // C#의 'x'는 글자 하나, 파이썬 · 자바스크립트는 글. 둘 다 같은 따옴표가 다시 나올 때까지(\ 다음 글자는 건너뜀)
      let j = i + 1;
      while (j < code.length && code[j] !== c) { if (code[j] === "\\") j++; if (code[j] === "\n" && c !== "`") return `따옴표(${c})가 그 줄에서 닫히지 않았어요.`; j++; }
      if (j >= code.length) return `따옴표(${c})가 닫히지 않았어요.`;
      i = j; continue;
    }
    if ("([{".includes(c)) stack.push(c);
    else if (pairs[c]) { if (stack.pop() !== pairs[c]) return `괄호 ${c}의 짝이 맞지 않아요.`; }
  }
  return stack.length ? `괄호 ${stack.at(-1)}가 닫히지 않았어요.` : null;
}
/**
 * 알맹이 코드가 돌아가나(설계 1번 검사 2). 조각이라 가정한 변수가 없을 수 있어서:
 * 자바스크립트 = 문법(node --check) 뒤 권한 모드로 실제로 돌려 보고(된다면 ran) · 파이썬 = 문법(ast) · C# · C++ · 명령 = 괄호 · 따옴표 모양.
 */
export async function checkKernel(k: { lang: string; code: string }): Promise<{ check: KernelCheck; error?: string }> {
  const code = String(k.code ?? "");
  if (!code.trim()) return { check: "none" };
  const dir = await mkdtemp(path.join(await tmpBase(), "k-"));
  try {
    if (k.lang === "javascript") {
      // await · return이 든 조각도 되게 async 함수 안에 넣어 문법만 본다
      const f = path.join(dir, "k.mjs");
      await writeFile(f, `async function __kernel() {\n${code}\n}\n`);
      const r = await run(process.execPath, ["--check", f]);
      if (!r.ok) return { check: "failed", error: tidy(r.out, dir) };
      const { runSnippet } = await import("./tutor-tools.ts");
      const s = await runSnippet(`(async () => {\n${code}\n})();`, 3000).catch(() => null);
      return { check: s?.ok && !s.timedOut ? "ran" : "syntax" };
    }
    if (k.lang === "python") {
      const py = await python();
      const shape = shapeProblem(code, "python");
      if (!py) return shape ? { check: "failed", error: shape } : { check: "shape" };
      const f = path.join(dir, "k.py");
      await writeFile(f, code);
      const r = await run(py[0], [...py.slice(1), "-c", "import ast,sys;ast.parse(open(sys.argv[1],encoding='utf-8').read())", f]);
      return r.ok ? { check: "syntax" } : { check: "failed", error: tidy(r.out, dir) };
    }
    const shape = shapeProblem(code, k.lang);
    return shape ? { check: "failed", error: shape } : { check: "shape" };
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const tidy = (out: string, dir: string) => out.split(dir).join(".").split("\n").filter((l) => l.trim()).slice(-3).join("\n").slice(0, 300);
async function tmpBase() { const b = path.join(DATA, "tmp"); await mkdir(b, { recursive: true }); return b; }

const ledgerFile = (runId: string) => path.join(DATA, "gaps", `${runId}.json`);
/** 이 목표(없으면 실습 전체)의 원장 칸 중 알맹이를 아직 안 본 것을 검사해 적는다 */
export async function checkKernels(runId: string, goalId?: string) {
  const { ledgerOf } = await import("./gaps.ts");
  const todo = (await ledgerOf(runId)).filter((g) => g.scene && !g.scene.kernel.check && (!goalId || g.goal.id === goalId));
  const results = new Map<string, { check: KernelCheck; error?: string }>();
  for (const g of todo) results.set(g.id, await checkKernel(g.scene!.kernel));
  if (!results.size) return 0;
  await update<{ gaps: Gap[] }>(ledgerFile(runId), { gaps: [] }, (l) => {
    for (const g of l.gaps) { const r = results.get(g.id); if (r && g.scene) { g.scene.kernel.check = r.check; if (r.error) g.scene.kernel.error = r.error; else delete g.scene.kernel.error; } }
  });
  return results.size;
}

/* ---------- 막힌 정도 · 증거 ---------- */
export type Signals = { wrongTries: number; asked: number; helpRung: number; tutorCode: boolean; gaveUp: boolean; repeated: boolean };
type MomentLite = { goal: string; how?: string; by: string; help: { edits: string[] } };
/** 세기의 재료(설계 1번 신호 표). 계산(scopeOf · doseOf)은 앱이 바닥(ladder.ts)으로 한다 */
export function signalsOf(g: Gap, moments: MomentLite[], siblings: number): Omit<Signals, "repeated"> {
  const judged = g.evidence.filter((e) => e.from === "판정").length;
  const refailed = g.checks.filter((c) => c.answer && c.verdict !== "correct").length;
  const asked = g.evidence.filter((e) => e.from === "막힘").length;
  let helpRung = g.remedy.some((r) => r.kind === "보충") ? 2 : g.remedy.length ? 1 : 0;
  if (g.card?.how === "도움 받고 됨") helpRung = Math.max(helpRung, 1);
  // 막힌 순간은 목표 단위라, 그 목표의 빈틈이 하나뿐이거나 튜터가 그 파일을 고친 때만 이 빈틈의 것으로 본다
  const file = g.code?.file;
  const mine = moments.filter((m) => m.goal === g.goal.title && (siblings <= 1 || (!!file && m.help.edits.includes(file))));
  if (mine.some((m) => m.how === "힌트 받고 풂")) helpRung = Math.max(helpRung, 1);
  if (mine.some((m) => m.how === "코드를 보고 풂")) helpRung = Math.max(helpRung, 3);
  const tutorCode = mine.some((m) => m.how === "튜터가 고쳐 줌");
  const gaveUp = g.card?.how === "아직 모름" || mine.some((m) => m.how === "안 풀고 넘어감");
  return { wrongTries: judged + refailed, asked, helpRung, tutorCode, gaveUp };
}
/**
 * 그때 생각이 정말 틀렸나(설계 1번 검사 3의 실습 판): 판정이 틀림이라 했거나 · 다시 확인에서 또 틀렸거나 · 학습자 코드가 틀렸다가 고쳐졌거나.
 * 표현 빈틈은 표현을 못 쓴 증거(고른 이유 "코드(문법)로 못 옮기겠어요").
 */
export function wrongVerifiedOf(g: Gap) {
  if (g.evidence.some((e) => e.from === "판정" || e.from === "다시 확인")) return true;
  if (g.checks.some((c) => c.answer && c.verdict !== "correct")) return true;
  if (g.card?.how === "틀렸다 고침" && g.code?.code) return true;
  if (g.scene?.target === "form" && g.cause.some((c) => c.includes("문법"))) return true;
  return false;
}
/** 목표 정리 전(또는 11/15 전)에 생긴 칸: 고른 이유로 종류를 짐작(알맹이가 없으니 장면은 대개 왜인지 한 줄) */
export function guessKind(g: Gap): SceneKind {
  const c = g.cause.join(" ");
  if (/문법/.test(c)) return "문법";
  if (/순서/.test(c)) return "알고리즘 구현";
  if (/오류/.test(c)) return "오류 읽기";
  if (/과제|완료 조건/.test(c)) return "문제 읽기";
  return "알고리즘 원리";
}

/* ---------- 앱으로 내보내기 ---------- */
export type SceneGapItem = {
  runId: string; id: string; goal: { id: string; title: string; done: string }; title: string; kind: SceneKind; target: "ability" | "form"; topic: string;
  missed: string; wrong: string; wrongCode: string; wrongVerified: boolean; lang: string;
  kernel: { lang: string; code: string; needs: string[]; check: KernelCheck };
  code: { file: string; from: number; to: number; save?: string } | null; evidence: Array<{ at: string; from: string; text: string }>;
  signals: Signals; recheck: boolean; status: string; at: string; enriched: boolean;
};
export async function runIds() {
  return (await readdir(path.join(DATA, "gaps")).catch(() => [] as string[])).filter((n) => /^\w+\.json$/.test(n)).map((n) => n.slice(0, -5));
}
/** 모든 실습의 빈틈(묶인 칸 · 아직 이름 없는 칸은 뺌). 같은 주제가 다른 목표 · 실습에서 또 나오면 repeated */
export async function sceneGaps(): Promise<{ items: SceneGapItem[] }> {
  const { ledgerOf } = await import("./gaps.ts");
  const { momentsOf } = await import("./moments.ts");
  const items: SceneGapItem[] = [];
  for (const runId of await runIds()) {
    const all = (await ledgerOf(runId)).filter((g) => !g.mergedInto && (g.scene || (g.type && g.recheck)));
    const moments = (await momentsOf(runId).catch(() => [])) as MomentLite[];
    for (const g of all) {
      const siblings = all.filter((x) => x.goal.id === g.goal.id).length;
      const k = g.scene?.kernel;
      const lang = (k && (KERNEL_LANGS as readonly string[]).includes(k.lang) ? k.lang : "") || langOfFile(g.code?.file ?? "") || "javascript";
      items.push({ runId, id: g.id, goal: { id: g.goal.id, title: g.goal.title, done: g.unit.done }, title: g.type ? g.concept : g.unit.title,
        kind: (g.scene?.kind as SceneKind) ?? guessKind(g), target: g.scene?.target ?? "ability", topic: g.scene?.topic || `practice.${g.id.toLowerCase()}`,
        missed: g.right || g.card?.next || "", wrong: g.wrong, wrongCode: g.code?.code ?? "", wrongVerified: wrongVerifiedOf(g), lang,
        kernel: { lang: k?.lang || lang, code: k?.code ?? "", needs: k?.needs ?? [], check: k?.check ?? "none" },
        code: g.code ? { file: g.code.file, from: g.code.from, to: g.code.to, ...(g.code.save ? { save: g.code.save } : {}) } : null,
        evidence: g.evidence.slice(-6), signals: { ...signalsOf(g, moments, siblings), repeated: false }, recheck: !!g.recheck, status: g.status, at: g.at, enriched: !!g.scene });
    }
  }
  const where = new Map<string, Set<string>>();
  for (const x of items) { const s = where.get(x.topic) ?? new Set(); s.add(`${x.runId}:${x.goal.id}`); where.set(x.topic, s); }
  for (const x of items) x.signals.repeated = (where.get(x.topic)?.size ?? 0) > 1;
  return { items };
}

/** 그 칸의 코드를 자른 저장본(번호가 없던 옛 칸은 그 파일 저장본 중 그 줄이 그대로 있는 마지막 것) */
export function findSave<T extends { file: string; text: string; at: string }>(saves: T[], code: { file: string; from: number; to: number; code: string; save?: string }): { index: number; save: T } | null {
  const n = /^S(\d+)$/.exec(code.save ?? "")?.[1];
  if (n && saves[Number(n) - 1]?.file === code.file) return { index: Number(n) - 1, save: saves[Number(n) - 1] };
  const want = code.code.replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).join("\n");
  for (let i = saves.length - 1; i >= 0; i--) {
    if (saves[i].file !== code.file) continue;
    const lines = saves[i].text.replace(/\r/g, "").split("\n");
    if (lines.slice(code.from - 1, code.to).map((l) => l.trimEnd()).join("\n") === want) return { index: i, save: saves[i] };
  }
  return null;
}
/** 공통 형식(한 줄 쓰기 · 결과 맞히기 · 오류 읽기)을 실습 빈틈으로 만들 때 AI 장면 지시문에 넣을 재료: 목표 · 그때 파일과 줄 · 그때 한 말 · 언어 */
export async function sceneMaterial(runId: string, gapId: string) {
  const { ledgerOf } = await import("./gaps.ts");
  const g = (await ledgerOf(runId)).find((x) => x.id === gapId);
  if (!g) throw Object.assign(new Error("그 빈틈을 찾지 못했어요."), { status: 404 });
  const { savesOf } = await import("./goal-record.ts");
  const hit = g.code ? findSave(await savesOf(runId), g.code) : null;
  // 그 줄 앞뒤 10줄까지(줄 번호, 학습자가 그때 본 모습)
  const around = hit && g.code ? (() => { const ls = hit.save.text.replace(/\r/g, "").split("\n"); const a = Math.max(1, g.code.from - 10), b = Math.min(ls.length, g.code.to + 10);
    return ls.slice(a - 1, b).map((l, i) => `${String(a + i).padStart(3)}| ${l}`).join("\n"); })() : "";
  const said = g.evidence.map((e) => e.text).filter(Boolean).slice(-4);
  const lang = g.scene?.kernel.lang && (KERNEL_LANGS as readonly string[]).includes(g.scene.kernel.lang) ? g.scene.kernel.lang : langOfFile(g.code?.file ?? "") || "javascript";
  const statement = [
    `[실습 목표] ${g.goal.title} — 완료 조건: ${g.unit.done}`,
    g.card?.situation ? `[그때 상황] ${g.card.situation}` : "",
    g.code ? `[그때 코드] ${g.code.file} ${g.code.from}~${g.code.to}줄${around ? `\n${around}` : `\n${g.code.code}`}` : "",
    said.length ? `[그때 기록] ${said.join(" / ")}` : "",
    g.right ? `[바로 알 것] ${g.right}` : "",
  ].filter(Boolean).join("\n\n");
  return { title: g.goal.title, statement, lang, file: g.code?.file ?? "", from: g.code?.from ?? 0, to: g.code?.to ?? 0, code: g.code?.code ?? "", said };
}
