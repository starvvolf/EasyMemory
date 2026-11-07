// 튜터 평가(2026-11-08 사용자 "연구한 걸 바탕으로 개선하면서 아주 작은 단위의 테스트를 실제 AI 호출로 반복"). 제품 흐름에 넣지 않는 실험실 코드.
// 시험 1: 학습자 답 판정 — 튜터가 틀리거나 일부만 맞은 답을 "맞다"고 받아들이는 비율(False Acceptance Rate)을 잰다.
//   조건: base(지금 튜터 지시문 그대로, 강도 low/medium) · judge(판정을 먼저 한 번 하고 그 결과를 맥락에 붙여 튜터가 답함)
//   채점: 다른 호출(medium)이 문항의 key와 튜터 답을 보고 accepted · pointed_gap · leaked를 매긴다
// 튜터 호출은 실제 대화의 근사다: 지금 튜터 지시문(CHAT_SYSTEM 또는 고친 지시문) + 목표 맥락 + 직전 튜터 말 + 학습자 답. 도구는 없다.
import path from "node:path";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DATA } from "./store.ts";
import { aiWith, S } from "./ai.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
type Case = { id: string; topic: string; goal: { title: string; done: string }; tutor: string; learner: string; gold: "correct" | "partial" | "incorrect" | "subtle" | "unclear"; key: string };
export const loadCases = async () => (JSON.parse(await readFile(path.join(HERE, "..", "evals", "judge-cases.json"), "utf8")) as { cases: Case[] }).cases;

/* ---------- 일반 모델: 판정 → 행동 (튜터 한 차례를 두 단계로 본다) ---------- */
// 판정: 학습자의 마지막 말이 직전 질문 · 과제에 대한 답이면, 완료 조건에 비추어 다섯 가지 중 하나로 본다
export const JUDGE_SYSTEM = `학습자의 마지막 말이 튜터가 바로 앞에 낸 질문 · 과제에 대한 답인지 보고, 답이면 지금 목표의 완료 조건에 비추어 판정한다.
verdict: correct(핵심이 다 맞음) · partial(맞은 부분이 있지만 핵심이 하나 이상 빠지거나 틀림) · incorrect(핵심이 틀림) · unclear(뜻이 모호하거나 이해했는지 판단할 근거가 부족) · not_answer(질문 · 요청 · 잡담).
right: 맞은 부분 한 구절(없으면 빈 글). gap: 빠지거나 틀린 부분 한 문장(correct · not_answer면 빈 글).
학습자가 실제로 말한 것만으로 판단한다. 학습자가 알 거라고 너그럽게 채우지 않는다.`;
export const JUDGE_SCHEMA = S.obj({ verdict: S.oneOf("correct", "partial", "incorrect", "unclear", "not_answer"), right: S.str, gap: S.str });
type Verdict = { verdict: string; right: string; gap: string };
const KO: Record<string, string> = { correct: "맞음", partial: "일부만 맞음", incorrect: "틀림", unclear: "판단 근거 부족", not_answer: "답이 아님" };
// 행동: 판정마다 일반 규칙(어느 주제든 같다). 맥락 줄로 붙인다
export function verdictLine(v: Verdict) {
  if (v.verdict === "not_answer") return "";
  const act = v.verdict === "correct" ? "짧게 맞다고 확인하고 이어 간다."
    : v.verdict === "unclear" ? "맞다 · 틀리다 하지 말고, 무엇을 뜻하는지 짧게 되묻는다."
    : "'맞아요'로 시작하지 않는다. 맞은 부분은 구체적으로 인정하고, 빠지거나 틀린 곳은 정답을 통째로 주지 말고 질문이나 힌트로 짚는다.";
  return `[답 판정 — Recaller가 붙임] ${KO[v.verdict]}${v.right ? ` · 맞은 부분: ${v.right}` : ""}${v.gap ? ` · 빠지거나 틀린 부분: ${v.gap}` : ""}\n→ ${act}`;
}

// 판정 호출 없이 같은 규칙을 맥락 한 줄로만 줄 때(호출 1번): 판정 → 행동을 튜터가 한 번에
export const RESPOND_RULE = `[답에 반응하기 — Recaller가 붙임] 학습자의 마지막 말이 직전 질문 · 과제에 대한 답이면, 먼저 맞음 · 일부만 맞음 · 틀림 · 판단 근거 부족 중 무엇인지 학습자가 실제로 말한 것만으로 판단한다. 맞음이면 짧게 확인하고 이어 간다. 일부만 맞음 · 틀림이면 '맞아요'로 시작하지 않고, 맞은 부분은 구체적으로 인정하고 빠지거나 틀린 곳은 정답을 통째로 주지 말고 질문이나 힌트로 짚는다. 판단 근거가 부족하면 무엇을 뜻하는지 짧게 되묻는다.`;

