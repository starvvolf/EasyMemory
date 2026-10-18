// Generation engine v3 (Claude 안, 협업/설계_생성엔진v3_Claude_20261019.md). Lab-only engine choice; v2 stays the default.
// ① 전체 읽기: the whole PDF (plus its text layer) → outline + knowledge map (concepts with their conditions, relations
//    across units, materials, skips, notes for picture pages). ② 출제 계획: the map → planned questions with what the
//    question gives, what the learner must bring back, and the conditions it must keep. ③ 출제 per unit with the unit's
//    full source text + map + plan. ④ 관문: code checks + one model check per unit; failures are re-authored once.
// This file holds the prompts, schemas and pure checks; runner.ts drives the calls.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AuthoredQuestion, AuthoringBlock } from "../../../../tools/problem-authoring-lab/contract.ts";
import { locate } from "./checks.ts";
import { DEFAULT_GUIDE_DIR, ruleLines } from "./guide.ts";
import { purposeLabel, type GenInput, type Issue, type Objective, type ObjectiveKind, type Purpose, type Section } from "./types.ts";

type Json = Record<string, unknown>;
const obj = (properties: Record<string, Json>): Json => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const str = (description?: string): Json => ({ type: "string", ...(description ? { description } : {}) });
const int = (description?: string): Json => ({ type: "integer", ...(description ? { description } : {}) });
const bool = (description?: string): Json => ({ type: "boolean", ...(description ? { description } : {}) });
const arr = (items: Json, description?: string): Json => ({ type: "array", items, ...(description ? { description } : {}) });
const oneOf = (values: readonly string[], description?: string): Json => ({ type: "string", enum: [...values], ...(description ? { description } : {}) });

export const conceptKinds = ["정의", "식", "절차", "규칙", "사실", "용어"] as const;
export const relationKinds = ["이유", "비교", "선택기준", "순서", "포함", "헷갈리는짝"] as const;
export const questionTypes = ["상황선택", "적용계산", "이유", "구별", "용어", "절차", "사실"] as const;
export type QuestionType = (typeof questionTypes)[number];

/** Largest PDF sent whole; a bigger file goes as text layer only (and says so). */
export const MAX_PDF_BYTES = 32 * 1024 * 1024;

// ---- ① 전체 읽기 ---------------------------------------------------------------------------------------------
const quote = obj({ page: int("인용이 있는 쪽"), text: str("원문 글자 그대로 복사. 조건이 담긴 문장 단위") });
export const readSchema = obj({
  sections: arr(obj({
    title: str("원문의 장·절·슬라이드 제목 그대로"),
    startText: str("이 단원이 원문에서 시작되는 글자 그대로(보통 제목 줄)"),
    pageStart: int(), pageEnd: int(),
    parts: arr(obj({ title: str(), pageStart: int() }), "단원 안 세부 항목, 원문 순서. 없으면 빈 배열"),
  }), "공부 단위(단원). 원문 순서대로, 고른 쪽을 빠짐없이 덮는다. 보통 4~10쪽 단위"),
  concepts: arr(obj({
    id: str("c1, c2 … 순서대로"),
    name: str("원문 표기 그대로의 이름"),
    kind: oneOf(conceptKinds),
    content: str("무엇인지(한국어, 원문 용어·기호는 그대로)"),
    conditions: arr(str(), "이 내용이 성립하는 조건·전제·적용 범위·대상(어느 경우, 어느 점, 어떤 좌표계·부호 관례·단위). 없으면 빈 배열"),
    steps: arr(str(), "절차면 단계 순서대로, 아니면 빈 배열"),
    pages: arr(int()),
    quotes: arr(quote),
    importance: oneOf(["상", "중", "하"], "시험·이해에 얼마나 중요한가"),
    why: str("중요도 이유 한 줄"),
  })),
  relations: arr(obj({
    id: str("r1, r2 …"),
    kind: oneOf(relationKinds),
    between: arr(str(), "관련 개념 id들"),
    statement: str("관계 내용: 왜 필요한가 / 무엇이 다른가 / 언제 무엇을 쓰나 / 어떤 순서인가"),
    pages: arr(int()),
    quotes: arr(quote),
  }), "개념 사이의 이유·비교·선택 기준·순서·포함·헷갈리는 짝. 단원을 넘어도 된다"),
  materials: arr(obj({ concepts: arr(str()), content: str("원문의 예시·수치·표·그림 내용"), page: int() }), "문제 상황으로 쓸 수 있는 원문 소재"),
  skips: arr(obj({ page: int(), reason: str() }), "학습 대상이 아닌 쪽·부분(표지, 강의 안내, 일정, 평가) 또는 읽기 불확실한 곳"),
  pageNotes: arr(obj({ page: int(), text: str("그 쪽의 그림·식·표 내용을 옮긴 것(식은 LaTeX, 표는 마크다운). 보이는 것만") }), "글자 층이 빈약한 쪽만"),
});
const quoteReply = z.object({ page: z.number().int(), text: z.string() });
export const readReply = z.object({
  sections: z.array(z.object({ title: z.string().trim().min(1), startText: z.string(), pageStart: z.number().int(), pageEnd: z.number().int(),
    parts: z.array(z.object({ title: z.string().trim(), pageStart: z.number().int() })).default([]) })),
  concepts: z.array(z.object({ id: z.string().trim().min(1), name: z.string().trim().min(1), kind: z.enum(conceptKinds), content: z.string().trim().min(1),
    conditions: z.array(z.string()), steps: z.array(z.string()), pages: z.array(z.number().int()), quotes: z.array(quoteReply),
    importance: z.enum(["상", "중", "하"]), why: z.string() })),
  relations: z.array(z.object({ id: z.string().trim().min(1), kind: z.enum(relationKinds), between: z.array(z.string()), statement: z.string().trim().min(1),
    pages: z.array(z.number().int()), quotes: z.array(quoteReply) })),
  materials: z.array(z.object({ concepts: z.array(z.string()), content: z.string(), page: z.number().int() })),
  skips: z.array(z.object({ page: z.number().int(), reason: z.string() })),
  pageNotes: z.array(z.object({ page: z.number().int(), text: z.string() })),
});
export type ReadReply = z.infer<typeof readReply>;
/** The stored map: the read reply plus which quotes were found in the source and which unit each item belongs to. */
export type KnowledgeMap = Omit<ReadReply, "sections" | "concepts" | "relations"> & {
  concepts: Array<ReadReply["concepts"][number] & { sectionId: string; quotes: Array<{ page: number; text: string; verified: boolean }> }>;
  relations: Array<ReadReply["relations"][number] & { sectionIds: string[]; quotes: Array<{ page: number; text: string; verified: boolean }> }>;
  pdfSent: boolean;
};

