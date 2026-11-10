// 플래시카드 → 한 번 더(OX · 객관식) 실험 (11/11 사용자 "OX랑 객관식으로 쓸 수 있는 애들은 그쪽으로 한 번 더" →
// "코드가 정하면 문제 안 생김? 헷갈림이 여러 개인 경우가 많음? 걍 AI한테 기준 예시 주고 하나 고르게 하는 게 나을 듯" → "둘 다 해 봐 테스트").
//   quickCode  코드가 카드마다 형식을 정한다(헷갈림 2개 이상·이웃 용어·목록·비교 → 객관식, 헷갈림 1개 → OX, 없음 → 안 냄). AI는 그 형식으로 쓰기만.
//   quickAI    AI가 기준과 예시를 보고 카드마다 OX · 객관식 · 안 냄을 고르고 쓴다.
// 둘 다 영역마다 terra low 1번(동시) → 코드 점검 → 따로 풀기(terra low, 영역마다 1번, 답 가림)로 답이 갈리는지 본다. 제품 흐름에 넣지 않는다.
import { askJson, S } from "../assist/model.ts";
import { withTrace } from "../ai/trace.ts";
import type { MapCard, MaterialMap } from "./material-map.ts";

export const QUICK_MODEL = { model: "gpt-6.1-terra", effort: "low" };
type Form = "ox" | "choice" | "none";
type Item = { card: string; form: Form; why: string; statement: string; truth: string; stem: string; options: string[]; correct: number; explain: string; sources: string[] };

const memo = (c: MapCard) => (c as MapCard & { memo?: { question?: string; line?: string; idea?: string; facts?: string[]; details?: string[]; role?: string } }).memo ?? {};
const cardText = (c: MapCard) => { const m = memo(c); return [`[${c.id}] ${c.title} (${c.kind}${m.role ? `, ${m.role}` : ""})`, m.question ? `  질문: ${m.question}` : "", m.line ? `  답: ${m.line}` : "", m.idea ? `  풀이: ${m.idea}` : "",
  c.shape ? `  모양: ${JSON.stringify(c.shape)}` : "", ...(m.facts ?? []).map((f) => `  핵심: ${f}`), ...c.mistakes.map((x) => `  헷갈림: ${x}`)].filter(Boolean).join("\n"); };

const COMMON = `받는 것: 한 영역의 기억 카드(질문 · 답 · 풀이 · 모양 · 핵심 · 학생이 헷갈리는 점). 학생은 이 카드를 플래시카드로 한 번 떠올린 뒤, "안다"고 한 카드에 대해 한 번 더 확인 문제를 푼다.
문제 규칙:
- 정답은 카드 내용만으로 정해져야 한다. 카드에 없는 사실로 정답이나 오답을 정하지 않는다.
- OX: statement는 주장 하나만 담은 한 문장(두 주장을 이어 붙이지 않는다). truth는 "O" 또는 "X". X 문장은 학생이 실제로 할 법한 틀린 생각이어야 하고(헷갈림이 좋은 출발점), O 문장은 카드의 핵심을 그대로 베끼지 않고 다른 말로.
- 객관식: stem은 질문 하나, options는 보기 넷, correct는 정답 보기의 번호(0부터). 오답은 그럴듯해야 한다: 헷갈림, 헷갈리는 이웃 용어, 카드 안의 다른 값·경우·대상에서 가져온다. "모두 맞다"·"없다" 보기는 쓰지 않는다. 보기 길이와 말투를 비슷하게.
- sources: 보기(또는 OX 문장)마다 어디서 왔는지 — "정답", "헷갈림: …", "이웃: …", "카드의 다른 값: …" 처럼. explain: 왜 그것이 답인지 한두 문장.
- 쓰지 않는 칸은 빈 문자열·빈 배열·correct -1. 카드 id는 받은 그대로. "~다" 체 문장, 식은 $…$.`;
const ITEM = S.obj({ card: S.str, form: S.oneOf("ox", "choice", "none"), why: S.str, statement: S.str, truth: S.str, stem: S.str, options: S.arr(S.str), correct: S.int, explain: S.str, sources: S.arr(S.str) });
const SCHEMA = S.obj({ items: S.arr(ITEM) });

