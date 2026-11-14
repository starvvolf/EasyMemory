// 연출가 (설계 3번, 코드만 · AI 0번): 가진 조각으로 갈 길을 고르고, 빠진 조각 자리에서 막히게 하고, 배우면 다시 계획한다. 정답지를 쓴다.
//   길 고르기: ① 끝까지 갈 수 있는 길 ② 여럿이면 익숙한 조각 · 최근 배운 조각이 든 길 ③ 조합력 주사위(틀을 알면 안 던짐) — 실패하면 "방법을 모르겠음"
//             ④ 갈 길이 없으면 가장 멀리 가는 길 ⑤ 틀린 조각(잘못 앎)이 든 길은 자신 있게. 계획할 때 문법(1층)은 안 보인다(쓸 때 드러남).
//   막히면 반응 고르기(성격 주사위): 지어 씀 · 틀린 조각으로 메움 · 도움 칸 · 힌트 · 튜터에게 물음(→ 배움 판정 → 다시 계획, 갈아타기 주사위) · 혼자 고침 · 포기.
//   아는데 하는 실수(typo), 복붙(튜터 코드를 그대로 붙임 → 맞혀도 조각은 안 생김). 상한: 질문 20 · 제출 15 · 행동 40(안전장치).
//   같은 명세 + 같은 문제 + 같은 씨앗이면 길과 막히는 자리가 같다(주사위는 이름 붙은 씨앗 주사위, dice.ts).
import { dice, weighted } from "./dice.ts";
import { guardCode, routeVerdict, syntaxLeaks, verdictOf, type Verdicted } from "./guard.ts";
import { fragmentOf, program, slotsOfStep } from "./map.ts";
import { holdings } from "./profile.ts";
import { scrubExamples, type CodeAsk, type CodeOut, type ProblemBrief, type SpeechKind, type Voice } from "./voice.ts";
import type { Fragment, KeyEvent, KnowState, Played, ProblemMap, Reaction, Route, Spec } from "./types.ts";
import type { TestCase } from "../code/run.ts";

export type LastRun = { verdict?: string; input?: string; expected?: string; got?: string; stderr?: string; compile?: string };
/** 알고리즘 화면에서 할 수 있는 것(사람이 누르는 것과 같은 함수를 부른다: algo-driver.ts). */
export type Driver = {
  name: string;
  open(): Promise<void>;
  example(code: string): Promise<Verdicted>;
  submit(code: string, hints: number): Promise<Verdicted>;
  ask(q: { question: string; code: string; selection: string; history: Array<{ q: string; a: string }>; last?: LastRun }): Promise<string>;
  help(rung: 1 | 2 | 3 | 4, code: string): Promise<{ text: string; skeleton?: string } | null>;
  hint(level: 1 | 2 | 3, code: string, last?: LastRun): Promise<string>;
  end(how: "solved" | "gaveup" | "cap", code: string): Promise<void>;
};
export type Caps = { asks: number; submits: number; actions: number };
export const CAPS: Caps = { asks: 20, submits: 15, actions: 40 };
export type PlayInput = {
  spec: Spec; map: ProblemMap; problem: ProblemBrief & { examples: TestCase[]; tests: TestCase[]; timeLimitMs: number };
  voice: Voice; driver: Driver; mode?: "strict" | "loose"; caps?: Caps; suspectAi?: boolean; log?: (line: string) => void;
  /** 느슨 모드에서 지도에 없는 길이 나오면 */ onCandidate?: (c: { code: string; plan: string[]; uses: string[]; verdict: string }) => void;
};

