// 실습 드라이버 + 손 하네스 (설계 4번 "실습은 손이 더 필요해요", 10번).
//   NPC마다 실습 서버를 따로 띄운다(PC_DATA_DIR · PC_PORT 4110번대, 가짜 AI면 PC_FAKE_AI=1). 앱 서버(3000) · 실습 서버(4100)는 안 쓴다.
//   손 = 도구 세 개만 가진 작은 에이전트 루프: 파일 읽기 · 파일 고치기 · 명령 실행(작업 폴더 안에서만, 명령은 node <파일>.js · npm test만).
//   연출가가 한 걸음씩만 시킨다("목표의 적용 과제를 빈틈 idea.await-gap(모름) 상태로 해 봐. 최대 6걸음").
//   손이 한 일은 VS Code 확장이 보내는 것과 같은 모양으로 실습 서버에 알린다: 저장(/api/bridge/state) · 명령과 출력(/api/bridge/terminal) ·
//   고른 코드로 묻기(/api/bridge/ask) · 대화와 "해 봤어요"(/api/runs/<id>/lesson/1/act). 실습 서버는 사람인지 NPC인지 모른다.
//   D(실습)의 파일은 고치지 않고, 서버를 띄워 주소로만 부른다.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { askJson, S } from "../assist/model.ts";
import { dice } from "./dice.ts";
import { dryTutorAnswer } from "./dry-ai.ts";
import { counterOf, PRACTICE_FILES, PRACTICE_GOAL, PRACTICE_MAP } from "./practice-map.ts";
import { holdings } from "./profile.ts";
import type { KeyEvent, ProblemMap, Route, Spec } from "./types.ts";
import { aiVoice, dryVoice } from "./voice.ts";