/*
 * 전체 읽기 is split for time (변경 2026-10-19): one outline call, then one map call per unit, several at once.
 * Every read call has the same instructions and the same PDF first, so after the outline call the unit calls can
 * reuse the prompt cache; what differs (the task, the unit's text) comes after the file.
 */
const sectionShape = readSchema.properties as Record<string, Json>;
export const readOutlineSchema = obj({ sections: sectionShape.sections, skips: sectionShape.skips });
export const readOutlineReply = readReply.pick({ sections: true, skips: true });
export const readUnitSchema = obj({ concepts: sectionShape.concepts, relations: sectionShape.relations, materials: sectionShape.materials, pageNotes: sectionShape.pageNotes });
export const readUnitReply = readReply.pick({ concepts: true, relations: true, materials: true, pageNotes: true });
export type ReadUnitReply = z.infer<typeof readUnitReply>;

export const READ_SYSTEM = [
  "너는 강의 자료 한 벌을 처음부터 끝까지 읽고, 시험 공부에 쓸 지식 지도를 만든다. 문제는 아직 만들지 않는다.",
  "첨부 PDF가 있으면 그림·식·표까지 보고, 함께 준 쪽별 글자 층으로 원문 표기를 확인한다. 고른 쪽만 다룬다.",
  "원칙",
  "- 외울 것은 '사실 + 그것이 성립하는 조건'이다. 내용을 짧게 줄이느라 조건(어느 경우, 어느 점·모서리·대상, 좌표계·부호 관례, 단위, 전제)을 떼지 않는다. 조건은 conditions 칸에 따로 적는다.",
  "- 정의·식·절차만이 아니라, 원문이 말하는 이유(왜 이 방법을 쓰는가, 무엇을 개선했는가), 비교(무엇이 다른가), 선택 기준(언제 무엇을 쓰는가), 헷갈리는 짝을 relations로 빠짐없이 적는다. 멀리 떨어진 쪽끼리의 관계도 적는다.",
  "- 같은 내용을 쪽마다 반복해서 적지 않는다. 방향·경우만 다른 같은 규칙은 한 개념의 conditions·steps로 묶는다.",
  "- 표지, 강의 운영 안내(학습목표 목록, 수업 방식, 평가 비율, 교재·일정)는 개념으로 만들지 않고 skips에 적는다.",
  "- quotes에는 원문을 글자 그대로 옮긴다. 조건이 담긴 문장 단위로 옮기고 식 한 조각만 옮기지 않는다. 그림 속 글자라 글자 층에 없으면 그대로 옮겨도 된다.",
  "- 원문에 없는 사실을 만들지 않는다. 원문 용어·기호·표기를 바꾸지 않는다.",
  "- 단원(sections)은 공부 단위다. 슬라이드마다 만들지 않고 한 주제를 다루는 여러 쪽을 묶는다(보통 4~10쪽). 고른 쪽을 빠짐없이 원문 순서로 덮는다. startText는 그 단원이 시작되는 원문 글자를 그대로 복사한다.",
  "- importance: 상 = 이 자료를 공부했다면 반드시 알아야 하고 시험에 나올 만한 것, 중 = 알아야 할 세부, 하 = 알면 좋은 보충.",
  "- 요청의 [작업]에 적힌 것만 출력한다: '목차'면 단원과 제외할 것만, '단원 지도'면 그 단원의 개념·관계·소재·그림 쪽 옮김만.",
  "- 단원 지도에서 relations의 between에는 이 단원 개념 id만 쓴다. 다른 단원과의 관계는 statement에 그 단원 제목과 함께 적는다.",
].join("\n");

