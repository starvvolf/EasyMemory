// 알고리즘 드라이버 (설계 10번, 정할 것 3의 (가) 기능을 바로 부르기): 사람이 문제 화면에서 누르는 것과 같은 함수를 같은 순서로 부른다.
//   문제 열기 · AI 튜터에게 묻기 · 도움 칸 · 힌트 · 예제 실행 · 제출 · 나가기 → 문제 한 장 · 총정리 · 상황 재현 빈틈 뽑기.
//   경로(src/app/api/code/...)가 하는 일을 그대로 따라 하되, 화면을 기다리게 하지 않으려고 "기다리지 않고" 하던 일(keepTalk · closeSheet)은 기다린다(결과가 늘 같게).
//   NPC 한 명 = 데이터 폴더 하나(STUDY_FORGE_DATA_DIR). 사용자 데이터는 절대 안 쓴다: 폴더는 tools/npc/out/data/<npc>/ 아래에 새로 만든다.
//   B(알고리즘)의 파일은 고치지 않고 부르기만 한다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Judgement } from "../code/run.ts";
import type { Driver, LastRun } from "./director.ts";
import { dryTutorAnswer } from "./dry-ai.ts";
import { verdictOf, type Verdicted } from "./guard.ts";
import { allTests, type ProblemPack } from "./map.ts";
import type { ProblemMap } from "./types.ts";

/** 이 NPC의 데이터 폴더로 바꾼다(사용자 데이터 폴더 · 저장소 안 .study-forge-data는 거절). */
export function switchDataDir(dir: string) {
  const abs = path.resolve(dir);
  const banned = [process.env.RECALLER_USER_DATA_DIR, path.join(process.cwd(), ".study-forge-data")].filter(Boolean).map((d) => path.resolve(d!));
  if (banned.some((b) => abs === b || abs.startsWith(`${b}${path.sep}`))) throw new Error(`사용자 데이터 폴더는 쓰지 않아요: ${abs}`);
  if (!/[\\/]npc[\\/]|npc-|[\\/]tmp[\\/]|tmp-/.test(abs)) throw new Error(`NPC 데이터 폴더는 이름에 npc가 들어간 곳(tools/npc/out/data/…)만 써요: ${abs}`);
  process.env.STUDY_FORGE_DATA_DIR = abs;
  process.env.RECALLER_AFTER_SAVE = "off";
  return abs;
}

/** 문제 재료를 NPC 데이터 폴더에 넣는다: 문제 파일(숨은 테스트 · 모범 풀이) + 교육용 문제 모델(도움 칸 재료). */
export async function setupProblem(pack: ProblemPack) {
  const { saveProblem } = await import("../code/problems.ts");
  await saveProblem({ id: pack.id, title: pack.title, statement: pack.statement, inputText: pack.inputText, outputText: pack.outputText, examples: pack.examples,
    tests: pack.tests, timeLimitMs: pack.timeLimitMs, kind: "full", templates: {}, reference: { lang: "javascript", code: pack.referenceJs },
    knowledge: ["그래프 탐색", "방문 표시"], folder: "NPC 시험", source: { kind: "manual", title: `NPC 시험 재료 (${pack.number})` }, examplesFrom: "made" });
  if (pack.model) {
    const dir = path.join(process.env.STUDY_FORGE_DATA_DIR!, "code", "tutor");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, "models.json");
    const have = JSON.parse(await readFile(file, "utf8").catch(() => "{}")) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...have, [pack.number]: { ...pack.model, problemId: pack.id } }, null, 1), "utf8");
  }
}

const toVerdicted = (r: Judgement): Verdicted => {
  const f = r.results.find((x) => x.verdict !== "AC");
  return { verdict: r.verdict, passed: r.passed, total: r.total, compile: r.compile, ...(f ? { first: { input: f.input, expected: f.expected, got: f.got, stderr: f.stderr, verdict: f.verdict } } : {}) };
};

