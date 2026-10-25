// 글에서 지식 잡기, 드래그해서 묻기, 주장 확인, 사이드바 질문 — the model parts of the knowledge tools.
// The model only reads and writes text; saving, merging and states are done by the knowledge store.
import { askJson, S } from "./model.ts";
import { getKnowledge, memoryOverview, recordEvent, saveKnowledge, saveMany, searchKnowledge, tree, pathOf, type SaveResult } from "../knowledge/store.ts";
import { saveSource, sourceIdOf, getSource, type ReadSource } from "../knowledge/sources.ts";

const EXTRACT_SYSTEM = `학습자가 읽은 글에서 "알아야 할 지식"을 뽑는다.
- knowledge: 글을 이해하고 나중에 다른 글에서도 써먹으려면 알아야 하는 것. 한 항목에 하나만.
  - kind "term": 용어. body는 사전 정의가 아니라 이 글의 문맥에서의 뜻을 1~2문장으로.
  - kind "idea": 일반적인 원리·규칙·패턴(예: "금리가 내리면 대출이 늘어난다", "정렬된 배열은 절반씩 버리며 찾을 수 있다").
  - quote: 그 지식이 나온 글의 문장을 그대로 (80자 이내).
  - 오늘의 시세·날짜·특정 회사의 이번 분기 숫자처럼 시간이 지나면 의미가 없어지는 사실은 지식으로 뽑지 않는다.
  - 학습자가 이미 가진 지식과 같은 것이면 그 이름을 그대로 쓴다 (목록이 주어진다).
- chains: 지식 사이의 고리. from/to는 반드시 knowledge의 title 중 하나. relation은 "그러면", "때문에", "의 예" 같은 짧은 말.
- claim: 글쓴이의 주장 한 줄과 그 근거들 (설명 글이라 주장이 없으면 글의 요지).
- folder: 이 지식들을 넣을 폴더 경로 ("주식/금리", "알고리즘/이분 탐색"). 학습자 폴더 목록에 맞는 것이 있으면 그것을 쓴다.
개수는 글 길이에 맞게, 보통 4~12개.`;

type Extracted = { folder: string; claim: { text: string; basis: string[] }; knowledge: Array<{ title: string; body: string; kind: "term" | "idea"; quote: string }>; chains: Array<{ from: string; relation: string; to: string }> };
const EXTRACT_SCHEMA = S.obj({
  folder: S.str,
  claim: S.obj({ text: S.str, basis: S.arr(S.str) }),
  knowledge: S.arr(S.obj({ title: S.str, body: S.str, kind: S.oneOf("term", "idea"), quote: S.str })),
  chains: S.arr(S.obj({ from: S.str, relation: S.str, to: S.str })),
});

/** What the learner already has, as names the model can reuse (so the store merges instead of duplicating). */
async function knownNames(limit = 160) {
  const { folders, items } = await tree();
  const paths = [...new Set(folders.map((f) => pathOf({ folders }, f.id)))].slice(0, 60);
  const names = [...items].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, limit).map((i) => i.title);
  return { paths, names };
}

export type ExtractResult = { source: ReadSource; items: Array<SaveResult["item"] & { again: boolean; created: boolean; kind: string; quote: string }> };
/** Read a web article or a lesson: knowledge saved as 만남 (or "다시 만남"), chains as links, the article kept with its goals. */
export async function extractFromText(input: { kind: "web" | "lesson"; title: string; url?: string; text: string; folder?: string }): Promise<ExtractResult> {
  const text = input.text.replace(/\s+\n/g, "\n").trim();
  if (text.length < 80) throw new Error("본문이 너무 짧아요. 글 전체가 보이는지 확인해 주세요.");
  const known = await knownNames();
  const user = [`[글 제목] ${input.title}`, input.url ? `[주소] ${input.url}` : "", input.folder ? `[학습자가 고른 폴더] ${input.folder}` : "",
    `[학습자 폴더 목록] ${known.paths.join(", ") || "(없음)"}`, `[학습자가 이미 가진 지식 이름] ${known.names.join(", ") || "(없음)"}`, `[본문]\n${text.slice(0, 40000)}`].filter(Boolean).join("\n\n");
  const data = await askJson<Extracted>("knowledge:extract", EXTRACT_SYSTEM, user, EXTRACT_SCHEMA, { heavy: true });
  const folder = input.folder || data.folder || (input.kind === "lesson" ? "강의" : "읽은 글");
  const ref = { kind: input.kind === "lesson" ? "web" as const : "web" as const, title: input.title, ...(input.url ? { url: input.url } : {}) };
  const chainsByFrom = new Map<string, Array<{ title: string; relation: string }>>();
  for (const c of data.chains) chainsByFrom.set(c.from, [...(chainsByFrom.get(c.from) ?? []), { title: c.to, relation: c.relation }]);
  const results = await saveMany(data.knowledge.map((k) => ({ title: k.title, body: k.body, folder, source: { ...ref, quote: k.quote.slice(0, 200) },
    links: chainsByFrom.get(k.title) ?? [] })));
  const items = results.map((r, i) => ({ ...r.item, again: r.again, created: r.created, kind: data.knowledge[i].kind, quote: data.knowledge[i].quote }));
  const id = sourceIdOf(input.url ?? "", input.title);
  const prior = await getSource(id);
  const source: ReadSource = {
    id, kind: input.kind, title: input.title, url: input.url ?? "", text: text.slice(0, 60000), readAt: new Date().toISOString(),
    claim: data.claim, chains: data.chains, knowledgeIds: items.map((i) => i.id), againIds: items.filter((i) => i.again).map((i) => i.id),
    quotes: Object.fromEntries(items.map((i) => [i.id, i.quote])),
    goals: prior?.goals ?? { terms: { done: false }, claim: { done: false }, chains: { done: false }, recognize: { done: false } },
  };
  await saveSource(source);
  return { source, items };
}