export function readOutlineUser(input: GenInput, pageText: string, pdfSent: boolean) {
  return [`[작업] 목차`, `[자료] ${input.fileName}`, `[고른 쪽] ${input.pageNumbers.join(", ")}`,
    pdfSent ? "[첨부] 자료 PDF 전체(고른 쪽만 다룬다)" : "[첨부 없음] 글자 층만 준다.", `[원문: 쪽별 추출 글자]\n${pageText}`].join("\n\n");
}
export function readUnitUser(input: GenInput, sections: Section[], section: Section, unitText: string, thinPages: number[], pdfSent: boolean) {
  return [`[작업] 단원 지도: ${section.id} ${section.title} (p.${section.pages[0]}–${section.pages.at(-1)})`,
    `[자료] ${input.fileName}`, `[전체 목차] ${sections.map((other) => `${other.id} ${other.title} (p.${other.pages[0]}–${other.pages.at(-1)})`).join(" / ")}`,
    pdfSent ? "[첨부] 자료 PDF 전체(이 단원 쪽을 다룬다)" : "[첨부 없음] 글자 층만 준다. 그림 내용은 글자 층에 보이는 만큼만 다룬다.",
    thinPages.length ? `[글자 층이 빈약한 쪽] ${thinPages.join(", ")} — pageNotes에 그림·식·표 내용을 옮긴다.` : "",
    `[이 단원 원문: 쪽별 추출 글자]\n${unitText}`].filter(Boolean).join("\n\n");
}

/** Joins the unit maps: ids become unit-scoped (s2-c1), relations keep their unit's concepts. */
export function joinUnitMaps(parts: Array<{ sectionId: string; reply: ReadUnitReply }>, skips: ReadReply["skips"]): Omit<ReadReply, "sections"> & { owner: Map<string, string> } {
  const owner = new Map<string, string>();
  const concepts: ReadReply["concepts"] = [], relations: ReadReply["relations"] = [], materials: ReadReply["materials"] = [], pageNotes: ReadReply["pageNotes"] = [];
  for (const { sectionId, reply } of parts) {
    const id = (local: string) => `${sectionId}-${local}`;
    for (const concept of reply.concepts) { concepts.push({ ...concept, id: id(concept.id) }); owner.set(id(concept.id), sectionId); }
    for (const relation of reply.relations) relations.push({ ...relation, id: id(relation.id), between: relation.between.map(id) });
    for (const material of reply.materials) materials.push({ ...material, concepts: material.concepts.map(id) });
    for (const note of reply.pageNotes) if (!pageNotes.some((other) => other.page === note.page)) pageNotes.push(note);
  }
  return { concepts, relations, materials, skips, pageNotes, owner };
}


