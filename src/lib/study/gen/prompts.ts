// Prompts for the four model calls. Each says only what that call decides; the shape is enforced by the schema.
// No tool talk: the app sends the source text itself, so nothing here refers to reading tools or MCP.
import type { ClassItem, GenInput, Objective, Purpose, Section } from "./types.ts";
import { purposeLabel } from "./types.ts";

const COMMON = [
  "원문에 없는 사실을 만들지 않는다. 원문의 기호·용어·표기를 바꾸지 않는다.",
  "인용 칸에는 원문을 글자 그대로 복사한다. 요약하거나 번역하거나 고쳐 쓰지 않는다.",
].join("\n");

/** What each purpose turns into a learning target (docs/DECISIONS.md 2026-10-12). */
export const PURPOSE_RULE: Record<Purpose, string> = {
  read: "그냥 읽기: 문제를 만들지 않는다.",
  understand: "이해: 개념, 관계, 이유처럼 '왜·어떻게'를 설명할 수 있어야 하는 것만 적게 고른다. 단순 용어·수치 암기는 고르지 않는다.",
  core: "핵심 암기: 핵심 지식과 재사용 패턴 가운데 이 자료의 목적상 꼭 떠올려야 하는 것만 고른다. 보조 설명·부가 정보는 고르지 않는다.",
  all: "통암기: 핵심 지식, 재사용 패턴, 원문에 나온 사실(정의, 수치, 순서)까지 떠올려야 할 것을 빠짐없이 고른다.",
};

const FORMAT_RULE: Record<Purpose, string> = {
  read: "",
  understand: "설명형을 우선한다: 이유·관계를 떠올려 말하게 하는 self-check, 헷갈리는 개념을 가르는 choice.",
  core: "목표 종류에 맞춘다: 용어·사실은 short, 개념 구별은 choice, 식·절차·여러 요소는 self-check.",
  all: "떠올리기 중심: short와 self-check를 우선하고, 구별이 핵심일 때만 choice.",
};

export function outlinePrompt(input: GenInput, pageText: string) {
  const system = [
    "너는 학습자료의 목차를 정리한다.",
    "원문에 있는 장·절·슬라이드 제목으로 목차를 만든다. 내용 설명·요약은 쓰지 않는다.",
    "목차 항목 하나가 한 번에 공부할 단위가 된다. 보통 1~6쪽이 되게 하고, 아주 긴 장은 원문의 절 제목으로 나눈다.",
    "고른 쪽을 빠짐없이 원문 순서대로 덮는다. 명시적 목차가 없으면 실제 제목이나 슬라이드 제목을 쓴다.",
    COMMON,
  ].join("\n");
  const user = [`[자료] ${input.fileName}`, `[고른 쪽] ${input.pageNumbers.join(", ")}`, `[원문: 쪽별 추출 글자]\n${pageText}`].join("\n\n");
  return { system, user };
}

export function classifyPrompt(input: GenInput, section: Section, pageText: string) {
  const system = [
    "너는 학습자료의 한 부분을 내용 성격별로 나눈다. 무엇을 공부할지는 아직 정하지 않는다.",
    "kind 기준:",
    "- 핵심 지식: 정의, 원리, 규칙, 식, 절차처럼 이 부분이 가르치는 내용",
    "- 재사용 패턴: 여러 상황에 그대로 다시 쓰는 틀(문장 패턴, 풀이 틀, 코드 관용구)",
    "- 예시: 핵심 지식을 보여 주는 구체적 사례",
    "- 설명: 핵심 지식을 풀어 주는 말, 이유, 비유",
    "- 학습 지시: 공부 방법이나 과제 안내",
    "- 연습문제: 원문에 실린 문제",
    "- 부가 정보: 출처, 일화, 공지처럼 학습 대상이 아닌 것",
    "내용 하나에 항목 하나. 같은 패턴을 보여 주는 예시가 여러 개면 패턴은 재사용 패턴으로, 각 예시는 예시로 둔다.",
    "글자가 거의 없는 쪽(그림 위주)은 건너뛴다. 원문에 없는 내용을 채우지 않는다.",
    COMMON,
  ].join("\n");
  const user = [`[자료] ${input.fileName}`, `[목차] ${section.title} (p.${section.pages.join(", ")})`, `[원문: 쪽별 추출 글자]\n${pageText}`].join("\n\n");
  return { system, user };
}

