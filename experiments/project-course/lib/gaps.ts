// 부족함 원장(2026-11-08 사용자 "모르는 걸 후벼 파야 … 알려준 데서 끝난 게 아니라 다시 확인하는 것까지 절차가 기억 시스템을 통해 갖춰져야"):
// 실습 한 번 동안 드러난 부족함 하나하나에 id를 붙이고, 그 뒤에 일어난 일을 이어 적는다.
//   찾기(어디서 드러났나: 판정 · 막힘 · 목표 정리) → 채우기(처방: 보충 로드맵 · 설명) → 세션 안 확인(그 단위의 다음 판정이 맞음)
//   → 다시 확인(며칠 뒤 그 부족함을 겨냥한 문항, 실습 첫 화면과 앱 복습에서) → 맞으면 간격을 늘리고, 틀리면 다시 열린다
// 상태는 코드가 정한다(판정 결과 · 버튼 · 시각). AI는 부족함의 말(무엇을 잘못 알았나)과 재확인 문항만 만든다.
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DATA, read, update } from "./store.ts";

export type GapFrom = "판정" | "막힘" | "목표 정리" | "선행 확인";
export type GapStatus = "열림" | "채우는 중" | "세션에서 채움" | "다시 확인 맞음" | "다시 틀림";
export type Unit = { id: string; title: string; done: string; support?: boolean };
export type Recheck = { q: string; a: string };
export type Gap = {
  id: string; runId: string;
  goal: { id: string; title: string };            // 이 부족함이 드러난 현재 목표(보충 중이면 그 보충의 종착지)
  unit: Unit;                                       // 드러난 단위(현재 목표 또는 보충 단계)
  concept: string; type: string;                    // 지식 이름 · 여섯 칸(목표 정리 뒤에 채워짐, 그 전엔 단위 이름)
  wrong: string; right: string;                     // 무엇을 잘못 알았나 · 바로 알 것
  cause: string[];                                  // 학습자가 고른 막힌 이유(막힘에서만)
  evidence: { at: string; from: GapFrom | "다시 확인"; text: string }[];
  remedy: { at: string; kind: "보충" | "설명"; text: string }[];
  code?: { file: string; from: number; to: number; code: string };
  status: GapStatus;
  filledAt?: string; fillEvidence?: string;
  recheck?: Recheck;
  /** 목표 정리가 같은 부족함으로 묶은 것(11/8 실측: 판정 · 막힘 두 칸이 같은 문항을 두 번): 다시 확인은 묶인 첫 칸에서만 */
  mergedInto?: string;
  /** 선행(11/10): 지금 목표 아래 먼저 알아야 할 것이 비어서 생긴 부족함이면 그 이름 */
  prereq?: string;
  /** 실습 기억 카드(11/10): 상황 · 다음엔 · 어떻게 알게 됐나 */
  card?: { situation: string; next: string; how: string };
  checks: { at: string; answer: string; verdict: string; note: string }[];
  dueAt?: string; box: number;
  at: string;
};
type Ledger = { gaps: Gap[] };
const file = (runId: string) => path.join(DATA, "gaps", `${runId}.json`);
const now = () => new Date().toISOString();
const empty = (): Ledger => ({ gaps: [] });
export const ledgerOf = async (runId: string) => (await read<Ledger>(file(runId), empty())).gaps;
const DAY = 86_400_000;
/** 다시 확인 간격(일): 맞을 때마다 한 칸씩. 틀리면 1일부터 다시 */
export const RECHECK_DAYS = [1, 3, 7, 16, 35];
const dueFrom = (box: number, at = Date.now()) => new Date(at + RECHECK_DAYS[Math.min(box, RECHECK_DAYS.length - 1)] * DAY).toISOString();
const clean = (s: unknown, n = 400) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const open = (g: Gap) => g.status === "열림" || g.status === "채우는 중" || g.status === "다시 틀림";

