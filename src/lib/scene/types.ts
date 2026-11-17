// 상황 재현 복습 (3번 판, 11/15, 설계 docs/상황재현_설계_v2(+gpt).md): 풀이 기록에서 "그때 떠올리지 못한 생각"(빈틈)을 뽑고,
// 빈틈마다 그 생각만 다시 꺼내게 하는 작은 장면을 만든다. 맞았는지는 코드를 실제로 돌려서, 왜 틀렸는지는 증거(오답 모양)가 있을 때만.

export const GAP_KINDS = ["문법", "자료 담기", "자료 구현", "한 줄 읽기", "알고리즘 고르기", "알고리즘 원리", "알고리즘 구현", "경계 · 예외", "문제 읽기", "실행 · 도구", "오류 읽기", "순서 · 동시성"] as const;
/** 알고리즘 빈틈 뽑기에 쓰는 종류(순서 · 동시성은 실습만) */
export const ALGO_KINDS = GAP_KINDS.filter((k) => k !== "순서 · 동시성");
export type GapKind = (typeof GAP_KINDS)[number];
/** 모르는 것의 층(docs/모르는것_층_설계.md): 1 문법 · 2 담기 · 3 한 줄 읽기 · 4 잇기 · 5 원리 · 6 고르기. 낮은 층부터 낸다. */
export const LAYER: Record<GapKind, number> = { 문법: 1, "자료 담기": 2, "자료 구현": 3, "한 줄 읽기": 3, "알고리즘 고르기": 6, "알고리즘 원리": 5, "알고리즘 구현": 4,
  "경계 · 예외": 4, "문제 읽기": 2, "실행 · 도구": 1, "오류 읽기": 3, "순서 · 동시성": 5 };
/** 범위 = 장면 길이. 빈틈의 종류가 정한다(틀린 횟수는 키우지 않는다). */
export type Scope = "line" | "piece" | "function" | "project";
export type Distance = "same" | "near" | "far";
export const DISTANCE_LABEL: Record<Distance, string> = { same: "똑같이", near: "비슷하게", far: "응용" };
export type Target = "ability" | "form";

export type Evidence = { type: "submission"; id: string; lines?: [number, number]; verdict?: string } | { type: "talk"; at: string; quote?: string };
/** 세기 = 얼마나 빨리 · 몇 번 · 어느 거리부터. 얼마나 막혔는지가 정한다. */
export type Dose = { level: 1 | 2 | 3 };
export type GapState = {
  distance: Distance; passes: number; sameMistakes: number; unclear: number; otherMistakes: number;
  /** 응용을 통과하면 앎 */ known: boolean;
  /** 다음에 볼 날(ISO). 없으면 지금. */ due: string;
  /** 같은 실수 · 미확정이 연달아 몇 번 */ streak: { same: number; unclear: number };
  /** 지금 거리에서 통과한 횟수(세기 2 · 3은 한 거리에서 두 번 통과해야 다음 칸, 설계 1번 세기 표) */ here?: number;
};
export type Gap = {
  id: string; branch: "algo" | "practice"; kind: GapKind; layer: number;
  title: string; target: Target;
  /** 떠올렸어야 할 생각 */ missed: string;
  /** 그때 생각(있으면) */ wrong: string;
  /** 그때 생각대로 원래 문제를 푼 코드(AI가 같이 냄). 원래 테스트에서 실제로 틀려야 빈틈이다. */
  wrongCode?: string;
  /** 코드가 확인: wrongCode가 원래 문제에서 틀림(판정). 확인 못 하면 false → 같은 실수를 판정하지 않는다. */
  wrongVerified: boolean; wrongVerdict?: string;
  kernel: { lang: string; code: string; needs: string[] };
  evidence: Evidence[];
  /** 알고리즘: problemId · 실습: runId(+ goalId, 실습 원장의 gap id) */
  origin: { problemId: string; title: string; lang: string; runId?: string; goalId?: string; practiceGapId?: string; file?: string };
  topic: string; scope: Scope; dose: Dose;
  state: GapState;
  createdAt: string;
  /** 사람이(또는 원인 미확정이 쌓여) 다시 볼 빈틈 */ doubtful?: boolean;
  /** 학습자가 [이건 아는 거였어요]로 뺀 빈틈(뽑기가 틀렸을 수 있음). 복습에 안 나온다. */ dismissed?: boolean;
  marks?: GapMark[];
  /** 기억 저장소 항목 id(빈틈은 기억 저장소의 항목으로도 남는다) */ knowledgeId?: string;
  /** 생각 따라가기의 목차(11/16): 이 빈틈이 든 파트 · 작은 묶음, 목차 순서 */ unit?: { part: string; sub: string; order: number };
};

/** 형식 (설계 3번). 1~12 공통, 13~17 실습 전용. */
export const FORMATS = ["write", "blank", "predict", "fix", "choice", "order", "function", "counter", "draw", "variant", "error", "why",
  "where", "timeline", "command", "project", "origin"] as const;