export function designPrompt(input: GenInput, section: Section, items: ClassItem[]) {
  const system = [
    "너는 학습 설계자다. 분류된 내용에서 학습자가 '자료를 보지 않고 떠올려야 하는 것'을 학습 목표로 고른다.",
    `목적 규칙 — ${PURPOSE_RULE[input.purpose]}`,
    "목표 하나 = 떠올릴 것 하나(개념 하나, 식 하나, 절차 하나). 여러 사실을 한 목표에 묶지 않는다.",
    "같은 패턴을 보여 주는 예시 여러 개는 목표를 따로 만들지 않고 그 패턴 하나로 묶는다. 구체적 사실 자체가 학습 대상이면 무리하게 일반화하지 않는다.",
    "예시·연습문제·부가 정보는 목표의 근거로 쓰지 않는다. 문제 소재로 쓸 만하면 materialNumbers에 넣는다.",
    "cue와 recall은 실제로 쓰는 상황 기준이다: 학습자가 무엇을 보고(cue) 무엇을 떠올려야(recall) 하는가. 예: 말하기 표현이면 '하고 싶은 말 → 영어 표현'.",
    "statement와 cue에 recall(정답)을 그대로 쓰지 않는다.",
    "고를 것이 없으면 빈 배열을 낸다.",
  ].join("\n");
  const list = items.map((item) => `${item.n}. [${item.kind}] ${item.content} (p.${item.page}) 「${item.quote}」`).join("\n");
  const signals = [...input.signals.weakSpots.map((value) => `- 약점: ${value}`), ...input.signals.reports.map((value) => `- 신고: ${value}`)];
  const user = [
    `[자료] ${input.fileName}`,
    `[목차] ${section.title} (p.${section.pages.join(", ")})`,
    `[목적] ${purposeLabel[input.purpose]}`,
    input.note.trim() ? `[학습자 메모] ${input.note.trim().slice(0, 600)}` : "",
    signals.length ? `[먼저 다룰 것]\n${signals.join("\n")}` : "",
    `[분류된 내용]\n${list}`,
  ].filter(Boolean).join("\n\n");
  return { system, user };
}

export function authorPrompt(input: GenInput, section: Section, objectives: Objective[], items: ClassItem[]) {
  const system = [
    "너는 인출 연습 문제 출제자다. 목표마다 문항을 정확히 하나 만든다.",
    "문항은 블록을 읽는 순서대로 쌓아 만든다: heading(제목), text(본문), math(LaTeX 식), table(표), box(강조 상자). 위치·크기는 정하지 않는다. 코드가 위에서 아래로 쌓는다.",
    "응답 형식:",
    "- choice: 보기 정확히 4개, correctIndex는 0부터. 오답은 학습자가 실제로 헷갈릴 오개념(부호·순서 반전, 조건 누락, 비슷한 개념 혼동). 네 보기의 길이·문체·구체성을 비슷하게, 정답에만 조건을 붙이지 않는다. '항상·절대·전혀' 같은 티 나는 오답 금지.",
    "- short: 답이 짧은 값 하나(수, 좌표, 기호, 용어, 20자 이내)일 때만. accepted에 원문 표기를 먼저, 같은 뜻의 다른 표기를 뒤에.",
    "- self-check: 식·정의·절차·이유처럼 여러 요소를 떠올려야 할 때. accepted에 모범 답 하나(원문 표기 유지).",
    `형식 선택 — ${FORMAT_RULE[input.purpose]}`,
    "목표의 cue를 문제 상황으로 삼고 recall을 떠올리게 한다. 공개 전에 보이는 글(본문, 보기, 입력칸 앞뒤 문구)에 정답이나 결정적 단서를 쓰지 않는다.",
    "풀이에 필요한 조건(수치, 기준, 방향, 단위)은 본문에 모두 넣는다. 소재 항목의 상황·수치를 쓸 수 있고, 수치를 새로 정했다면 검산한다.",
    "식·절차가 목표면 원문 예시를 그대로 묻지 말고 수치나 상황을 바꾼 적용 문제를 낼 수 있다.",
    COMMON,
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
  const user = [`[자료] ${input.fileName}`, `[목차] ${section.title}`, `[목적] ${purposeLabel[input.purpose]}`, `[목표]\n${blocks.join("\n")}`].join("\n\n");
  return { system, user };
}

/** A retry shows the previous answer and what failed, and asks to fix only that. */
export function retryUser(user: string, previous: unknown, problems: string[]) {
  return `${user}\n\n[이전 답]\n${JSON.stringify(previous)}\n\n[검사에서 걸린 것]\n${problems.map((problem) => `- ${problem}`).join("\n")}\n\n걸린 것만 고치고 나머지는 그대로 둔 같은 형식의 JSON 전체를 다시 쓴다.`;
}