/** 부족함을 연다. 같은 단위에 아직 안 채워진 같은 출처의 부족함이 있으면 근거만 더한다(같은 걸 여러 번 틀린 것) */
const keyOf = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
/** 선행 단위: 같은 목표에서 같은 선행은 한 칸 */
export const prereqUnit = (goalId: string, name: string): Unit => ({ id: `pre:${goalId}:${keyOf(name).slice(0, 60)}`, title: `먼저 알 것: ${clean(name, 60)}`, done: "" });
export async function openGap(runId: string, x: { goal: { id: string; title: string }; unit: Unit; from: GapFrom; wrong: string; right?: string; quote?: string; cause?: string[]; prereq?: string }) {
  let out: Gap | null = null;
  await update<Ledger>(file(runId), empty(), (l) => {
    // 같은 단계에서 아직 안 채워진 부족함은 판정에서 왔든 막힘에서 왔든 하나로(11/9 시험: 같은 단계의 판정 · 막힘이 처방 · 근거가 같은 두 칸으로 남음)
    const same = l.gaps.find((g) => g.unit.id === x.unit.id && (g.status === "열림" || g.status === "채우는 중"));
    const ev = { at: now(), from: x.from, text: clean([x.wrong, x.quote ? `학습자: "${clean(x.quote, 300)}"` : "", x.cause?.length ? `고른 이유: ${x.cause.join(", ")}` : ""].filter(Boolean).join(" · "), 700) };
    if (same) { same.evidence.push(ev); if (x.wrong) same.wrong = clean(x.wrong); for (const c of x.cause ?? []) if (!same.cause.includes(c)) same.cause.push(c); out = same; return; }
    const g: Gap = { id: `G${l.gaps.length + 1}-${randomBytes(2).toString("hex")}`, runId, goal: x.goal, unit: x.unit, concept: x.prereq ? clean(x.prereq, 60) : x.unit.title, type: "", wrong: clean(x.wrong), right: clean(x.right ?? ""),
      cause: x.cause ?? [], evidence: [ev], remedy: [], status: "열림", checks: [], box: 0, at: now(), ...(x.prereq ? { prereq: clean(x.prereq, 60) } : {}) };
    l.gaps.push(g); out = g;
  });
  return out as Gap | null;
}
/** 처방을 붙인다: 그 목표에서 열린 부족함 → 그 보충 로드맵 */
export async function addRemedy(runId: string, goalId: string, kind: "보충" | "설명", text: string) {
  await update<Ledger>(file(runId), empty(), (l) => {
    for (const g of l.gaps) if (g.goal.id === goalId && open(g)) { g.remedy.push({ at: now(), kind, text: clean(text, 500) }); if (g.status === "열림") g.status = "채우는 중"; }
  });
}
/** 단위의 판정이 맞음 → 그 단위에 열린 부족함은 세션에서 채워진 것으로(근거: 맞은 답) */
export async function fillUnit(runId: string, unitId: string, evidence: string) {
  const filled: string[] = [];
  await update<Ledger>(file(runId), empty(), (l) => {
    for (const g of l.gaps) if (g.unit.id === unitId && (g.status === "열림" || g.status === "채우는 중")) {
      g.status = "세션에서 채움"; g.filledAt = now(); g.fillEvidence = clean(evidence, 600); g.box = 0; g.dueAt = dueFrom(0); filled.push(g.id);
    }
  });
  return filled;
}

/** 목표가 맞으면(보충 밖) 그 목표에서 열린 선행 부족함도 채운 것으로 */
export async function fillPrereqs(runId: string, goalId: string, evidence: string) {
  const filled: string[] = [];
  await update<Ledger>(file(runId), empty(), (l) => {
    for (const g of l.gaps) if (g.goal.id === goalId && g.prereq && (g.status === "열림" || g.status === "채우는 중")) {
      g.status = "세션에서 채움"; g.filledAt = now(); g.fillEvidence = clean(`목표를 해냄: ${evidence}`, 600); g.box = 0; g.dueAt = dueFrom(0); filled.push(g.id);
    }
  });
  return filled;
}