export const QUICK_CODE_SYSTEM = `너는 이 강의의 복습 문제를 쓰는 사람이다. 카드마다 정해 준 형식(ox · choice)으로 확인 문제 하나를 쓴다. 형식이 none인 카드는 form none으로 두고 비운다.\n${COMMON}`;
export const QUICK_AI_SYSTEM = `너는 이 강의의 복습 문제를 쓰는 사람이다. 카드마다 한 번 더 확인할 문제로 OX · 객관식 · 안 냄 가운데 가장 맞는 하나를 고르고(why에 까닭 한 줄), 골랐으면 쓴다.
고르는 기준:
- OX가 어울릴 때: 참·거짓이 한 문장으로 분명히 갈리는 사실·조건·경계가 있고, 그 반대를 그럴듯하게 믿는 오개념이 있을 때. 예) 규칙의 경계("값이 같을 때도 포함된다"), 원인과 결과의 방향("A가 커지면 B는 작아진다"), 흔한 오해("X이면 반드시 Y다").
- 객관식이 어울릴 때: 같은 질문에 그럴듯한 오답이 여럿 나올 때. 예) 정의에 맞는 용어를 헷갈리는 이웃 용어들 사이에서 고르기, 목록에서 속하지 않는 것 고르기, 둘 이상을 견주는 성질이 어느 쪽인지, 주어진 상황의 판정·결과가 갈래 중 어느 것인지.
- 안 낼 때: 답이 계산 과정이나 서술이어야 해서 고르기로 바꾸면 핵심이 사라지거나, 그럴듯한 오답이 나오지 않아 너무 쉬워질 때.
${COMMON}`;

/** 코드 규칙: 헷갈림 2개 이상 · 이웃 용어 · 목록 · 비교 → 객관식, 헷갈림 1개 → OX, 그 밖 → 안 냄. */
export function codeForm(c: MapCard): Form {
  const s = c.shape as { form?: string; neighbors?: string[] } | undefined;
  if (c.mistakes.length >= 2 || (s?.form === "term" && (s.neighbors?.length ?? 0) >= 2) || s?.form === "list" || s?.form === "compare") return "choice";
  if (c.mistakes.length === 1) return "ox";
  return "none";
}

/** 코드 점검. 걸린 까닭(없으면 빈 배열). */
export function checkItem(it: Item): string[] {
  const bad: string[] = [];
  if (it.form === "ox") {
    if (!it.statement.trim()) bad.push("OX 문장 없음");
    if (!/^[OX]$/.test(it.truth.trim())) bad.push("OX 답이 O/X가 아님");
    if (/(그리고|또한|이며|이고)\s/.test(it.statement) && it.statement.length > 70) bad.push("OX에 주장 둘?");
  } else if (it.form === "choice") {
    if (!it.stem.trim()) bad.push("발문 없음");
    if (it.options.length < 3) bad.push("보기가 적음");
    if (new Set(it.options.map((o) => o.replace(/\s+/g, ""))).size !== it.options.length) bad.push("보기 겹침");
    if (!(it.correct >= 0 && it.correct < it.options.length)) bad.push("정답 번호 틀림");
    if (it.options.some((o) => /모두|없다$|없음$|이상 모두/.test(o.trim()))) bad.push("모두/없음 보기");
    const lens = it.options.map((o) => o.length); if (lens.length && Math.max(...lens) > Math.min(...lens) * 3 + 10) bad.push("보기 길이 차이 큼");
  }
  return bad;
}

const SOLVE_SYSTEM = `기억 카드들과, 그 카드로 만든 확인 문제들을 받는다(정답은 가려져 있다). 카드 내용만으로 문제마다 답을 고른다. OX면 "O"/"X", 객관식이면 보기 번호(0부터). 카드로 답이 하나로 정해지지 않으면 ambiguous true와 까닭.`;
const SOLVE_SCHEMA = S.obj({ answers: S.arr(S.obj({ n: S.int, answer: S.str, ambiguous: { type: "boolean" }, note: S.str })) });

