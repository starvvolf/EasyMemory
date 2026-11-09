// 기억 단위 출제 비교 (11/10 사용자 "여러 방법 테스트해서 문제까지 내면서, 제일 좋은 거 하나 골라서 마무리"). 제품 흐름에 넣지 않는다.
// 같은 출제 고리(quiz-plan.ts makeOne: 출제 sol → 따로 풀기 → 엇갈리면 판정 → 한 번 고쳐 쓰기)에 무엇을 묻게 하는지만 바꾼다.
//   nine     기억 하나에 문제 하나, 엔진 9가지 모양으로 방식(formFor 낱장 규칙)
//   five     기억 하나에 문제 하나, 5종류(뜻·나열·비교·순서·적용) — 순서·적용은 깊게(따라가기·상황), 나머지는 구별
//   goals    학습 목표 하나에 문제 하나, 목표 ↔ 기억 잇기(goal-links.ts)로 필요한 기억을 넣는다
// 메인 기억(핵심)만. 결과는 study-gen/<id>/quiz-lab2/<방법>.json, 토큰은 assist-log에서.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { withTrace } from "../ai/trace.ts";
import { costOf } from "../ai/prices.ts";
import { loadGen } from "./gen/runner.ts";
import type { DigestObjective } from "./gen/digest.ts";
import { materialMap, type MapCard } from "./material-map.ts";
import { DEFAULT_QUIZ_OPTIONS, formFor, makeOne, type Form, type MadeQuestion, type PlanItem } from "./quiz-plan.ts";
import { loadGoalLinks, makeGoalLinks } from "./goal-links.ts";

export const LAB2_METHODS = ["nine", "five", "goals", "stem", "design"] as const;
export type Lab2Method = (typeof LAB2_METHODS)[number];
const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");

export const FIVE: Record<string, "뜻" | "나열" | "비교" | "순서" | "적용"> = { 용어: "뜻", 사실: "뜻", 개념: "뜻", 패턴: "뜻", 목록: "나열", 비교: "비교", 절차: "순서", 조건: "적용", 공식: "적용" };
const FIVE_ASK: Record<string, { form: Form; level: number; ask: string }> = {
  뜻: { form: "choice", level: 3, ask: "이 기억의 뜻과 이유를 묻는다: 왜 그런지(원리·까닭)를 고르게. 정의를 살짝 바꾼 보기와 가르게." },
  나열: { form: "choice", level: 3, ask: "원소들 가운데 빠진 것이나 아닌 것을 고르게. 원소 하나가 빠지면 어떻게 되는지 물어도 된다." },
  비교: { form: "choice", level: 3, ask: "같은 상황·입력에서 대상들이 어떻게 다른지, 또는 주어진 설명이 어느 쪽인지 가르게." },
  순서: { form: "short", level: 4, ask: "깊게: 구체적인 값을 주고 단계를 손으로 따라가게(다음 값·찍히는 점·결과를 구한다). 경우(방향·범위)를 바꿔 물어도 된다." },
  적용: { form: "choice", level: 4, ask: "깊게: 상황이나 값을 주고 결과를 내게(판정·계산·분류). 경계 상황이면 더 좋다. 판정의 열쇠는 문제 글에 말하지 않는다." },
};
const VERB: Record<string, { form: Form; level: number }> = { 떠올리기: { form: "choice", level: 2 }, 구별: { form: "choice", level: 3 }, 판정: { form: "choice", level: 4 }, 계산: { form: "short", level: 4 }, 설명: { form: "choice", level: 3 } };

async function callsOf(ref: string, t0: number) {
  await new Promise((r) => setTimeout(r, 500));
  const lines = (await readFile(path.join(dataDir(), "assist-log.jsonl"), "utf8").catch(() => "")).split("\n").slice(-3000);
  return lines.flatMap((l) => { try { const x = JSON.parse(l); return x?.trace?.ref === ref && String(x.trace.action ?? "").startsWith("quiz-") && Date.parse(x.at) >= t0 - 500 ? [x] : []; } catch { return []; } })
    .map((x) => ({ ms: x.ms as number, in: x.tokens?.in ?? 0, out: x.tokens?.out ?? 0, cost: costOf(x.model, { inputTokens: x.tokens?.in, cachedInputTokens: x.tokens?.cached, outputTokens: x.tokens?.out }) ?? 0 }));
}