/**
 * 부족함의 원인 → 채우는 방법 → 다시 확인하는 꼴(11/8 사용자 "이게 부족하면 이거, 이거 부족하면 이거 … 매칭").
 * 원인은 [너무 어려워요]의 6가지(goals.ts STUCK_REASONS)와 같은 말. 판정에서 드러난 것은 원인을 모르니 "틀린 지점 그대로"로 본다.
 * 튜터(보충 로드맵)와 목표 정리(재확인 문항)가 같은 표를 본다.
 */
export const CAUSE_PLAN: { cause: string; fill: string; recheck: string }[] = [
  { cause: "무엇을 하라는 건지(과제 · 완료 조건)를 모르겠어요", fill: "과제를 더 작은 할 일로 쪼개고 완료 조건을 예로 보여 준다", recheck: "비슷한 과제를 주고 무엇을 해야 끝인지 자기 말로 말하게" },
  { cause: "설명에 나온 개념 · 용어를 몰라요", fill: "그 말의 뜻을 작은 예 하나로 먼저", recheck: "그 개념이 들어간 짧은 코드나 상황의 결과를 예측하게" },
  { cause: "알겠는데 코드(문법)로 못 옮기겠어요", fill: "빈칸 한두 개짜리 코드로 옮기는 연습", recheck: "한두 줄을 직접 쓰거나 고치게" },
  { cause: "어디서부터 어떤 순서로 할지 모르겠어요", fill: "단계를 순서대로 나눠 하나씩", recheck: "단계를 순서대로 말하거나 코드가 지나가는 순서를 따라가게" },
  { cause: "코드를 썼는데 오류가 나거나 결과가 달라요", fill: "실제로 돌려 오류 · 값을 보고 원인을 같이 찾기", recheck: "비슷한 코드의 오류나 출력을 예측하고 이유를 말하게" },
  { cause: "앞에서 배운 게 기억이 안 나요", fill: "앞에서 배운 것을 먼저 떠올리게 하고 짧게 다시", recheck: "앞에서 배운 것을 힌트 없이 떠올려 설명하게" },
];
const planOf = (cause: string[]) => CAUSE_PLAN.filter((p) => cause.includes(p.cause));
/** 목표 정리 호출에 보낼 것: 이 목표 동안 원장에 잡힌 부족함(정리가 이름을 붙이고 재확인 문항을 만든다) */
export async function gapsForRecord(runId: string, goalId: string, verdicts: string[] = []) {
  const gs = (await ledgerOf(runId)).filter((g) => g.goal.id === goalId);
  // 판정 기록(11/8 실측: 정리가 판정을 몰라 틀린 답을 "배운 것"의 근거로 씀)
  const vline = verdicts.length ? `[이 목표 동안 [해 봤어요] 판정 — 틀림 · 일부만 맞음으로 판정된 답은 배운 것의 근거로 쓰지 않는다]\n${verdicts.join("\n")}\n\n` : "";
  if (!gs.length) return vline.trim();
  return `${vline}[이 목표 동안 Recaller가 잡은 부족함 — 정리할 때 같은 것이면 ids에 그 id를 넣는다]\n${gs.map((g) => `${g.id} (${g.evidence.map((e) => e.from).join("·")}, ${g.status}) 단위 "${g.unit.title}": ${g.wrong}${g.cause.length ? ` · 막힌 이유: ${g.cause.join(", ")} → 재확인 꼴: ${planOf(g.cause).map((p) => p.recheck).join(" / ") || "틀린 지점 그대로"}` : " · 재확인 꼴: 틀렸던 그 지점을 이름 · 값만 바꿔 다시"}${g.remedy.length ? ` · 처방: ${g.remedy.map((r) => r.text).join(" / ")}` : ""}${g.fillEvidence ? ` · 채운 근거: ${g.fillEvidence}` : ""}`).join("\n")}`;
}
/** 목표 정리 결과(gaps)를 원장에 합친다: ids로 이은 것은 이름 · 칸 · 바로 알 것 · 코드 · 재확인 문항을 채우고, 원장에 없던 것은 "목표 정리"로 새로 연다 */
export async function mergeRecord(runId: string, goal: { id: string; title: string; done: string }, recGaps: { type: string; concept: string; wrong: string; right: string; quote: string; ids?: string[]; recheck?: Recheck; code?: { file: string; from: number; to: number; code: string } | null; prereq?: boolean; card?: { situation: string; next: string; how: string } }[], endAt: string) {
  await update<Ledger>(file(runId), empty(), (l) => {
    for (const r of recGaps) {
      // ids로 이은 것, 없으면 같은 목표에서 같은 이름으로 이미 연 것(다시 정리할 때 같은 부족함이 새로 생기지 않게)
      const byIds = l.gaps.filter((g) => (r.ids ?? []).includes(g.id) && g.goal.id === goal.id);
      const linked = byIds.length ? byIds : l.gaps.filter((g) => g.goal.id === goal.id && g.type && clean(g.concept, 80).toLowerCase() === clean(r.concept, 80).toLowerCase()).slice(0, 1);
      const targets = linked.length ? linked : [(() => {
        const g: Gap = { id: `G${l.gaps.length + 1}-${randomBytes(2).toString("hex")}`, runId, goal: { id: goal.id, title: goal.title }, unit: { id: goal.id, title: goal.title, done: goal.done }, concept: "", type: "", wrong: "", right: "",
          cause: [], evidence: [{ at: endAt, from: "목표 정리", text: clean([r.wrong, r.quote ? `학습자: "${clean(r.quote, 300)}"` : ""].filter(Boolean).join(" · "), 700) }], remedy: [], status: "열림", checks: [], box: 0, at: endAt };
        // 카드(11/10): 도움 받고 됨 · 틀렸다 고침은 세션 안에서는 됐다 → 채움(다시 확인은 잡는다), 아직 모름만 열림
        if (r.card && (r.card.how === "도움 받고 됨" || r.card.how === "틀렸다 고침")) { g.status = "세션에서 채움"; g.filledAt = endAt; g.fillEvidence = `목표 정리: ${r.card.how}`; }
        l.gaps.push(g); return g;
      })()];
      for (const [i, g] of targets.entries()) {
        if (i > 0) g.mergedInto = targets[0].id; else delete g.mergedInto;
        // 이미 이름이 붙은 칸은 이름을 바꾸지 않는다(다시 정리해도 같은 지식 하나로)
        if (!g.type) { g.concept = clean(r.concept, 80) || g.concept; g.type = r.type || g.type; }
        if (r.wrong) g.wrong = clean(r.wrong); if (r.right) g.right = clean(r.right, 600);
        if (r.code?.code) g.code = { file: r.code.file, from: r.code.from, to: r.code.to, code: r.code.code.slice(0, 1500) };
        if (r.recheck?.q && r.recheck?.a) g.recheck = { q: clean(r.recheck.q, 1200), a: clean(r.recheck.a, 600) };
        if (r.card) g.card = { situation: clean(r.card.situation, 160), next: clean(r.card.next, 200), how: clean(r.card.how, 20) };
        if (r.prereq && !g.prereq) g.prereq = g.concept;
        // 세션 안에서 채움 확인을 못 한 것도 다시 확인 날짜는 잡는다(알려 준 데서 끝나지 않게)
        if (!g.dueAt) { g.box = 0; g.dueAt = dueFrom(0, Date.parse(endAt) || Date.now()); }
      }
    }
  });
}

