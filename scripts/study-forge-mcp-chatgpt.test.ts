import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatGptParityService } from "../tools/study-forge-mcp/chatgpt-parity.ts";

test("ChatGPT 첨부 PDF 경로가 자연어 다섯 단계를 검증하고 같은 덱 계약으로 발행한다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "study-forge-chatgpt-mcp-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new ChatGptParityService(
    path.join(root, "runs"),
    path.join(root, "published"),
  );

  const started = await service.startRun({
    projectId: "project-deadlock",
    title: "데드락 비교 학습",
    files: [{ fileName: "deadlock.pdf", pageCount: 1 }],
    learningGoal: "데드락 조건을 설명한다.",
    instruction: "원문 근거만 사용한다.",
  });
  assert.equal(started.nextStage, "analyze");

  const analyzed = await service.submitStage({
    runId: started.runId,
    stage: "analyze",
    result: {
      outlineText: "@file deadlock.pdf\n# 데드락의 필요조건 [1]",
    },
  });
  assert.equal(analyzed.nextStage, "concept-tree");
  assert.deepEqual(
    (analyzed.stageInput as { input: { selectedSourceOutline: { nodes: Array<{ id: string }> } } })
      .input.selectedSourceOutline.nodes.map((node) => node.id),
    ["source-1:outline-1"],
  );

  const tree = await service.submitStage({
    runId: started.runId,
    stage: "concept-tree",
    result: {
      treeText: [
        "데드락",
        "- [필요조건] 상호 배제 — 하나의 자원을 동시에 공유할 수 없음 (p.1)",
        "- [필요조건] 점유와 대기 — 자원을 가진 채 다른 자원을 기다림 (p.1)",
        "- [필요조건] 비선점 — 자원을 강제로 회수할 수 없음 (p.1)",
        "- [필요조건] 순환 대기 — 프로세스들이 원형으로 자원을 기다림 (p.1)",
      ].join("\n"),
    },
  });
  assert.equal(tree.nextStage, "learning-design");

  const designed = await service.submitStage({
    runId: started.runId,
    stage: "learning-design",
    result: {
      learningDesignText: [
        "--- LEARNING 1 ---",
        "개념: 2, 3, 4, 5",
        "학습내용: 데드락의 네 필요조건과 동시 성립 관계",
        "학습목표: 네 필요조건과 동시 성립 관계를 설명할 수 있다.",
        "성공기준: 네 조건과 동시 성립 관계를 빠짐없이 말한다.",
        "근거: 데드락은 네 가지 필요조건이 동시에 성립할 때 발생할 수 있다.",
        "종류: 관계",
        "이유: 네 조건은 개별 사실보다 동시 성립 관계가 핵심이다.",
        "중요도: 3",
      ].join("\n"),
    },
  });
  assert.equal(designed.nextStage, "activity-design");
  assert.doesNotMatch(JSON.stringify(designed.stageInput), /"operation"|행동:/);

  const activityDesigned = await service.submitStage({
    runId: started.runId,
    stage: "activity-design",
    result: {
      activityDesignText: [
        "--- DESIGN 1 ---",
        "학습대상: 1",
        "관련개념: 전체",
        "관계: 직접",
        "보여줄 것: 데드락은 네 가지 필요조건이 어떻게 성립할 때 발생하는가",
        "감출 것: 동시에",
        "응답: 짧은답",
        "채점: 정확",
        "단서: 보통",
        "문제방식: 빈칸",
        "풀이방식: 해당없음",
        "이유: 핵심 관계어를 문맥에서 직접 회상한다.",
        "제한:",
        "--- DESIGN 2 ---",
        "학습대상: 1",
        "관련개념: 3",
        "관계: 직접",
        "보여줄 것: 네 조건 중 일부만 성립한 상황에 대한 진술",
        "감출 것: 데드락 발생 여부의 참과 거짓",
        "응답: 단일선택",
        "채점: 정확",
        "단서: 보통",
        "문제방식: OX",
        "풀이방식: 해당없음",
        "이유: 동시 성립 관계를 진술 판별로 보조 연습한다.",
        "제한: 최종 설명 행동을 직접 평가하지는 않는다.",
      ].join("\n"),
    },
  });
  assert.equal(activityDesigned.nextStage, "cards");
  const actionlessDesignInput = activityDesigned.stageInput as {
    input: { problemDesigns: Array<{ supportLevel: string }> };
  };
  assert.doesNotMatch(JSON.stringify(activityDesigned.stageInput), /"operation"|확인행동/);
  assert.deepEqual(
    actionlessDesignInput.input.problemDesigns.map((item) => item.supportLevel),
    ["exact", "exact"],
  );

  await assert.rejects(
    service.submitStage({
      runId: started.runId,
      stage: "cards",
      result: {
        cardsText: [
          "--- CARD 1 ---",
          "유형: 빈칸",
          "질문: 데드락은 네 가지 필요조건이 ____ 성립할 때 발생할 수 있다.",
          "정답: 동시에",
          "해설: 네 조건은 개별 존재가 아니라 동시 성립해야 한다.",
          "근거: 데드락은 네 가지 필요조건이 동시에 성립할 때 발생할 수 있다.",
          "--- CARD 2 ---",
          "유형: OX",
          "질문: 필요조건 중 하나만 성립해도 데드락이 발생한다.",
          "정답: 예",
          "해설: 네 조건이 동시에 성립해야 한다.",
          "근거: 데드락은 네 가지 필요조건이 동시에 성립할 때 발생할 수 있다.",
        ].join("\n"),
      },
    }),
    /CARD 블록만 같은 번호로 다시 보내세요/,
  );
  const completed = await service.submitStage({
    runId: started.runId,
    stage: "cards",
    result: {
      cardsText: [
        "--- CARD 2 ---",
        "유형: OX",
        "질문: 필요조건 중 하나만 성립해도 데드락이 발생한다.",
        "정답: X",
        "해설: 네 조건이 동시에 성립해야 한다.",
        "근거: 데드락은 네 가지 필요조건이 동시에 성립할 때 발생할 수 있다.",
      ].join("\n"),
    },
  });
  assert.equal(completed.completed, true);

  const result = await service.getResult(started.runId);
  assert.equal(result.engine, "chatgpt-mcp");
  assert.equal(result.cardCount, 2);
  assert.equal(result.stageAttemptCounts.cards, 2);
  assert.equal(result.stageValidationFailures.cards.length, 1);
  assert.equal(result.cards[0].activityType, "cloze");
  assert.equal((result.cards[0] as typeof result.cards[0] & { effectiveType: string }).effectiveType, "cloze");
  assert.equal(result.cards[0].clozeText, "데드락은 네 가지 필요조건이 ____ 성립할 때 발생할 수 있다.");
  assert.equal(result.cards[0].answer, "동시에");
  assert.deepEqual(result.cards[0].conceptNodeIds, [
    "concept-002", "concept-003", "concept-004", "concept-005",
  ]);
  assert.deepEqual(result.cards[1].conceptNodeIds, ["concept-003"]);

  const published = await service.publishRun({ runId: started.runId, confirmPublish: true });
  assert.equal(published.cardCount, 2);
  assert.match(published.deckId, /^mcp-run-chatgpt-/);
  const publishedDeck = JSON.parse(
    await readFile(path.join(root, "published", `${started.runId}.json`), "utf8"),
  ) as { projectId?: string; conceptTree?: { nodes: unknown[] } };
  assert.equal(publishedDeck.projectId, "project-deadlock");
  assert.equal(publishedDeck.conceptTree?.nodes.length, 5);
});

