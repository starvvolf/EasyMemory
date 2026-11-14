// 예전 실행의 정리 글(summary.json, 10/31 실험) 모양. 지금은 만들지 않고, 옛 자료를 열 때 읽기만 한다.

export type SummaryState = {
  status: "writing" | "done" | "failed";
  text: string;
  startedAt: string;
  /** ms from the start to the first text, and to the end. */
  firstMs?: number; ms?: number;
  model?: string; effort?: string; usage?: unknown;
  /** Pages the text cites that the material does not have (code check). */
  outside?: number[];
  error?: string;
};
