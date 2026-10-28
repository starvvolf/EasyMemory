// 지식 저장소의 바깥 입구 (2026-10-28, 협업/스레드분담_20261028.md 3장).
//
// 지식 저장소(src/lib/knowledge/) 밖의 코드는 이 파일로만 지식 저장소를 부른다. 화면은 /api/knowledge를 그대로 쓴다.
// 약속: 여기서 내보내는 함수의 이름과 받는 값은 바꾸지 않는다. 바꿔야 하면 새 함수를 더하고 옛 함수는 남긴다.
// 이 약속은 api.test.ts가 확인한다. 안쪽 로직은 store.ts · questions.ts · sources.ts에 있고, 여기는 다시 내보내기만 한다.
//
// 누가 무엇을 쓰나 (10/28 기준)
// - 코드 문제(src/lib/code/service.ts, src/lib/assist/code-ai.ts): saveMany, recordEvent, memoryEvents, searchKnowledge, KEventKind
// - 일정(src/lib/schedule/store.ts): reviewQueue, tree, dayOf, listGoals, goalItemIds, updateGoal (기한 = 목표의 날짜)
// - 에이전트 툴(src/lib/agent/tools.ts): 지식 읽기·쓰기, 지식에서 만드는 문제, 읽은 글

/* ---------- 지식 저장·찾기 ---------- */
export { saveKnowledge, saveMany, getKnowledge, searchKnowledge, tree, linkKnowledge, setKnowledgeState } from "./store.ts";

/* ---------- 기록 (3단계 메모리) ---------- */
export { recordEvent, memoryOverview, memorySummary, memoryEvents } from "./store.ts";

/* ---------- 복습 ---------- */
export { reviewQueue, reviewStatus, dayOf } from "./store.ts";

/* ---------- 비슷한 지식 후보 (임베딩, 2026-10-28 추가) ---------- */
export { similarKnowledge } from "./embed.ts";
export type { SimilarHit } from "./embed.ts";

/* ---------- 목표 (4개 축, 2026-10-28 추가): 자료를 넣으면 지식이 따라오고, 날짜가 시험·마감 ---------- */
export { listGoals, getGoal, createGoal, updateGoal, goalItemIds, goalReview, sourceKey } from "./goals.ts";
export type { Goal, GoalSource } from "./goals.ts";

/* ---------- 지식에서 바로 만드는 문제 (AI 호출 없음) ---------- */
export { questionsFor, grade, QUESTION_LABEL } from "./questions.ts";

/* ---------- 읽은 글 (웹 글) ---------- */
export { getSource, listSources } from "./sources.ts";

/* ---------- 타입 ---------- */
export type { Knowledge, KState, KSource, KEvent, KEventKind, SaveInput, SaveResult, ItemLite, SearchHit, SourceKind } from "./store.ts";
export type { Question, QuestionKind, Graded } from "./questions.ts";
export type { ReadSource } from "./sources.ts";
