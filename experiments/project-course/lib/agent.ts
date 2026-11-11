// 튜터 엔진이 쓰는 모양(카드 · 입출력)과 작업 폴더 경로 검사, 튜터가 고친 앞뒤 기록 자리.
// (11/11 정해진 코스를 빼며 기본 루프 튜터 · 코스 도구 실행을 뺐다. 튜터는 OpenCode 엔진(oc-engine.ts)만 쓴다)
import path from "node:path";
import { stat } from "node:fs/promises";
import { DATA } from "./store.ts";

export const MAX_STEPS = 5;
export type ToolCard = { type: "tool"; icon: string; label: string; detail?: string; ok: boolean; url?: string };
/** 코드 조각을 따로 돌려 본 결과 (튜터 도구 run_snippet, 10/30) */
export type SnippetCard = { type: "snippet"; code: string; output: string; ok: boolean; ms: number };
/** 튜터가 학습자에게 고르게 묻기 (튜터 도구 ask_learner, 10/30) */
export type AskCard = { type: "ask"; id: string; question: string; options: string[]; picked?: number; answer?: string };
export type TourStep = { file: string; from: number; to: number; title: string; text: string; code: string };
export type TourCard = { type: "tour"; id: string; title: string; steps: TourStep[] };
export type DiffCard = { type: "diff"; id: string; file: string; why: string; diff: string; undone?: boolean };
export type CtxFile = { key: string; text: string };
export type AgentIO = {
  runId: string; n: number; ws: string;
  /** 지금까지의 수업 맥락(계획서·지금 순서·최근 대화·마지막 확인) — 기본 엔진은 이것만 쓴다 */
  context: string;
  /** 같은 맥락을 캐시가 맞게 나눈 것(OpenCode 엔진이 대화를 이어 쓸 때). fixed는 대화 첫 메시지에만,
   *  recent는 새 대화일 때, since는 이어 쓸 때, files는 지난번과 달라졌을 때만 다시 붙인다 */
  parts?: { fixed: string; turn: string; recent: string; since: string; files: CtxFile[] };
  /** 채팅에 바로 보이게 */
  show: (card: ToolCard | DiffCard | TourCard | SnippetCard) => Promise<void>;
  /** 도구를 쓰기 전 튜터의 한마디 */
  say: (text: string) => Promise<void>;
  /** 튜터가 고친 파일 때문에 저장 감지가 다시 확인하지 않게 */
  quiet: (ms: number) => void;
  /** 작업 지시(설계안 5.3)로 부를 때 고쳐도 되는 파일. 그 밖은 읽기만 */
  scope?: string[];
  /** explain: 설명만(고치기 도구를 주지 않음) */
  mode?: "normal" | "explain" | "tour";
  /** 답을 쓰는 대로 채팅에 흘려 보낸다(같은 key는 같은 말풍선). 엔진이 썼으면 streamed=true */
  stream?: (key: string, text: string) => Promise<void>;
  streamed?: boolean;
  /** 생각 요약 한 줄("라우터 쪽 보는 중"). null이면 지운다 */
  think?: (text: string | null) => void;
  /** 도구의 실제 실행 수명. 모델의 설명·생각과 구분해서 표시한다. */
  progress?: (event: import("./tool-progress.ts").ToolProgress) => Promise<void>;
  /** 학습자에게 고르게 묻고 답을 기다린다(답이 없으면 빈 글) */
  choose?: (q: { question: string; options: string[] }) => Promise<string>;
  /** [막혔어요] 칸 안에서 부를 때(11/3): 칸마다 따로 이어 쓰는 대화(sessKey)와 막힘 도구 */
  sessKey?: string;
  /** 별도 자유 대화 실험판. 기존 수업의 지시문·진도 도구와 섞지 않는다. */
  /** 프리스타일 진행: 이 지시문으로 바꿔 끼우고 effort low(도구는 보통 질문과 같음) */
  freeSystem?: string;
  learningChat?: {
    system?: string;
    capture?: (body: Record<string, unknown>) => Promise<void>;
    execute: (name: string, input: Record<string, unknown>) => Promise<string>;
    /** 이 대화에서 빼는 도구(11/4 A안: 코스 없는 대화는 get_course_material을 뺀다) */
    hide?: string[];
    /** 11/4 사용자 "채팅창에서 모델 변경": 이 대화의 모델(없으면 엔진 기본) */
    model?: string;
    /** 11/4 사용자 "직접 고치는 권한 주기(처음에 권한 확인 요청)": 학습자가 허락하면 작업 폴더 파일을 고칠 수 있다 */
    edit?: boolean;
  };
};

export const safePath = (ws: string, p: string) => {
  const rel = String(p || "").replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!rel || rel.includes("..") || path.isAbsolute(rel) || rel.startsWith(".recaller") || rel.startsWith("node_modules")) throw new Error(`이 경로는 다룰 수 없어요: ${p}`);
  return { rel, abs: path.join(ws, ...rel.split("/")) };
};

/** 튜터가 고친 파일의 앞뒤(자유 대화 실습: 줄 주인 · 막힌 순간 계산용) */
export const editsDir = (runId: string) => path.join(DATA, "agent-edits", runId);
export type EditRecord = { id: string; file: string; before: string; after: string; at: string };
export const exists = (p: string) => stat(p).then(() => true, () => false);
