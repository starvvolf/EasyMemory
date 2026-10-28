// 지식 카드의 층 (2026-10-28, 사용자 "뜻 한 줄로 이해가 안 되는 사람은?"):
//   뜻 (body)   — 복습 때 떠올릴 답. 일반적인 뜻을 짧게. 만난 문제·글의 사연은 넣지 않는다.
//   예 (example) — 그 뜻이 만난 곳에서 어떻게 쓰였나 ("이 문제에선 이름 → 누적 포인트를 O(1)에").
//   쉽게 풀어 보기 (explainParts) — 학습자가 "설명이 어려워요"를 누르면 그때 만든다: 쉬운 말 + 그 지식에 맞는 칸 1~3개
//   (비유·작은 예·따라가 보기·기호 뜻·예문·이유 단계·다른 데서 …). 한 번 만들면 남는다. 지식창에서 누르면 복습 단계는 그대로(기록만), 복습 중 답 전에 누르면 물어봄.
// runLayer: 아직 나누지 않은 지식을 20개씩 AI 한 번으로 (저장 뒤 자동, 또는 "정리할 것"에서). explainKnowledge: 하나씩.
import { askJson, S } from "../assist/model.ts";
import { getKnowledge, layerKnowledge, pathOf, readAll, recordEvent, sameName, updateKnowledge, KIND_LABEL, type ExplainParts, type Knowledge } from "./store.ts";

const BATCH = 20;
const LAYER_SYSTEM = `학습자의 지식 카드를 정리한다. 카드마다 이름, 종류, 주제, 지금의 뜻, 만난 곳(자료 이름과 그 자료의 문장)이 주어진다.
- meaning: 복습할 때 떠올릴 일반적인 뜻, 한국어 1~2문장. 그 주제의 교과서에서 쓰는 뜻으로.
  - 지금의 뜻에 만난 문제·글의 사연(누구의 점수, 어떤 회사, 문제 속 이름·숫자)이 섞여 있으면 빼고 일반적인 말로.
  - 지금의 뜻이 이미 일반적이고 정확하면 글자를 거의 바꾸지 않는다. 절차·공식은 단계와 식을 그대로 둔다. 수식 표기($...$)도 그대로.
  - 뜻이 비어 있으면 새로 쓴다. 이름을 앞에 되풀이하지 않는다.
- example: 이 지식이 만난 곳에서 어떻게 쓰였는지 한 문장("이 문제에선 이름을 키로 누적 포인트를 O(1)에 찾는다"). 지금의 뜻에서 뺀 사연이 있으면 그것을 옮긴다. 만난 곳이 이 지식을 실제로 쓴 경우가 아니거나 모르면 빈 문자열 "".
- confusion: 처음 배우는 사람이 흔히 헷갈리는 점 한 줄(예: "충돌: 다른 키가 같은 자리로 갈 수 있다"). 지금의 뜻에 "헷갈림:"이 이미 있거나 확실하지 않으면 빈 문자열 "".
- n은 받은 번호를 그대로 쓴다.`;
type Layered = { items: Array<{ n: number; meaning: string; example: string; confusion: string }> };
const LAYER_SCHEMA = S.obj({ items: S.arr(S.obj({ n: S.int, meaning: S.str, example: S.str, confusion: S.str })) });

const sourceLines = (i: Knowledge) => [...new Map(i.sources.map((s) => [s.title, s])).values()].slice(0, 3)
  .map((s) => `${s.title}${s.quote ? ` ("${s.quote.slice(0, 80)}")` : ""}`).join(" / ") || "없음";

/** One run: items not layered yet, newest first, a batch per model call. */
export async function runLayer(options: { ids?: string[]; batches?: number } = {}) {
  let done = 0, calls = 0;
  const changed: string[] = [];
  for (let b = 0; b < (options.batches ?? 1); b++) {
    const { folders, items } = await readAll();
    const todo = items.filter((i) => !i.layered && i.kind && (!options.ids || options.ids.includes(i.id)))
      .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)).slice(0, BATCH);
    if (!todo.length) break;
    const user = todo.map((i, n) => `${n}. ${i.title}${i.aliases.length ? ` (다른 이름: ${i.aliases.slice(0, 4).join(", ")})` : ""} | 종류: ${i.kind ? KIND_LABEL[i.kind] : "?"}`
      + ` | 주제: ${pathOf({ folders }, i.folderId) || "없음"}\n   지금의 뜻: ${i.body.trim().replace(/\n/g, " / ").slice(0, 400) || "(비어 있음)"}\n   만난 곳: ${sourceLines(i)}`).join("\n");
    const data = await askJson<Layered>("knowledge:layer", LAYER_SYSTEM, user, LAYER_SCHEMA);
    calls++;
    const entries = todo.map((i, n) => { const x = (data.items ?? []).find((y) => y.n === n); return { id: i.id, body: x?.meaning, example: x?.example, confusion: x?.confusion }; });
    const r = await layerKnowledge(entries);
    changed.push(...r.changed); done += todo.length;
  }
  const left = (await readAll()).items.filter((i) => !i.layered && i.kind && (!options.ids || options.ids.includes(i.id))).length;
  return { done, changed, left, calls };
}

