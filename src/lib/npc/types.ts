// 가상 학습자(NPC) 공용 모양 (설계 docs/가상학습자_설계_v2(+gpt).md). 명세 · 풀이 조각 지도 · 정답지 사건.

/* ---------- 1. 학습자 명세 ---------- */
export const STATES = ["앎", "모름", "잘못 앎", "애매"] as const;
export type KnowState = (typeof STATES)[number];
/** 층(docs/모르는것_층_설계.md): 1 문법 · 2 담기 · 3 한 줄 읽기 · 4 잇기 · 5 원리 · 6 고르기. run = 실행 · 도구(예제 돌려 보기). */
export const BASE_KEYS = ["1", "2", "3", "4", "5", "6", "run"] as const;
export type BaseKey = (typeof BASE_KEYS)[number];
export type KnowItem = { state: KnowState; /** 잘못 앎: 틀린 믿음 한 문장 */ belief?: string; /** 잘못 앎: 어느 틀린 조각인지(없으면 지도에서 찾음) */ as?: string };
export type Traits = {
  /** 조합력: 조각은 다 있는데 엮는 법을 떠올릴 확률 */ invent: number;
  /** 새 조각을 배웠을 때 더 나은 길로 갈아탈 확률 */ switch: number;
  askEarly: number; guess: number; helpRungs: number; copyTutor: number; confirm: number;
  /** 몇 번 막혀야 포기하나(반응 수) */ patience: number; typo: number; terse: number;
};
export type Learning = { perExplain: number; perHint: number; fromOwnFix: number; forgetPerDay: number };
export type Spec = {
  id: string; seed: number; name: string; lang: "python";
  knows: { base: Partial<Record<BaseKey, KnowState>>; items: Record<string, KnowItem> };
  traits: Traits; learning: Learning;
  /** 이 명세를 만든 옵션 조각(겹친 순서) */ options?: string[];
};
/** 옵션 조각: 명세의 일부만 담은 작은 JSON. 겹칠 때는 뒤에 쓴 것이 이긴다. */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type OptionPatch = { id: string; label: string; group?: "아는 것" | "성격" | "배움" | "문제"; patch: DeepPartial<Spec> & { knows?: { base?: Partial<Record<BaseKey, KnowState>>; items?: Record<string, KnowItem> } };
  /** 같이 쓰면 부딪치는 조각 */ conflicts?: string[] };

/* ---------- 2. 풀이 조각 지도 ---------- */
export type Fragment = {
  id: string; layer: number; what: string; /** 3~8줄 */ example: string;
  /** 틀린 조각(그럴듯하지만 틀린 생각) */ wrong?: boolean;
  /** 틀린 조각이 대신하는 맞는 조각 */ right?: string;
  /** 배움 판정(가짜 AI) · 채점의 낱말 맞추기에 쓰는 말(정규식 조각) */ keys?: string[];
  /** 문법 조각: 이 문법을 모르면 코드에 나오면 안 되는 모양(정규식). 문법에만 쓴다(설계 5번 2). */ leak?: string[];
};
export type Step = { text: string; uses: string[]; /** 이 걸음의 코드. {{자리}}는 slots에서 채운다 */ code: string;
  /** 이 걸음에 필요한 조각이 없을 때 지어 쓰는 코드(없으면 걸음을 비움) */ guess?: string };
/** 자리: 같은 걸음에 맞는 조각 · 틀린 조각마다 다른 코드. "?" = 몰라서 지어 쓴 코드. */
export type Slot = { right: string; alts: Record<string, string>;
  /** 맞는 조각을 모르면 모르는 줄도 모르고 이 틀린 조각대로 쓴다(막히지 않음). 없으면 그 자리에서 막힌다. */ unaware?: string };
export type Route = {
  id: string; name: string; needs: string[];
  /** 이 길의 틀(frame.*). 가졌으면 엮는 법을 아는 것이라 조합력 주사위를 안 던진다. */ frame?: string;
  /** 흔한 정도(고를 때 같은 점수면 앞) */ prior?: number;
  steps: Step[]; slots: Record<string, Slot>;
  /** AI가 짐작한 판정(지도 만들기). 믿지 않고 잰 값을 쓴다. */ expect?: string;
  /** 채점기로 잰 판정: right = 자리마다 맞는 조각, variants[자리=조각] = 그 자리만 바꾼 것 */
  measured?: { verdict: string; variants: Record<string, string>; at: string };
};
export type ProblemMap = {
  problem: string; title: string; lang: "python"; source: "hand" | "ai"; madeAt: string;
  fragments: Fragment[]; routes: Route[];
  /** 조각 예시 코드가 문법으로 돌아가나(ast) */ exampleChecks?: Record<string, "ok" | string>;
  notes?: string[];
};

/* ---------- 7. 정답지 ---------- */
export type KeyEvent =
  | { t: number; route: string; why: string; mode?: "strict" | "loose" }
  | { t: number; stuck: string; layer: number; state: KnowState | "방법 모름" | "실수"; reaction: Reaction; verdict?: string }
  | { t: number; asked: true; taught: string[]; learned: boolean; learnedIds?: string[]; copied?: boolean }
  | { t: number; help: number; via: "칸" | "힌트"; taught: string[]; learned: boolean; learnedIds?: string[] }
  | { t: number; taught: string[]; learned: boolean; switched: string }
  | { t: number; slip: true; layer: number; verdict: string; resolvedBy: "self" | "tutor" | "never"; what?: string }
  | { t: number; submit: number; verdict: string; route: string; picks?: Record<string, string> }
  | { t: number; unreproduced: true; route: string; expected: string; got: string; why: string }
  | { t: number; leak: string[]; fixed: boolean }
  | { t: number; suspect: string; ai?: boolean }
  | { t: number; selfFix: string; learned: boolean }
  | { t: number; end: "solved" | "gaveup" | "cap"; why: string; copied?: boolean };
export const REACTIONS = ["지어 씀", "틀린 조각으로 메움", "도움 칸", "힌트", "튜터에게 물음", "혼자 고침", "포기"] as const;
export type Reaction = (typeof REACTIONS)[number];

/** 한 판 요약(채점 재료) */
export type Played = {
  spec: Spec; problem: string; mode: "strict" | "loose"; dry: boolean;
  key: KeyEvent[];
  /** 처음 가진 조각 · 처음 틀린 조각(잘못 앎) · 처음 애매했던 조각 */
  start: { holds: string[]; wrongs: string[]; vague: string[] };
  /** 끝에 가진 조각 · 이번 판에 배운 조각(배움 판정으로) · 붙여 넣어 맞힌 것 */
  end: { holds: string[]; learned: string[]; copied: boolean; verdict: string; route: string };
  /** 막힌 조각(정답지의 "없던 조각"): 이번 판에서 실제로 걸린 것만 */ missed: string[];
  /** 써 보고 맞게 쓴 조각(리뷰가 "모름"으로 잡으면 헛짚음) */ used: string[];
  slips: number; /** 실수가 든 코드(이 코드의 제출은 "모름"으로 잡히면 안 됨) */ slipCodes: string[]; counts: { asked: number; submits: number; actions: number; help: number };
  codes: Array<{ t: number; code: string; verdict: string; kind: "submit" | "example" | "draft" }>;
  calls: Array<{ purpose: string; ms: number; chars: number }>;
};
