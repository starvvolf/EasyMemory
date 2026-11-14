// 실습 빈틈의 형식 고르기(설계 4번 표의 실습 줄 + 공통 줄). 앞이 기본, 재료가 없으면(만들지 못하면) 다음. 코드만.
//   똑같이 → 17 원래 자리로(그 시점 저장본이 있을 때) 먼저.
//   (실습) 순서 · 동시성 → 14 시간 순서 표 · 13 어디에 넣을까 → 응용 확인에서 16 작은 재현 프로젝트(한 줄 · 조각 장면을 통과한 뒤, 한 번만).
//   실행 · 도구 → 15 명령 한 줄 · 1 한 줄 쓰기 · 11 오류 읽기.  문법 → 1(+구조 검사) · 2.  …
//   12 왜인지 한 줄(실습 "다시 확인" 문항)은 맨 끝: 다른 형식을 못 만들 때와, 통과한 뒤 덧붙이는 질문(practiceWhy).
import type { Format, Gap } from "../types.ts";

type Ctx = {
  /** 같은 주제(topic)의 다른 실습 빈틈들 — 응용 확인(16)의 준비 규칙에 쓴다 */ siblings?: Gap[];
  /** 이 빈틈에서 작은 재현 프로젝트를 이미 냈나(한 번만) */ projectTried?: boolean;
};
/**
 * 16 작은 재현 프로젝트의 준비 규칙(설계 8번 "위 셋을 통과한 뒤의 응용 확인 … 한 번만, 여기서 틀려도 한 줄 · 조각 장면으로 돌아가요"):
 * 이 빈틈이 응용 거리이고, 비슷하게까지 통과했고(passes ≥ 2), 같은 주제의 실습 빈틈들도 모두 한 번 이상 통과했고, 아직 안 냈을 때.
 */
export function projectReady(gap: Gap, ctx: Ctx = {}) {
  if (gap.branch !== "practice" || ctx.projectTried) return false;
  if (gap.state.distance !== "far" || gap.state.passes < 2) return false;
  const sib = (ctx.siblings ?? []).filter((g) => g.id !== gap.id && g.branch === "practice" && g.topic === gap.topic);
  return sib.every((g) => g.state.passes >= 1);
}
/** 그 시점 저장본으로 갈 수 있나(17): 실습 원장의 칸이 코드 위치를 가짐 */
export const originReady = (gap: Gap) => Boolean(gap.origin.runId && gap.origin.practiceGapId && gap.origin.file);

export function practiceFormats(gap: Gap, ctx: Ctx = {}): Format[] {
  const out: Format[] = [];
  if (gap.state.distance === "same" && originReady(gap)) out.push("origin");
  const fn = gap.scope === "function";
  switch (gap.kind) {
    case "순서 · 동시성":
      if (projectReady(gap, ctx)) out.push("project");
      out.push("timeline", "where");
      break;
    case "실행 · 도구": out.push("command", "write", "error"); break;
    case "문법": out.push("write", "blank"); break;
    case "오류 읽기": out.push("error", "fix"); break;
    case "한 줄 읽기": out.push("predict"); break;
    case "자료 담기": out.push("choice", "draw"); break;
    case "자료 구현": out.push(...(fn ? ["function"] as Format[] : ["blank", "write"] as Format[])); break;
    case "알고리즘 고르기": out.push("choice"); break;
    case "알고리즘 원리": out.push("predict", "counter"); break;
    case "알고리즘 구현": out.push(...(fn ? ["function"] as Format[] : ["order", "blank"] as Format[])); break;
    case "경계 · 예외": out.push("counter", "fix"); break;
    case "문제 읽기": out.push("choice", "predict"); break;
  }
  out.push("why");
  return [...new Set(out)];
}
/** 실습 전용 형식(13~17) · 실습 쪽이 만드는 공통 형식 — 바닥이 이 형식이면 makePracticeScene을 부른다 */
export const PRACTICE_MADE: Format[] = ["where", "timeline", "command", "project", "origin", "why"];
