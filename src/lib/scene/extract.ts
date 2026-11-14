// 빈틈 뽑기 (설계 1번): 풀이 하나가 끝나면 그 기록(문제 · 대화 · 제출 코드와 처음 틀린 입력)으로 AI 1번 → 빈틈 목록.
// 코드가 하는 검사: 증거 주소가 진짜 있나 · 그때 생각(wrongCode)이 원래 문제에서 정말 틀리나(맞으면 빈틈이 아님: "다른 맞는 방법") · 범위 · 세기 · 합치기.
import { judge, type TestCase } from "../code/run.ts";
import { readProblem, readSubmissions, type Submission } from "../code/problems.ts";
import { askJson } from "../assist/model.ts";
import { langOf } from "./exec.ts";
import { doseOf, firstState, scopeOf } from "./ladder.ts";
import { EXTRACT_SCHEMA, EXTRACT_SYSTEM, type ExtractReply } from "./prompts.ts";
import { changeGaps, newId, readGaps } from "./store.ts";
import { GAP_KINDS, LAYER, type Evidence, type Gap, type GapKind } from "./types.ts";

export type Ask = <T>(purpose: string, system: string, user: string, schema: Record<string, unknown>) => Promise<T>;
export const defaultAsk: Ask = (purpose, system, user, schema) => askJson(purpose, system, user, schema, { model: "gpt-6.1-terra", effort: "medium" });

type Talk = { at: string; kind: string; q: string; a: string; code?: string; verdict?: string };
export type Record_ = { problemId: string; title: string; statement: string; tests: TestCase[]; timeLimitMs: number; subs: Submission[]; talk: Talk[]; tags?: string[] };

/** 이 문제의 기록(데이터 폴더). 같은 코드를 이어서 낸 제출은 하나로. */
export async function recordOf(problemId: string): Promise<Record_> {
  // 큰 숨은 입력을 생성기로 다시 만들 수 없을 때(생성기 없음 · 실패)는 저장된 작은 테스트만 쓴다(빈틈 확인에는 작은 입력이면 충분).
  const p = await readProblem(problemId).catch(async () => {
    const { readFile } = await import("node:fs/promises");
    const path = (await import("node:path")).default;
    const dir = path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "code", "problems");
    const meta = JSON.parse(await readFile(path.join(dir, `${problemId}.json`), "utf8"));
    const raw = JSON.parse(await readFile(path.join(dir, `${problemId}.tests.json`), "utf8").catch(() => "[]")) as Array<{ input?: string; output?: string }>;
    return { ...meta, tests: raw.filter((t) => typeof t.input === "string" && typeof t.output === "string") } as Awaited<ReturnType<typeof readProblem>>;
  });
  const all = (await readSubmissions(problemId)).filter((s) => s.problemId === problemId);
  const subs = all.filter((s, i) => i === 0 || s.code.trim() !== all[i - 1].code.trim() || s.mode !== all[i - 1].mode);
  const { readTalk } = await import("../code/tutor/talk.ts");
  const talk = (await readTalk({ problemId })).slice(-60);
  return { problemId, title: p.title, statement: p.statement, tests: [...p.examples, ...p.tests.map((t) => ({ input: t.input, output: t.output }))], timeLimitMs: p.timeLimitMs, subs, talk };
}

const numbered = (code: string) => code.replace(/\r/g, "").split("\n").map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n");
const small = (tests: TestCase[], n = 40) => [...tests].sort((a, b) => a.input.length - b.input.length).slice(0, n);
/** 틀린 제출이 처음 틀리는 가장 작은 입력(코드가 찾음) */
async function firstFail(rec: Record_, sub: Submission) {
  if (sub.verdict === "AC") return null;
  const j = await judge(langOf(sub.lang), sub.code, small(rec.tests), { timeLimitMs: rec.timeLimitMs, stopAtFirstFail: true });
  const r = j.results.find((x) => x.verdict !== "AC");
  return j.verdict === "CE" ? { verdict: "CE", input: "", expected: "", got: j.compile.slice(0, 600) } : r ? { verdict: r.verdict, input: r.input.slice(0, 400), expected: r.expected.slice(0, 200), got: (r.got || r.stderr).slice(0, 300) } : null;
}

export async function extractUser(rec: Record_) {
  const lines = [`[문제] ${rec.title}\n${rec.statement.slice(0, 1500)}`];
  if (rec.talk.length) lines.push(`[대화] 시간 순서. 학습자가 묻고 AI(튜터)가 답한 것.\n${rec.talk.map((t) => `- ${t.at} (${t.kind}${t.verdict ? `, 그때 채점 ${t.verdict}` : ""})\n  학습자: ${t.q.slice(0, 500)}\n  AI: ${t.a.slice(0, 700)}`).join("\n")}`);
  const subs: string[] = [];
  for (const s of rec.subs.slice(-8)) {
    const f = await firstFail(rec, s).catch(() => null);
    subs.push(`- 제출 id ${s.id} · ${s.at} · ${s.mode === "submit" ? "제출" : "예제 실행"} · ${s.lang} · ${s.verdict}${s.hints ? ` · 그때까지 연 힌트 ${s.hints}` : ""}\n${numbered(s.code).slice(0, 4000)}` +
      (f ? `\n  처음 틀린 입력(${f.verdict}): ${JSON.stringify(f.input)} → 정답 ${JSON.stringify(f.expected)}, 낸 출력 ${JSON.stringify(f.got)}` : ""));
  }
  if (subs.length) lines.push(`[제출한 코드] 시간 순서, 줄 번호를 붙였다.\n${subs.join("\n\n")}`);
  return lines.join("\n\n");
}