/** Attaches unit ids and quote checks to the read reply. A quote not found in the text layer is kept but marked. */
export function buildMap(reply: Omit<ReadReply, "sections"> & { owner?: Map<string, string> }, sections: Section[], texts: Map<number, string>, pdfSent: boolean): { map: KnowledgeMap; warnings: Issue[] } {
  const byPage = (pages: number[]) => (pages.length ? sections.find((section) => section.pages.includes(pages[0])) : undefined)?.id ?? sections[0]?.id ?? "s1";
  const check = (quotes: ReadReply["concepts"][number]["quotes"]) => quotes.map((q) => ({ ...q, verified: locate(texts.get(q.page) ?? "", q.text) >= 0 }));
  const concepts = reply.concepts.map((concept) => ({ ...concept, sectionId: reply.owner?.get(concept.id) ?? byPage(concept.pages.length ? concept.pages : concept.quotes.map((q) => q.page)), quotes: check(concept.quotes) }));
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  const relations = reply.relations.map((relation) => ({ ...relation, quotes: check(relation.quotes),
    sectionIds: [...new Set([...relation.between.map((id) => byId.get(id)?.sectionId).filter((id): id is string => Boolean(id)), byPage(relation.pages)])] }));
  const warnings: Issue[] = [];
  const unverified = [...concepts, ...relations].flatMap((item) => item.quotes).filter((q) => !q.verified).length;
  if (unverified) warnings.push({ severity: "warning", code: "map-quote-unverified", message: `글자 층에서 찾지 못한 인용 ${unverified}개(그림 속 글자일 수 있음)` });
  if (!concepts.length) warnings.push({ severity: "warning", code: "map-empty", message: "지식 지도에 개념이 없어요." });
  return { map: { concepts, relations, materials: reply.materials, skips: reply.skips, pageNotes: reply.pageNotes, pdfSent }, warnings };
}

// ---- ② 출제 계획 ---------------------------------------------------------------------------------------------
export const planSchema = obj({
  items: arr(obj({
    sectionId: str("이 문항을 낼 단원 id(s1, s2 …)"),
    type: oneOf(questionTypes, "상황선택: 구체 상황을 주고 방법·개념을 고르게 / 적용계산: 새 수치·상황에 규칙을 적용 / 이유: 왜 그런가 / 구별: 헷갈리는 둘의 차이 기준 / 용어: 정의·상황 → 용어 / 절차: 순서·다음 단계 / 사실: 꼭 기억할 사실"),
    statement: str("학습 목표 문장('~할 수 있다'). 정답을 쓰지 않음"),
    given: str("문제가 학습자에게 주는 상황·정보(무엇을 보여 줄지)"),
    mustRecall: str("학습자가 기억에서 꺼내야 하는 것(정답의 핵심). 조건을 포함해 원문 그대로의 뜻으로"),
    conditions: arr(str(), "문항 본문에 반드시 들어가야 하는 조건(대상·경우·관례·단위). 없으면 빈 배열"),
    concepts: arr(str(), "근거 개념 id"),
    relations: arr(str(), "근거 관계 id(없으면 빈 배열)"),
    importance: oneOf(["core", "support"]),
  })),
});
export const planReply = z.object({
  items: z.array(z.object({ sectionId: z.string().trim(), type: z.enum(questionTypes), statement: z.string().trim().min(1), given: z.string().trim(),
    mustRecall: z.string().trim().min(1), conditions: z.array(z.string()), concepts: z.array(z.string()), relations: z.array(z.string()), importance: z.enum(["core", "support"]) })),
});
export type PlanItem = z.infer<typeof planReply>["items"][number];

const PURPOSE_RULE: Record<Purpose, string> = {
  read: "",
  understand: "목적이 '이해'다. 이유·구별·선택 기준·관계 문항을 중심으로, 단순 용어·수치 암기는 꼭 필요한 것만.",
  core: "목적이 '핵심 암기'다. 중요도 상인 개념과 이유·구별·선택 기준 관계를 core로, 중은 꼭 필요한 것만, 하는 support로.",
  all: "목적이 '통암기'다. 중요도와 관계없이 원문의 개념·조건·관계를 빠짐없이 다룬다. 그래도 같은 지식을 방향만 바꿔 두 번 묻지 않는다.",
};
/** Suggested count: about this many questions per content page, by purpose (a guide, not a cap). */
const PER_PAGE: Record<Purpose, number> = { read: 0, understand: 0.4, core: 0.75, all: 1.2 };
export function suggestedCount(purpose: Purpose, pages: number[], skips: Array<{ page: number }>) {
  const skipped = new Set(skips.map((skip) => skip.page));
  const content = pages.filter((page) => !skipped.has(page)).length;
  return Math.max(3, Math.round(content * PER_PAGE[purpose]));
}

