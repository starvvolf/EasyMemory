import assert from "node:assert/strict";
import test from "node:test";

import { createWholeDocumentCorePlan } from "../src/lib/pipeline/plan.ts";
import {
  buildSourceExpressionRules,
  getMaxLearningUnitCount,
  POST,
  runAnalysis,
  type GenerateInput,
} from "../src/lib/pipeline/generate.ts";

test("원문 중심 모드는 원문을 주재료와 단서로 쓰는 기준을 제공한다", () => {
  const preserve = buildSourceExpressionRules("preserve").join("\n");
  assert.match(preserve, /원문 중심으로 문제 만들기/);
  assert.match(preserve, /주재료로 쓰고.*단서도/);
  assert.match(preserve, /핵심 의미·관계·조건·표현 특징은 유지/);
  assert.match(preserve, /원문의 규칙과 사례를 우선 사용/);
  assert.match(preserve, /거짓 명제는 핵심 관계 하나만 바꾸고/);
  assert.match(preserve, /구조복원은 원문에 실제로 존재하는 구조/);

  const adapt = buildSourceExpressionRules("adapt").join("\n");
  assert.match(adapt, /AI가 학습용으로 다듬기/);
  assert.match(adapt, /구체 입력/);
});

const analysis = {
  files: [
    {
      fileName: "sample.pdf",
      documentType: "강의자료",
      summary: "핵심 규칙, 예시, 학습 방법이 함께 있는 자료",
      keyTopics: ["핵심 규칙", "예시", "학습 방법"],
      outline: [{ heading: "본문", points: ["규칙", "예시", "복습법"] }],
      suggestedRole: "학습자료",
    },
  ],
};

