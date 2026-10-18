// 앱 안의 코치 (docs/학습흐름_자동화.md, docs/품질_자동화.md): the app itself watches the day plan and the quality
// ledger and turns what it sees into a few cards, each with one-tap actions. No model calls: every card is a rule
// over numbers the app already has. Paid steps (making or remaking material) are only ever suggested.
import type { TodayPlan, StudyRules, PlanPrefs } from "./plan.ts";
import type { Cause } from "./quality.ts";

export type CoachAction =
  | { label: string; do: "summary"; subject: string }
  | { label: string; do: "weak"; subject: string }
  | { label: string; do: "minutes"; minutes: number }
  | { label: string; do: "subjects" }
  | { label: string; do: "genNote"; text: string }
  | { label: string; do: "propose"; cause: Cause; text: string }
  | { label: string; do: "create" };
export type CoachCard = { id: string; kind: "study" | "improve"; title: string; body: string; actions: CoachAction[] };
export type CoachInput = {
  plan: TodayPlan;
  rules: StudyRules;
  prefs?: PlanPrefs & { genNote?: string; coachSeen?: Record<string, string> };
  counts: Partial<Record<Cause, number>>;
  /** Materials waiting for the learner (objective confirmation), and materials without a subject. */
  waiting: number;
  unassigned: number;
  subjectsWithoutDate: string[];
};

/** Lines the coach can add to the memo of the next material (자료 만들기 메모), by cause. */
export const GEN_NOTES: Partial<Record<Cause, string>> = {
  "지엽": "지엽적인 세부(인명·연도·자잘한 수치·예시 이름)는 빼고 핵심 개념과 관계 위주로.",
  "너무쉬움": "단순 정의 확인보다 적용·비교·이유를 묻는 문제 위주로.",
  "빠뜨림": "슬라이드의 본문 내용은 빠짐없이 목표로 잡기(표지·목차·출처 제외).",
};
const PROPOSALS: Partial<Record<Cause, string>> = {
  "인정답안누락": "단답 정답의 표기가 좁아요. 출제기준 단답-1에 '같은 값의 다른 표기(공백, 괄호, 분수·소수)를 인정 답안에 모두 넣는다'를 더하는 후보.",
  "형식선택": "표기가 여럿인 답이 단답으로 나와요. 출제기준 단답-1의 '단답은 표기 하나일 때만'을 예시와 함께 강화하는 후보.",
  "정답오류": "정답 오류 신고가 쌓였어요. 판정단으로 그 자료를 점검하고 신고한 목표를 다시 만드는 후보(유료).",
  "애매함": "애매한 문제 신고가 쌓였어요. 나쁜 예(출제기준/예시/나쁜예.md)에 신고 문제를 넣는 후보.",
  "원문불일치": "원문과 다른 문제 신고가 쌓였어요. 그림 쪽 읽기(transcribe) 결과를 점검하는 후보.",
  "목표설계": "목표를 자주 빼요. 목표설계 기준(설계-3: 강의 안내 제외)을 예시와 함께 강화하는 후보.",
  "지엽": "지엽적이라는 피드백이 쌓였어요. 목표설계의 '핵심 암기' 절에 세부 사항 제외 규칙을 더하는 후보.",
  "빠뜨림": "빠진 쪽 기록이 쌓였어요. 그 쪽들만 다시 만들기(유료) 또는 분류 단계 page-uncovered 기준을 낮추는 후보.",
};

const seen = (input: CoachInput, id: string) => Boolean(input.prefs?.coachSeen?.[id]);
const bucket = (count: number, threshold: number) => Math.floor(count / Math.max(1, threshold));