export const PLAN_SYSTEM = [
  "너는 시험 대비 문항 계획을 세운다. 지식 지도를 보고 무엇을, 어떤 종류로 물을지 정한다. 문항 문장은 아직 쓰지 않는다.",
  "원칙",
  "- 배울 가치 단위로 묶는다. 방향·경우만 다른 자잘한 사실을 각각 문항으로 만들지 않고, 같은 지식을 방향만 바꿔 두 번 묻지 않는다. 한 문항은 한 과제다.",
  "- 정의·식·절차뿐 아니라 이유(왜 이 방법인가), 구별(헷갈리는 둘의 차이), 선택 기준(어떤 상황에 무엇을 쓰나)을 문항으로 살린다.",
  "- 묻는 방향은 실제로 쓰는 상황대로 정한다. 상황에 맞게 방법을 고르는 지식이면 '상황 → 방법'(상황선택)으로, 식·절차면 새 수치에 적용(적용계산)으로 묻는다. 이름을 주고 정의를 되묻는 것만으로 대신하지 않는다.",
  "- given은 문제에 보여 줄 상황·정보이고 mustRecall은 학습자가 꺼낼 것이다. given에 mustRecall(또는 그 핵심)을 넣지 않는다. 규칙을 주고 적용시키는 문항이라면 mustRecall은 '규칙을 이 상황에 적용한 결과'이고, 외우는 것이 목표인 규칙은 given에 넣지 않는다.",
  "- conditions에는 mustRecall이 참이 되려면 문항에 꼭 있어야 하는 조건을 적는다(지도 개념의 conditions에서 가져온다).",
  "- 강의 안내·표지 같은 skips는 다루지 않는다.",
].join("\n");

export function planUser(input: GenInput, sections: Section[], map: KnowledgeMap, count: number) {
  const signals = [...input.signals.weakSpots.map((value) => `- 약점: ${value}`), ...input.signals.reports.map((value) => `- 신고: ${value}`)];
  const compact = {
    concepts: map.concepts.map(({ id, sectionId, name, kind, content, conditions, steps, pages, importance }) => ({ id, sectionId, name, kind, content, conditions, steps, pages, importance })),
    relations: map.relations.map(({ id, kind, between, statement, sectionIds }) => ({ id, kind, between, statement, sectionIds })),
    materials: map.materials, skips: map.skips,
  };
  return [
    `[자료] ${input.fileName}`,
    `[목적] ${purposeLabel[input.purpose]} — ${PURPOSE_RULE[input.purpose]}`,
    `[권장 문항 수] 약 ${count}개(자료에 맞게 ±30% 안에서 정한다)`,
    input.note.trim() ? `[학습자 메모] ${input.note.trim().slice(0, 600)}` : "",
    signals.length ? `[먼저 다룰 것]\n${signals.join("\n")}` : "",
    `[단원]\n${sections.map((section) => `- ${section.id}: ${section.title} (p.${section.pages[0]}–${section.pages.at(-1)})`).join("\n")}`,
    `[지식 지도]\n${JSON.stringify(compact)}`,
  ].filter(Boolean).join("\n\n");
}

const KIND_OF: Record<QuestionType, ObjectiveKind> = { 상황선택: "개념", 적용계산: "공식", 이유: "관계", 구별: "관계", 용어: "용어", 절차: "절차", 사실: "사실" };

/** Planned items → objectives per unit (what the confirmation, the summary and the judges read). */
export function planToObjectives(items: PlanItem[], sections: Section[], map: KnowledgeMap): { bySection: Map<string, Objective[]>; warnings: Issue[] } {
  const bySection = new Map<string, Objective[]>(sections.map((section) => [section.id, []]));
  const warnings: Issue[] = [];
  const concepts = new Map(map.concepts.map((concept) => [concept.id, concept]));
  const relations = new Map(map.relations.map((relation) => [relation.id, relation]));
  const seen = new Set<string>();
  for (const item of items) {
    const refs = [...item.concepts.map((id) => concepts.get(id)), ...item.relations.map((id) => relations.get(id))].filter((ref): ref is NonNullable<typeof ref> => Boolean(ref));
    const fallback = item.concepts.map((id) => concepts.get(id)?.sectionId).find(Boolean);
    const sectionId = bySection.has(item.sectionId) ? item.sectionId : fallback ?? sections[0]?.id;
    if (!sectionId) continue;
    if (sectionId !== item.sectionId) warnings.push({ severity: "warning", code: "plan-section-fixed", message: `없는 단원 '${item.sectionId}'을 가리킨 계획을 ${sectionId}에 붙였어요.` });
    const key = item.mustRecall.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
    if (seen.has(key)) { warnings.push({ severity: "warning", code: "plan-duplicate", message: `같은 꺼낼 것이 겹쳐 하나로 합쳤어요: ${item.mustRecall.slice(0, 50)}` }); continue; }
    seen.add(key);
    const section = sections.find((candidate) => candidate.id === sectionId)!;
    const refPages = [...new Set(refs.flatMap((ref) => ref.pages))].sort((a, b) => a - b);
    const inSection = refPages.filter((page) => section.pages.includes(page));
    const quotes = [...new Set(refs.flatMap((ref) => [...ref.quotes].sort((a, b) => Number(b.verified) - Number(a.verified)).map((q) => q.text)))].slice(0, 4);
    const list = bySection.get(sectionId)!;
    list.push({
      id: `${sectionId}-o${list.length + 1}`, sectionId, statement: item.statement, cue: item.given || item.statement, recall: item.mustRecall,
      kind: KIND_OF[item.type], importance: item.importance, itemNumbers: [], materialNumbers: [],
      pages: inSection.length ? inSection : refPages.length ? refPages : [section.pages[0]], quotes,
      given: item.given, conditions: item.conditions.filter((condition) => condition.trim()), qtype: item.type,
      conceptIds: item.concepts, relationIds: item.relations,
    });
  }
  if (!items.length) warnings.push({ severity: "warning", code: "plan-empty", message: "출제 계획이 비었어요." });
  return { bySection, warnings };
}