/* ---------- 다시 확인 ---------- */
/** 모든 실습의 다시 확인할 것(재확인 문항이 있는 것만). due: 날짜가 된 것만 */
export async function rechecks(opts: { due?: boolean; at?: number } = {}) {
  const { readdir } = await import("node:fs/promises");
  const names = await readdir(path.join(DATA, "gaps")).catch(() => [] as string[]);
  const all: Gap[] = [];
  for (const n of names) if (n.endsWith(".json")) all.push(...(await ledgerOf(n.slice(0, -5))));
  const t = opts.at ?? Date.now();
  return all.filter((g) => g.recheck && !g.mergedInto && (!opts.due || !g.dueAt || Date.parse(g.dueAt) <= t))
    .sort((a, b) => (a.status === "다시 틀림" ? -1 : 0) - (b.status === "다시 틀림" ? -1 : 0) || String(a.dueAt).localeCompare(String(b.dueAt)));
}
export const RECHECK_SYSTEM = `학습자가 예전에 부족했던 것을 다시 확인하는 문항의 답을 채점한다. 문항 · 모범답 · 학습자가 예전에 잘못 알았던 것을 보고, 학습자의 답만으로 판단한다.
verdict: correct(핵심이 맞음, 예전 오해가 보이지 않음) · partial(일부만 맞거나 뭉뚱그림) · incorrect(틀림, 특히 예전과 같은 오해가 다시 보이면) · unclear(모르겠다 · 빈 답 · 판단 근거 부족).
same_mistake: 예전에 잘못 알았던 것과 같은 오해가 다시 보이면 true.
note: 학습자에게 보여 줄 한두 문장(해요체). 맞으면 짧게 확인, 아니면 어디가 어긋났는지와 바로 알 것을 담백하게.`;
/** 다시 확인 답을 받아 채점 결과로 상태 · 다음 날짜를 정한다(채점은 grade 함수가, 상태는 여기 코드가) */
export async function answerRecheck(runId: string, gapId: string, answer: string, grade: (g: Gap) => Promise<{ verdict: string; same_mistake: boolean; note: string }>) {
  const g0 = (await ledgerOf(runId)).find((g) => g.id === gapId);
  if (!g0?.recheck) throw Object.assign(new Error("다시 확인할 문항이 없어요."), { status: 404 });
  const a = clean(answer, 3000);
  const v = a ? await grade(g0) : { verdict: "unclear", same_mistake: false, note: "답이 비어 있어요. 기억나는 만큼 적어 보세요." };
  let out: Gap | null = null;
  await update<Ledger>(file(runId), empty(), (l) => {
    const g = l.gaps.find((x) => x.id === gapId)!;
    g.checks.push({ at: now(), answer: a, verdict: v.verdict, note: clean(v.note, 400) });
    if (v.verdict === "correct") { g.status = "다시 확인 맞음"; g.box = Math.min(g.box + 1, RECHECK_DAYS.length - 1); g.dueAt = dueFrom(g.box); }
    // "모르겠어요"도 못 떠올린 것(검토 11/8: unclear면 아무것도 안 바뀌어 다시 열리지 않던 것). 빈 답만 그대로 둔다
    else if (a) { g.status = "다시 틀림"; g.box = 0; g.dueAt = dueFrom(0); g.evidence.push({ at: now(), from: "다시 확인", text: clean(`${v.verdict}${v.same_mistake ? " · 같은 오해" : ""}: ${a}`, 600) }); }
    out = g;
  });
  return { gap: out as Gap | null, verdict: v };
}
/** 다음 실습 맥락: 다시 틀린 것 중 가장 최근 3개(튜터가 이어서 채울 수 있게) */
export async function refailedContext() {
  const gs = (await rechecks()).filter((g) => g.status === "다시 틀림").slice(0, 3);
  return gs.length ? `[예전 실습에서 다시 확인했는데 또 틀린 것 — 지금 목표와 이어지면 짚어 준다]\n${gs.map((g) => `- ${g.concept}: ${g.wrong}`).join("\n")}` : "";
}