// v2: "핵심"을 일반적으로 정의(질문 · 완료 조건이 요구한 것 전부). 하나라도 빠지면 일부만 맞음
export const RESPOND_RULE_2 = `[답에 반응하기 — Recaller가 붙임] 학습자의 마지막 말이 직전 질문 · 과제에 대한 답이면, 먼저 그 질문과 지금 목표의 완료 조건이 요구한 것을 떠올리고, 학습자가 실제로 말한 것만으로 맞음 · 일부만 맞음 · 틀림 · 판단 근거 부족 중 하나로 판단한다. 요구한 것을 하나라도 빠뜨렸거나 뭉뚱그려 말했으면 일부만 맞음이다. 맞음이면 짧게 확인하고 이어 간다. 일부만 맞음 · 틀림이면 '맞아요'로 시작하지 않고, 맞은 부분은 구체적으로 인정하고 빠지거나 틀린 곳은 정답을 통째로 주지 말고 질문이나 힌트로 짚는다. 판단 근거가 부족하면 무엇을 뜻하는지 짧게 되묻는다.`;

/* ---------- 튜터 호출(근사) ---------- */
const turnText = (c: Case, extra = "") => `[학습 목표 — Recaller가 관리]\n현재 목표: ${c.goal.title} — 완료 조건: ${c.goal.done} · 단계: ② 적용 중\n\n[최근 대화]\n튜터: ${c.tutor}\n\n${extra ? `${extra}\n\n` : ""}[학습자] ${c.learner}`;

/* ---------- 채점 ---------- */
const GRADE_SYSTEM = `AI 튜터의 답을 채점한다. 문항의 정답 근거(key)와 기대 판정(gold)을 보고 튜터 답에 대해 매긴다.
accepted: 튜터가 학습자 답을 고칠 데 없이 맞다고 받아들였으면 true(맞다고 하고 넘어감, 또는 고칠 점을 말했어도 전체를 맞다고 한 경우 포함). 맞은 부분만 인정하고 빠진 곳을 짚었으면 false.
pointed_gap: key의 빠지거나 틀린 부분을 튜터가 짚었으면 true(질문으로 그쪽을 가리킨 것 포함). gold가 correct면 늘 false.
leaked: 학습자가 스스로 고칠 기회 없이 고친 코드나 완전한 정답 설명을 통째로 줬으면 true.
note: 한 줄 이유.`;
const GRADE_SCHEMA = S.obj({ accepted: S.bool, pointed_gap: S.bool, leaked: S.bool, note: S.str });

export type Cond = { name: string; effort: "low" | "medium" | "high"; judge?: { effort: "low" | "medium" } | null; rule?: boolean | 2; system?: string };
type Row = { id: string; gold: string; verdict?: Verdict; reply: string; grade: { accepted: boolean; pointed_gap: boolean; leaked: boolean; note: string }; ms: { judge?: number; tutor: number } };

async function runOne(c: Case, cond: Cond, system: string): Promise<Row> {
  let verdict: Verdict | undefined, jm: number | undefined;
  if (cond.judge) { const j = await aiWith("eval-judge", JUDGE_SYSTEM, turnText(c), { effort: cond.judge.effort, schema: JUDGE_SCHEMA }); verdict = j.out as Verdict; jm = j.ms; }
  const t = await aiWith("eval-tutor", system, turnText(c, verdict ? verdictLine(verdict) : cond.rule === 2 ? RESPOND_RULE_2 : cond.rule ? RESPOND_RULE : ""), { effort: cond.effort });
  const reply = String(t.out);
  const g = await aiWith("eval-grade", GRADE_SYSTEM, `[문항]\n질문: ${c.tutor}\n학습자 답: ${c.learner}\ngold: ${c.gold}\nkey: ${c.key}\n\n[튜터 답]\n${reply}`, { effort: "medium", schema: GRADE_SCHEMA });
  return { id: c.id, gold: c.gold, ...(verdict ? { verdict } : {}), reply, grade: g.out as Row["grade"], ms: { ...(jm ? { judge: jm } : {}), tutor: t.ms } };
}

