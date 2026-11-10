// 기억 카드 읽기 쉽게 실험 (11/10 사용자 "조건·결과·전제·경계란 워딩이 딱딱하고 이해가 안 됨 … 사람이 카드 읽었을 때 이해하기 쉽게
// 어떻게 처리할지 테스트 돌려 봐, 비용·시간 측정"). 제품 흐름에 넣지 않는다. 결과는 study-gen/<id>/quiz-lab2/<방법>.json.
//   readCode  AI 없이: 모양의 칸을 사람이 읽는 순서로 이어 한 덩어리 글로(칸 이름표 없음)
//   readAI    다 만든 뒤 영역마다 AI 1번(terra low, 동시): 기억마다 처음 보는 사람이 바로 이해하는 설명
import { withTrace } from "../ai/trace.ts";
import { askJson, S } from "../assist/model.ts";
import type { MapCard } from "./material-map.ts";

type Shape = NonNullable<MapCard["shape"]>;
const end = (s: string) => (/[.?!다요]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const has = (s?: string) => Boolean(s && s.trim());

/** 칸 이름표 없이 이어 쓴 글. 경계·한계처럼 따로 기억할 것은 둘째 줄. */
export function readCode(s: Shape): string[] {
  switch (s.form) {
    case "rule": return [`${has(s.premise) ? `${s.premise.trim().replace(/[.]$/, "")}일 때, ` : ""}${s.condition.trim().replace(/[.]$/, "")} → ${end(s.result)}`, ...(has(s.boundary) ? [`딱 경계일 때: ${end(s.boundary)}`] : [])];
    case "formula": return [`${s.expr}`, ...(s.vars.length ? [s.vars.map((v) => `${v.symbol}는 ${v.meaning}`).join(", ")] : []), ...(has(s.when) ? [`이럴 때 써요: ${end(s.when)}`] : [])];
    case "concept": return [end(s.claim), ...(has(s.reason) ? [`왜냐하면 ${end(s.reason)}`] : []), ...(has(s.limit) ? [`단, ${end(s.limit)}`] : [])];
    case "term": return [end(s.definition), ...(s.neighbors.length ? [`헷갈리는 말: ${s.neighbors.join(", ")}`] : [])];
    case "fact": return [end(`${s.subject}: ${s.value}`)];
    case "list": return [s.items.map((x, i) => (s.ordered ? `${i + 1}. ${x}` : `· ${x}`)).join("\n")];
    case "procedure": return [s.steps.map((x, i) => `${i + 1}. ${x.action}${has(x.output) ? ` → ${x.output}` : ""}`).join("\n")];
    case "compare": return [`${s.targets.join(" vs ")}`, ...s.criteria.map((c) => `${c.name}: ${c.values.join(" / ")}`)];
    case "pattern": return [s.frame, ...(has(s.example) ? [`예: ${s.example}`] : [])];
  }
}

const READ_SYSTEM = `강의 자료에서 뽑은 기억 카드들을 받는다. 카드마다, 이 강의를 처음 보는 학생이 한 번 읽고 바로 이해하도록 다시 쓴다.
- 칸 이름(전제·조건·결과·경계 같은 것)을 쓰지 않고, 사람이 설명하듯 이어서 쓴다. 상황을 먼저 그리고, 그 상황에서 무엇을 보고 어떻게 되는지.
- 용어는 처음 나올 때 쉬운 말로 풀어 준다. 원문 용어는 "한국어(영어 원어)"로 남긴다.
- 식·기호·값은 원문 그대로 두고, 그 식이 무엇을 말하는지 말로 덧붙인다.
- 카드에 있는 내용(조건, 결과, 경계, 한계, 식과 조건)을 빠뜨리지 않는다. 카드에 없는 사실을 지어내지 않는다.
- 이해에 도움이 되면 짧은 예를 들어도 된다. 예는 카드의 원문 상황과 같은 내용이어야 한다.
- "~해요" 체. 카드 id는 받은 그대로.`;
const READ_SCHEMA = S.obj({ cards: S.arr(S.obj({ id: S.str, easy: S.str })) });
export const READ_MODEL = { model: "gpt-6.1-terra", effort: "low" };

const cardText = (c: MapCard) => {
  const s = c.shape ? JSON.stringify(c.shape) : "";
  const memo = (c as MapCard & { memo?: { line?: string; facts?: string[] } }).memo;
  return [`[${c.id}] ${c.title} (${c.kind})`, memo?.line ? `요지: ${memo.line}` : "", s ? `모양: ${s}` : "", ...(memo?.facts ?? []).map((f) => `식·조건: ${f}`),
    ...c.quotes.slice(0, 2).map((q) => `원문: ${q}`)].filter(Boolean).join("\n");
};

export async function readAI(id: string, sections: Array<{ title: string; cards: MapCard[] }>) {
  const t0 = Date.now();
  const per = await Promise.all(sections.filter((s) => s.cards.length).map(async (s) => {
    const t = Date.now();
    const r = await withTrace({ area: "pdf", action: "quiz-read", ref: id }, () => askJson<{ cards: Array<{ id: string; easy: string }> }>("map:card-read", READ_SYSTEM,
      `영역: ${s.title}\n\n${s.cards.map(cardText).join("\n\n")}`, READ_SCHEMA, READ_MODEL)).catch(() => ({ cards: [] }));
    return { area: s.title, ms: Date.now() - t, cards: r.cards ?? [] };
  }));
  return { wall: Date.now() - t0, per };
}
