import type { AuthoringDocument, InspectionIssue, RevisionPatch, SourceContent } from "../contract.ts";

const frame = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

export function mockDraft(items: SourceContent[]): AuthoringDocument {
  const [temperature, fusion, heavyElements, spectra] = items;
  return {
    schemaVersion: "problem-authoring-v1",
    id: "science-authoring-draft-v1",
    title: "별과 스펙트럼 · 문제 제작 실험",
    questions: [
      {
        id: "q-lu2-blank", source: temperature, page: { width: 760, height: 330 },
        blocks: [
          { id: "q1-title", kind: "text", frame: frame(55, 36, 650, 55), style: "heading", text: "원시별이 별이 되는 조건" },
          { id: "q1-context", kind: "box", frame: frame(55, 95, 650, 68), tone: "accent", label: "중력 수축으로 원시별의 중심 온도가 높아진다." },
          { id: "q1-blank", kind: "blank", frame: frame(55, 180, 650, 45), responseId: "r-lu2-temp", promptBefore: "중심 온도가", promptAfter: "이상이 되면 핵융합이 시작된다." },
          { id: "q1-reveal", kind: "answer-reveal", frame: frame(55, 245, 650, 55), responseIds: ["r-lu2-temp"] }
        ],
        responses: [{ id: "r-lu2-temp", kind: "short-text", acceptedAnswers: ["1000만 K", "1000만K"], grading: "exact-normalized" }]
      },
      {
        id: "q-lu3-blank", source: fusion, page: { width: 760, height: 360 },
        blocks: [
          { id: "q2-title", kind: "text", frame: frame(55, 35, 650, 48), style: "heading", text: "핵융합 반응의 결과를 완성하시오." },
          { id: "q2-table", kind: "table", frame: frame(55, 98, 650, 88), headerRows: 1, rows: [["반응 전", "반응", "반응 후"], ["가벼운 원자핵 여러 개", "결합", "새로운 원소와 빛"]] },
          { id: "q2-blank", kind: "blank", frame: frame(55, 205, 650, 55), responseId: "r-lu3-result", promptBefore: "결합 결과 더", promptAfter: "원자핵을 가진 새로운 원소가 만들어진다." },
          { id: "q2-reveal", kind: "answer-reveal", frame: frame(55, 280, 650, 50), responseIds: ["r-lu3-result"] }
        ],
        responses: [{ id: "r-lu3-result", kind: "short-text", acceptedAnswers: ["무거운"], grading: "exact-normalized" }]
      },
      {
        id: "q-lu5-choice", source: heavyElements, page: { width: 760, height: 410 },
        blocks: [
          { id: "q3-title", kind: "text", frame: frame(55, 35, 650, 70), style: "heading", text: "철보다 무거운 원소가 만들어지는 현상으로 옳은 것은?" },
          { id: "q3-choices", kind: "choice-set", frame: frame(55, 120, 650, 180), responseId: "r-lu5-choice", optionIds: ["o1", "o2", "o3", "o4"], columns: 2 },
          { id: "q3-reveal", kind: "answer-reveal", frame: frame(55, 320, 650, 58), responseIds: ["r-lu5-choice"], title: "정답과 확인" }
        ],
        responses: [{ id: "r-lu5-choice", kind: "single-choice", grading: "exact", correctOptionId: "o3", options: [
          { id: "o1", text: "원시별의 중력 수축만 일어날 때" },
          { id: "o2", text: "연속 스펙트럼이 관측될 때" },
          { id: "o3", text: "초신성 폭발이나 중성자별 충돌이 일어날 때" },
          { id: "o4", text: "중심 온도가 1000만 K에 도달하기 전" }
        ] }]
      },
      {
        id: "q-lu6-choice", source: spectra, page: { width: 760, height: 430 },
        blocks: [
          { id: "q4-title", kind: "text", frame: frame(55, 35, 650, 70), style: "heading", text: "연속적인 색 띠의 특정 파장에 어두운 선이 보였다. 이 스펙트럼은?" },
          { id: "q4-hint", kind: "box", frame: frame(55, 112, 650, 55), tone: "plain", label: "관측된 바탕과 선의 모습을 함께 판단하시오." },
          { id: "q4-choices", kind: "choice-set", frame: frame(55, 185, 650, 125), responseId: "r-lu6-choice", optionIds: ["o1", "o2", "o3"], columns: 1 },
          { id: "q4-reveal", kind: "answer-reveal", frame: frame(55, 335, 650, 58), responseIds: ["r-lu6-choice"] }
        ],
        responses: [{ id: "r-lu6-choice", kind: "single-choice", grading: "exact", correctOptionId: "o3", options: [
          { id: "o1", text: "연속 스펙트럼" }, { id: "o2", text: "선 스펙트럼" }, { id: "o3", text: "흡수 스펙트럼" }
        ] }]
      }
    ]
  };
}

export function mockInspection(document: AuthoringDocument): InspectionIssue[] {
  return document.questions[1].blocks.find((block) => block.id === "q2-title" && block.kind === "text")?.text.includes("모두")
    ? []
    : [{ severity: "error", code: "scope-ambiguity", message: "표가 여러 결과를 보이지만 지시문이 한 빈칸에서 무엇을 요구하는지 좁혀야 합니다.", questionId: "q-lu3-blank", blockId: "q2-title" }];
}

export const mockPatch: RevisionPatch = {
  instruction: "q2 지시문만 수정해 빈칸이 원자핵의 상대적 무게를 묻는다는 점을 분명히 한다.",
  operations: [{
    op: "replace-block", questionId: "q-lu3-blank", blockId: "q2-title",
    value: { id: "q2-title", kind: "text", frame: frame(55, 35, 650, 48), style: "heading", text: "표를 참고해 빈칸을 모두 완성하시오: 원자핵의 상대적 무게" }
  }]
};