export function summarize(rows: Row[]) {
  const wrong = rows.filter((r) => r.gold !== "correct"), right = rows.filter((r) => r.gold === "correct");
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  const judged = rows.filter((r) => r.verdict);
  const judgeOk = judged.filter((r) => (r.gold === "correct" ? r.verdict!.verdict === "correct" : r.verdict!.verdict !== "correct")).length;
  const med = (xs: number[]) => (xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
  return {
    n: rows.length,
    falseAccept: `${pct(wrong.filter((r) => r.grade.accepted).length, wrong.length)}% (${wrong.filter((r) => r.grade.accepted).length}/${wrong.length})`,
    correctAccepted: `${pct(right.filter((r) => r.grade.accepted).length, right.length)}% (${right.filter((r) => r.grade.accepted).length}/${right.length})`,
    pointedGap: `${pct(wrong.filter((r) => r.grade.pointed_gap).length, wrong.length)}%`,
    leaked: `${pct(rows.filter((r) => r.grade.leaked).length, rows.length)}%`,
    ...(judged.length ? { judgeAgree: `${pct(judgeOk, judged.length)}% (맞음/아님 기준)` } : {}),
    msTutorMedian: med(rows.map((r) => r.ms.tutor)), ...(judged.length ? { msJudgeMedian: med(judged.map((r) => r.ms.judge!)) } : {}),
    falseAcceptIds: wrong.filter((r) => r.grade.accepted).map((r) => r.id),
  };
}

/* ---------- 작업(오래 걸려서 뒤에서 돈다) ---------- */
const jobs = new Map<string, { status: "running" | "done" | "error"; done: number; total: number; result?: unknown; error?: string }>();
export function jobOf(id: string) { return jobs.get(id) ?? null; }
export async function startJudgeEval(conds: Cond[], opts: { ids?: string[]; repeat?: number } = {}) {
  const all = await loadCases();
  const cases = opts.ids?.length ? all.filter((c) => opts.ids!.includes(c.id)) : all;
  const { chatPrompts } = await import("./agent-chat.ts");
  const baseSystem = (await chatPrompts()).system;
  const id = `judge-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}-${randomBytes(2).toString("hex")}`;
  const rep = Math.max(1, Math.min(3, opts.repeat ?? 1));
  const work = conds.flatMap((cond) => Array.from({ length: rep }, (_, k) => cases.map((c) => ({ cond, c, k }))).flat());
  const job = { status: "running" as const, done: 0, total: work.length };
  jobs.set(id, job);
  void (async () => {
    const rows = new Map<string, Row[]>();
    try {
      let i = 0;
      const worker = async () => { while (i < work.length) { const w = work[i++]; const r = await runOne(w.c, w.cond, w.cond.system ?? baseSystem).catch((e) => ({ id: w.c.id, gold: w.c.gold, reply: `(실패) ${(e as Error).message}`, grade: { accepted: false, pointed_gap: false, leaked: false, note: "호출 실패" }, ms: { tutor: 0 } } as Row)); const key = rep > 1 ? `${w.cond.name}#${w.k + 1}` : w.cond.name; rows.set(key, [...(rows.get(key) ?? []), r]); job.done++; } };
      await Promise.all(Array.from({ length: 4 }, worker));
      const result = { id, at: new Date().toISOString(), conds, cases: cases.length, repeat: rep, summary: Object.fromEntries([...rows].map(([k, v]) => [k, summarize(v)])), rows: Object.fromEntries(rows) };
      await mkdir(path.join(DATA, "evals"), { recursive: true });
      await writeFile(path.join(DATA, "evals", `${id}.json`), JSON.stringify(result, null, 1));
      Object.assign(job, { status: "done", result: { id, summary: result.summary } });
    } catch (e) { Object.assign(job, { status: "error", error: (e as Error).message }); }
  })();
  return { id, total: work.length };
}

/* ---------- 시험 2: 목표 정리 호출(배운 것 · 부족했던 점) 강도 비교 ---------- */
// 실제 대화(보관본 포함)의 끝난 목표를 같은 입력으로 다시 정리한다(저장 · 메모리 반영 없음). 채점 호출이 대화에서 학습자 부족함을 스스로 찾고 정리 결과와 맞춘다
const GRADE_RECORD_SYSTEM = `학습 목표 하나의 대화와, 그 대화를 정리한 결과를 채점한다.
먼저 대화에서 학습자에게 실제로 드러난 부족한 점(틀린 답, 잘못 쓴 코드, 오해, 몰라서 물어본 것)을 스스로 찾아 found에 한 줄씩 쓴다(없으면 빈 목록).
missed: found 중 정리 결과의 gaps에 없는 것. unsupported: gaps 중 대화에 근거가 없는 것(튜터가 설명만 하고 학습자는 틀린 적 없는 것 포함).
learned_unsupported: learned 중 학습자의 말 · 행동에 근거가 없는 것(튜터 설명만 있던 것).`;
const GRADE_RECORD_SCHEMA = S.obj({ found: S.arr(S.str), missed: S.arr(S.str), unsupported: S.arr(S.str), learned_unsupported: S.arr(S.str) });
export async function startRecordEval(opts: { dataDir: string; runIds: string[]; efforts: string[]; repeat?: number }) {
  const R = await import("./goal-record.ts");
  const { recordShow } = await import("./lesson.ts");
  const id = `record-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}-${randomBytes(2).toString("hex")}`;
  const items: { runId: string; goal: { title: string; done: string; understood: boolean; applied: boolean; at: string }; to: string; messages: { role: string; text: string; at: string }[]; saves: { at: string; file: string; text: string }[] }[] = [];
  for (const runId of opts.runIds) {
    const recs = JSON.parse(await readFile(path.join(opts.dataDir, "goals", `${runId}.records.json`), "utf8")).items as { goal: string; done: string; status: string; from: string; to: string }[];
    const runs = JSON.parse(await readFile(path.join(opts.dataDir, "runs.json"), "utf8")) as { runs?: { id: string; codexId?: string; chatId?: string }[] } | { id: string; codexId?: string; chatId?: string }[];
    const run = (Array.isArray(runs) ? runs : runs.runs ?? []).find((r) => r.id === runId);
    const chatFile = run?.codexId ? path.join(opts.dataDir, "codex-chat", `${run.codexId}.json`) : path.join(opts.dataDir, "agent-chat", `${run?.chatId}.json`);
    const messages = JSON.parse(await readFile(chatFile, "utf8")).messages;
    const saves = (await readFile(path.join(opts.dataDir, "goals", `${runId}.saves.jsonl`), "utf8").catch(() => "")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    for (const r of recs) items.push({ runId, goal: { title: r.goal, done: r.done, understood: r.status === "마침", applied: r.status === "마침", at: r.from }, to: r.to, messages, saves });
  }
  const rep = Math.max(1, Math.min(3, opts.repeat ?? 1));
  const work = opts.efforts.flatMap((effort) => Array.from({ length: rep }, () => items.map((it) => ({ effort, it }))).flat());
  const job = { status: "running" as const, done: 0, total: work.length };
  jobs.set(id, job);
  void (async () => {
    const rows: Record<string, unknown[]> = {};
    try {
      let i = 0;
      const worker = async () => { while (i < work.length) {
        const w = work[i++];
        const inp = R.recordInput(w.it.goal, w.it.messages, recordShow, w.it.saves, w.it.to, "(아직 없음)");
        if (!inp.seg.some((m) => m.role === "user")) { job.done++; continue; }
        try {
          const r = await aiWith("eval-record", R.SYSTEM_RECORD, inp.user, { effort: w.effort, schema: R.RECORD_SCHEMA });
          const out = r.out as { learned: { concept: string }[]; gaps?: { concept: string; wrong: string; code?: { save: string } }[] };
          const g = await aiWith("eval-record-grade", GRADE_RECORD_SYSTEM, `${inp.user}\n\n[정리 결과]\n${JSON.stringify({ learned: out.learned, gaps: out.gaps }, null, 1)}`, { effort: "medium", schema: GRADE_RECORD_SCHEMA });
          const gr = g.out as { found: string[]; missed: string[]; unsupported: string[]; learned_unsupported: string[] };
          (rows[w.effort] ??= []).push({ goal: w.it.goal.title, ms: r.ms, learned: out.learned.length, gaps: out.gaps?.length ?? 0, withCode: (out.gaps ?? []).filter((x) => x.code?.save).length, found: gr.found.length, missed: gr.missed, unsupported: gr.unsupported, learnedUnsupported: gr.learned_unsupported, gapsOut: (out.gaps ?? []).map((x) => x.concept) });
        } catch (e) { (rows[w.effort] ??= []).push({ goal: w.it.goal.title, error: (e as Error).message }); }
        job.done++;
      } };
      await Promise.all(Array.from({ length: 3 }, worker));
      const sum = Object.fromEntries(Object.entries(rows).map(([k, v]) => { const ok = v.filter((x: any) => !x.error) as any[]; const tot = (f: (x: any) => number) => ok.reduce((n, x) => n + f(x), 0);
        const found = tot((x) => x.found), missed = tot((x) => x.missed.length);
        return [k, { goals: ok.length, gapRecall: found ? `${Math.round(((found - missed) / found) * 100)}% (${found - missed}/${found})` : "-", unsupportedGaps: tot((x) => x.unsupported.length), unsupportedLearned: tot((x) => x.learnedUnsupported.length), gapsWithCode: tot((x) => x.withCode), msMedian: ok.map((x) => x.ms).sort((a, b) => a - b)[Math.floor(ok.length / 2)] ?? 0 }]; }));
      await mkdir(path.join(DATA, "evals"), { recursive: true });
      await writeFile(path.join(DATA, "evals", `${id}.json`), JSON.stringify({ id, opts, summary: sum, rows }, null, 1));
      Object.assign(job, { status: "done", result: { id, summary: sum } });
    } catch (e) { Object.assign(job, { status: "error", error: (e as Error).message }); }
  })();
  return { id, total: work.length };
}
