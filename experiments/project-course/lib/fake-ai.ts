// 시험용 가짜 AI (PC_FAKE_AI=1). 호출 없이 AI 경로가 화면까지 도는지 본다. 횟수에 세지 않는다.
// (11/11 정해진 코스를 빼며 코스 정하기 · 단계 튜터 · 코스 생성 · 힌트용 가짜 답을 뺐다. 판정 · 목표 정리 등은 각 테스트가 setFakeAi로 따로 준다)
import { setFakeAi } from "./ai.ts";

export function installFakeAi() {
  setFakeAi((purpose) => {
    if (purpose === "context-summary") return "- (가짜 요약) 학습자는 라우터와 상태 코드를 물어봤다.";
    if (purpose === "tutor") return "좋은 질문이에요! (가짜 AI 답)";
    return "";
  });
}