type Slip = { what: string; layer: number };
const SLIPS: Array<Slip & { apply: (code: string) => string | null }> = [
  { what: "출력할 값에 1을 더 침", layer: 3, apply: (c) => { const m = /^print\((.+)\)\s*$/m.exec(c); return m ? c.replace(m[0], `print(${m[1]} + 1)`) : null; } },
  { what: "range 끝을 하나 덜 씀", layer: 3, apply: (c) => (/range\(n \+ 1\)/.test(c) ? c.replace(/range\(n \+ 1\)/, "range(n)") : null) },
  { what: "변수 이름을 잘못 침", layer: 1, apply: (c) => {
    const names = [...c.matchAll(/^([a-z_][a-z0-9_]{2,})\s*=/gm)].map((m) => m[1]).filter((n) => !["input"].includes(n));
    for (const n of names) { const uses = [...c.matchAll(new RegExp(`\\b${n}\\b`, "g"))]; if (uses.length >= 3) { const u = uses[uses.length - 1]; return c.slice(0, u.index) + n + n.at(-1) + c.slice(u.index! + n.length); } }
    return null; } },
];
const codeBlock = (text: string) => [...text.matchAll(/```(?:python|py)?\n([\s\S]*?)```/g)].map((m) => m[1]).sort((a, b) => b.length - a.length)[0] ?? null;

