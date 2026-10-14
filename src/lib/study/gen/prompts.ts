// Prompts for the four model calls. Each says only what that call decides; the shape is enforced by the schema.
// No tool talk: the app sends the source text itself, so nothing here refers to reading tools or MCP.
// Judgment rules for design and authoring live in the editable 출제기준/ folder (guide.ts) and arrive as `guide`;
// what stays here is what the reply's fields mean.
import type { ClassItem, GenInput, Objective, Section } from "./types.ts";
import { purposeLabel } from "./types.ts";

const COMMON = [
  "원문에 없는 사실을 만들지 않는다. 원문의 기호·용어·표기를 바꾸지 않는다.",
  "인용 칸에는 원문을 글자 그대로 복사한다. 요약하거나 번역하거나 고쳐 쓰지 않는다.",
].join("\n");

/** The finer headings inside a unit, as context for classify and design. Empty when the outline has none. */
const partsLine = (section: Section) => section.parts?.length ? `[세부 항목] ${section.parts.map((part) => `${part.title} (p.${part.pages[0]}${part.pages.length > 1 ? `–${part.pages.at(-1)}` : ""})`).join(" / ")}` : "";

export function outlinePrompt(input: GenInput, pageText: string) {
  const system = [
    "너는 학습자료의 목차를 정리한다.",
    "원문에 있는 장·절·슬라이드 제목으로 목차를 만든다. 내용 설명·요약은 쓰지 않는다.",
    "목차는 두 단계다. sections(단원)는 한 번에 공부할 단위로, 한 주제를 다루는 여러 쪽을 묶어 보통 4~10쪽이 되게 한다. 슬라이드마다 단원을 만들지 않는다. 아주 긴 장은 원문의 절 제목으로 나눈다.",
    "parts(세부 항목)는 단원 안의 원문 소제목이나 슬라이드 제목을 원문 순서대로 쓴다. 세밀해도 된다. 같은 제목이 이어지는 쪽은 하나로 쓴다.",
    "표지, 강의·차시 안내(학습목표 목록, 수업 진행 방식, 평가·교재·일정 안내), 퀴즈, 요약 쪽은 따로 단원을 만들지 않고 이웃 단원에 붙인다.",
    "고른 쪽을 빠짐없이 원문 순서대로 덮는다. 명시적 목차가 없으면 실제 제목이나 슬라이드 제목을 쓴다.",
    "startText에는 그 항목이 시작되는 곳의 원문 글자(보통 제목 줄)를 그대로 복사한다. 한 쪽 중간에서 다음 항목이 시작되면 코드가 이 글자 위치에서 쪽을 나눈다.",
    COMMON,
  ].join("\n");
  const user = [`[자료] ${input.fileName}`, `[고른 쪽] ${input.pageNumbers.join(", ")}`, `[원문: 쪽별 추출 글자]\n${pageText}`].join("\n\n");
  return { system, user };
}

export function classifyPrompt(input: GenInput, section: Section, pageText: string, others: string[] = []) {
  const system = [
    "너는 학습자료의 한 부분을 내용 성격별로 나눈다. 무엇을 공부할지는 아직 정하지 않는다.",
    "kind 기준:",
    "- 핵심 지식: 정의, 원리, 규칙, 식, 절차처럼 이 부분이 가르치는 내용",
    "- 재사용 패턴: 여러 상황에 그대로 다시 쓰는 틀(문장 패턴, 풀이 틀, 코드 관용구)",
    "- 예시: 핵심 지식을 보여 주는 구체적 사례",
    "- 설명: 핵심 지식을 풀어 주는 말, 이유, 비유",
    "- 학습 지시: 공부 방법, 과제, 강의 운영 안내(이 강의·차시의 학습목표 목록, 수업 진행 방식, 평가 비율, 교재·일정, 퀴즈 안내)",
    "- 연습문제: 원문에 실린 문제",
    "- 부가 정보: 출처, 일화, 공지처럼 학습 대상이 아닌 것",
    "\"~을 이해하고 설명할 수 있다\" 같은 학습목표 안내 문장은 내용을 가르치지 않으므로 핵심 지식이 아니라 학습 지시다.",
    "내용 하나에 항목 하나. 같은 패턴을 보여 주는 예시가 여러 개면 패턴은 재사용 패턴으로, 각 예시는 예시로 둔다.",
    "글자가 거의 없는 쪽(제목뿐인 쪽)은 건너뛴다. 식·표·그림 설명으로 옮겨 적힌 쪽은 내용이므로 건너뛰지 않는다. 원문에 없는 내용을 채우지 않는다.",
    "받은 원문은 이 목차에 해당하는 부분만 잘라 낸 것이다. 그 밖의 내용은 다른 목차에서 다루므로 끌어오지 않는다.",
    COMMON,
  ].join("\n");
  const user = [`[자료] ${input.fileName}`, `[목차] ${section.title} (p.${section.pages.join(", ")})`, partsLine(section),
    others.length ? `[같은 쪽의 다른 목차(다루지 않음)] ${others.join(" / ")}` : "",
    `[원문: 이 목차 부분의 쪽별 추출 글자]\n${pageText}`].filter(Boolean).join("\n\n");
  return { system, user };
}