/* ---------- 손: 도구 셋 ---------- */
export type HandTool = { tool: "read" | "edit" | "run" | "done"; path?: string; content?: string; command?: string; note?: string };
export type HandResult = { tool: string; ok: boolean; out: string; exitCode?: number | null };
/** 작업 폴더 밖 · 숨은 파일 · 다른 명령은 코드가 거른다 */
export function inside(root: string, rel: string) {
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`작업 폴더 밖이에요: ${rel}`);
  if (path.relative(root, abs).split(path.sep).some((p) => p.startsWith(".") || p === "node_modules")) throw new Error(`숨은 폴더는 안 돼요: ${rel}`);
  return abs;
}
export const ALLOWED_COMMAND = /^(node\s+[\w./-]+\.js|npm\s+test)$/;
export async function runTool(root: string, t: HandTool): Promise<HandResult> {
  try {
    if (t.tool === "read") return { tool: "read", ok: true, out: (await readFile(inside(root, t.path ?? ""), "utf8")).slice(0, 12000) };
    if (t.tool === "edit") { const f = inside(root, t.path ?? ""); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, t.content ?? "", "utf8"); return { tool: "edit", ok: true, out: `${t.path} 저장(${(t.content ?? "").split("\n").length}줄)` }; }
    if (t.tool === "run") {
      const cmd = (t.command ?? "").trim();
      if (!ALLOWED_COMMAND.test(cmd)) return { tool: "run", ok: false, out: `이 명령은 못 돌려요(node <파일>.js · npm test만): ${cmd}`, exitCode: null };
      const [bin, ...rest] = cmd.split(/\s+/);
      const out = await new Promise<{ code: number | null; text: string }>((resolve) => {
        const p = spawn(bin === "node" ? process.execPath : "npm", rest, { cwd: root, env: { PATH: process.env.PATH ?? "", HOME: root } as unknown as NodeJS.ProcessEnv, timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
        let text = ""; p.stdout.on("data", (d: Buffer) => (text += d)); p.stderr.on("data", (d: Buffer) => (text += d));
        p.on("close", (code) => resolve({ code, text })); p.on("error", (e) => resolve({ code: null, text: String(e) }));
      });
      return { tool: "run", ok: out.code === 0, out: out.text.slice(-6000), exitCode: out.code };
    }
    return { tool: "done", ok: true, out: t.note ?? "" };
  } catch (e) { return { tool: t.tool, ok: false, out: (e as Error).message }; }
}
export const HANDS_SYSTEM = `너는 실습 과제를 하는 학습자의 "손"이다. 도구는 셋: read(파일 읽기) · edit(파일 전체를 새 내용으로 저장) · run(명령 실행: node <파일>.js 또는 npm test). 끝나면 done.
- [아는 조각]에 없는 생각 · 도구는 쓰지 않는다. "믿는 것"은 맞다고 믿고 그대로 한다. 더 좋은 방법을 알아도 쓰지 않는다.
- [시킨 일]의 길대로만 한다. 모르는 곳은 고치지 않고 그대로 둔다.
- 한 번에 도구 하나. 고친 뒤에는 꼭 run으로 확인한다. note에 지금 하는 일을 한 줄.`;
const HAND_SCHEMA = S.obj({ tool: S.oneOf("read", "edit", "run", "done"), path: S.str, content: S.str, command: S.str, note: S.str });

/* ---------- 실습 서버 ---------- */
const PC_ROOT = () => path.join(process.cwd(), "experiments", "project-course");
async function http(port: number, method: string, url: string, body?: unknown) {
  const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let data: unknown = text; try { data = JSON.parse(text); } catch { /* 글 */ }
  if (!r.ok) throw Object.assign(new Error(`${method} ${url} → ${r.status} ${typeof data === "object" ? JSON.stringify(data).slice(0, 200) : text.slice(0, 200)}`), { status: r.status });
  return data as Record<string, unknown>;
}
export async function startServer(o: { port: number; dataDir: string; fake: boolean; logFile: string }): Promise<{ proc: ChildProcess; stop: () => void }> {
  if (o.port === 3000 || o.port === 4100 || o.port < 4110) throw new Error("NPC 실습 서버는 4110번 위만 써요(3000 · 4100은 사용자 것).");
  await mkdir(o.dataDir, { recursive: true });
  const { openSync } = await import("node:fs");
  const log = openSync(o.logFile, "a");
  const proc = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(PC_ROOT(), "server", "main.ts")],
    { cwd: PC_ROOT(), env: { ...process.env, PC_DATA_DIR: o.dataDir, PC_PORT: String(o.port), PC_OPEN: "0", PC_ONGOING: "0", ...(o.fake ? { PC_FAKE_AI: "1" } : {}) }, stdio: ["ignore", log, log] });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (proc.exitCode !== null) throw new Error(`실습 서버가 바로 꺼졌어요(${o.logFile})`);
    try { await http(o.port, "GET", "/api/status"); return { proc, stop: () => { try { proc.kill("SIGTERM"); } catch { /* 이미 꺼짐 */ } } }; } catch { /* 아직 */ }
  }
  proc.kill("SIGTERM");
  throw new Error("실습 서버가 15초 안에 켜지지 않았어요.");
}