/** For compatibility (fixed-prefix reruns, judges): the map as classification items of each unit. */
export function mapItems(sectionId: string, map: KnowledgeMap) {
  let n = 0;
  return [
    ...map.concepts.filter((concept) => concept.sectionId === sectionId).map((concept) => ({ n: ++n, kind: "핵심 지식" as const,
      content: `${concept.name}: ${concept.content}${concept.conditions.length ? ` (조건: ${concept.conditions.join("; ")})` : ""}`,
      quote: concept.quotes[0]?.text ?? concept.name, page: concept.quotes[0]?.page ?? concept.pages[0] ?? 0 })),
    ...map.relations.filter((relation) => relation.sectionIds.includes(sectionId)).map((relation) => ({ n: ++n, kind: "설명" as const,
      content: `[${relation.kind}] ${relation.statement}`, quote: relation.quotes[0]?.text ?? relation.statement, page: relation.quotes[0]?.page ?? relation.pages[0] ?? 0 })),
  ];
}

// ---- ③ 단원별 출제 -------------------------------------------------------------------------------------------
/** Answer-format rules (출제기준 형식.md) and the shared rules (공통.md) still apply; the old 출제 원칙 does not. */
export async function formatRules(dir = DEFAULT_GUIDE_DIR) {
  const root = process.env.STUDY_FORGE_GUIDE_ROOT?.trim() || process.cwd();
  const read = async (file: string) => ruleLines(await readFile(/* turbopackIgnore: true */ path.join(root, dir, ...file.split("/")), "utf8"));
  return [...await read("공통.md"), ...await read("출제/형식.md")].join("\n");
}

export const AUTHOR_SYSTEM = [
  "너는 시험 대비 인출 연습 문항을 쓴다. 문항 계획마다 문항을 정확히 하나 쓴다.",
  "문항은 블록을 읽는 순서대로 쌓아 만든다: heading(제목), text(본문), math(LaTeX 식), table(표, 첫 행은 머리글), box(강조 상자). 위치·크기는 코드가 정한다.",
  "answer 칸: choice는 options 4개와 correctIndex(0부터), short는 accepted에 인정 답안들, self-check는 accepted에 모범 답 하나. before·after는 입력칸 앞뒤의 짧은 꼬리표이고 지시문은 쓰지 않는다. explanation은 정답인 이유 1~2문장.",
  "원칙",
  "- 계획의 given(주는 것)은 본문에 쓰고, mustRecall(꺼낼 것)과 정답은 정답 공개 전에 보이는 글(본문·입력칸 문구)에 쓰지 않는다. 외워야 할 목록·대응표·정의를 본문에 적어 놓고 그 안에서 찾게 하지 않는다.",
  "- 계획의 conditions는 본문에 빠짐없이 쓴다. 원문의 조건(대상·경우·관례·단위·시간·부정·범위)을 줄이거나 바꾸지 않는다.",
  "- 계획의 종류대로 묻는다. 상황선택은 구체 상황을 주고 방법·개념을 고르게, 적용계산은 원문 예시와 다른 수치로 계산하게(정답은 직접 검산), 이유는 '왜'를, 구별은 둘을 가르는 기준을 묻는다.",
  "- 단원 원문이 계획·지도와 다르면 원문을 따른다. 원문에 없는 사실을 만들지 않는다.",
  "- 같은 단원의 여러 문항에 같은 수치·같은 정답을 다시 쓰지 않는다. 수식·행렬은 math 블록에 LaTeX로 쓴다.",
  "[형식 규칙]",
].join("\n");