test("자연어형 Markdown 목차를 앱 계층으로 조립하고 설명 문장은 거부한다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "study-forge-outline-text-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new ChatGptParityService(
    path.join(root, "runs"),
    path.join(root, "published"),
  );
  const started = await service.startRun({
    title: "목차 조립 테스트",
    files: [{ fileName: "outline.pdf", pageCount: 3 }],
  });
  const analyzed = await service.submitStage({
    runId: started.runId,
    stage: "analyze",
    result: {
      outlineText: "@file outline.pdf\n# Deadlocks [1-3]\n## Four conditions [2]",
    },
  });
  const nodes = (analyzed.stageInput as {
    input: { selectedSourceOutline: { nodes: Array<{ id: string; parentId: string | null }> } };
  }).input.selectedSourceOutline.nodes;
  assert.equal(nodes[0].id, "source-1:outline-1");
  assert.equal(nodes[0].parentId, null);
  assert.equal(nodes[1].id, "source-1:outline-2");
  assert.equal(nodes[1].parentId, "source-1:outline-1");

  const invalidRun = await service.startRun({
    title: "잘못된 목차 테스트",
    files: [{ fileName: "outline.pdf", pageCount: 3 }],
  });
  await assert.rejects(
    service.submitStage({
      runId: invalidRun.runId,
      stage: "analyze",
      result: { outlineText: "데드락을 설명하는 자료입니다." },
    }),
    /형식이어야 합니다/,
  );
});

