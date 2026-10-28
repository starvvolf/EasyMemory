// 지식 카드의 층 (2026-10-28, 사용자 "뜻 한 줄로 이해가 안 되는 사람은?"):
//   뜻 (body)   — 복습 때 떠올릴 답. 일반적인 뜻을 짧게. 만난 문제·글의 사연은 넣지 않는다.
//   예 (example) — 그 뜻이 만난 곳에서 어떻게 쓰였나 ("이 문제에선 이름 → 누적 포인트를 O(1)에").
//   쉽게 풀어 보기 (explainParts) — 학습자가 "설명이 어려워요"를 누르면 그때 만든다: 한 줄 요약, 왜 필요한지, 비유, 작은 예,
//   다른 데서는. 한 번 만들면 남는다. 지식창에서 누르면 복습 단계는 그대로(기록만), 복습 중 답 전에 누르면 물어봄.
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

const EXPLAIN_SYSTEM = `학습자가 지식 카드의 뜻만 보고는 이해가 안 된다고 했다. 처음 배우는 사람에게 쉽게 풀어 준다. 어려운 말은 풀어서, 칸마다 짧게.
- summary: 핵심을 한 문장으로(머리말 없이 바로 내용).
- why: 이게 왜 필요한지, 어떤 불편을 없애는지 1~2문장.
- analogy: 일상 비유 하나, 1~2문장.
- example: 아주 작은 예 하나(숫자나 짧은 코드 한 줄도 좋다). 만난 곳의 상황이 주어지면 그것을 써도 된다. 1~2문장.
- elsewhere: 다른 상황에서는 어떻게 쓰이는지 한 문장(예: "사용자 ID로 계정 찾기, 상품 코드로 재고 찾기"). 만난 곳과 다른 상황으로.
- 복잡도처럼 조건이 붙는 말은 조건을 밝힌다("평균 O(1)", "정렬돼 있을 때").
- see: 함께 보면 좋은 개념 이름 0~3개. 이것을 이해하는 데 정말 필요한 더 기본적인 것만(해시라면 키와 값, 배열 인덱스, 해시 함수). 그것을 몰라도 이것을 설명할 수 있으면 넣지 않는다. 학습자의 지식 목록에 있으면 그 이름을 그대로.
- 학습자가 따로 물은 것이 있으면 그것을 중심으로 칸을 채운다.`;
type Explained = ExplainParts & { see: string[] };
const PARTS_SCHEMA = S.obj({ summary: S.str, why: S.str, analogy: S.str, example: S.str, elsewhere: S.str, see: S.arr(S.str) });
const joinParts = (p: ExplainParts) => [p.summary, p.why, p.analogy && `비유: ${p.analogy}`, p.example && `예: ${p.example}`, p.elsewhere && `다른 데서: ${p.elsewhere}`].filter(Boolean).join("\n\n");
export async function explainKnowledge(id: string, question = "", from: "detail" | "review" = "detail") {
  const d = await getKnowledge(id);
  const { items } = await readAll();
  // Items already linked as what to know first (먼저 알 것·조건·상위, or what this one uses): the 먼저 알 것 chips.
  const sureIds = new Set([...d.backlinks.filter((l) => ["먼저", "먼저 알기", "조건", "포함"].includes(l.relation)).map((l) => l.item.id),
    ...d.links.filter((l) => l.relation === "씀").map((l) => l.item.id)]);
  const before = items.filter((i) => sureIds.has(i.id)).map((i) => i.title);
  const user = [`[지식] ${d.item.title}${d.item.aliases.length ? ` (다른 이름: ${d.item.aliases.join(", ")})` : ""} | 주제: ${d.path || "없음"}`,
    `[뜻] ${d.item.body.trim() || "(비어 있음)"}`, d.item.example ? `[만난 곳에서] ${d.item.example}` : "",
    before.length ? `[이어진 앞선 지식] ${before.join(", ")}` : "", question.trim() ? `[학습자가 물은 것] ${question.trim().slice(0, 300)}` : "",
    `[학습자의 지식 목록 일부] ${items.slice(0, 120).map((i) => i.title).join(", ")}`].filter(Boolean).join("\n");
  const data = await askJson<Explained>("knowledge:explain-item", EXPLAIN_SYSTEM, user, PARTS_SCHEMA);
  const parts: ExplainParts = { summary: (data.summary ?? "").trim(), why: (data.why ?? "").trim(), analogy: (data.analogy ?? "").trim(), example: (data.example ?? "").trim(), elsewhere: (data.elsewhere ?? "").trim() };
  const see = (data.see ?? []).slice(0, 3).map((name) => { const hit = sameName(items, name); return { title: hit?.title ?? name, id: hit?.id ?? null, sure: Boolean(hit && sureIds.has(hit.id)) }; })
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