export async function runQuick(id: string, map: MaterialMap, method: "quickCode" | "quickAI") {
  const t0 = Date.now();
  const sections = map.sections.map((s) => ({ title: s.title, cards: s.cards.filter((c) => !c.title.startsWith("흐름: ")) })).filter((s) => s.cards.length);
  const per = await Promise.all(sections.map(async (sec) => {
    const t = Date.now();
    const plan = method === "quickCode" ? sec.cards.map((c) => `- ${c.id}: ${codeForm(c)}`).join("\n") : "";
    const user = `영역: ${sec.title}\n\n${sec.cards.map(cardText).join("\n\n")}${plan ? `\n\n[카드마다 정한 형식]\n${plan}` : ""}`;
    const r = await withTrace({ area: "pdf", action: "quiz-quick", ref: id }, () => askJson<{ items: Item[] }>(`lab:${method}`, method === "quickCode" ? QUICK_CODE_SYSTEM : QUICK_AI_SYSTEM, user, SCHEMA, QUICK_MODEL)).catch((e) => ({ items: [] as Item[], error: String(e) }));
    const items = (r.items ?? []).filter((x) => sec.cards.some((c) => c.id === x.card));
    // 코드 방식이면 코드가 정한 형식을 따랐는지
    const followed = method === "quickCode" ? items.filter((x) => x.form === codeForm(sec.cards.find((c) => c.id === x.card)!)).length : null;
    // 따로 풀기
    const asked = items.filter((x) => x.form !== "none" && !checkItem(x).length);
    const q = asked.map((x, n) => x.form === "ox" ? `${n}. [OX] ${x.statement}` : `${n}. [객관식] ${x.stem}\n${x.options.map((o, k) => `   ${k}) ${o}`).join("\n")}`).join("\n\n");
    const solved = asked.length ? await withTrace({ area: "pdf", action: "quiz-quick-solve", ref: id }, () => askJson<{ answers: Array<{ n: number; answer: string; ambiguous: boolean; note: string }> }>("lab:quick-solve", SOLVE_SYSTEM,
      `[카드]\n${sec.cards.map(cardText).join("\n\n")}\n\n[문제]\n${q}`, SOLVE_SCHEMA, QUICK_MODEL)).catch(() => ({ answers: [] })) : { answers: [] };
    const graded = asked.map((x, n) => { const a = solved.answers.find((y) => y.n === n); const want = x.form === "ox" ? x.truth.trim() : String(x.correct);
      return { card: x.card, form: x.form, agree: a ? a.answer.trim().replace(/\D*(\d+).*/, "$1").replace(/^([OX]).*/i, (m) => m[0].toUpperCase()) === want : false, ambiguous: a?.ambiguous ?? false, note: a?.note ?? "" }; });
    return { area: sec.title, ms: Date.now() - t, cards: sec.cards.length, items, followed, graded, error: (r as { error?: string }).error };
  }));
  const items = per.flatMap((p) => p.items.map((x) => ({ ...x, problems: checkItem(x) })));
  const graded = per.flatMap((p) => p.graded);
  const count = (f: Form) => items.filter((x) => x.form === f).length;
  return { method, wall: Date.now() - t0, cards: per.reduce((a, p) => a + p.cards, 0), ox: count("ox"), choice: count("choice"), none: count("none"),
    failedChecks: items.filter((x) => x.form !== "none" && x.problems.length).map((x) => ({ card: x.card, form: x.form, problems: x.problems })),
    solved: graded.length, agree: graded.filter((g) => g.agree && !g.ambiguous).length, disagree: graded.filter((g) => !g.agree || g.ambiguous).map((g) => ({ card: g.card, form: g.form, ambiguous: g.ambiguous, note: g.note })),
    followed: method === "quickCode" ? per.reduce((a, p) => a + (p.followed ?? 0), 0) : null, per: per.map((p) => ({ area: p.area, ms: p.ms, error: p.error })), items };
}