export async function play(input: PlayInput): Promise<Played> {
  const { spec, map, voice, driver } = input;
  const mode = input.mode ?? "strict";
  const caps = input.caps ?? CAPS;
  const log = input.log ?? (() => undefined);
  const roll = dice(spec.seed, map.problem); // 명세 id는 넣지 않는다: 씨앗이 같으면 조각만 다른 NPC끼리 같은 주사위 눈(설계 8번 "하나만 바꾸기")
  const tests = [...input.problem.examples, ...input.problem.tests];
  const frag = (id: string) => fragmentOf(map, id)!;
  const tr = spec.traits, le = spec.learning;
  const h = holdings(spec, map, roll);
  const holds = new Set(h.holds);
  const start = { holds: [...holds].filter((x) => !frag(x).wrong), wrongs: [...h.wrongs.values()], vague: [...h.vague] };
  const filled = new Set<string>();
  const learned: string[] = [];
  const learnedAt = new Map<string, number>();
  const key: KeyEvent[] = [];
  const codes: Played["codes"] = [];
  const missed = new Set<string>(), used = new Set<string>();
  const counts = { asked: 0, submits: 0, actions: 0, help: 0 };
  const history: Array<{ q: string; a: string }> = [];
  const tried = new Map<string, number>();
  const slipCodes: string[] = [];
  let t = 0, code = "", copied = false, slips = 0, patience = tr.patience, helpRung = 0, hintLevel = 0, inventTry = 0, ranExamples = 0;
  let route: Route | null = null, last: Verdicted | null = null, slip: Slip | null = null, lastPartial = "", ended: "solved" | "gaveup" | "cap" | null = null, endWhy = "";
  const lastRun = (): LastRun | undefined => (last && last.verdict !== "AC" ? { verdict: last.verdict, ...(last.first ? { input: last.first.input.slice(0, 2000), expected: last.first.expected.slice(0, 500), got: last.first.got.slice(0, 500), stderr: last.first.stderr.slice(0, 1000) } : {}), ...(last.compile ? { compile: last.compile.slice(0, 2000) } : {}) } : undefined);
  const act = () => { t++; counts.actions++; };

  /* ---------- 조각 · 길 ---------- */
  const heldWrongAlt = (r: Route, name: string) => Object.keys(r.slots[name].alts).find((a) => a !== "?" && a !== r.slots[name].right && holds.has(a));
  const slotPick = (r: Route, name: string): string | null => {
    const s = r.slots[name];
    if (holds.has(s.right)) return s.right;
    return heldWrongAlt(r, name) ?? s.unaware ?? null;
  };
  const picksOf = (r: Route) => Object.fromEntries(Object.keys(r.slots).map((n) => [n, slotPick(r, n) ?? "?"]));
  /** 이 길에서 조각 n이 채워지나(계획할 때는 문법이 안 보임) */
  const needOk = (r: Route, n: string, planning: boolean) => {
    const f = frag(n);
    if (!f) return true;
    if (f.wrong) return holds.has(n);
    if (holds.has(n)) return true;
    if (Object.keys(r.slots).some((k) => r.slots[k].right === n && slotPick(r, k))) return true;
    return planning && f.layer === 1;
  };
  const finishable = (r: Route) => r.needs.every((n) => needOk(r, n, true));
  const missingOf = (r: Route, planning = true) => r.needs.filter((n) => !needOk(r, n, planning));
  const firstGap = (r: Route): { step: number; fragment: string } | null => {
    for (const [i, s] of r.steps.entries()) {
      const miss = s.uses.find((u) => !needOk(r, u, false));
      if (miss) return { step: i, fragment: miss };
      const slotMiss = slotsOfStep(s).find((k) => !slotPick(r, k));
      if (slotMiss) return { step: i, fragment: r.slots[slotMiss].right };
    }
    return null;
  };
  const usesWrong = (r: Route) => r.needs.some((n) => frag(n)?.wrong && holds.has(n)) || Object.values(picksOf(r)).some((p) => frag(p)?.wrong);
  const score = (r: Route) => {
    const fam = r.needs.reduce((s, n) => s + (h.vague.has(n) ? 0.5 : 1), 0) / Math.max(1, r.needs.length);
    const recent = r.needs.filter((n) => learnedAt.has(n)).length;
    return fam + recent + (r.prior ?? 0.2) * 0.5;
  };
  const whyParts = () => map.routes.map((r) => ({ r, miss: missingOf(r) })).filter((x) => x.miss.length).map((x) => `${x.r.id}: ${x.miss.join(", ")} 없음`);
  const choose = (): { route: Route | null; why: string } => {
    const cand = map.routes.filter(finishable);
    const parts = whyParts();
    const ordered = (rs: Route[]) => [...rs].sort((a, b) => score(b) - score(a) || (b.prior ?? 0) - (a.prior ?? 0));
    const confident = ordered(cand.filter(usesWrong));
    if (confident.length) {
      const w = [...confident[0].needs.filter((n) => frag(n)?.wrong && holds.has(n)), ...Object.values(picksOf(confident[0])).filter((p) => frag(p)?.wrong)];
      return { route: confident[0], why: [`틀린 조각 ${[...new Set(w)].join(", ")}을 맞다고 믿고 자신 있게`, ...parts].join(" · ") };
    }
    if (cand.length) {
      let list = ordered(cand);
      // 가끔(15%) 비슷한 점수의 다음 길을 고른다("더 자주"이지 "늘"이 아님)
      if (list.length > 1 && score(list[0]) - score(list[1]) < 0.3 && roll(`explore:${inventTry}:${t}`) < 0.15) list = [list[1], list[0], ...list.slice(2)];
      for (const r of list) {
        if (r.frame && holds.has(r.frame)) return { route: r, why: [`틀 ${r.frame}을 앎`, ...parts].join(" · ") };
        if (roll(`invent:${r.id}:${inventTry}`) < tr.invent) return { route: r, why: [`조합력으로 떠올림(${r.needs.filter((n) => !frag(n)?.id.startsWith("syntax.")).join(" + ")})`, ...parts].join(" · ") };
      }
      return { route: null, why: [`갈 수 있는 길(${list.map((r) => r.id).join(", ")})이 있지만 엮는 법을 못 떠올림(조합력 ${tr.invent})`, ...parts].join(" · ") };
    }
    // 끝까지 갈 길이 없음 → 가장 멀리 가는 길(쥔 틀린 조각과 어긋나지 않는 길 중)
    const far = map.routes.filter((r) => r.needs.every((n) => !frag(n)?.wrong || holds.has(n))).map((r) => ({ r, at: firstGap(r)?.step ?? r.steps.length }))
      .sort((a, b) => b.at - a.at || (b.r.prior ?? 0) - (a.r.prior ?? 0))[0];
    return { route: far?.r ?? null, why: [`끝까지 갈 길이 없어 가장 멀리 가는 길(${far ? `${far.r.id}, ${far.at}걸음까지` : "없음"})`, ...parts].join(" · ") };
  };
  const learnIds = (ids: string[]) => {
    for (const id of ids) {
      holds.add(id); learned.push(id); learnedAt.set(id, t);
      for (const f of map.fragments.filter((x) => x.wrong && x.right === id)) { holds.delete(f.id); filled.delete(f.id); }
    }
  };
  const lacking = (id: string) => Boolean(frag(id)) && !frag(id).wrong && !holds.has(id);
  const replan = (newly: string[]) => {
    const before = route;
    inventTry++;
    const next = choose();
    if (!before || !finishable(before)) {
      route = next.route;
    } else if (next.route && next.route.id !== before.id && next.route.needs.some((n) => newly.includes(n)) && roll(`switch:${t}`) < tr.switch) {
      route = next.route;
    }
    if ((before?.id ?? "-") !== (route?.id ?? "-")) key.push({ t, taught: newly, learned: true, switched: `${before?.id ?? "-"}→${route?.id ?? "-"}` });
    if (route && route !== before) log(`  길 다시: ${before?.id ?? "-"} → ${route.id} (${next.why})`);
  };

  /* ---------- 손 ---------- */
  const allowedFor = (r: Route | null): Fragment[] => {
    // 가진 조각의 예시에 모르는 문법이 섞여 있으면 그 줄은 지운다(11/15 대역 모델 시험: adj-list 예시에 [[] for …]가 그대로 새었음)
    const all = scrubExamples([...holds].map(frag).filter(Boolean), unknownSyntax());
    if (mode === "loose" || !r) return all;
    return all.filter((f) => r.needs.includes(f.id) || f.layer === 1 || Object.values(r.slots).some((s) => f.id in s.alts));
  };
  const unknownSyntax = () => map.fragments.filter((f) => f.layer === 1 && !f.wrong && !holds.has(f.id));
  const baseAsk = (r: Route, picks: Record<string, string>): CodeAsk => ({ problem: { title: input.problem.title, statement: input.problem.statement, inputText: input.problem.inputText, outputText: input.problem.outputText },
    mode, route: r, picks, allowed: allowedFor(r), previous: code });
  const writeCode = async (a: CodeAsk): Promise<string> => {
    try { return (await voice.code(a)).code; }
    catch (e) { key.push({ t, unreproduced: true, route: a.route?.id ?? "-", expected: "-", got: "-", why: `코드 쓰기 AI 실패: ${(e as Error).message.slice(0, 120)}` }); return a.route ? program(a.route, a.picks, { upto: a.upto, guessAt: a.guessAt }) : a.previous; }
  };
  /** 걸음 끝까지 쓰고 검사(판정 맞음 · 문법 누수 · 의심). 두 번 어긋나면 "재현 못 함"으로 적고 지도 코드를 쓴다. */
  const writeFull = async (r: Route, picks: Record<string, string>, guess?: { at?: number; what: string }) => {
    const a: CodeAsk = { ...baseAsk(r, picks), ...(guess?.at !== undefined ? { guessAt: guess.at } : {}), ...(guess ? { guessWhat: guess.what } : {}) };
    if (mode === "loose" && voice.name === "ai") {
      const out: CodeOut = await voice.code(a).catch(() => ({ code: program(r, picks), plan: [] as string[], uses: [] as string[] }));
      const v = await verdictOf(out.code, tests, input.problem.timeLimitMs);
      const known = map.routes.some((x) => out.uses && x.needs.filter((n) => !n.startsWith("syntax.")).every((n) => out.uses!.includes(n)));
      if (!known) input.onCandidate?.({ code: out.code, plan: out.plan ?? [], uses: out.uses ?? [], verdict: v.verdict });
      return out.code;
    }
    let c = await writeCode(a);
    if (voice.name === "dry") return c;
    const invented = guess !== undefined || Object.values(picks).includes("?");
    if (invented) {
      const leaks = syntaxLeaks(c, unknownSyntax().filter((f) => f.id !== guess?.what));
      if (leaks.length) { const c2 = await writeCode({ ...a, feedback: `모르는 문법(${leaks.map((x) => frag(x).what).join(" / ")})을 쓰지 마세요.` }); const l2 = syntaxLeaks(c2, unknownSyntax()); key.push({ t, leak: leaks, fixed: !l2.length }); c = c2; }
      return c;
    }
    let g = await guardCode({ code: c, route: r, picks, unknownSyntax: unknownSyntax(), tests, timeLimitMs: input.problem.timeLimitMs });
    if (!g.match || g.leaks.length) {
      const why = [!g.match ? `이 걸음대로면 판정이 ${g.expected}여야 하는데 ${g.verdict.verdict}가 나왔어요. 걸음을 그대로 따라 쓰세요(더하지도 고치지도 말고).` : "", g.leaks.length ? `모르는 문법(${g.leaks.map((x) => frag(x).what).join(" / ")})을 쓰지 마세요.` : ""].filter(Boolean).join(" ");
      const c2 = await writeCode({ ...a, feedback: why, previous: c });
      const g2 = await guardCode({ code: c2, route: r, picks, unknownSyntax: unknownSyntax(), tests, timeLimitMs: input.problem.timeLimitMs });
      if (g.leaks.length) key.push({ t, leak: g.leaks, fixed: !g2.leaks.length });
      c = c2; g = g2;
    }
    if (!g.match) {
      key.push({ t, unreproduced: true, route: r.id, expected: g.expected, got: g.verdict.verdict, why: "AI가 쓴 코드의 판정이 길의 잰 판정과 두 번 달라 지도 코드로 바꿈" });
      return program(r, picks);
    }
    if (g.suspect) {
      let ai = false;
      if (input.suspectAi) { const s = await voice.suspect(c, allowedFor(r)).catch(() => null); ai = Boolean(s?.outside); if (ai) { key.push({ t, suspect: `${g.suspect} → AI: ${s!.what}`, ai: true }); return program(r, picks); } }
      key.push({ t, suspect: g.suspect, ai });
    }
    return c;
  };

  /* ---------- 말 ---------- */
  const say = async (kind: SpeechKind, situation: string, extra: { step?: string; verdict?: string } = {}) =>
    voice.speech({ name: spec.name, terse: tr.terse, kind, situation, ...extra }).catch(() => situation);
  const verdictSituation = (v: Verdicted) => v.verdict === "TLE" ? "시간 안에 안 끝나요." : v.verdict === "CE" ? `컴파일 오류: ${v.compile.slice(0, 120)}`
    : v.first ? `입력 ${JSON.stringify(v.first.input.slice(0, 60))}에서 ${JSON.stringify(v.first.expected.slice(0, 20))}가 나와야 하는데 ${JSON.stringify((v.first.got || v.first.stderr.split("\n").filter(Boolean).at(-1) || "").slice(0, 60))}가 나와요.` : "";
  const VERDICT_KO: Record<string, string> = { WA: "틀렸습니다", TLE: "시간 초과", RE: "런타임 에러", CE: "컴파일 에러", MLE: "메모리 초과" };

  /* ---------- 반응 ---------- */
  type Stuck = { kind: "missing" | "wrong" | "method"; fragment: string; right?: string; step?: number; verdict?: string };
  const askTutor = async (question: string, selection: string) => {
    act(); counts.asked++;
    const answer = await driver.ask({ question, code: code || "# (아직 비어 있음)", selection: selection || code.split("\n").filter((l) => l.trim()).slice(-3).join("\n") || question, history: [...history], last: lastRun() })
      .catch((e) => `(튜터 답 실패: ${(e as Error).message})`);
    history.push({ q: question, a: answer });
    return answer;
  };
  const judgeLearn = async (text: string, p: number, tag: string) => {
    const taught = await voice.learned(text, map.fragments).catch(() => [] as string[]);
    const got = taught.filter((id) => lacking(id) && roll(`learn:${id}:${tag}`) < p);
    learnIds(got);
    return { taught, got };
  };
  const react = async (s: Stuck) => {
    const k = `${s.kind}:${s.fragment}`;
    const n = tried.get(k) ?? 0; tried.set(k, n + 1);
    patience--;
    const f = frag(s.fragment);
    const layer = s.kind === "method" ? 6 : (frag(s.right ?? s.fragment) ?? f)?.layer ?? 0;
    const state: KnowState | "방법 모름" | "실수" = s.kind === "method" ? "방법 모름" : h.states[s.right ?? s.fragment] ?? (f?.wrong ? "잘못 앎" : "모름");
    const slotName = route && s.kind === "missing" ? Object.keys(route.slots).find((x) => route!.slots[x].right === s.fragment) : undefined;
    const fillable = slotName && route ? Object.keys(route.slots[slotName].alts).find((a) => a !== "?" && a !== s.fragment && !holds.has(a) && frag(a)?.wrong) : undefined;
    const r = roll(`react:${k}:${n}`);
    let reaction: Reaction | null;
    if (patience < 0) reaction = "포기";
    else if (s.kind === "missing") reaction = weighted(r, [["튜터에게 물음", n === 0 ? tr.askEarly : 0.4 + tr.askEarly * 0.4], ["도움 칸", helpRung < 4 ? tr.helpRungs * 0.8 : 0], ["힌트", helpRung >= 3 && hintLevel < 3 ? tr.helpRungs * 0.4 : 0],
      ["지어 씀", (n === 0 ? 1 : 0.4) * tr.guess], ["틀린 조각으로 메움", fillable && n === 0 ? tr.guess * 0.8 : 0], ["포기", patience <= 2 ? 0.3 : 0.02]]);
    else if (s.kind === "wrong") reaction = weighted(r, [["튜터에게 물음", 0.5 + tr.askEarly * 0.3], ["혼자 고침", le.fromOwnFix * (n === 0 ? 0.6 : 0.3)], ["도움 칸", helpRung < 4 ? tr.helpRungs * 0.5 : 0], ["힌트", hintLevel < 3 ? tr.helpRungs * 0.3 : 0], ["포기", patience <= 2 ? 0.3 : 0.02]]);
    else reaction = weighted(r, [["튜터에게 물음", 0.3 + tr.askEarly * 0.5], ["도움 칸", helpRung < 4 ? tr.helpRungs : 0], ["지어 씀", tr.invent * 0.5], ["포기", patience <= 2 ? 0.3 : 0.02]]);
    reaction ??= "튜터에게 물음";
    if (counts.asked >= caps.asks && reaction === "튜터에게 물음") reaction = helpRung < 4 ? "도움 칸" : "포기";
    const ev: KeyEvent = { t, stuck: s.fragment, layer, state, reaction, ...(s.verdict ? { verdict: s.verdict } : {}) };
    key.push(ev);
    log(`  t${t} 막힘 ${s.fragment}(${state}) → ${reaction}`);
    const step = route && s.step !== undefined ? route.steps[s.step] : undefined;
    if (reaction === "포기") { ended = "gaveup"; endWhy = `${s.fragment}에서 버티다 포기(남은 인내 ${patience})`; return; }
    if (reaction === "틀린 조각으로 메움" && fillable) { holds.add(fillable); filled.add(fillable); return; }
    if (reaction === "지어 씀") {
      if (s.kind === "method") { inventTry++; const c = choose(); if (c.route) { route = c.route; key.push({ t, route: c.route.id, why: `혼자 더 생각해서 떠올림 · ${c.why}` }); } return; }
      if (!route) return;
      const picks = picksOf(route);
      const guessAt = slotName ? undefined : s.step;
      code = await writeFull(route, picks, { ...(guessAt !== undefined ? { at: guessAt } : {}), what: s.fragment }); act();
      const v = spec.knows.base.run === "모름" ? (counts.submits++, await driver.submit(code, hintLevel)) : await driver.example(code);
      act(); last = v; ranExamples++;
      codes.push({ t, code, verdict: v.verdict, kind: spec.knows.base.run === "모름" ? "submit" : "example" });
      (ev as { verdict?: string }).verdict = v.verdict;
      if (v.verdict === "AC") { // 어림한 것이 맞아 버림: 그 조각을 혼자 알아낸 것으로
        learnIds([s.fragment]); key.push({ t, selfFix: s.fragment, learned: true }); return;
      }
      if (roll(`ownfix:${s.fragment}:${n}`) < le.fromOwnFix * 0.5) { learnIds([s.fragment]); key.push({ t, selfFix: s.fragment, learned: true }); replan([s.fragment]); }
      return;
    }
    if (reaction === "혼자 고침") {
      const target = s.right ?? s.fragment;
      act();
      const ok = Boolean(frag(target)) && !frag(target).wrong && roll(`ownfix:${k}:${n}`) < le.fromOwnFix;
      key.push({ t, selfFix: target, learned: ok });
      if (ok) { learnIds([target]); replan([target]); }
      return;
    }
    if (reaction === "도움 칸" || reaction === "힌트") {
      let text = "", via: "칸" | "힌트" = "칸", level = 0;
      if (reaction === "도움 칸" && helpRung < 4) {
        helpRung++; act(); counts.help++;
        const got = await driver.help(helpRung as 1 | 2 | 3 | 4, code).catch(() => null);
        text = got ? [got.text, got.skeleton ?? ""].join("\n") : ""; level = helpRung;
      } else {
        hintLevel = Math.min(3, hintLevel + 1); act(); counts.help++; via = "힌트"; level = hintLevel;
        text = await driver.hint(hintLevel as 1 | 2 | 3, code, lastRun()).catch(() => "");
      }
      const { taught, got } = await judgeLearn(text, le.perHint, `help:${via}:${level}`);
      key.push({ t, help: level, via, taught, learned: got.length > 0, learnedIds: got });
      if (got.length) replan(got);
      return;
    }
    // 튜터에게 물음
    const kind: SpeechKind = s.kind === "method" ? "method" : s.kind === "wrong" ? "verdict" : f?.layer === 1 ? "syntax" : "stuck";
    const situation = s.kind === "method" ? "무엇을 세야 하는지는 알겠는데 어떤 방법으로 해야 할지 모르겠어요."
      : s.kind === "wrong" ? verdictSituation(last ?? { verdict: s.verdict ?? "WA", passed: 0, total: 0, compile: "" })
      : f?.layer === 1 ? "하려는 건 알겠는데 이 줄을 파이썬으로 어떻게 쓰는지 모르겠어요." : "이 걸음에서 무엇을 어떻게 해야 할지 모르겠어요.";
    const question = await say(kind, situation, { ...(step ? { step: step.text } : {}), ...(s.verdict ? { verdict: VERDICT_KO[s.verdict] ?? s.verdict } : {}) });
    const answer = await askTutor(question, "");
    const block = codeBlock(answer);
    if (block && roll(`copy:${t}`) < tr.copyTutor) {
      // 복붙형: 튜터 코드를 그대로 붙여 넣고 낸다 → 맞혀도 조각은 안 생김
      copied = true; code = block; act(); counts.submits++;
      const v = await driver.submit(code, hintLevel); last = v;
      codes.push({ t, code, verdict: v.verdict, kind: "submit" });
      key.push({ t, asked: true, taught: [], learned: false, copied: true });
      key.push({ t, submit: counts.submits, verdict: v.verdict, route: "튜터 코드" });
      if (v.verdict === "AC") { ended = "solved"; endWhy = "튜터 코드를 붙여 넣어 맞힘(조각은 안 생김)"; }
      return;
    }
    let { taught, got } = await judgeLearn(answer, le.perExplain, `ask:${counts.asked}`);
    // 확인 연타: 맞는지 한 번 더 묻는다(설명을 한 번 더 들으니 배울 기회도 한 번 더)
    if (roll(`confirm-ask:${t}`) < tr.confirm && counts.asked < caps.asks) {
      const q2 = await say("confirm", "방금 알려 준 대로 하면 되는지", step ? { step: step.text } : {});
      const a2 = await askTutor(q2, "");
      const more = await judgeLearn(a2, le.perExplain, `confirm:${counts.asked}`);
      taught = [...new Set([...taught, ...more.taught])]; got = [...got, ...more.got];
    }
    key.push({ t, asked: true, taught, learned: got.length > 0, learnedIds: got });
    if (got.length) replan(got);
  };

  /* ---------- 한 판 ---------- */
  await driver.open();
  {
    const c = choose(); route = c.route;
    key.push({ t: 0, route: route?.id ?? "-", why: c.why, mode });
    log(`  t0 길 ${route?.id ?? "-"}: ${c.why}`);
  }
  while (!ended) {
    if (counts.actions >= caps.actions || counts.submits >= caps.submits || counts.asked >= caps.asks) {
      ended = "cap"; endWhy = `상한(행동 ${counts.actions}/${caps.actions} · 제출 ${counts.submits}/${caps.submits} · 질문 ${counts.asked}/${caps.asks})`; break;
    }
    if (!route) { await react({ kind: "method", fragment: "방법" }); continue; }
    const picks = picksOf(route);
    const gap = firstGap(route);
    if (gap) {
      // 빠진 조각 자리까지 쓰고 멈춤
      const pk = `${route.id}:${gap.step}:${[...holds].sort().join(",")}`;
      if (pk !== lastPartial) {
        act(); lastPartial = pk;
        code = await writeCode({ ...baseAsk(route, picks), upto: gap.step });
        codes.push({ t, code, verdict: "-", kind: "draft" });
        for (const s of route.steps.slice(0, gap.step)) for (const u of s.uses) if (start.holds.includes(u)) used.add(u);
      }
      missed.add(gap.fragment);
      await react({ kind: "missing", fragment: gap.fragment, step: gap.step });
      continue;
    }
    act();
    code = await writeFull(route, picks);
    // 아는데 하는 실수
    slip = null;
    if (!copied && roll(`typo:${t}`) < tr.typo) {
      const options = SLIPS.map((s) => ({ s, c: s.apply(code) })).filter((x) => x.c);
      const pickS = options[Math.floor(roll(`typo-kind:${t}`) * options.length)];
      if (pickS) {
        const v = await verdictOf(pickS.c!, tests, input.problem.timeLimitMs);
        if (v.verdict !== "AC" && v.verdict !== (await routeVerdict(route, picks, tests, input.problem.timeLimitMs))) { code = pickS.c!; slip = { what: pickS.s.what, layer: pickS.s.layer }; slips++; slipCodes.push(code); }
      }
    }
    for (const n of route.needs) if (start.holds.includes(n) && !frag(n)?.wrong) used.add(n);
    // 예제 돌려 보기: 처음 한 번, 그 뒤엔 확인 연타 주사위
    if (spec.knows.base.run !== "모름" && (ranExamples === 0 || roll(`confirm:${t}`) < tr.confirm)) {
      act(); ranExamples++;
      const v = await driver.example(code); last = v;
      codes.push({ t, code, verdict: v.verdict, kind: "example" });
      if (v.verdict !== "AC") { await onFail(v, picks); continue; }
    }
    act(); counts.submits++;
    const v = await driver.submit(code, hintLevel); last = v;
    codes.push({ t, code, verdict: v.verdict, kind: "submit" });
    key.push({ t, submit: counts.submits, verdict: v.verdict, route: route.id, picks });
    log(`  t${t} 제출 ${counts.submits}: ${v.verdict} (길 ${route.id})`);
    if (v.verdict === "AC") { ended = "solved"; endWhy = `길 ${route.id}로 맞힘`; break; }
    await onFail(v, picks);
  }
  async function onFail(v: Verdicted, picks: Record<string, string>) {
    if (slip) {
      const s = slip; slip = null;
      const self = roll(`slipfix:${t}`) < Math.max(0.6, le.fromOwnFix);
      let resolvedBy: "self" | "tutor" | "never" = self ? "self" : "tutor";
      if (!self) {
        if (counts.asked >= caps.asks) resolvedBy = "never";
        else { const q = await say("slip", verdictSituation(v), { verdict: VERDICT_KO[v.verdict] ?? v.verdict }); await askTutor(q, ""); }
      } else act();
      key.push({ t, slip: true, layer: s.layer, verdict: v.verdict, resolvedBy, what: s.what });
      return;
    }
    if (!route) return;
    const wrongs = [...new Set([...route.needs.filter((n) => frag(n)?.wrong && holds.has(n)), ...Object.values(picks).filter((p) => frag(p)?.wrong)])];
    if (wrongs.length) {
      const w = wrongs.sort((a, b) => frag(a).layer - frag(b).layer)[0];
      const right = frag(w).right ?? w;
      missed.add(right);
      await react({ kind: "wrong", fragment: w, right, verdict: v.verdict });
      return;
    }
    // 길대로 썼는데 틀림(재현 못 함 · AI 코드) → 튜터에게
    await react({ kind: "wrong", fragment: route.id, verdict: v.verdict });
  }
  key.push({ t, end: ended ?? "cap", why: endWhy, ...(copied ? { copied } : {}) });
  await driver.end(ended ?? "cap", code);
  const verdictNow = codes.filter((c) => c.kind === "submit").at(-1)?.verdict ?? "-";
  return { spec, problem: map.problem, mode, dry: voice.name === "dry", key, start,
    end: { holds: [...holds], learned, copied, verdict: verdictNow, route: route?.id ?? "-" },
    missed: [...missed].filter((m) => frag(m) && !start.holds.includes(m)), used: [...used].filter((u) => !missed.has(u)), slips, slipCodes, counts, codes, calls: [] };
}