/* ---------- 한 판 ---------- */
export type PracticeResult = { ok: boolean; summary: string; key: KeyEvent[]; runId?: string; server: Record<string, unknown> };
export async function runPractice(o: { outDir: string; dataDir: string; port: number; dry: boolean; seed: number; spec?: Spec; map?: ProblemMap; maxSteps?: number; log?: (s: string) => void }): Promise<PracticeResult> {
  const log = o.log ?? (() => undefined);
  const map = o.map ?? PRACTICE_MAP;
  const spec: Spec = o.spec ?? { id: "npc_practice", seed: o.seed, name: "실습 NPC", lang: "python", knows: { base: { 1: "앎", 2: "앎", 3: "앎", 4: "앎", 5: "앎", 6: "앎", run: "앎" }, items: { "idea.await-gap": { state: "모름" } } },
    traits: { invent: 0.6, switch: 0.4, askEarly: 0.6, guess: 0.3, helpRungs: 0.3, copyTutor: 0.1, confirm: 0.3, patience: 6, typo: 0, terse: 0.6 }, learning: { perExplain: 0.8, perHint: 0.3, fromOwnFix: 0.2, forgetPerDay: 0.03 } };
  const roll = dice(spec.seed, map.problem);
  const h = holdings(spec, map, roll);
  const holds = new Set(h.holds);
  const voice = o.dry ? dryVoice(map) : aiVoice();
  const key: KeyEvent[] = [];
  let t = 0;
  await mkdir(o.outDir, { recursive: true });
  const server = await startServer({ port: o.port, dataDir: path.join(o.dataDir, "pc"), fake: true, logFile: path.join(o.outDir, "server.log") });
  const notes: string[] = [];
  try {
    const free = await http(o.port, "POST", "/api/free", { open: false, float: false });
    const runId = String(free.runId), ws = path.resolve(String(free.workspace));
    for (const [f, c] of Object.entries(PRACTICE_FILES)) await writeFile(path.join(ws, f), c, "utf8");
    await http(o.port, "POST", "/api/bridge/hello", { root: ws, version: "npc-hands-0.1", embedded: true });
    log(`  실습 서버 ${o.port} · 실습 ${runId} · 작업 폴더 ${ws}`);
    const report = { state: (b: Record<string, unknown>) => http(o.port, "POST", "/api/bridge/state", { runId, ...b }), terminal: (b: Record<string, unknown>) => http(o.port, "POST", "/api/bridge/terminal", { runId, ...b }),
      ask: (b: Record<string, unknown>) => http(o.port, "POST", "/api/bridge/ask", { runId, ...b }), act: (b: Record<string, unknown>) => http(o.port, "POST", `/api/runs/${runId}/lesson/1/act`, b) };
    await report.act({ do: "ask", text: `과제: ${PRACTICE_GOAL}. 해 볼게요.` }).catch((e) => notes.push(`대화 시작: ${(e as Error).message}`));
    const has = (n: string) => holds.has(n);
    const pick = (): Route | null => {
      const ok = map.routes.filter((r) => r.needs.every(has)).sort((a, b) => Number(b.needs.some((n) => map.fragments.find((f) => f.id === n)?.wrong)) - Number(a.needs.some((n) => map.fragments.find((f) => f.id === n)?.wrong)) || (b.prior ?? 0) - (a.prior ?? 0));
      return ok[0] ?? null;
    };
    let route = pick();
    key.push({ t, route: route?.id ?? "-", why: route ? `조각이 다 있음: ${route.needs.join(", ")}` : `끝까지 갈 길이 없음: ${map.routes.map((r) => `${r.id}: ${r.needs.filter((n) => !has(n)).join(", ")} 없음`).join(" · ")} → 그대로 돌려 봄` });
    let passed = false, asked = 0;
    /** 손 한 번(최대 maxSteps 걸음) */
    const hands = async (task: string, target: string | null) => {
      const results: HandResult[] = [];
      const steps: HandTool[] = [];
      if (voice.name === "dry") {
        steps.push({ tool: "read", path: "counter.js" });
        if (target !== null) steps.push({ tool: "edit", path: "counter.js", content: target });
        steps.push({ tool: "run", command: "node test.js" }, { tool: "done", note: task });
      }
      for (let i = 0; i < (o.maxSteps ?? 6); i++) {
        let step: HandTool;
        if (voice.name === "dry") step = steps[i] ?? { tool: "done" };
        else {
          const allowed = [...holds].map((id) => map.fragments.find((f) => f.id === id)).filter(Boolean).map((f) => `- ${f!.id}${f!.wrong ? "(믿는 것)" : ""}: ${f!.what}\n${f!.example}`).join("\n");
          step = await askJson<HandTool>("npc:hands", HANDS_SYSTEM, [`[과제] ${PRACTICE_GOAL}`, `[아는 조각]\n${allowed}`, `[시킨 일] ${task}`, `[파일] ${Object.keys(PRACTICE_FILES).join(", ")}`,
            `[지금까지]\n${results.map((r, k) => `${k + 1}. ${r.tool}: ${r.out.slice(0, 1500)}`).join("\n") || "(아직 없음)"}`].join("\n\n"), HAND_SCHEMA, { model: "gpt-6.1-terra", effort: "low" }).catch(() => ({ tool: "done" as const }));
        }
        t++;
        const r = await runTool(ws, step);
        results.push(r);
        log(`    손 ${i + 1}: ${step.tool}${step.path ? ` ${step.path}` : ""}${step.command ? ` ${step.command}` : ""} → ${r.ok ? "됨" : "안 됨"}${r.exitCode !== undefined ? ` (종료 ${r.exitCode})` : ""}`);
        // VS Code 확장과 같은 모양으로 알림
        if (step.tool === "edit" && r.ok) await report.state({ file: step.path, line: 1, selection: null, dirty: false, text: null, errors: [], saved: step.path }).catch((e) => notes.push(`state: ${(e as Error).message}`));
        if (step.tool === "run") await report.terminal({ command: step.command, exitCode: r.exitCode ?? null, cwd: "", output: r.out }).catch((e) => notes.push(`terminal: ${(e as Error).message}`));
        if (step.tool === "run" && r.exitCode === 0) passed = true;
        if (step.tool === "run" && r.exitCode !== 0 && r.exitCode !== undefined) passed = false;
        if (step.tool === "done") break;
      }
      return results;
    };
    for (let round = 0; round < 4 && !passed; round++) {
      const task = route ? `길 ${route.id}(${route.name})로 counter.js를 고치고 node test.js로 확인. 걸음: ${route.steps.map((s) => s.text).join(" → ")}` : "무엇이 문제인지 모르니 일단 그대로 node test.js를 돌려 본다";
      log(`  t${t} 시킨 일: ${task}`);
      const res = await hands(task, route ? counterOf(route) : null);
      if (passed) break;
      // 막힘: 빠진 조각(가장 흔한 길의 첫 빠진 조각)
      const best = [...map.routes].filter((r) => !r.needs.some((n) => map.fragments.find((f) => f.id === n)?.wrong)).sort((a, b) => (b.prior ?? 0) - (a.prior ?? 0))[0];
      const missing = best.needs.find((n) => !has(n)) ?? "-";
      const fr = map.fragments.find((f) => f.id === missing);
      const out = res.filter((r) => r.tool === "run").at(-1)?.out ?? "";
      key.push({ t, stuck: missing, layer: fr?.layer ?? 0, state: h.states[missing] ?? "모름", reaction: "튜터에게 물음", verdict: out.includes("FAIL") ? "FAIL" : "오류" });
      if (asked >= 3) { key.push({ t, end: "gaveup", why: "세 번 물어도 못 풀어 포기" }); break; }
      // 고른 코드로 묻기(확장의 "물어보기")와 대화
      const code = await readFile(path.join(ws, "counter.js"), "utf8");
      const question = await voice.speech({ name: spec.name, terse: spec.traits.terse, kind: "verdict", situation: `node test.js를 돌리면 ${out.trim().split("\n").at(-1) ?? ""}가 나와요. 40번 올렸는데 왜 모자라요?`, verdict: "FAIL" });
      t++; asked++;
      await report.ask({ file: "counter.js", from: 7, to: 10, code: code.split("\n").slice(6, 10).join("\n"), question }).catch((e) => notes.push(`ask: ${(e as Error).message}`));
      // 실습 서버의 튜터 답을 기다린다(OpenCode가 없으면 답이 없다 → 가짜 모드는 로컬 가짜 튜터로 이어 간다)
      let answer = "";
      for (let i = 0; i < 24 && !answer; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const v = await http(o.port, "GET", `/api/runs/${runId}/lesson/1`).catch(() => null);
        const msgs = (v?.messages as Array<{ role: string; text: string }> | undefined) ?? [];
        answer = msgs.filter((m) => m.role === "assistant").at(-1)?.text ?? "";
        if (v && v.busy === false && i > 2 && !answer) break;
      }
      let from = "실습 서버 튜터";
      if (!answer) { from = "로컬 가짜 튜터(실습 서버 튜터는 OpenCode · Node 24가 있어야 답함)"; answer = dryTutorAnswer(map, question, code); notes.push(`t${t}: 실습 서버가 답하지 않아 ${from}로 이어 감`); }
      const taught = await voice.learned(answer, map.fragments).catch(() => [] as string[]);
      const got = taught.filter((id) => !holds.has(id) && roll(`learn:${id}:${asked}`) < spec.learning.perExplain);
      for (const g of got) { holds.add(g); for (const w of map.fragments.filter((f) => f.wrong && f.right === g)) holds.delete(w.id); }
      key.push({ t, asked: true, taught, learned: got.length > 0, learnedIds: got });
      log(`  t${t} 물음 → ${from}: 가르친 것 ${taught.join(", ") || "없음"} · 배움 ${got.join(", ") || "없음"}`);
      const before = route;
      route = pick();
      if ((before?.id ?? "-") !== (route?.id ?? "-")) key.push({ t, taught, learned: got.length > 0, switched: `${before?.id ?? "-"}→${route?.id ?? "-"}` });
    }
    if (passed) {
      await report.act({ do: "goal", op: "applied", text: "해 봤어요: node test.js가 OK" }).catch((e) => notes.push(`해 봤어요: ${(e as Error).message}`));
      key.push({ t, end: "solved", why: `길 ${route?.id ?? "-"}로 node test.js OK` });
    } else if (!key.some((k) => "end" in k)) key.push({ t, end: "cap", why: "네 번 해도 못 함" });
    // 실습 서버가 남긴 것
    const get = (u: string) => http(o.port, "GET", u).catch((e) => ({ error: (e as Error).message }));
    const serverSide = { timeline: await get(`/api/runs/${runId}/timeline`), moments: await get(`/api/runs/${runId}/moments`), note: await get(`/api/runs/${runId}/note`), view: await get(`/api/runs/${runId}/lesson/1`) };
    await writeFile(path.join(o.outDir, "server-side.json"), JSON.stringify(serverSide, null, 1), "utf8");
    await writeFile(path.join(o.outDir, "key.jsonl"), key.map((k) => JSON.stringify(k)).join("\n") + "\n", "utf8");
    const steps = ((serverSide.timeline as { steps?: Array<{ trigger?: { label?: string; text?: string } }> }).steps ?? []);
    const moments = JSON.stringify(serverSide.moments);
    const terminalSteps = steps.filter((s) => /터미널/.test(String(s.trigger?.text ?? s.trigger?.label ?? ""))).length;
    const lacked = [...map.fragments.filter((f) => !f.wrong && !h.holds.has(f.id)).map((f) => f.id)];
    const md = [`# 실습 NPC — ${map.title} (${o.dry ? "가짜 AI" : "AI 손"})`, "",
      `- 실습 서버 ${o.port}(PC_FAKE_AI=1, 데이터 ${path.relative(process.cwd(), path.join(o.dataDir, "pc"))}) · 실습 ${runId}`,
      `- 처음 없던 조각: ${lacked.join(", ") || "없음"} · 끝: ${passed ? "OK(맞음)" : "못 함"} · 물음 ${asked}`,
      `- 서버가 받은 것: 타임라인 ${steps.length}칸(터미널 ${terminalSteps}) · 막힌 순간 기록 ${moments.includes("오류") ? "있음(오류로 열림)" : "없음"}`,
      ...(notes.length ? ["", "## 메모", "", ...notes.map((n) => `- ${n}`)] : []),
      "", "## 정답지", "", "```jsonl", ...key.map((k) => JSON.stringify(k)), "```", "",
      "## 확인", "", `| 확인 | 결과 |`, `|---|---|`,
      `| 막힌 조각이 처음에 없던 조각인가 | ${key.filter((k) => "stuck" in k).every((k) => lacked.includes((k as { stuck: string }).stuck)) ? "예" : "아니오"} |`,
      `| 실습 서버가 실패한 명령을 막힌 순간으로 열었나 | ${moments.includes("오류") ? "예" : "아니오"} |`,
      `| 배운 뒤 맞혔나 | ${passed ? "예" : "아니오"} |`, ""].join("\n");
    await writeFile(path.join(o.outDir, "report.md"), md, "utf8");
    return { ok: true, summary: `${passed ? "맞음" : "못 함"} · 물음 ${asked} · 서버 타임라인 ${steps.length}칸`, key, runId, server: serverSide };
  } finally { server.stop(); }
}