test("Cards 계약은 구조의 종류와 지원 풀이 방식을 분리해 요구한다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "study-forge-structure-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new ChatGptParityService(
    path.join(root, "runs"),
    path.join(root, "published"),
  );
  const started = await service.startRun({
    title: "구조 계약 테스트",
    files: [{ fileName: "flow.pdf", pageCount: 1 }],
  });
  await service.submitStage({
    runId: started.runId,
    stage: "analyze",
    result: { outlineText: "@file flow.pdf\n# 처리 순서 [1]" },
  });
  await service.submitStage({
    runId: started.runId,
    stage: "concept-tree",
    result: {
      treeText: [
        "처리 순서",
        "- [첫 단계] 요청 — 자원을 요청함 (p.1)",
        "- [다음 단계] 할당 — 자원을 할당받음 (p.1)",
        "- [마지막 단계] 반납 — 사용한 자원을 반납함 (p.1)",
      ].join("\n"),
    },
  });
  await service.submitStage({
    runId: started.runId,
    stage: "learning-design",
    result: {
      learningDesignText: [
        "--- LEARNING 1 ---",
        "개념: 2, 3, 4",
        "학습내용: 요청, 할당, 반납의 고정 순서",
        "학습목표: 세 단계를 순서대로 복원할 수 있다.",
        "성공기준: 세 단계의 순서가 정확하다.",
        "근거: 요청 후 할당하고 마지막에 반납한다.",
        "종류: 절차",
        "이유: 개별 단계보다 고정 순서가 학습 대상이다.",
        "중요도: 3",
      ].join("\n"),
    },
  });
  const cardsStage = await service.submitStage({
    runId: started.runId,
    stage: "activity-design",
    result: {
      activityDesignText: [
        "--- DESIGN 1 ---",
        "학습대상: 1",
        "관련개념: 전체",
        "관계: 직접",
        "보여줄 것: 처리 단계의 항목",
        "감출 것: 요청, 할당, 반납의 순서",
        "응답: 순서구조",
        "채점: 정확",
        "단서: 많음",
        "문제방식: 순서복원",
        "풀이방식: 직접입력",
        "이유: 고정 순서를 그대로 복원한다.",
        "제한:",
      ].join("\n"),
    },
  });
  const contract = JSON.stringify(cardsStage.stageInput);
  assert.match(contract, /cardsText/);
  assert.match(contract, /문제 수, 문제 방식, 단서 수준과 기대 응답은 앞 단계 그대로 유지합니다/);
  assert.match(contract, /free_input/);
  const completed = await service.submitStage({
    runId: started.runId,
    stage: "cards",
    result: {
      cardsText: [
        "--- CARD 1 ---",
        "유형: 순서복원",
        "질문: 처리 순서를 처음부터 끝까지 복원하세요.",
        "정답: 요청 → 할당 → 반납 → 요청",
        "구조:",
        "- 요청",
        "- 할당",
        "- 반납",
        "- 요청",
        "해설: 요청 뒤에 할당하고 마지막에 반납한다.",
        "근거: 요청 후 할당하고 마지막에 반납한다.",
      ].join("\n"),
    },
  });
  assert.equal(completed.completed, true);
  const result = await service.getResult(started.runId);
  assert.equal(result.cards[0].structureRecallKind, "sequence");
  assert.deepEqual(result.cards[0].supportedStructureRecallModes, ["word_bank", "free_input"]);
  assert.equal(result.cards[0].structureRecallMode, "free_input");
});

