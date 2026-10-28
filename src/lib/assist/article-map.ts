// 글 지도 (2026-10-29, 사용자 "글의 구조를 따서 핵심 아이디어를 담고, 개념어는 사용자가 모르면 추가"):
// 읽기 연구의 원칙대로 — 읽기 전에 훑어보고 질문을 갖고(SQ3R), 아는 것부터 꺼내고(KWL), 어휘는 필요한 것만 — AI는 지도와
// 후보만 준비하고, 무엇을 남길지는 학습자가 정한다(모른다고 누름, 틀림, 물어봄).
//   글 종류 · 이 글이 답하는 질문 · 흐름 · 요지 · 핵심 아이디어 3~5개(완성된 지식) · 개념어(이름 + 이 글에서의 한 줄 뜻)
// 개념어는 학습자가 이미 아는 것(앎·졸업)이면 known으로 표시한다. 지금은 미리보기만(저장하지 않음).
import { askJson, S } from "./model.ts";
import { readAll, sameName } from "../knowledge/store.ts";

const GENRES = ["concept", "case", "opinion", "news", "other"] as const;
export const GENRE_LABEL: Record<(typeof GENRES)[number], string> = { concept: "개념 설명", case: "사례·설계", opinion: "주장·칼럼", news: "소식", other: "기타" };
const MAP_SYSTEM = `학습자가 글을 읽기 전에 볼 "글 지도"를 만든다. 무엇을 외울지는 학습자가 나중에 정하니, 여기서는 지도와 후보만 준비한다.
- genre: concept(개념을 설명하는 글), case(기술·업무 사례: 문제→해결→이유), opinion(주장하는 칼럼·의견), news(소식·사건), other.
- question: 이 글이 답하는 질문 한 문장("금리가 내리면 주식은 왜 오를까?").
- flow: 글의 흐름 3~6단계. 단계마다 짧은 구절.
- claim: 글의 요지 한 문장과 근거 1~3개(설명 글이면 요지).
- ideas: 이 글에서 가져갈 핵심 아이디어 3~5개. 글 종류에 맞게 고른다.
  concept는 개념 사이의 원리("금리가 오르면 기존 채권 가격이 내린다"), case는 문제·해결·그 이유("초과 판매를 막으려고 사용량을 구매번호 집합으로 센다"),
  opinion은 주장·근거·반대로 볼 여지, news는 무엇이 왜 일어났고 무엇이 바뀌나.
  title은 짧은 이름, body는 1~2문장, quote는 근거가 된 글의 문장 그대로 80자 이내. 개념어 하나의 정의는 ideas가 아니라 terms에 둔다.
- terms: 글을 이해하는 데 필요한 개념어(이름이 붙은 개념)를 글에 나온 순서로, 많아야 20개. line은 이 글에서의 뜻 한 줄(30자 안팎).
  명령어·함수·제품 이름은 그것으로 하는 일이 중요할 때만 넣고, 그 일 단위로 묶는다(SADD·SCARD·SREM → "Redis Set 연산"). 일상어는 넣지 않는다.
  학습자가 이미 가진 지식 이름과 같은 것이면 그 이름을 그대로 쓴다.`;
type Mapped = { genre: (typeof GENRES)[number]; question: string; flow: string[]; claim: { text: string; basis: string[] };
  ideas: Array<{ title: string; body: string; quote: string }>; terms: Array<{ name: string; line: string }> };
const MAP_SCHEMA = S.obj({
  genre: S.oneOf(...GENRES), question: S.str, flow: S.arr(S.str), claim: S.obj({ text: S.str, basis: S.arr(S.str) }),
  ideas: S.arr(S.obj({ title: S.str, body: S.str, quote: S.str })), terms: S.arr(S.obj({ name: S.str, line: S.str })),
});

/** One model call: the map, and each term marked with what the learner already has (known = 앎·졸업, met = 만남·몰랐음). */
export async function mapArticle(input: { title: string; text: string }, options: { model?: string; effort?: string } = {}) {
  const { items } = await readAll();
  const names = [...items].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 160).map((i) => i.title);
  const user = [`[글 제목] ${input.title}`, `[학습자가 이미 가진 지식 이름] ${names.join(", ") || "(없음)"}`, `[본문]\n${input.text.slice(0, 40000)}`].join("\n\n");
  const data = await askJson<Mapped>("knowledge:map", MAP_SYSTEM, user, MAP_SCHEMA,
    { model: options.model || process.env.RECALLER_EXTRACT_MODEL?.trim() || "gpt-6.1-terra", effort: options.effort || process.env.RECALLER_EXTRACT_EFFORT?.trim() || "low" });
  const terms = (data.terms ?? []).slice(0, 20).map((t) => {
    const hit = sameName(items, t.name);
    const have = !hit ? "new" : hit.graduated || hit.state === "known" ? "known" : "met";
    return { ...t, have, ...(hit ? { id: hit.id } : {}) };
  });
  return { ...data, ideas: (data.ideas ?? []).slice(0, 5), terms };
}