/** 진짜 앱 기능을 부르는 드라이버 */
export function appDriver(pack: ProblemPack): Driver {
  const id = pack.id;
  return {
    name: "app",
    async open() {
      const { readProblemMeta, warmTests } = await import("../code/problems.ts");
      await readProblemMeta(id); warmTests(id);
      const { helpState } = await import("../code/tutor/help.ts");
      await helpState(id);
    },
    async example(code) {
      const { submitAndRecord } = await import("../code/service.ts");
      return toVerdicted(await submitAndRecord(id, "python", code, "example", 0));
    },
    async submit(code, hints) {
      const { submitAndRecord } = await import("../code/service.ts");
      const result = await submitAndRecord(id, "python", code, "submit", hints);
      // 경로와 같은 뒤처리: 튜터 기록 → 맞았으면 문제 한 장
      const { notePlainSolve, syncTutorImplement } = await import("../code/tutor/service.ts");
      const synced = notePlainSolve(id).then(() => syncTutorImplement()).catch(() => undefined);
      await synced;
      if (result.verdict === "AC") { const { closeSheet } = await import("../code/tutor/sheets.ts"); await closeSheet(id, "solved", { after: synced }).catch(() => undefined); }
      return toVerdicted(result);
    },
    async ask(q) {
      const { recordAsked, noteAnswer } = await import("../code/service.ts");
      const { explainCode } = await import("../assist/code-ai.ts");
      const { appendTalk } = await import("../code/tutor/talk.ts");
      await recordAsked(id, q.question);
      const out = await explainCode({ problemId: id, lang: "python", code: q.code, selection: q.selection.slice(0, 8000) || q.code.slice(0, 200) || "-", question: q.question,
        history: q.history.slice(-200), ...(q.last ? { last: q.last } : {}) });
      await noteAnswer(id, out.text).catch(() => undefined);
      await appendTalk({ problemId: id, kind: "질문", q: q.question, a: out.text, selection: q.selection, code: q.code, ...(q.last?.verdict ? { verdict: q.last.verdict } : {}) });
      return out.text;
    },
    async help(rung, code) {
      void code;
      const { openHelp } = await import("../code/tutor/help.ts");
      const { appendTalk } = await import("../code/tutor/talk.ts");
      const out = await openHelp(id, rung, "python").catch(() => null);
      if (!out) return null;
      const skeleton = "skeleton" in out ? out.skeleton : undefined;
      await appendTalk({ problemId: id, kind: "도움 칸", q: `도움 ${rung}칸: ${out.label}`, a: [out.text, skeleton ? `[뼈대 코드]\n${skeleton}` : ""].filter(Boolean).join("\n\n") });
      return { text: out.text, ...(skeleton ? { skeleton } : {}) };
    },
    async hint(level, code, last?: LastRun) {
      const { hint } = await import("../assist/code-ai.ts");
      const { recordHint, noteAnswer } = await import("../code/service.ts");
      const { appendTalk } = await import("../code/tutor/talk.ts");
      const out = await hint({ problemId: id, lang: "python", code, level, ...(last ? { last } : {}) });
      await recordHint(id, level);
      await noteAnswer(id, out.text, "hint").catch(() => undefined);
      await appendTalk({ problemId: id, kind: "힌트", q: `힌트 ${level}단계`, a: out.text, code, ...(last?.verdict ? { verdict: last.verdict } : {}) });
      return out.text;
    },
    async end(how, code) {
      const { waitSheet, closeSheet } = await import("../code/tutor/sheets.ts");
      if (how === "solved") { await waitSheet(id); return; }
      // 나가기(경로 end, touched): 쓰던 코드를 남기고 문제 한 장(하다가 나감)
      const { saveDraft } = await import("../code/problems.ts");
      const { endAttempt } = await import("../code/service.ts");
      await saveDraft(id, "python", code).catch(() => undefined);
      await closeSheet(id, "paused", { ...(code ? { code } : {}) }).catch(() => null);
      await endAttempt(id);
    },
  };
}