const EXPLAIN_SYSTEM = `학습자가 글을 읽다가 드래그한 부분을 묻는다. 이 글의 문맥에 맞춰 짧고 정확하게 답한다 (3~6문장).
- answer: 설명. 사전식 정의보다 "이 글에서 이 말이 무슨 뜻인지"를 먼저.
- other_view: 글의 주장이나 설명에 대해 다르게 보는 시각이 있으면 한두 문장. 없으면 빈 문자열.
- term: 드래그한 부분이 하나의 용어·개념이면 { title: 그 이름, body: 이 글 문맥에서의 뜻 1~2문장 }. 문장 전체처럼 지식 하나로 묶기 어려우면 title을 빈 문자열로.`;
type Explained = { answer: string; other_view: string; term: { title: string; body: string } };
/** 드래그해서 묻기: the answer, one other view, and the term saved as 몰랐음 (asking means not knowing). */
export async function explainSelection(input: { title: string; url?: string; text: string; selection: string; question?: string; folder?: string }) {
  const user = [`[글 제목] ${input.title}`, `[드래그한 부분] ${input.selection.slice(0, 1200)}`, input.question ? `[질문] ${input.question.slice(0, 1000)}` : "",
    `[글 본문]\n${input.text.slice(0, 24000)}`].filter(Boolean).join("\n\n");
  const data = await askJson<Explained>("knowledge:explain", EXPLAIN_SYSTEM, user, S.obj({ answer: S.str, other_view: S.str, term: S.obj({ title: S.str, body: S.str }) }));
  let saved: SaveResult | null = null;
  if (data.term.title.trim()) {
    saved = await saveKnowledge({ title: data.term.title, body: data.term.body, folder: input.folder || "읽은 글", source: { kind: "web", title: input.title, ...(input.url ? { url: input.url } : {}), quote: input.selection.slice(0, 200) } });
    await recordEvent(saved.item.id, "asked", input.question || `"${input.selection.slice(0, 80)}" 드래그해서 물어봄`, { kind: "web", title: input.title });
  }
  return { answer: data.answer, otherView: data.other_view, knowledge: saved ? { id: saved.item.id, title: saved.item.title, created: saved.created } : null };
}

/** 주장 확인: the learner's one line against the article's claim. */
export async function checkClaim(sourceId: string, answer: string) {
  const source = await getSource(sourceId);
  if (!source) throw new Error("읽은 글을 찾을 수 없어요.");
  const data = await askJson<{ verdict: "맞음" | "일부" | "다름"; feedback: string }>("knowledge:claim",
    "학습자가 글을 덮고 쓴 '이 글의 주장' 한 줄을 실제 주장과 비교한다. verdict: 핵심이 같으면 맞음, 일부만 맞으면 일부, 다르면 다름. feedback: 무엇이 맞고 무엇이 빠졌는지 1~2문장, 정답을 그대로 베껴 주지 않는다.",
    `[실제 주장] ${source.claim.text}\n[근거] ${source.claim.basis.join(" / ")}\n[학습자 답] ${answer.slice(0, 600)}`, S.obj({ verdict: S.oneOf("맞음", "일부", "다름"), feedback: S.str }));
  return { ...data, claim: source.claim };
}

/** 사이드바 질문 ("이거 1번이랑 연결돼?"): memory level 1 always, the focused items in full, and a link it may suggest. */
export async function askKnowledge(question: string, focusIds: string[] = [], context = "") {
  const overview = await memoryOverview();
  const focus = await Promise.all(focusIds.slice(0, 6).map((id) => getKnowledge(id).catch(() => null)));
  const found = await searchKnowledge(question, { limit: 6 });
  const lines = (d: NonNullable<(typeof focus)[number]>) => `- ${d.item.title} [${d.path || "폴더 없음"}] ${d.item.body.slice(0, 300)}${d.links.length ? ` | 이어짐: ${d.links.map((l) => `${l.relation}→${l.item.title}`).join(", ")}` : ""}${d.events.length ? ` | 최근 기록: ${d.events.slice(0, 4).map((e) => `${e.kind}${e.detail ? `(${e.detail.slice(0, 40)})` : ""}`).join(", ")}` : ""}`;
  const user = [`[학습자 지식 전체]\n${overview.text}`, focus.some(Boolean) ? `[지금 보고 있는 지식]\n${focus.filter(Boolean).map((d) => lines(d!)).join("\n")}` : "",
    found.length ? `[질문과 관련 있어 보이는 지식] ${found.map((h) => `${h.title}: ${h.line}`).join(" / ")}` : "", context ? `[지금 화면] ${context.slice(0, 4000)}` : "", `[질문] ${question.slice(0, 1500)}`].filter(Boolean).join("\n\n");
  return askJson<{ answer: string; link: { from: string; to: string; relation: string } }>("knowledge:ask",
    "학습자의 지식 저장소를 아는 튜터다. 질문에 짧게 답한다 (2~6문장). 학습자의 지식과 이어지는 점이 있으면 그 지식 이름을 그대로 써서 짚는다. 두 지식 사이에 고리를 새로 이을 만하면 link에 from/to(지식 이름 그대로)/relation(“그러면”, “때문에”, “의 예”처럼 10자 이내)을 채우고, 아니면 셋 다 빈 문자열.",
    user, S.obj({ answer: S.str, link: S.obj({ from: S.str, to: S.str, relation: S.str }) }));
}