function responseJson(output: unknown) {
  return new Response(JSON.stringify({ output_text: JSON.stringify(output) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("문제 설계 없이 옛 카드 생성 경로를 호출할 수 없다", async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    const response = await POST(
      new Request("http://localhost/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "flashcard",
          stage: "cards",
          preparedAnalysis: "{}",
          preparedMaterial: "{}",
          activityDesign: "",
        }),
      }),
    );
    assert.equal(response.status, 400);
    assert.match(String((await response.json()).message), /문제 설계 결과/);
  } finally {
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test("whole-document Plan은 learningGoal을 instruction과 분리하고 새 count 계약만 출력한다", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return responseJson({
      summary: "핵심 수행 지식만 선별",
      learningGoal: "사용자 목표",
      selectionRationale: "수행에 필요한 범위",
      areas: [
        {
          id: "core",
          title: "핵심 규칙",
          description: "실제로 적용할 규칙",
          learningValue: "상황에 적용해야 함",
          sourceScope: ["본문"],
        },
      ],
      exclusions: ["복습법: 자료를 공부하는 방법이므로 제외"],
      maxLearningUnitCount: 7,
    });
  };

  try {
    const result = await createWholeDocumentCorePlan(
      analysis,
      "추가 지시",
      [{ filename: "sample.pdf", mimeType: "application/pdf", base64: "AA==" }],
      "실제 상황에서 규칙을 적용한다",
      {},
      {
        title: "사용자 선택 원문",
        summary: "선택한 범위만 사용",
        nodes: [
          {
            id: "source-leaf",
            parentId: null,
            order: 1,
            title: "사용자가 고른 장",
            summary: "이 장만 학습",
            sourceRefs: [{ fileName: "sample.pdf", pageNumbers: [2] }],
            sourceEvidence: "선택한 원문 근거",
            selectedByDefault: true,
            structureTags: ["관계"],
            importance: 3,
          },
        ],
      },
    );
    assert.equal(result.maxLearningUnitCount, 7);
    assert.equal("estimatedLearningUnitCount" in result, false);

    const body = requestBody as {
      input: Array<{ content: Array<{ type: string; text?: string }> }>;
      text: { format: { schema: Record<string, unknown> } };
    };
    const prompt = body.input[1].content.find((item) => item.type === "input_text")?.text ?? "";
    assert.match(prompt, /사용자 학습 목표: 실제 상황에서 규칙을 적용한다/);
    assert.match(prompt, /사용자 추가 지시사항: 추가 지시/);
    assert.match(prompt, /사용자가 고른 장/);
    assert.match(prompt, /선택하지 않은 섹션은 다시 포함하지 않습니다/);
    assert.match(prompt, /자료를 공부하는 방법/);
    assert.match(prompt, /교과 내용을 수행하는 절차는 학습 대상/);
    assert.match(prompt, /maxLearningUnitCount는.*과다 추출 안전선/);
    assert.match(prompt, /채울 목표나 area 개수가 아니며/);
    assert.match(prompt, /원문 목차를 다시 만들거나 문제 단위로 나누지 않습니다/);
    assert.match(prompt, /원문 목차의 계층·제목·태그·중요도·ID를 변경하지 않습니다/);
    assert.match(prompt, /문제 하나의 크기로 나누는 일은 Prepare 단계/);
    assert.equal(result.learningOutline?.nodes.length, 1);
    assert.equal(
      JSON.stringify(body.text.format.schema).includes("learningOutline"),
      false,
    );
    assert.equal(
      JSON.stringify(body.text.format.schema).includes("structureTags"),
      false,
    );
    assert.equal(
      JSON.stringify(body.text.format.schema).includes("uniqueItems"),
      false,
    );
    assert.equal(
      JSON.stringify(body.text.format.schema).includes("estimatedLearningUnitCount"),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("학습 목표 공란과 학습 방법 자체 목표를 서로 구분해 Plan에 전달한다", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      input: Array<{ content: Array<{ type: string; text?: string }> }>;
    };
    prompts.push(
      body.input[1].content.find((item) => item.type === "input_text")?.text ?? "",
    );
    return responseJson({
      summary: "목표에 따른 선별",
      learningGoal: "자동 또는 사용자 목표",
      selectionRationale: "목표 우선",
      areas: [
        {
          id: "method",
          title: "학습 절차",
          description: "목표로 지정된 절차",
          learningValue: "절차 수행이 목표",
          sourceScope: ["방법 안내"],
        },
      ],
      exclusions: [],
      maxLearningUnitCount: 5,
    });
  };

  try {
    const pdf = [{ filename: "sample.pdf", mimeType: "application/pdf", base64: "AA==" }];
    await createWholeDocumentCorePlan(analysis, "", pdf, "");
    await createWholeDocumentCorePlan(
      analysis,
      "",
      pdf,
      "자료에 제시된 반복 학습 방법 자체를 정확히 수행할 수 있어야 한다",
    );
    assert.match(
      prompts[0],
      /자료 학습 후 실제 상황에서 무엇을 할 수 있어야 하는지 기준으로 자동 설정/,
    );
    assert.match(
      prompts[1],
      /사용자 학습 목표: 자료에 제시된 반복 학습 방법 자체를 정확히 수행/,
    );
    assert.match(prompts[1], /사용자가 학습 방법 자체를 목표로 한 경우는 예외/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Plan 안전선은 기본 선택한 최종 목차 수보다 작아지지 않는다", async () => {
  const originalFetch = globalThis.fetch;
  const selectedSourceOutline = {
    title: "핵심 목차",
    summary: "두 최종 목차",
    nodes: [
      {
        id: "leaf-a",
        parentId: null,
        order: 1,
        title: "A",
        summary: "A 핵심",
        sourceRefs: [{ fileName: "sample.pdf", pageNumbers: [1] }],
        sourceEvidence: "A 근거",
        selectedByDefault: true,
        importance: 3 as const,
      },
      {
        id: "leaf-b",
        parentId: null,
        order: 2,
        title: "B",
        summary: "B 핵심",
        sourceRefs: [{ fileName: "sample.pdf", pageNumbers: [2] }],
        sourceEvidence: "B 근거",
        selectedByDefault: true,
        importance: 3 as const,
      },
    ],
  };
  globalThis.fetch = async () => responseJson({
    summary: "두 문제 단위",
    learningGoal: "두 핵심을 익힌다",
    selectionRationale: "둘 다 필수",
    areas: [
      {
        id: "core",
        title: "핵심",
        description: "두 핵심",
        learningValue: "둘 다 학습",
        sourceScope: ["본문"],
      },
    ],
    exclusions: [],
    maxLearningUnitCount: 1,
  });

  try {
    const result = await createWholeDocumentCorePlan(
      analysis,
      "",
      [{ filename: "sample.pdf", mimeType: "application/pdf", base64: "AA==" }],
      "",
      {},
      selectedSourceOutline,
    );
    assert.equal(result.maxLearningUnitCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Prepare 상한은 새 계약과 legacy budget을 모두 읽는다", () => {
  assert.equal(
    getMaxLearningUnitCount(
      JSON.stringify({
        wholeDocumentCore: { maxLearningUnitCount: 9 },
        learningUnitSoftBudget: { max: 8 },
      }),
    ),
    9,
  );
  assert.equal(
    getMaxLearningUnitCount(
      JSON.stringify({ learningUnitSoftBudget: { target: 6, min: 4, max: 10 } }),
    ),
    10,
  );
});

test("Prepare JSON schema에 maxItems를 적용하고 초과 응답도 거부한다", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  const unit = (id: string) => ({
    id,
    sourceId: "sample.pdf",
    sourcePage: 1,
    sourceRange: "본문",
    sourceText: `근거 ${id}`,
    knowledgeType: "concept",
    fixedPart: "",
    variableSlots: [],
    generalizedForm: "",
    target: `학습 대상 ${id}`,
    operation: "recall",
    successCriterion: `자료 없이 학습 대상 ${id}를 말한다.`,
    rationale: "학습 목표에 필요",
  });
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return responseJson({
      detectedGoal: "핵심 적용",
      sourceType: "concept",
      keyTopics: ["핵심"],
      recommendedStrategy: "능동 인출",
      extractedMaterial: "핵심",
      primaryKnowledgeType: "concept",
      learningUnits: [unit("LU-1"), unit("LU-2"), unit("LU-3")],
    });
  };

  const input: GenerateInput = {
    title: "test",
    subject: "",
    tags: [],
    sourceText: "자료",
    instruction: "",
    analysisContext: "",
    studyGuideline: JSON.stringify({
      countPolicy: "soft_budget",
      learningUnitSoftBudget: { max: 2 },
    }),
    activityDesign: "",
    activitySelectionMode: "automatic",
    stage: "prepare",
    preparedAnalysis: "",
    preparedMaterial: "",
    mode: "flashcard",
  };

  try {
    await assert.rejects(() => runAnalysis(input, []), /안전선 2개를 초과/);
    const body = requestBody as {
      text: {
        format: {
          schema: {
            properties: {
              learningUnits: {
                maxItems?: number;
                items: { required: string[] };
              };
            };
          };
        };
      };
    };
    assert.equal(body.text.format.schema.properties.learningUnits.maxItems, 2);
    assert.deepEqual(
      body.text.format.schema.properties.learningUnits.items.required.filter((key) =>
        ["target", "operation", "successCriterion"].includes(key),
      ),
      ["target", "operation", "successCriterion"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("선택 목차의 원문 근거가 있으면 Prepare에서 PDF를 다시 전송하지 않는다", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return responseJson({
      detectedGoal: "근거를 정확히 회상한다.",
      sourceType: "concept",
      keyTopics: ["핵심"],
      recommendedStrategy: "능동 인출",
      extractedMaterial: "핵심 근거",
      primaryKnowledgeType: "concept",
      learningUnits: [
        {
          id: "leaf-a",
          sourceId: "sample.pdf",
          sourcePage: 2,
          sourceRange: "sample.pdf p.2",
          sourceText: "정확한 공식과 조건",
          knowledgeType: "concept",
          fixedPart: "",
          variableSlots: [],
          generalizedForm: "",
          target: "정확한 공식과 조건",
          operation: "recall",
          successCriterion: "자료 없이 공식과 조건을 말한다.",
          rationale: "선택된 핵심 근거",
        },
      ],
    });
  };

  try {
    await runAnalysis(
      {
        title: "test",
        subject: "",
        tags: [],
        sourceText: "## 핵심\n출처: sample.pdf p.2\n정확한 공식과 조건",
        instruction: "",
        analysisContext: "",
        studyGuideline: JSON.stringify({
          wholeDocumentCore: {
            learningOutline: {
              nodes: [
                {
                  id: "leaf-a",
                  selectedByDefault: true,
                  sourceEvidence: "정확한 공식과 조건",
                },
              ],
            },
          },
        }),
        activityDesign: "",
        activitySelectionMode: "automatic",
        stage: "prepare",
        preparedAnalysis: "",
        preparedMaterial: "",
        mode: "flashcard",
      },
      [{ filename: "sample.pdf", mimeType: "application/pdf", base64: "AA==" }],
    );

    const body = requestBody as {
      input: Array<{ role: string; content: string | Array<{ type: string }> }>;
    };
    assert.equal(typeof body.input[1].content, "string");
    assert.equal(JSON.stringify(body).includes("input_file"), false);
    assert.match(String(body.input[1].content), /아래 확정 근거만 사용합니다/);
    assert.match(String(body.input[1].content), /원문 표현을 보존/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("사용자 메모만 있고 선택 목차 원문 근거가 없으면 PDF를 계속 전송한다", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return responseJson({
      detectedGoal: "자료의 핵심을 회상한다.",
      sourceType: "concept",
      keyTopics: ["핵심"],
      recommendedStrategy: "능동 인출",
      extractedMaterial: "핵심",
      primaryKnowledgeType: "concept",
      learningUnits: [
        {
          id: "leaf-a",
          sourceId: "legacy.pdf",
          sourcePage: 1,
          sourceRange: "본문",
          sourceText: "PDF에서 확인한 핵심",
          knowledgeType: "concept",
          fixedPart: "",
          variableSlots: [],
          generalizedForm: "",
          target: "PDF의 핵심",
          operation: "recall",
          successCriterion: "자료 없이 핵심을 말한다.",
          rationale: "학습 목표에 필요",
        },
      ],
    });
  };

  try {
    await runAnalysis(
      {
        title: "legacy",
        subject: "",
        tags: [],
        sourceText: "사용자가 덧붙인 참고 메모",
        instruction: "",
        analysisContext: "",
        studyGuideline: JSON.stringify({
          wholeDocumentCore: {
            learningOutline: {
              nodes: [{ id: "leaf-a", selectedByDefault: true }],
            },
          },
        }),
        activityDesign: "",
        activitySelectionMode: "automatic",
        stage: "prepare",
        preparedAnalysis: "",
        preparedMaterial: "",
        mode: "flashcard",
      },
      [{ filename: "legacy.pdf", mimeType: "application/pdf", base64: "AA==" }],
    );

    const body = requestBody as {
      input: Array<{ role: string; content: string | Array<{ type: string }> }>;
    };
    assert.equal(Array.isArray(body.input[1].content), true);
    assert.equal(JSON.stringify(body).includes("input_file"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Prepare는 모든 개수 정책에서 독립적으로 질문·채점 가능한 크기를 우선한다", async () => {
  const originalFetch = globalThis.fetch;
  let prompt = "";
  const atomicUnit = {
    id: "LU-1",
    sourceId: "sample.pdf",
    sourcePage: 1,
    sourceRange: "본문",
    sourceText: "핵심 개념",
    knowledgeType: "concept",
    fixedPart: "",
    variableSlots: [],
    generalizedForm: "",
    target: "서로 다른 개념의 차이",
    operation: "discriminate",
    successCriterion: "조건을 보고 알맞은 개념을 선택한다.",
    rationale: "학습 목표에 필요",
  };
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    prompt = body.input[1].content;
    return new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          detectedGoal: "개념을 구분한다.",
          sourceType: "concept",
          keyTopics: ["개념"],
          recommendedStrategy: "개념 인출",
          extractedMaterial: "핵심 개념",
          primaryKnowledgeType: "concept",
          learningUnits: [atomicUnit],
        }),
      }),
      { status: 200 },
    );
  };
  try {
    await runAnalysis(
      {
        title: "test",
        subject: "",
        tags: [],
        sourceText: "자료",
        instruction: "",
        analysisContext: "",
        studyGuideline: "",
        activityDesign: "",
        activitySelectionMode: "automatic",
        stage: "prepare",
        preparedAnalysis: "",
        preparedMaterial: "",
        mode: "flashcard",
      },
      [],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.match(prompt, /독립적으로 질문하고 정답을 판정/);
  assert.match(prompt, /각각 맞거나 틀릴 수 있다면 별도 LearningUnit/);
  assert.match(prompt, /순서·상하 관계·분류 구조 자체가 학습 목표/);
  assert.match(prompt, /target에는 이 단위에서 학습자가 가져가야 할 대상/);
  assert.match(prompt, /operation에는 학습자가 그 대상에 대해 성공적으로 보여야 할 주 행동 하나/);
  assert.match(prompt, /새로운 입력에 따라 정답이 달라지면/);
  assert.match(prompt, /서로 다른 성공 방법을 하나로 묶지 마세요/);
});