/** 앱 없이(시험용): 채점은 진짜 채점기, 튜터는 가짜 튜터 */
export function offlineDriver(map: ProblemMap, pack: ProblemPack): Driver & { talk: Array<{ kind: string; q: string; a: string }>; subs: Array<{ mode: string; verdict: string; code: string }> } {
  const talk: Array<{ kind: string; q: string; a: string }> = [], subs: Array<{ mode: string; verdict: string; code: string }> = [];
  const m = pack.model;
  return {
    name: "offline", talk, subs,
    async open() { /* 열 것 없음 */ },
    async example(code) { const v = await verdictOf(code, pack.examples, pack.timeLimitMs); subs.push({ mode: "example", verdict: v.verdict, code }); return v; },
    async submit(code) { const v = await verdictOf(code, allTests(pack), pack.timeLimitMs); subs.push({ mode: "submit", verdict: v.verdict, code }); return v; },
    async ask(q) { const a = dryTutorAnswer(map, q.question, q.code); talk.push({ kind: "질문", q: q.question, a }); return a; },
    async help(rung) {
      if (!m) return null;
      const text = rung === 1 ? m.signals.join(" · ") : rung === 2 ? m.approaches.find((a) => a.verdict === "best")?.name ?? "" : rung === 3 ? `${m.state.right} · ${m.update}` : "(뼈대 코드는 앱에서만)";
      talk.push({ kind: "도움 칸", q: `도움 ${rung}칸`, a: text }); return { text };
    },
    async hint(level, code) { const a = dryTutorAnswer(map, "", code); talk.push({ kind: "힌트", q: `힌트 ${level}단계`, a }); return a; },
    async end() { /* 나갈 것 없음 */ },
  };
}

/** 맞힌 뒤(또는 나간 뒤) 만들어지는 것: 문제 한 장 · 총정리 · 상황 재현 빈틈. 하나가 실패해도 나머지는 한다. */
export async function afterSolve(pack: ProblemPack, opts: { extract?: boolean } = {}) {
  const id = pack.id;
  const { waitSheet, reviewFor } = await import("../code/tutor/sheets.ts");
  const errors: string[] = [];
  const sheet = await waitSheet(id).catch((e) => { errors.push(`문제 한 장: ${(e as Error).message}`); return null; });
  const review = sheet ? await reviewFor(id).catch((e) => { errors.push(`총정리: ${(e as Error).message}`); return null; }) : null;
  let gaps: Awaited<ReturnType<typeof import("../scene/extract.ts").extractGaps>> = [];
  if (opts.extract !== false) {
    const { extractGaps } = await import("../scene/extract.ts");
    gaps = await extractGaps(id, { force: true }).catch((e) => { errors.push(`빈틈 뽑기: ${(e as Error).message}`); return []; });
  }
  return { sheet, review, gaps, errors };
}

/** 이 데이터 폴더에 남은 것(채점 재료): 대화 · 제출 · 배운 것 카드 · 기억 · 튜터 사건 · 문제 한 장 */
export async function collectRecord(pack: ProblemPack) {
  const id = pack.id;
  const [{ readTalk }, { readSubmissions }, { readLessons }, { readEvents }, { readSheets }, { tree }] = await Promise.all([
    import("../code/tutor/talk.ts"), import("../code/problems.ts"), import("../code/tutor/lessons.ts"), import("../code/tutor/state.ts"), import("../code/tutor/sheets.ts"), import("../knowledge/api.ts")]);
  const knowledge = await tree().catch(() => ({ folders: [], items: [] as Array<Record<string, unknown>> }));
  return {
    talk: await readTalk({ problemId: id }), subs: await readSubmissions(id), lessons: await readLessons(), events: await readEvents(),
    sheets: (await readSheets()).filter((s) => s.problemId === id), knowledge: (knowledge.items ?? []) as Array<Record<string, unknown>>,
  };
}

/** 이 데이터 폴더의 AI 호출 기록(assist-log.jsonl) → 목적별 수 · 토큰(모델이 안 알려 주면 글자 수로 어림: 2글자 ≈ 1토큰) */
export async function usageOf(dataDir: string) {
  const lines = (await readFile(path.join(dataDir, "assist-log.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) as { purpose: string; ok: boolean; ms: number; inChars: number; outChars: number; tokens?: { in?: number; out?: number } }; } catch { return null; } }).filter(Boolean) as Array<{ purpose: string; ok: boolean; ms: number; inChars: number; outChars: number; tokens?: { in?: number; out?: number } }>;
  const by: Record<string, { calls: number; tokens: number; measured: boolean }> = {};
  let total = 0, measured = true;
  for (const l of lines) {
    const real = l.tokens && (l.tokens.in || l.tokens.out);
    const tk = real ? (l.tokens!.in ?? 0) + (l.tokens!.out ?? 0) : Math.round((l.inChars + l.outChars) / 2);
    if (!real) measured = false;
    const b = (by[l.purpose] ??= { calls: 0, tokens: 0, measured: true });
    b.calls++; b.tokens += tk; if (!real) b.measured = false;
    total += tk;
  }
  return { calls: lines.length, tokens: total, measured, by };
}