export function coachCards(input: CoachInput): CoachCard[] {
  const { plan, rules } = input;
  const cards: CoachCard[] = [];
  const add = (card: CoachCard) => { if (!seen(input, card.id)) cards.push(card); };

  // ---- 학습 유도
  for (const subject of plan.subjects) {
    if (subject.phase === "final" && subject.name) add({
      id: `final:${subject.name}:${plan.date}`, kind: "study", title: `${subject.name} 시험이 ${subject.daysLeft === 0 ? "오늘" : "내일"}이에요`,
      body: `새 문제는 내지 않아요. 한 장 정리를 가리고 한 번 훑은 뒤, 약점 ${subject.counts.weak}개를 풀어요.`,
      actions: [{ label: "한 장 정리", do: "summary", subject: subject.name }, ...(subject.counts.weak ? [{ label: "약점 풀기", do: "weak" as const, subject: subject.name }] : [])],
    });
  }
  const minutes = input.prefs?.dailyMinutes ?? rules.dailyMinutes;
  if (plan.needMinutes > minutes * 1.3 && plan.needMinutes - minutes >= 15) {
    const suggest = Math.min(300, Math.ceil(plan.needMinutes / 15) * 15);
    add({
      id: `backlog:${plan.date}`, kind: "study", title: "오늘 할 양이 하루 시간보다 많아요",
      body: `시험에 맞춰 다 보려면 오늘 약 ${plan.needMinutes}분이 필요해요(지금 하루 ${minutes}분). 시간을 늘리지 않으면 시험이 먼 과목의 새 문제부터 줄여요.`,
      actions: [{ label: `하루 ${suggest}분으로`, do: "minutes", minutes: suggest }],
    });
  }
  for (const subject of plan.subjects) {
    if (subject.phase !== "learn" || !subject.name || subject.counts.weak < 15) continue;
    add({ id: `weakpile:${subject.name}:${plan.date}`, kind: "study", title: `${subject.name} 약점이 ${subject.counts.weak}개 쌓였어요`,
      body: "새 문제보다 약점을 먼저 줄이면 시험 직전이 가벼워져요.", actions: [{ label: "약점부터 풀기", do: "weak", subject: subject.name }] });
  }
  if (input.waiting) add({ id: `waiting:${plan.date}:${input.waiting}`, kind: "study", title: `목표 확인을 기다리는 자료 ${input.waiting}개`,
    body: "목표를 확인해야 문제가 만들어져요. 연습 탭 위쪽 자료 카드에서 확인할 수 있어요.", actions: [] });
  if (input.subjectsWithoutDate.length) add({ id: `nodate:${input.subjectsWithoutDate.join(",")}`, kind: "study", title: "시험일이 없는 과목이 있어요",
    body: `${input.subjectsWithoutDate.join(", ")}: 시험일을 넣으면 그날까지 새 문제를 나눠서 내요.`, actions: [{ label: "시험일 넣기", do: "subjects" }] });
  if (input.unassigned) add({ id: `unassigned:${input.unassigned}`, kind: "study", title: `과목이 없는 자료 ${input.unassigned}개`,
    body: "과목을 고르면 시험일에 맞춰 오늘 할 것에 들어가요.", actions: [{ label: "과목 고르기", do: "subjects" }] });

  // ---- 자체 개선 (장부에서 같은 원인이 문턱을 넘을 때마다 한 번)
  const threshold = rules.candidateThreshold;
  const genNote = input.prefs?.genNote ?? "";
  for (const [cause, count] of Object.entries(input.counts) as Array<[Cause, number]>) {
    if (count < threshold) continue;
    const id = `improve:${cause}:${bucket(count, threshold)}`;
    const note = GEN_NOTES[cause];
    const actions: CoachAction[] = [];
    if (note && !genNote.includes(note)) actions.push({ label: "다음 자료 메모에 넣기", do: "genNote", text: note });
    if (PROPOSALS[cause]) actions.push({ label: "개선 후보로 올리기", do: "propose", cause, text: PROPOSALS[cause]! });
    if (!actions.length) continue;
    add({ id, kind: "improve", title: `${causeTitle[cause] ?? cause} ${count}번`, body: PROPOSALS[cause] ?? note ?? "", actions });
  }
  // Study cards first (today matters most), at most three of each.
  return [...cards.filter((card) => card.kind === "study").slice(0, 3), ...cards.filter((card) => card.kind === "improve").slice(0, 2)];
}
const causeTitle: Partial<Record<Cause, string>> = {
  "인정답안누락": "‘내 답도 맞아요’", "형식선택": "카드로 바꾼 문제", "정답오류": "정답 오류 신고", "애매함": "애매함 신고", "원문불일치": "원문과 다름 신고",
  "목표설계": "목표 빼기", "지엽": "‘지엽적’ 피드백", "빠뜨림": "빠진 쪽 기록", "너무쉬움": "너무 쉬운 문제",
};