export function authorUser(input: GenInput, section: Section, sectionText: string, objectives: Objective[], map: KnowledgeMap) {
  const conceptIds = new Set(objectives.flatMap((objective) => objective.conceptIds ?? []));
  const relationIds = new Set(objectives.flatMap((objective) => objective.relationIds ?? []));
  const concepts = map.concepts.filter((concept) => concept.sectionId === section.id || conceptIds.has(concept.id));
  const relations = map.relations.filter((relation) => relation.sectionIds.includes(section.id) || relationIds.has(relation.id));
  const materials = map.materials.filter((material) => section.pages.includes(material.page));
  const plan = objectives.map((objective) => [
    `- id: ${objective.id} [${objective.qtype ?? objective.kind}]`,
    `  목표: ${objective.statement}`,
    `  주는 것: ${objective.given ?? objective.cue}`,
    `  꺼낼 것: ${objective.recall}`,
    `  조건: ${(objective.conditions ?? []).join(" / ") || "(없음)"}`,
    `  근거: ${objective.quotes.map((q) => `「${q}」`).join(" ")}`,
  ].join("\n"));
  return [
    `[자료] ${input.fileName}`, `[단원] ${section.title} (p.${section.pages.join(", ")})`, `[목적] ${purposeLabel[input.purpose]}`,
    `[단원 원문]\n${sectionText}`,
    `[이 단원 지식 지도]\n${JSON.stringify({ concepts: concepts.map(({ id, name, content, conditions, steps }) => ({ id, name, content, conditions, steps })),
      relations: relations.map(({ id, kind, statement }) => ({ id, kind, statement })), materials })}`,
    `[문항 계획]\n${plan.join("\n")}`,
    input.remake?.previous && Object.keys(input.remake.previous).length
      ? `[다시 만들기: 신고된 이전 문제와 다른 상황·형식으로]\n${objectives.map((objective) => input.remake?.previous[objective.id] ? `- ${objective.id}: ${input.remake.previous[objective.id]}` : "").filter(Boolean).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

// ---- ④ 관문 ---------------------------------------------------------------------------------------------------
const loose = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\s.,;:!?·'"`()[\]{}<>「」『』“”‘’$\\^_]/g, "");
const tokens = (text: string) => [...new Set(text.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 2))];
const STOP = new Set(["the", "and", "of", "to", "in", "is", "a", "an", "for", "있다", "한다", "때", "경우", "이다", "하는", "수", "것", "및", "또는"]);

/** What a learner reads before the answer is revealed: stem blocks, options, input labels. */
export function questionView(question: AuthoredQuestion, label: string) {
  const LETTERS = ["A", "B", "C", "D"];
  const lines = question.blocks.map((block: AuthoringBlock) => {
    switch (block.kind) {
      case "text": return block.text;
      case "box": return block.label ?? "";
      case "math": return `식: ${block.latex}`;
      case "table": return block.rows.map((row) => row.join(" | ")).join("\n");
      case "choice-set": {
        const response = question.responses.find((candidate) => candidate.id === block.responseId);
        if (response?.kind !== "single-choice") return "";
        return block.optionIds.map((id, index) => { const option = response.options.find((candidate) => candidate.id === id); return `${LETTERS[index]}. ${option?.text ?? option?.latex ?? ""}`; }).join("\n");
      }
      case "blank": return `[답 입력칸] ${block.promptBefore} ____ ${block.promptAfter}`.replace(/\s+/g, " ").trim();
      default: return "";
    }
  }).filter((text) => text.trim());
  return [`### ${label}`, ...lines].join("\n");
}
function stemOnly(question: AuthoredQuestion) {
  return question.blocks.map((block) => block.kind === "text" ? block.text : block.kind === "math" ? block.latex : block.kind === "table" ? block.rows.flat().join(" ")
    : block.kind === "box" ? block.label ?? "" : block.kind === "blank" ? `${block.promptBefore} ${block.promptAfter}` : "").join("\n");
}
function optionsText(question: AuthoredQuestion) {
  return question.responses.flatMap((response) => response.kind === "single-choice" ? response.options.map((option) => option.text ?? option.latex ?? "") : []).join("\n");
}

/** Code part of the gate: the thing to recall written into the stem (hard), conditions not visible (hint for the model check). */
export function gateCode(question: AuthoredQuestion, objective: Objective): { leak: string | null; hints: string[] } {
  const stem = stemOnly(question);
  const recall = objective.recall;
  let leak: string | null = null;
  if (loose(recall).length >= 6 && loose(stem).includes(loose(recall))) leak = "꺼낼 것이 문제 본문에 그대로 적혀 있음";
  else {
    const want = tokens(recall).filter((token) => !STOP.has(token));
    const have = new Set(tokens(stem));
    if (want.length >= 5 && want.filter((token) => have.has(token)).length / want.length >= 0.85) leak = "꺼낼 것의 핵심 낱말 대부분이 문제 본문에 있음";
  }
  const visible = new Set(tokens(`${stem}\n${optionsText(question)}`));
  const hints = (objective.conditions ?? []).filter((condition) => {
    const keys = tokens(condition).filter((token) => !STOP.has(token));
    return keys.length > 0 && !keys.some((token) => visible.has(token));
  }).map((condition) => `계획의 조건 '${condition}'이 본문에 안 보임`);
  return { leak, hints };
}