export type Format = (typeof FORMATS)[number];
export const PRACTICE_FORMATS: Format[] = ["where", "timeline", "command", "project", "origin"];
export const FORMAT_LABEL: Record<Format, string> = { write: "한 줄 쓰기", blank: "빈칸 채우기", predict: "결과 맞히기", fix: "틀린 곳 고치기", choice: "고르기",
  order: "순서 맞추기", function: "작은 함수 쓰기", counter: "반례 만들기", draw: "담기 그리기", variant: "변형 문제", error: "오류 읽기", why: "왜인지 한 줄",
  where: "어디에 넣을까", timeline: "시간 순서 표", command: "명령 한 줄", project: "작은 재현 프로젝트", origin: "원래 자리로" };
export type SceneInput = { role: "basic" | "split"; stdin: string; label?: string };
export type Wrong = { id: string; what: string; code: string; /** 섞은 장면(응용)에서 이 틀린 생각이 어느 빈틈의 것인가 */ gapId?: string; /** 미확정 답에서 모은 것 */ collected?: boolean };
export type Choice = { text: string; thought: string };

/**
 * 장면 하나. 실행되는 프로그램 = setup(입력 읽기) + 학습자가 쓰는 부분 + after(출력). 결과 맞히기는 code 전체를 보여 주고 출력을 묻는다.
 * expected · shapes는 AI가 쓴 값이 아니라 코드가 돌려서 만든다(check.ts).
 */
export type Scene = {
  id: string; gapId: string; format: Format; lang: string; distance: Distance; target: Target;
  story: string; ask: string; explain: string;
  setup: string; after: string;
  /** write: 처음 칸에 둘 코드(선택) · blank: ____ 자리가 있는 코드 */ template?: string;
  /** write · blank: 학습자 자리의 모범 답(blank는 빈칸 답을 \n으로 이은 것) · predict: 보여 줄 코드 전체 · fix: 모범 프로그램 전체 */
  reference: string;
  alsoRight: string[];
  wrongs: Wrong[];
  inputs: SceneInput[];
  choices?: Choice[];
  /** fix: 원래 문제의 테스트로 채점(그때 코드에서 시작) */ origin?: { problemId: string; code: string; failIndex?: number };
  /** 똑같이(한 줄 범위): 그때 코드에서 보여 줄 줄(그 밖은 접힘) */ view?: { from: number; to: number };
  /** 표현 확인(한 줄 쓰기): 이 표현을 썼나 — 정규식, 모범 답은 맞고 그때 생각은 안 맞아야 함 */ structure?: { must: Array<{ pattern: string; why: string }> };
  /** 순서 맞추기: 섞어 보여 줄 줄(들여쓰기 뺀 것) */ pieces?: string[];
  /** 반례 만들기: 입력이 문제 조건에 맞나 보는 프로그램(표준 입력을 읽고 맞으면 0으로 끝남) */ validator?: string;
  /** 담기 그리기: value = 실제로 만든 값과 같아야 함 · shape = checker가 받아들이면 통과(어떤 모양이든 관계를 다 담으면) */
  draw?: { mode: "value" | "shape"; checker?: string; mineCheck?: string };
  /** 변형 문제: 알고리즘 문제로 만든 것 */ variant?: { problemId: string; title: string };
  /** 오류 읽기: 보여 줄 오류 문구(코드가 실제로 돌려서 얻음) */ errorText?: string;
  /** 왜인지 한 줄(다른 형식을 통과한 뒤 덧붙이는 질문, AI 채점) */ why?: { question: string; answer: string };
  /** 응용 섞기: 이 장면이 확인하는 빈틈들(첫째가 gapId) */ mix?: string[];
  /** 실습 형식의 재료(src/lib/scene/practice/) */ practice?: Record<string, unknown>;
  computed?: { expected: string[]; shapes: Record<string, string[]> };
  check?: { ok: boolean; problems: string[] };
  /** 같은 생각(빈틈의 topic): 은행에서 다른 빈틈 id로도 다시 쓴다 */ topic?: string; bankedTo?: string;
  createdAt: string; madeBy: "record" | "ai" | "bank";
};

export type SceneVerdict = "pass" | "same" | "other" | "unclear";
/** 학습자가 [이건 아는 거였어요]를 누름 */
export type GapMark = { at: string; kind: "known" | "doubt"; note?: string };
export const VERDICT_LABEL: Record<SceneVerdict, string> = { pass: "통과", same: "같은 실수", other: "다른 실수", unclear: "원인 미확정" };
export type Attempt = { id: string; at: string; sceneId: string; gapId: string; distance: Distance; format: Format; answer: string; verdict: SceneVerdict;
  hinted: boolean; gaveUp: boolean; outputs?: string[]; matched?: string; firstDiff?: { index: number; expected: string; got: string } };

/** 문제 · 실습 글은 자르지 않고 보낸다(11/16 사용자 결정). 비정상적으로 긴 글만 막는 넉넉한 상한. */
export const STATEMENT_CAP = 20_000;