/** 다시 확인 채점(AI 한 번, low). 상태 · 날짜는 answerRecheck(코드)가 */
export async function gradeRecheck(g: Gap, answer: string) {
  const { aiJson, S } = await import("./ai.ts");
  const user = `[문항]\n${g.recheck!.q}\n\n[모범답]\n${g.recheck!.a}\n\n[학습자가 예전에 잘못 알았던 것]\n${g.wrong}\n\n[학습자 답]\n${answer}`;
  return aiJson<{ verdict: string; same_mistake: boolean; note: string }>("recheck-grade", RECHECK_SYSTEM, user, S.obj({ verdict: S.oneOf("correct", "partial", "incorrect", "unclear"), same_mistake: S.bool, note: S.str }));
}
/** 화면용(모범답은 답한 뒤에만) */
export const recheckView = (g: Gap) => ({ runId: g.runId, id: g.id, concept: g.concept, goal: g.goal.title, q: g.recheck?.q ?? "", status: g.status, dueAt: g.dueAt ?? null, tries: g.checks.length, wrong: g.wrong });

/* ---------- 세션 노트(11/8 사용자 "그 학습 세션에서 어떤 거를 배웠다를 잘 정리할 수 있다면 그것만으로도 좋다") ---------- */
/** 학습 한 번 = 제목(장기 목표) · 태그(나온 지식 이름) · 목표마다 요약 · 배운 것 · 부족함(어디서 드러났고 · 무엇으로 채웠고 · 확인됐는지 · 다시 확인 문항) */
export async function sessionNote(runId: string) {
  const { goalsOf } = await import("./goals.ts");
  const { recordsOf } = await import("./goal-record.ts");
  const g = await goalsOf(runId), recs = await recordsOf(runId), gaps = await ledgerOf(runId);
  const tags = new Map<string, number>();
  for (const r of recs) for (const x of [...r.learned, ...(r.gaps ?? [])]) tags.set(x.concept, (tags.get(x.concept) ?? 0) + 1);
  for (const x of gaps) if (x.type) tags.set(x.concept, (tags.get(x.concept) ?? 0) + 2);
  const count = (st: GapStatus[]) => gaps.filter((x) => !x.mergedInto && st.includes(x.status)).length;
  return {
    runId, title: g.long?.text ?? "목표를 정하기 전", mode: g.mode, at: g.long?.at ?? null,
    tags: [...tags].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t),
    map: g.map.map((m) => ({ title: m.title, status: m.status, support: !!m.support })),
    goals: recs.map((r) => ({ goal: r.goal, done: r.done, status: r.status, summary: r.summary, steps: r.steps, learned: r.learned.map((x) => ({ type: x.type, concept: x.concept, meaning: x.meaning, how: x.how })) })),
    // 묶인 칸(mergedInto)은 첫 칸에 합쳐 한 줄로: 드러난 곳 · 고른 이유를 더한다
    gaps: gaps.filter((x) => !x.mergedInto).map((x0) => { const extra = gaps.filter((y) => y.mergedInto === x0.id); return { ...x0, evidence: [...x0.evidence, ...extra.flatMap((y) => y.evidence)], cause: [...new Set([...x0.cause, ...extra.flatMap((y) => y.cause)])] }; }).map((x) => ({ id: x.id, goal: x.goal.title, unit: x.unit.title, concept: x.type ? x.concept : "", type: x.type, prereq: x.prereq ?? "", card: x.card ?? null, wrong: x.wrong, right: x.right, cause: x.cause,
      from: [...new Set(x.evidence.map((e) => e.from))], evidence: x.evidence.map((e) => e.text).slice(-4), remedy: x.remedy.map((r) => `${r.kind}: ${r.text}`), status: x.status,
      fillEvidence: x.fillEvidence ?? "", code: x.code ?? null, recheck: x.recheck?.q ?? "", dueAt: x.dueAt ?? null, checks: x.checks })),
    // 지나온 목표 길(11/9): 목표마다 그 안의 일 + 그 목표에서 드러난 부족함 · 정리에서 남긴 지식(이름으로 맞춤)
    path: (await import("./goal-path.ts")).goalPath(g.log, g.current).map((p) => ({ ...p,
      gaps: gaps.filter((x) => !x.mergedInto && x.goal.title === p.title).map((x) => ({ id: x.id, name: x.type ? `${x.prereq ? "먼저 알 것: " : ""}${x.concept}` : x.unit.title, wrong: x.wrong, status: x.status })),
      learned: recs.filter((r) => r.goal === p.title).flatMap((r) => r.learned.map((x) => x.concept)) })),
    counts: { all: gaps.filter((x) => !x.mergedInto).length, filled: count(["세션에서 채움", "다시 확인 맞음"]), open: count(["열림", "채우는 중", "다시 틀림"]), rechecked: count(["다시 확인 맞음"]) },
  };
}