/*
 * The gate asks two separate questions (변경 2026-10-19): with the unit's source in the same call, the model judged
 * "answerable from the question alone" by quoting the source (first real run: every question flagged). So the
 * derivability check sees only what the learner sees; the misreading check sees the source.
 */
export const derivableSchema = obj({ questions: arr(obj({
  questionId: str("문항 머리글(Q1, Q2 …) 그대로"),
  derivable: bool("과목 지식 없이 문제 글(본문·보기·입력칸 문구)만으로 꺼낼 것을 알아낼 수 있는가"),
  evidence: str("derivable이면 그렇게 만드는 문제 글의 문장(문제에 실제로 적힌 것만), 아니면 빈 문자열"),
})) });
export const derivableReply = z.object({ questions: z.array(z.object({ questionId: z.string(), derivable: z.boolean(), evidence: z.string() })) });
export const misreadSchema = obj({ questions: arr(obj({
  questionId: str("문항 머리글(Q1, Q2 …) 그대로"),
  misreading: bool("원문과 대조해, 문제를 다르게 읽으면 정답이 틀려지는 해석이 있는가(조건이 빠지거나 넓어져서)"),
  detail: str("misreading이면 그 해석과 빠진 조건, 아니면 빈 문자열"),
})) });
export const misreadReply = z.object({ questions: z.array(z.object({ questionId: z.string(), misreading: z.boolean(), detail: z.string() })) });

export const DERIVABLE_SYSTEM = [
  "너는 이 과목을 공부하지 않은 사람이다. 자료는 볼 수 없고, 아래 문제 글만 보인다.",
  "문항마다 판단한다: 문제 글에 적힌 정보만으로 '꺼낼 것'을 알아낼 수 있는가. 문제에 외울 내용(목록·대응표·정의·식)이 적혀 있어 세기·찾기·옮겨 쓰기로 답이 나오면 true.",
  "일반 상식으로 맞히는 것, 문제가 준 수치에 기억해야 하는 규칙을 적용해 계산하는 것은 false다. 확실하지 않으면 false.",
  "true면 그렇게 만드는 문장을 문제 글에서 그대로 옮겨 evidence에 쓴다. 문제 글에 없는 문장은 쓰지 않는다. 문항 머리글(Q1, Q2 …)을 questionId에 그대로 쓴다.",
].join("\n");
export const MISREAD_SYSTEM = [
  "너는 문항 검사자다. 정답이 맞는지는 판단하지 않는다. 문항마다 하나만 판단한다.",
  "[단원 원문]과 대조해, 문제가 조건(대상·경우·관례·단위·시간·범위)을 빼거나 넓혀서 정답이 틀리게 읽히는 해석이 있는가. 있으면 그 해석과 빠진 조건을 detail에 쓴다. 확실하지 않으면 false.",
  "문항 머리글(Q1, Q2 …)을 questionId에 그대로 쓴다.",
].join("\n");

type GateEntry = { label: string; question: AuthoredQuestion; objective: Objective; answer: string; hints: string[] };
export function derivableUser(entries: GateEntry[]) {
  return entries.map((entry) => [questionView(entry.question, entry.label), `꺼낼 것: ${entry.objective.recall}`].join("\n")).join("\n\n");
}
export function misreadUser(sectionText: string, entries: GateEntry[]) {
  return [`[단원 원문]\n${sectionText}`, ...entries.map((entry) => [
    questionView(entry.question, entry.label), `정답: ${entry.answer}`,
    entry.hints.length ? `참고(코드 검사): ${entry.hints.join(" / ")}` : "",
  ].filter(Boolean).join("\n"))].join("\n\n");
}

/** A derivable verdict counts only when its evidence is really in the question text (guards against quoting the source). */
export function evidenceInQuestion(evidence: string, question: AuthoredQuestion) {
  const text = loose(questionView(question, ""));
  const want = loose(evidence);
  if (want.length < 4) return false;
  if (text.includes(want)) return true;
  const parts = evidence.split(/[“”"…]+|\.\.\./).map(loose).filter((part) => part.length >= 6);
  return parts.length > 0 && parts.every((part) => text.includes(part));
}