export function designPrompt(input: GenInput, section: Section, items: ClassItem[], guide: string) {
  const system = [
    "너는 학습 설계자다. 분류된 내용에서 학습자가 '자료를 보지 않고 떠올려야 하는 것'을 학습 목표로 고른다.",
    "칸의 뜻: statement는 학습자 행동으로 쓴 목표, cue는 학습자가 보는 것, recall은 떠올려야 하는 것 하나, itemNumbers는 근거가 되는 분류 항목 번호, materialNumbers는 문제 소재로 쓸 예시·연습문제 항목 번호, importance는 core 또는 support.",
    "고를 것이 없으면 빈 배열을 낸다.",
    "아래 [기준]을 따른다.",
    `[기준]\n${guide}`,
  ].join("\n");
  const list = items.map((item) => `${item.n}. [${item.kind}] ${item.content} (p.${item.page}) 「${item.quote}」`).join("\n");
  const signals = [...input.signals.weakSpots.map((value) => `- 약점: ${value}`), ...input.signals.reports.map((value) => `- 신고: ${value}`)];
  const user = [
    `[자료] ${input.fileName}`,
    `[목차] ${section.title} (p.${section.pages.join(", ")})`,
    partsLine(section),
    `[목적] ${purposeLabel[input.purpose]}`,
    input.note.trim() ? `[학습자 메모] ${input.note.trim().slice(0, 600)}` : "",
    signals.length ? `[먼저 다룰 것]\n${signals.join("\n")}` : "",
    `[분류된 내용]\n${list}`,
  ].filter(Boolean).join("\n\n");
  return { system, user };
}

export function authorPrompt(input: GenInput, section: Section, objectives: Objective[], items: ClassItem[], guide: string) {
  const system = [
    "너는 인출 연습 문제 출제자다. 목표마다 문항을 정확히 하나 만든다.",
    "문항은 블록을 읽는 순서대로 쌓아 만든다: heading(제목), text(본문), math(LaTeX 식), table(표, 첫 행은 머리글), box(강조 상자). 위치·크기는 정하지 않는다. 코드가 위에서 아래로 쌓는다.",
    "answer 칸: choice는 options 4개와 correctIndex(0부터), short는 accepted에 인정 답안들, self-check는 accepted에 모범 답 하나. before·after는 입력칸 앞뒤의 짧은 꼬리표(예: '자료구조:', '단위: ms')이고 지시문('떠올려 보세요', '비교하세요')은 쓰지 않는다. explanation은 정답인 이유 1~2문장.",
    "목표마다 주어진 소재 항목의 상황·수치를 문제에 쓸 수 있다.",
    "아래 [기준]을 따른다.",
    `[기준]\n${guide}`,
  ].join("\n");
  const material = new Map(items.map((item) => [item.n, item]));
  const blocks = objectives.map((objective) => [
    `- id: ${objective.id} [${objective.kind}]`,
    `  목표: ${objective.statement}`,
    `  보고(cue): ${objective.cue}`,
    `  떠올릴 것(recall): ${objective.recall}`,
    `  근거: ${objective.quotes.map((quote) => `「${quote}」`).join(" ")}`,
    ...objective.materialNumbers.map((n) => material.get(n)).filter(Boolean)
      .map((item) => `  소재(${item!.kind}): ${item!.content} 「${item!.quote}」`),
  ].join("\n"));
  const previous = objectives.map((objective) => input.remake?.previous[objective.id] ? `- ${objective.id}: ${input.remake.previous[objective.id]}` : "").filter(Boolean);
  const user = [`[자료] ${input.fileName}`, `[목차] ${section.title}`, `[목적] ${purposeLabel[input.purpose]}`, `[목표]\n${blocks.join("\n")}`,
    // A remake: the learner reported these questions as odd. Same objective, a different question that avoids the earlier one's problem.
    previous.length ? `[다시 만들기: 학습자가 이상하다고 신고한 이전 문제. 같은 목표로, 이전 문제와 다른 상황·형식으로 다시 낸다]\n${previous.join("\n")}` : ""].filter(Boolean).join("\n\n");
  return { system, user };
}

/** A retry shows the previous answer and what failed, and asks to fix only that. */
export function retryUser(user: string, previous: unknown, problems: string[]) {
  return `${user}\n\n[이전 답]\n${JSON.stringify(previous)}\n\n[검사에서 걸린 것]\n${problems.map((problem) => `- ${problem}`).join("\n")}\n\n걸린 것만 고치고 나머지는 그대로 둔 같은 형식의 JSON 전체를 다시 쓴다.`;
}
