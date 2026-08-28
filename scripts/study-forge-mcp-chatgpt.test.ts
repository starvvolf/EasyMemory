import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatGptParityService } from "../tools/study-forge-mcp/chatgpt-parity.ts";

test("ChatGPT 첨부 PDF 경로가 최신 네 단계를 검증하고 같은 덱 계약으로 발행한다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "study-forge-chatgpt-mcp-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new ChatGptParityService(
    path.join(root, "runs"),
    path.join(root, "published"),
  );

  const started = await service.startRun({
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
      files: [{
        fileName: "deadlock.pdf",
        documentType: "운영체제 강의자료",
        summary: "데드락의 네 필요조건을 설명한다.",
        keyTopics: ["데드락 필요조건"],
        outline: [{ heading: "데드락", points: ["네 가지 필요조건"] }],
        sourceOutline: {
          title: "데드락",
          summary: "데드락 필요조건",
          nodes: [{
            id: "deadlock",
            parentId: null,
            order: 1,
            title: "데드락의 필요조건",
            summary: "상호배제, 점유대기, 비선점, 순환대기",
            sourceRefs: [{ fileName: "deadlock.pdf", pageNumbers: [1] }],
            sourceEvidence: "데드락은 네 가지 필요조건이 동시에 성립할 때 발생할 수 있다.",
            selectedByDefault: true,
            structureTags: ["목록", "관계"],
            importance: 3,
          }],
        },
        suggestedRole: "핵심 개념 자료",
      }],
      sourceOutline: {
        title: "데드락",
        summary: "데드락 필요조건",
        nodes: [{
          id: "deadlock",
          parentId: null,
          order: 1,
          title: "데드락의 필요조건",
          summary: "상호배제, 점유대기, 비선점, 순환대기",
          sourceRefs: [{ fileName: "deadlock.pdf", pageNumbers: [1] }],
          sourceEvidence: "데드락은 네 가지 필요조건이 동시에 성립할 때 발생할 수 있다.",
          selectedByDefault: true,
          structureTags: ["목록", "관계"],
          importance: 3,
        }],
      },
    },
  });
  assert.equal(analyzed.nextStage, "plan");

  const planned = await service.submitStage({
    runId: started.runId,
    stage: "plan",
    result: {
      summary: "데드락 필요조건을 학습한다.",
      learningGoal: "네 조건과 동시 성립 관계를 설명한다.",
      selectionRationale: "핵심 정의이므로 포함한다.",
      areas: [{
        id: "deadlock-conditions",
        title: "데드락 필요조건",
        description: "네 조건과 동시 성립 관계",
        learningValue: "데드락 판별의 기초",
        sourceScope: ["deadlock"],
      }],
      exclusions: [],
      maxLearningUnitCount: 3,
    },
  });
  assert.equal(planned.nextStage, "learning-design");

  const designed = await service.submitStage({
    runId: started.runId,
    stage: "learning-design",
    result: {
      objectives: [{
        nodes: ["deadlock"],
        target: "데드락의 네 필요조건과 동시 성립 관계를 설명한다.",
        operation: "recall",
        criteria: [{ description: "네 조건을 빠짐없이 말한다." }],
        importance: 3,
      }],
      units: [{
        objective: 1,
        nodes: ["deadlock"],
        content: "데드락의 네 필요조건은 상호배제, 점유대기, 비선점, 순환대기다.",
        evidence: "데드락은 네 가지 필요조건이 동시에 성립할 때 발생할 수 있다.",
        kind: "concept",
        rationale: "데드락 판별의 핵심 정의다.",
      }],
      checks: [{
        unit: 1,
        operation: "recall",
        criteria: [1],
        relation: "direct",
        given: { type: "instruction", description: "데드락의 필요조건을 말하시오." },
        hidden: { description: "네 필요조건", reason: "target_answer" },
        response: { kind: "short_text", description: "네 조건의 이름" },
        grading: "semantic",
      }],
    },
  });
  assert.equal(designed.nextStage, "cards");

  const completed = await service.submitStage({
    runId: started.runId,
    stage: "cards",
    result: {
      activities: [{
        blueprintId: "blueprint-1",
        recommendedType: "flashcard",
        supportLevel: "exact",
        reason: "네 조건을 직접 회상할 수 있다.",
        limitation: "",
        includeInGeneration: true,
      }],
      cards: [{
        blueprintId: "blueprint-1",
        activityType: "flashcard",
        front: "데드락의 네 가지 필요조건은 무엇인가?",
        back: "상호배제, 점유대기, 비선점, 순환대기",
        basis: "네 가지 필요조건이 동시에 성립할 때 데드락이 발생할 수 있다.",
        strategy: "concept",
        difficulty: 2,
        explanation: "네 조건이 함께 성립하는 관계를 기억한다.",
        sourceGrounded: true,
        verificationNotes: ["PDF 1쪽 근거와 대조함"],
      }],
    },
  });
  assert.equal(completed.completed, true);

  const result = await service.getResult(started.runId);
  assert.equal(result.engine, "chatgpt-mcp");
  assert.equal(result.cardCount, 1);
  assert.equal(result.cards[0].front, "데드락의 네 가지 필요조건은 무엇인가?");

  const published = await service.publishRun({ runId: started.runId, confirmPublish: true });
  assert.equal(published.cardCount, 1);
  assert.match(published.deckId, /^mcp-run-chatgpt-/);
});