// 쉽게 풀어 보기 = 모든 지식에 공통인 "쉬운 말" + 그 지식에 도움이 되는 칸 1~3개 (2026-10-28 사용자: "보편적으로 접근하면서도
// 비유나 예, 다른 데서를 넣을 수 있게"). 칸 이름은 정해진 목록에서만 골라 화면이 늘 같은 모양이다.
export const EXPLAIN_LABELS = ["비유", "작은 예", "따라가 보기", "기호 뜻", "숫자 넣어 보기", "헷갈리는 짝", "외우는 요령", "예문", "비슷한 말과 차이", "이유 단계", "조건·예외", "사례", "다른 데서"] as const;
const EXPLAIN_SYSTEM = `학습자가 지식 카드의 뜻만 보고는 이해가 안 된다고 했다. 처음 배우는 사람에게 쉽게 풀어 준다.
- 카드의 뜻은 학습자가 배운 자료(강의·교재·글) 기준이다. 시험도 그 기준으로 나온다. 설명은 그 기준을 먼저 풀어 주고, 자료의 전제가 있으면 밝힌다
  ("강의는 월드 좌표계를 오른손 좌표계로 둔다"). 자료의 말을 고치거나 부정하지 않는다.
- plain: 쉬운 말 2~3문장. 카드의 뜻을 그대로 되풀이하지 말고, 어려운 말을 풀어서 무엇이고 왜 필요한지(또는 왜 그런지)를 말한다.
  복잡도·규칙처럼 조건이 붙는 말은 조건을 밝힌다("평균 O(1)", "정렬돼 있을 때").
- differs: 자료 기준과 다르게 볼 수 있는 일반적인 관점이 정말 있으면 한 문장("다른 설정에서는 월드를 왼손으로 둘 수 있어 반대가 된다"). 없으면 빈 문자열 "". 의심만으로 쓰지 않는다.
- extras: 이 지식을 이해하는 데 가장 도움이 되는 칸 1~3개. label은 아래 목록에서만 고르고, text는 1~3문장(따라가 보기는 짧은 단계 줄 여러 개도 된다).
  ${EXPLAIN_LABELS.join(", ")}
  고르는 기준(정해진 틀이 아니라 도움이 되는 것만): 개념이면 비유·작은 예·다른 데서, 절차·알고리즘이면 작은 입력으로 따라가 보기, 공식이면 기호 뜻·숫자 넣어 보기,
  사실·수치면 헷갈리는 짝·외우는 요령, 외국어 어휘면 예문(뜻 함께)·비슷한 말과 차이, 원리·인과(경제 등)면 이유 단계·조건·예외·사례.
  억지 비유는 넣지 않는다. 만난 곳의 상황을 예로 써도 되지만 "다른 데서"는 다른 상황으로.
  칸은 plain이나 다른 칸에서 이미 한 말을 되풀이하지 않는다(새로 보태는 것이 없으면 칸을 줄인다). 헷갈리는 짝은 서로 헷갈리는 두 가지를 나란히 견줄 때만 쓴다.
  plain은 일반적인 말로 쓰고, 만난 문제·글의 상황은 작은 예나 예문에서만 쓴다.
  조건·예외는 학습자가 정말 자주 틀리는 조건일 때만 고른다(이미 plain이나 뜻의 헷갈림에서 말했으면 고르지 않는다). 자료와 다른 관점은 조건·예외가 아니라 differs에 쓴다.
- see: 이것을 이해하는 데 정말 필요한 더 기본적인 개념 이름 0~3개(해시라면 키와 값, 배열 인덱스, 해시 함수). 그것을 몰라도 이것을 설명할 수 있으면 넣지 않는다. 학습자의 지식 목록에 있으면 그 이름을 그대로.
- 학습자가 따로 물은 것이 있으면 그것을 중심으로 쓴다.`;
type Explained = { plain: string; differs: string; extras: Array<{ label: string; text: string }>; see: string[] };
const PARTS_SCHEMA = S.obj({ plain: S.str, differs: S.str, extras: S.arr(S.obj({ label: S.oneOf(...EXPLAIN_LABELS), text: S.str })), see: S.arr(S.str) });
const joinParts = (p: ExplainParts) => [p.plain, ...p.extras.map((x) => `${x.label}: ${x.text}`), p.differs ? `다른 관점: ${p.differs}` : ""].filter(Boolean).join("\n\n");
type ExplainInput = { title: string; aliases: string[]; body: string; kind?: string; path?: string; example?: string; source?: string; before?: string[]; question?: string; names?: string[] };
/** One explanation, not saved (used by explainKnowledge and the preview that compares kinds). */
export async function makeExplanation(input: ExplainInput) {
  const user = [`[지식] ${input.title}${input.aliases.length ? ` (다른 이름: ${input.aliases.join(", ")})` : ""} | 종류: ${input.kind ? KIND_LABEL[input.kind as keyof typeof KIND_LABEL] ?? input.kind : "?"} | 주제: ${input.path || "없음"}`,
    `[뜻] ${input.body.trim() || "(비어 있음)"}`, input.source ? `[배운 자료] ${input.source}` : "", input.example ? `[만난 곳에서] ${input.example}` : "",
    input.before?.length ? `[이어진 앞선 지식] ${input.before.join(", ")}` : "", input.question?.trim() ? `[학습자가 물은 것] ${input.question.trim().slice(0, 300)}` : "",
    input.names?.length ? `[학습자의 지식 목록 일부] ${input.names.slice(0, 120).join(", ")}` : ""].filter(Boolean).join("\n");
  const data = await askJson<Explained>("knowledge:explain-item", EXPLAIN_SYSTEM, user, PARTS_SCHEMA);
  const parts: ExplainParts = { plain: (data.plain ?? "").trim(), ...(data.differs?.trim() ? { differs: data.differs.trim() } : {}), extras: (data.extras ?? []).filter((x) => (EXPLAIN_LABELS as readonly string[]).includes(x.label) && x.text?.trim()).slice(0, 3).map((x) => ({ label: x.label, text: x.text.trim() })) };
  return { parts, see: (data.see ?? []).slice(0, 3) };
}
export async function explainKnowledge(id: string, question = "", from: "detail" | "review" = "detail") {
  const d = await getKnowledge(id);
  const { items } = await readAll();
  // Items already linked as what to know first (먼저 알 것·조건·상위, or what this one uses): the 먼저 알 것 chips.
  const sureIds = new Set([...d.backlinks.filter((l) => ["먼저", "먼저 알기", "조건", "포함"].includes(l.relation)).map((l) => l.item.id),
    ...d.links.filter((l) => l.relation === "씀").map((l) => l.item.id)]);
  const before = items.filter((i) => sureIds.has(i.id)).map((i) => i.title);
  const SOURCE_NAME: Record<string, string> = { pdf: "강의·교재 PDF", web: "웹 글", code: "코드 문제", chat: "대화", manual: "직접 적음" };
  const source = [...new Map(d.item.sources.map((x) => [x.title, x])).values()].slice(0, 2).map((x) => `${SOURCE_NAME[x.kind] ?? x.kind} 「${x.title}」`).join(", ");
  const made = await makeExplanation({ title: d.item.title, aliases: d.item.aliases, body: d.item.body, kind: d.item.kind, path: d.path, example: d.item.example, source, before, question, names: items.map((i) => i.title) });
  const parts = made.parts;
  const see = made.see.map((name) => { const hit = sameName(items, name); return { title: hit?.title ?? name, id: hit?.id ?? null, sure: Boolean(hit && sureIds.has(hit.id)) }; })
    .filter((q) => q.id !== id);
  // Linked items that the model did not name still show as 먼저 알 것.
  for (const i of items.filter((x) => sureIds.has(x.id) && !see.some((q) => q.id === x.id)).slice(0, 2)) see.unshift({ title: i.title, id: i.id, sure: true });
  const explain = joinParts(parts);
  if (explain) await updateKnowledge(id, { explain, explainParts: parts, explainSee: see });
  // 설명을 본 것과 기억을 못 한 것은 다르다 (2026-10-28 GPT 상의): 지식창에서 누른 것은 기록만, 복습 중 답 전에 누른 것만 물어봄.
  if (from === "review") await recordEvent(id, "asked", question.trim() ? `설명 요청: ${question.trim().slice(0, 120)}` : "답 전에 설명 요청");
  else await recordEvent(id, "note", question.trim() ? `설명 봄: ${question.trim().slice(0, 120)}` : "설명 봄");
  return { explain, parts, see };
}