/** 그때 생각 코드가 원래 문제에서 틀리나 */
async function verifyWrong(rec: Record_, lang: string, code: string) {
  if (!code.trim()) return { verified: false as const };
  const j = await judge(langOf(lang), code, small(rec.tests, 60), { timeLimitMs: rec.timeLimitMs, stopAtFirstFail: true });
  if (j.verdict === "CE" || j.verdict === "MISSING") return { verified: false as const };
  if (j.verdict === "AC") return { verified: false as const, passes: true };
  return { verified: true as const, verdict: j.verdict };
}

export async function extractGaps(problemId: string, opts: { ask?: Ask; force?: boolean; rec?: Record_ } = {}): Promise<Gap[]> {
  const before = (await readGaps()).filter((g) => g.origin.problemId === problemId);
  if (before.length && !opts.force) return before;
  const rec = opts.rec ?? await recordOf(problemId);
  const lang = rec.subs.at(-1)?.lang ?? "python";
  const reply = await (opts.ask ?? defaultAsk)<ExtractReply>("scene:extract", EXTRACT_SYSTEM, await extractUser(rec), EXTRACT_SCHEMA);
  const made: Gap[] = [];
  for (const g of reply.gaps ?? []) {
    const kind = (GAP_KINDS as readonly string[]).includes(g.kind) ? g.kind as GapKind : null;
    if (!kind || !g.missed?.trim()) continue;
    // 증거 주소가 진짜 있나
    const evidence: Evidence[] = (g.evidence ?? []).flatMap((e): Evidence[] => {
      if (e.type === "submission") { const s = rec.subs.find((x) => x.id === e.ref); return s ? [{ type: "submission", id: s.id, verdict: s.verdict, ...(e.from > 0 ? { lines: [e.from, Math.max(e.from, e.to)] as [number, number] } : {}) }] : []; }
      const t = rec.talk.find((x) => x.at === e.ref || x.at.startsWith(e.ref) || (e.ref.length >= 5 && x.at.slice(11, 16) === e.ref.slice(-5)));
      return t ? [{ type: "talk", at: t.at, ...(e.quote ? { quote: e.quote.slice(0, 200) } : {}) }] : [];
    });
    if (!evidence.length) continue;
    // 그때 생각이 정말 틀렸나: 원래 문제에서 맞으면 빈틈이 아니다
    // 표현 빈틈도 그때 코드가 있으면 돌려 본다(예: [[]]*N은 실제로 틀린 답을 낸다 → 같은 실수를 가를 수 있음). 맞게 돌면 능력 빈틈은 버리고 표현 빈틈은 남긴다.
    // 코드로 옮기지 못한 빈틈(wrongCode "")이라도 증거가 가리키는 틀린 제출(실행은 된 것)이 있으면 그것으로 확인한다 — 그때 생각이 실제로 틀렸다는 증거
    const evidenceSub = evidence.flatMap((e) => (e.type === "submission" && e.verdict && !["AC", "CE"].includes(e.verdict) ? [e.id] : [])).at(-1);
    const fallback = !g.wrongCode?.trim() && evidenceSub ? rec.subs.find((x) => x.id === evidenceSub)?.code ?? "" : "";
    const v = await verifyWrong(rec, lang, g.wrongCode?.trim() ? g.wrongCode : fallback);
    if ("passes" in v && v.passes && g.target !== "form") continue;
    const signals = { ...g.signals, wrongTries: Math.max(g.signals?.wrongTries ?? 0, evidence.filter((e) => e.type === "submission" && e.verdict !== "AC").length) };
    const dose = doseOf(signals);
    made.push({ id: newId("gap"), branch: "algo", kind, layer: LAYER[kind], title: g.title.slice(0, 80), target: g.target === "form" ? "form" : "ability",
      missed: g.missed.slice(0, 300), wrong: (g.wrong ?? "").slice(0, 300), ...(g.wrongCode?.trim() ? { wrongCode: g.wrongCode } : {}),
      wrongVerified: v.verified, ...(v.verified ? { wrongVerdict: v.verdict } : {}),
      kernel: { lang, code: g.kernel?.code ?? "", needs: g.kernel?.needs ?? [] }, evidence,
      origin: { problemId, title: rec.title, lang }, topic: (g.topic || `${kind}.${g.title}`).slice(0, 60),
      scope: g.target === "form" ? "line" : scopeOf(kind, signals), dose: { level: dose }, state: firstState(dose), createdAt: new Date().toISOString() });
  }
  // 같은 생각(topic)이 이미 다른 문제에서 나왔으면 하나로: 세기만 올리고 증거를 더한다
  return changeGaps((gaps) => {
    for (let i = gaps.length - 1; i >= 0; i--) if (gaps[i].origin.problemId === problemId) gaps.splice(i, 1);
    const out: Gap[] = [];
    for (const g of made) {
      const same = gaps.find((x) => x.topic === g.topic && !x.state.known);
      if (same) { same.dose = { level: Math.min(3, Math.max(same.dose.level, g.dose.level) + 1) as 1 | 2 | 3 }; same.evidence.push(...g.evidence); out.push(same); }
      else { gaps.push(g); out.push(g); }
    }
    return out;
  });
}