test("지원 불가 설계만 남은 학습대상은 생성 가능한 보조 플래시카드로 자동 보정한다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "study-forge-coverage-repair-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new ChatGptParityService(path.join(root, "runs"), path.join(root, "published"));
  const started = await service.startRun({
    title: "탐지 전략 커버리지",
    files: [{ fileName: "deadlock.pdf", pageCount: 1 }],
    learningGoal: "데드락 탐지 절차를 이해한다.",
  });
  await service.submitStage({
    runId: started.runId,
    stage: "analyze",
    result: { outlineText: "@file deadlock.pdf\n# 데드락 탐지 [1]" },
  });
  await service.submitStage({
    runId: started.runId,
    stage: "concept-tree",
    result: { treeText: "데드락 탐지\n- [절차] 탐지 알고리즘 — 대기 관계를 검사해 사이클을 찾음 (p.1)" },
  });
  await service.submitStage({
    runId: started.runId,
    stage: "learning-design",
    result: {
      learningDesignText: [
        "--- LEARNING 1 ---",
        "개념: 2",
        "학습내용: 대기 관계를 이용한 데드락 탐지 절차",
        "학습목표: 주어진 그래프에 탐지 알고리즘을 적용할 수 있다.",
        "성공기준: 대기 관계의 사이클을 검사해 데드락 여부를 판단한다.",
        "근거: 대기 관계를 검사해 사이클을 찾는다.",
        "종류: 문제해결",
        "이유: 실제 탐지 판단이 학습 대상이다.",
        "중요도: 3",
      ].join("\n"),
    },
  });
  const cardsStage = await service.submitStage({
    runId: started.runId,
    stage: "activity-design",
    result: {
      activityDesignText: [
        "--- DESIGN 1 ---",
        "학습대상: 1",
        "관련개념: 전체",
        "관계: 직접",
        "보여줄 것: 자원 대기 그래프",
        "감출 것: 그래프에서 탐지한 데드락 여부",
        "응답: 그림표시",
        "채점: 규칙",
        "단서: 적음",
        "문제방식: 미지원",
        "풀이방식: 해당없음",
        "이유: 그래프 표시 기능이 필요하다.",
        "제한: 현재 앱에 그래프 표시 입력이 없다.",
      ].join("\n"),
    },
  });
  const input = cardsStage.stageInput as {
    input: { problemDesigns: Array<{ problemType: string; supportLevel: string; includeInGeneration: boolean }> };
  };
  assert.equal(input.input.problemDesigns.length, 1);
  assert.equal(input.input.problemDesigns[0].problemType, "플래시카드");
  assert.equal(input.input.problemDesigns[0].supportLevel, "scaffold");
  assert.equal(input.input.problemDesigns[0].includeInGeneration, true);
  const completed = await service.submitStage({
    runId: started.runId,
    stage: "cards",
    result: {
      cardsText: [
        "--- CARD 1 ---",
        "유형: 플래시카드",
        "질문: 대기 관계를 이용해 데드락을 탐지할 때 확인해야 할 핵심은 무엇인가?",
        "정답: 대기 관계에 사이클이 존재하는지 검사한다.",
        "해설: 현재 UI에서 그래프 직접 표시는 못 하므로 판단 원리를 먼저 회상한다.",
        "근거: 대기 관계를 검사해 사이클을 찾는다.",
      ].join("\n"),
    },
  });
  assert.equal(completed.completed, true);
  const result = await service.getResult(started.runId);
  assert.equal(result.cardCount, 1);
  assert.equal(result.cards[0].activityType, "flashcard");
});

test("clientRequestId는 시작 재호출을 같은 run으로 합치고 run을 조회·취소할 수 있다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "study-forge-idempotent-run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new ChatGptParityService(path.join(root, "runs"), path.join(root, "published"));
  const input = {
    clientRequestId: "deadlock-speed-test-1",
    title: "중복 방지 테스트",
    files: [{ fileName: "deadlock.pdf", pageCount: 1 }],
  };
  const first = await service.startRun(input);
  const second = await service.startRun(input);
  assert.equal(second.runId, first.runId);
  const listed = await service.listRuns();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, "active");
  const cancelled = await service.cancelRun(first.runId);
  assert.equal(cancelled.cancelled, true);
  assert.equal((await service.listRuns())[0].status, "cancelled");
  await assert.rejects(service.getNextStage(first.runId), /취소된/);
});
