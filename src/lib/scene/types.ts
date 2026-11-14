// 상황 재현 복습 (3번 판, 11/15, 설계 docs/상황재현_설계_v2(+gpt).md): 풀이 기록에서 "그때 떠올리지 못한 생각"(빈틈)을 뽑고,
// 빈틈마다 그 생각만 다시 꺼내게 하는 작은 장면을 만든다. 맞았는지는 코드를 실제로 돌려서, 왜 틀렸는지는 증거(오답 모양)가 있을 때만.

export const GAP_KINDS = ["문법", "자료 담기", "자료 구현", "한 줄 읽기", "알고리즘 고르기", "알고리즘 원리", "알고리즘 구현", "경계 · 예외", "문제 읽기", "실행 · 도구", "오류 읽기"] as const;
export type GapKind = (typeof GAP_KINDS)[number];
/** 모르는 것의 층(docs/모르는것_층_설계.md): 1 문법 · 2 담기 · 3 한 줄 읽기 · 4 잇기 · 5 원리 · 6 고르기. 낮은 층부터 낸다. */
export const LAYER: Record<GapKind, number> = { 문법: 1, "자료 담기": 2, "자료 구현": 3, "한 줄 읽기": 3, "알고리즘 고르기": 6, "알고리즘 원리": 5, "알고리즘 구현": 4,
  "경계 · 예외": 4, "문제 읽기": 2, "실행 · 도구": 1, "오류 읽기": 3 };
/** 범위 = 장면 길이. 빈틈의 종류가 정한다(틀린 횟수는 키우지 않는다). */
export type Scope = "line" | "piece" | "function";
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
};
export type Gap = {
  id: string; branch: "algo"; kind: GapKind; layer: number;
  title: string; target: Target;
  /** 떠올렸어야 할 생각 */ missed: string;
  /** 그때 생각(있으면) */ wrong: string;
  /** 그때 생각대로 원래 문제를 푼 코드(AI가 같이 냄). 원래 테스트에서 실제로 틀려야 빈틈이다. */
  wrongCode?: string;
  /** 코드가 확인: wrongCode가 원래 문제에서 틀림(판정). 확인 못 하면 false → 같은 실수를 판정하지 않는다. */
  wrongVerified: boolean; wrongVerdict?: string;
  kernel: { lang: string; code: string; needs: string[] };
  evidence: Evidence[];
  origin: { problemId: string; title: string; lang: string };
  topic: string; scope: Scope; dose: Dose;
  state: GapState;
  createdAt: string;
  /** 사람이(또는 원인 미확정이 쌓여) 다시 볼 빈틈 */ doubtful?: boolean;
};

export const FORMATS = ["write", "blank", "predict", "choice", "fix"] as const;
export type Format = (typeof FORMATS)[number];
export const FORMAT_LABEL: Record<Format, string> = { write: "직접 쓰기", blank: "빈칸 채우기", predict: "결과 맞히기", choice: "고르기", fix: "틀린 곳 고치기" };
export type SceneInput = { role: "basic" | "split"; stdin: string; label?: string };
export type Wrong = { id: string; what: string; code: string };
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
  computed?: { expected: string[]; shapes: Record<string, string[]> };
  check?: { ok: boolean; problems: string[] };
  createdAt: string; madeBy: "record" | "ai" | "bank";
};

export type SceneVerdict = "pass" | "same" | "other" | "unclear";
export const VERDICT_LABEL: Record<SceneVerdict, string> = { pass: "통과", same: "같은 실수", other: "다른 실수", unclear: "원인 미확정" };
export type Attempt = { id: string; at: string; sceneId: string; gapId: string; distance: Distance; format: Format; answer: string; verdict: SceneVerdict;
  hinted: boolean; gaveUp: boolean; outputs?: string[]; matched?: string; firstDiff?: { index: number; expected: string; got: string } };