export async function runQuizLab2(id: string, method: Lab2Method) {
  const state = await loadGen(id);
  const map = state ? materialMap(state, {}) : null;
  if (!state || !map) throw Object.assign(new Error("자료를 찾을 수 없어요."), { status: 404 });
  const texts = (state as unknown as { recaller?: { texts?: Record<string, string> } }).recaller?.texts ?? {};
  if (method === "design") {
    // 시험지 설계 → 문제 쓰기(exam-design.ts), 풀기 검사 없음
    const [{ designExam }, { loadStructure }] = await Promise.all([import("./exam-design.ts"), import("./structure.ts")]);
    const goals = (state as unknown as { recaller?: { digest?: { objectives?: DigestObjective[] } } }).recaller?.digest?.objectives ?? [];
    const t0 = Date.now();
    const r = await designExam(id, map, await loadStructure(id), goals, texts);
    const calls = await callsOf(id, t0);
    const out = { method, id, at: new Date().toISOString(), wall: Date.now() - t0, designMs: r.designMs, items: r.items.length, calls: calls.length,
      tokensIn: calls.reduce((a, c) => a + c.in, 0), tokensOut: calls.reduce((a, c) => a + c.out, 0), cost: calls.reduce((a, c) => a + c.cost, 0), questions: r.items };
    const dir = path.join(dataDir(), "study-gen", id, "quiz-lab2");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${method}.json`), JSON.stringify(out, null, 1));
    return out;
  }
  const all = map.sections.flatMap((s) => s.cards).filter((c) => !c.title.startsWith("흐름: "));
  const byId = new Map(all.map((c) => [c.id, c]));
  const main = all.filter((c) => c.core);
  const topicOf = (c: MapCard) => map.sections.find((s) => s.cards.includes(c))?.title ?? "";
  const items: PlanItem[] = [];
  if (method === "goals") {
    const links = (await loadGoalLinks(id)) ?? await makeGoalLinks(id);
    const goals = (state as unknown as { recaller?: { digest?: { objectives?: DigestObjective[] } } }).recaller?.digest?.objectives ?? [];
    for (const l of links.links) {
      const g = goals.find((x) => x.id === l.goal);
      if (!g || !l.need.length) continue;
      const fl = VERB[g.verb] ?? { form: "choice" as Form, level: 3 };
      items.push({ n: items.length + 1, unit: l.need.length > 1 ? "잇기" : "낱장", name: g.id, cards: l.need, form: fl.form, level: fl.level, topic: "", why: g.text,
        ask: `학습 목표 "${g.text}"를 확인한다.${g.given ? ` 주는 것: ${g.given}. 내는 것: ${g.output ?? ""}.` : ""}${l.confuse.length ? ` 헷갈리게 할 것: ${l.confuse.map((x) => byId.get(x)?.title).filter(Boolean).join(", ")}.` : ""}` });
    }
  } else {
    for (const c of main) {
      if (method === "nine") {
        const fl = formFor("낱장", [c], DEFAULT_QUIZ_OPTIONS, "계산");
        items.push({ n: items.length + 1, unit: "낱장", name: c.title, cards: [c.id], ...fl, ask: "기억 하나의 핵심을 묻는다.", topic: topicOf(c), why: c.kind });
      } else {
        const t = FIVE[c.kind] ?? "뜻";
        items.push({ n: items.length + 1, unit: "낱장", name: c.title, cards: [c.id], ...FIVE_ASK[t], topic: topicOf(c), why: t });
      }
    }
  }
  const t0 = Date.now();
  const limit = 8; const made: MadeQuestion[] = [];
  if (method === "stem") {
    // 제품 경로 그대로(stem-quiz.ts): 목표 문제 → 실제로 안 쓰인 메인 기억 문제
    const { makeStemQuestions } = await import("./stem-quiz.ts");
    const goals = (state as unknown as { recaller?: { digest?: { objectives?: DigestObjective[] } } }).recaller?.digest?.objectives ?? [];
    const r = await makeStemQuestions(id, map, texts, goals);
    items.push(...r.items); made.push(...r.made);
  } else for (let i = 0; i < items.length; i += limit)
    made.push(...await Promise.all(items.slice(i, i + limit).map((it) => withTrace({ area: "pdf", action: "quiz-lab2", ref: id }, () => makeOne(id, map, it, byId, texts, {})))));
  const wall = Date.now() - t0;
  const calls = await callsOf(id, t0);
  const out = { method, id, at: new Date().toISOString(), wall, items: items.length, ok: made.filter((m) => m.ok).length, calls: calls.length,
    tokensIn: calls.reduce((a, c) => a + c.in, 0), tokensOut: calls.reduce((a, c) => a + c.out, 0), cost: calls.reduce((a, c) => a + c.cost, 0),
    held: made.filter((m) => !m.ok).map((m) => `${m.name}: ${m.held}`),
    questions: made.map((m) => ({ n: m.n, name: m.name, kind: m.why, cards: m.cards.map((x) => byId.get(x)?.title ?? x), uses: (m.q?.uses ?? []).map((n) => byId.get(m.cards[n - 1])?.title ?? n), form: m.q?.form, level: m.level, ok: m.ok, stem: m.q?.stem, options: m.q?.options, answer: m.q?.answer, explain: m.q?.explain, solved: m.solved?.answer, steps: m.solved?.steps, fixed: m.fixed, easy: m.easy })) };
  const dir = path.join(dataDir(), "study-gen", id, "quiz-lab2");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${method}.json`), JSON.stringify(out, null, 1));
  return out;
}
export async function quizLab2Api(request: Request, id: string) {
  const { NextResponse } = await import("next/server");
  const m = new URL(request.url).searchParams.get("m") as Lab2Method;
  if (!LAB2_METHODS.includes(m)) return NextResponse.json({ message: `m은 ${LAB2_METHODS.join(", ")}` }, { status: 400 });
  if (request.method === "GET") return NextResponse.json({ result: JSON.parse(await readFile(path.join(dataDir(), "study-gen", id, "quiz-lab2", `${m}.json`), "utf8").catch(() => "null")) });
  return NextResponse.json({ result: await runQuizLab2(id, m) });
}
