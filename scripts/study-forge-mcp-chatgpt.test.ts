import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatGptParityService } from "../tools/study-forge-mcp/chatgpt-parity.ts";
import { registerMcpSource } from "../src/lib/mcp-source-registry.ts";

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
  assert.match((analyzed.stageInput as { instructions: string }).instructions, /독립적으로 학습·판단할 내용의 출처/);
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
  const learningInput = tree.stageInput as { instructions: string; input: { attachmentRule: string; format: string } };
  assert.match(learningInput.instructions, /학습내용·목표·성공기준은 같은 능력과 범위/);
  assert.match(learningInput.instructions, /독립 능력은 별도 학습 대상/);
  assert.match(learningInput.instructions, /제공된 원문으로 학습하고 확인할 수 있는 내용/);
  assert.match(learningInput.input.attachmentRule, /상위 개념의 출처를 그 아래 모든 독립 능력의 평가범위로 간주하지/);
  assert.match(learningInput.input.format, /학습내용과 같은 능력·범위/);

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

test("맨 위 개념만 제출하면 거부하고 하위 개념을 추가하면 다음 단계로 진행한다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "study-forge-root-only-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new ChatGptParityService(path.join(root, "runs"), path.join(root, "published"));
  const started = await service.startRun({ title: "합성 회귀 자료", files: [{ fileName: "fixture.pdf", pageCount: 1 }] });
  await service.submitStage({ runId: started.runId, stage: "analyze", result: { outlineText: "@file fixture.pdf\n# 개념 설명 [1]" } });
  await assert.rejects(service.submitStage({ runId: started.runId, stage: "concept-tree", result: { treeText: "개념 설명" } }), /하위 개념을 하나 이상/);
  const rejected = JSON.parse(await readFile(path.join(root, "runs", started.runId, "run.json"), "utf8"));
  assert.equal(rejected.artifacts["concept-tree"], undefined);
  const repaired = await service.submitStage({ runId: started.runId, stage: "concept-tree", result: { treeText: "개념 설명\n- 구성 요소 (p.1)" } });
  assert.equal(repaired.nextStage, "learning-design");
});

test("쪽 근거 없는 맨 위 개념만 참조한 학습 설계는 거부하고 하위 개념의 실제 쪽을 사용한다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "study-forge-learning-pages-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new ChatGptParityService(path.join(root, "runs"), path.join(root, "published"));
  const started = await service.startRun({
    title: "쪽 근거 검증",
    files: [{ fileName: "viewing.pdf", pageCount: 44 }],
  });
  await service.submitStage({
    runId: started.runId,
    stage: "analyze",
    result: { outlineText: "@file viewing.pdf\n# Three Dimensional Viewing [1-44]\n## Perspective Projection [44]" },
  });
  const tree = await service.submitStage({
    runId: started.runId,
    stage: "concept-tree",
    result: { treeText: "Three Dimensional Viewing\n- [투영] Perspective Projection — 원근 투영의 성질 (p.44)" },
  });
  assert.match((tree.stageInput as { instructions: string }).instructions, /맨 위 개념 하나로 자료 전체를 묶지/);
  const learningText = (concepts: string) => [
    "--- LEARNING 1 ---",
    `개념: ${concepts}`,
    "학습내용: 원근 투영의 성질",
    "학습목표: 원근 투영의 성질을 설명한다.",
    "성공기준: 원근 투영의 성질을 정확히 말한다.",
    "근거: Perspective Projection",
    "종류: 개념",
    "이유: 해당 절의 핵심 성질이다.",
    "중요도: 3",
  ].join("\n");
  await assert.rejects(service.submitStage({
    runId: started.runId,
    stage: "learning-design",
    result: { learningDesignText: learningText("1") },
  }), /1번 학습 설계는 쪽 근거가 있는 개념을 가리켜야 합니다/);
  const rejected = JSON.parse(await readFile(path.join(root, "runs", started.runId, "run.json"), "utf8")) as {
    artifacts: Record<string, unknown>;
  };
  assert.equal(rejected.artifacts["learning-design"], undefined);
  const designed = await service.submitStage({
    runId: started.runId,
    stage: "learning-design",
    result: { learningDesignText: learningText("1, 2") },
  });
  assert.equal(designed.nextStage, "activity-design");
  const saved = JSON.parse(await readFile(path.join(root, "runs", started.runId, "run.json"), "utf8")) as {
    artifacts: { "learning-design": { learningDesign: { knowledgeUnits: Array<{ sourcePage: number; sourceId: string; sourceRange: string }> } } };
  };
  const unit = saved.artifacts["learning-design"].learningDesign.knowledgeUnits[0];
  assert.equal(unit.sourcePage, 44);
  assert.equal(unit.sourceId, "viewing.pdf");
  assert.match(unit.sourceRange, /PDF 44쪽/);
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

test("같은 페이지의 서로 다른 말단 목차는 개념별 명시 연결을 요구한다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "study-forge-same-page-outline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new ChatGptParityService(path.join(root, "runs"), path.join(root, "published"));
  const started = await service.startRun({
    title: "같은 페이지 목차 검증",
    files: [{ fileName: "same-page.pdf", pageCount: 2 }],
  });
  const analyzed = await service.submitStage({
    runId: started.runId,
    stage: "analyze",
    result: { outlineText: "@file same-page.pdf\n# 변환 [1-2]\n## 평행이동 [2]\n## 회전 [2]" },
  });
  const choices = (analyzed.stageInput as { userSelection: { availableLeafNodes: Array<{ number: number; title: string }> } }).userSelection.availableLeafNodes;
  assert.deepEqual(choices.map(({ number, title }) => [number, title]), [[1, "평행이동"], [2, "회전"]]);
  await assert.rejects(service.submitStage({
    runId: started.runId,
    stage: "concept-tree",
    result: { treeText: "변환\n- [종류] 평행이동 — 좌표 이동 (p.2)" },
  }), /@목차\(번호\)/);
  await service.submitStage({
    runId: started.runId,
    stage: "concept-tree",
    result: { treeText: "변환\n- [종류] 평행이동 — 좌표 이동 (p.2) @목차(1)\n- [종류] 회전 — 방향 변경 (p.2) @목차(2)" },
  });
  const run = JSON.parse(await readFile(path.join(root, "runs", started.runId, "run.json"), "utf8")) as {
    artifacts: { "concept-tree": { nodes: Array<{ outlineNodeIds: string[] }> } };
  };
  assert.deepEqual(run.artifacts["concept-tree"].nodes[1].outlineNodeIds, ["source-1:outline-2"]);
  assert.deepEqual(run.artifacts["concept-tree"].nodes[2].outlineNodeIds, ["source-1:outline-3"]);
});

test("stopAfterStage 뒤에는 다음 단계 입력을 시작하지 않는다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "study-forge-stop-stage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new ChatGptParityService(path.join(root, "runs"), path.join(root, "published"));
  const started = await service.startRun({
    title: "목차까지만 실행",
    files: [{ fileName: "stop.pdf", pageCount: 2 }],
    stopAfterStage: "analyze",
  });
  const stopped = await service.submitStage({
    runId: started.runId,
    stage: "analyze",
    result: { outlineText: "@file stop.pdf\n# 첫 장 [1-2]" },
  });
  assert.equal(stopped.completed, false);
  assert.equal(stopped.stoppedAfterStage, "analyze");
  assert.equal(stopped.nextStage, null);
  assert.equal(stopped.stageInput, null);
  assert.equal((await service.getNextStage(started.runId)).nextStage, null);
  assert.equal((await service.listRuns())[0].status, "stopped");
  await assert.rejects(service.submitStage({
    runId: started.runId,
    stage: "concept-tree",
    result: { treeText: "첫 장" },
  }), /종료된 ChatGPT MCP run/);
  const run = JSON.parse(await readFile(path.join(root, "runs", started.runId, "run.json"), "utf8")) as {
    stageStartedAt: Record<string, string>;
  };
  assert.equal(run.stageStartedAt["concept-tree"], undefined);
});

test("완료 Analyze artifact를 해시 검증해 새 run에 정확히 재사용하고 출처를 보존한다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "study-forge-reuse-analyze-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pdfPath = path.join(root, "fixture.pdf");
  const pdfBytes = Buffer.from("fixed local PDF fixture");
  await writeFile(pdfPath, pdfBytes);
  const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
  const pdfSha256 = digest(pdfBytes);
  const service = new ChatGptParityService(
    path.join(root, "runs"),
    path.join(root, "published"),
    (name) => name === "fixture.pdf" ? { path: pdfPath, pageCount: 2, sha256: pdfSha256 } : null,
  );
  const source = await service.startRun({ title: "원본", files: [{ fileName: "fixture.pdf", pageCount: 2 }] });
  await service.submitStage({
    runId: source.runId,
    stage: "analyze",
    result: { outlineText: "@file fixture.pdf\n# 첫 장 [1-2]" },
  });
  const sourceFile = path.join(root, "runs", source.runId, "run.json");
  const sourceRaw = await readFile(sourceFile, "utf8");
  const sourceArtifact = (JSON.parse(sourceRaw) as { artifacts: { analyze: unknown } }).artifacts.analyze;
  const sourceRunSha256 = digest(sourceRaw);
  const sourceArtifactSha256 = digest(JSON.stringify(sourceArtifact));
  const target = await service.startRun({
    title: "재사용 대상",
    files: [{ fileName: "fixture.pdf", pageCount: 2 }],
    stopAfterStage: "concept-tree",
  });
  const reuseInput = {
    runId: target.runId,
    sourceRunId: source.runId,
    sourceRunSha256,
    sourceArtifactSha256,
    sourcePdfSha256: pdfSha256,
  };
  await assert.rejects(service.reuseAnalyzeOutput({ ...reuseInput, sourceArtifactSha256: "0".repeat(64) }), /산출물의 SHA-256/);
  await assert.rejects(service.reuseAnalyzeOutput({ ...reuseInput, sourceRunSha256: "0".repeat(64) }), /run 파일의 SHA-256/);
  await assert.rejects(service.reuseAnalyzeOutput({ ...reuseInput, sourcePdfSha256: "0".repeat(64) }), /승인된 SHA-256/);
  const reused = await service.reuseAnalyzeOutput(reuseInput);
  assert.equal(reused.reused.kind, "output");
  assert.equal(reused.nextStage, "concept-tree");
  assert.equal(await readFile(sourceFile, "utf8"), sourceRaw);
  const targetRun = JSON.parse(await readFile(path.join(root, "runs", target.runId, "run.json"), "utf8")) as {
    artifacts: { analyze: unknown };
    stageReuse: { analyze: { sourceRunId: string; sourceArtifactSha256: string } };
  };
  assert.deepEqual(targetRun.artifacts.analyze, sourceArtifact);
  assert.equal(targetRun.stageReuse.analyze.sourceRunId, source.runId);
  assert.equal(targetRun.stageReuse.analyze.sourceArtifactSha256, sourceArtifactSha256);
  await assert.rejects(service.reuseAnalyzeOutput(reuseInput), /Analyze 전에만/);
  const stopped = await service.submitStage({
    runId: target.runId,
    stage: "concept-tree",
    result: { treeText: "첫 장\n- [주제] 근거 — 첫 장의 내용 (p.1)" },
  });
  assert.equal(stopped.stoppedAfterStage, "concept-tree");
  assert.equal(stopped.nextStage, null);
});

test("registered PDF reuse binds source ID and bytes, not merely the file name", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "study-forge-registered-reuse-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  process.env.STUDY_FORGE_DATA_DIR = root;
  t.after(() => { delete process.env.STUDY_FORGE_DATA_DIR; });
  const firstBytes = await readFile(path.join(process.cwd(), "eval/corpus/user-test-pdfs/cornell-bfs-2pages.pdf"));
  const first = await registerMcpSource("same.pdf", firstBytes);
  const other = await registerMcpSource("same.pdf", Buffer.concat([firstBytes, Buffer.from("\n%alternate-copy\n")]));
  const service = new ChatGptParityService(path.join(root, "runs"), path.join(root, "published"));
  const source = await service.startRun({ title: "source", files: [{ fileName: first.fileName, pageCount: first.pageCount, sourceId: first.id, sha256: first.sha256 }] });
  await service.submitStage({ runId: source.runId, stage: "analyze", result: { outlineText: "@file same.pdf\n# 첫 장 [1-2]" } });
  const sourceRaw = await readFile(path.join(root, "runs", source.runId, "run.json"), "utf8");
  const sourceArtifact = (JSON.parse(sourceRaw) as { artifacts: { analyze: unknown } }).artifacts.analyze;
  const target = await service.startRun({ title: "target", files: [{ fileName: other.fileName, pageCount: other.pageCount, sourceId: other.id, sha256: other.sha256 }] });
  await assert.rejects(service.reuseAnalyzeOutput({
    runId: target.runId, sourceRunId: source.runId,
    sourceRunSha256: createHash("sha256").update(sourceRaw).digest("hex"),
    sourceArtifactSha256: createHash("sha256").update(JSON.stringify(sourceArtifact)).digest("hex"),
    sourcePdfSha256: first.sha256,
  }), /승인된 SHA-256/);
  await assert.rejects(service.startRun({ title: "bad", files: [{ fileName: first.fileName, pageCount: first.pageCount, sourceId: first.id, sha256: other.sha256 }] }), /등록된 원본 PDF/);
});

test("verified legacy Analyze can be reused by the same registered PDF", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "study-forge-legacy-registered-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  process.env.STUDY_FORGE_DATA_DIR = root;
  t.after(() => { delete process.env.STUDY_FORGE_DATA_DIR; });
  const bytes = await readFile(path.join(process.cwd(), "eval/corpus/user-test-pdfs/cornell-bfs-2pages.pdf"));
  const pdfPath = path.join(root, "legacy.pdf");
  await writeFile(pdfPath, bytes);
  const registered = await registerMcpSource("legacy.pdf", bytes);
  const service = new ChatGptParityService(path.join(root, "runs"), path.join(root, "published"),
    (name) => name === "legacy.pdf" ? { path: pdfPath, pageCount: registered.pageCount, sha256: registered.sha256 } : null);
  const source = await service.startRun({ title: "old", files: [{ fileName: "legacy.pdf", pageCount: registered.pageCount }] });
  await service.submitStage({ runId: source.runId, stage: "analyze", result: { outlineText: "@file legacy.pdf\n# 첫 장 [1-2]" } });
  const sourceRaw = await readFile(path.join(root, "runs", source.runId, "run.json"), "utf8");
  const artifact = (JSON.parse(sourceRaw) as { artifacts: { analyze: unknown } }).artifacts.analyze;
  const target = await service.startRun({ title: "new", files: [{ fileName: "legacy.pdf", pageCount: registered.pageCount,
    sourceId: registered.id, sha256: registered.sha256 }] });
  const result = await service.reuseAnalyzeOutput({ runId: target.runId, sourceRunId: source.runId,
    sourceRunSha256: createHash("sha256").update(sourceRaw).digest("hex"),
    sourceArtifactSha256: createHash("sha256").update(JSON.stringify(artifact)).digest("hex"),
    sourcePdfSha256: registered.sha256 });
  assert.equal(result.reused.sourcePdfSha256, registered.sha256);
});

test("완료된 Learning Design까지만 불변 복사하고 새 Activity Design으로 이어간다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "study-forge-reuse-prefix-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pdfPath = path.join(root, "fixture.pdf");
  const bytes = Buffer.from("fixed source for prefix reuse");
  await writeFile(pdfPath, bytes);
  const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
  const pdfSha256 = digest(bytes);
  const service = new ChatGptParityService(path.join(root, "runs"), path.join(root, "published"),
    (name) => name === "fixture.pdf" ? { path: pdfPath, pageCount: 1, sha256: pdfSha256 } : null);
  const config = {
    title: "학습 목표 확인", files: [{ fileName: "fixture.pdf", pageCount: 1 }],
    learningGoal: "네 필요조건의 동시 성립을 설명한다.", instruction: "원문만 사용한다.",
  };
  const source = await service.startRun({ ...config, stopAfterStage: "learning-design" });
  await service.submitStage({ runId: source.runId, stage: "analyze", result: {
    outlineText: "@file fixture.pdf\n# 데드락의 필요조건 [1]",
  } });
  await service.submitStage({ runId: source.runId, stage: "concept-tree", result: { treeText: [
    "데드락", "- [필요조건] 상호 배제 — 하나의 자원을 동시에 공유할 수 없음 (p.1)",
    "- [필요조건] 점유와 대기 — 자원을 가진 채 다른 자원을 기다림 (p.1)",
    "- [필요조건] 비선점 — 자원을 강제로 회수할 수 없음 (p.1)",
    "- [필요조건] 순환 대기 — 프로세스들이 원형으로 자원을 기다림 (p.1)",
  ].join("\n") } });
  const stopped = await service.submitStage({ runId: source.runId, stage: "learning-design", result: {
    learningDesignText: [
      "--- LEARNING 1 ---", "개념: 2, 3, 4, 5", "학습내용: 데드락의 네 필요조건과 동시 성립 관계",
      "학습목표: 네 필요조건과 동시 성립 관계를 설명할 수 있다.",
      "성공기준: 네 조건과 동시 성립 관계를 빠짐없이 말한다.",
      "근거: 데드락은 네 가지 필요조건이 동시에 성립할 때 발생할 수 있다.",
      "종류: 관계", "이유: 네 조건은 개별 사실보다 동시 성립 관계가 핵심이다.", "중요도: 3",
    ].join("\n"),
  } });
  assert.equal(stopped.stoppedAfterStage, "learning-design");
  const sourceFile = path.join(root, "runs", source.runId, "run.json");
  const sourceRaw = await readFile(sourceFile, "utf8");
  const sourceRun = JSON.parse(sourceRaw) as {
    artifacts: Record<string, unknown>; selectedOutlineLeafIds: string[];
  };
  const target = await service.startRun({ ...config, title: "새 문제 생성", stopAfterStage: "cards" });
  const reuse = {
    runId: target.runId, sourceRunId: source.runId, stage: "learning-design" as const,
    sourceRunSha256: digest(sourceRaw), sourceArtifactSha256: digest(JSON.stringify(sourceRun.artifacts["learning-design"])),
    sourcePdfSha256: pdfSha256, selectedOutlineLeafIds: sourceRun.selectedOutlineLeafIds, selectedPageNumbers: [1],
  };
  await assert.rejects(service.reuseStagePrefix({ ...reuse, sourceArtifactSha256: "0".repeat(64) }), /산출물의 SHA-256/);
  await assert.rejects(service.reuseStagePrefix({ ...reuse, selectedPageNumbers: [2] }), /페이지 범위/);
  await assert.rejects(service.reuseStagePrefix({ ...reuse, selectedOutlineLeafIds: ["different"] }), /하위목차 범위/);
  const differentGoal = await service.startRun({ ...config, learningGoal: "다른 목표", stopAfterStage: "cards" });
  await assert.rejects(service.reuseStagePrefix({ ...reuse, runId: differentGoal.runId }), /학습 목적/);
  const tooEarly = await service.startRun({ ...config, stopAfterStage: "concept-tree" });
  await assert.rejects(service.reuseStagePrefix({ ...reuse, runId: tooEarly.runId }), /종료 단계/);
  const reused = await service.reuseStagePrefix(reuse);
  assert.equal(reused.nextStage, "activity-design");
  assert.equal(await readFile(sourceFile, "utf8"), sourceRaw);
  const targetRun = JSON.parse(await readFile(path.join(root, "runs", target.runId, "run.json"), "utf8")) as {
    artifacts: Record<string, unknown>;
    stageReuse: Record<string, { sourceArtifactSha256: string }>;
    selectedOutlineLeafIds: string[];
  };
  assert.deepEqual(Object.keys(targetRun.artifacts), ["analyze", "concept-tree", "learning-design"]);
  assert.deepEqual(targetRun.selectedOutlineLeafIds, sourceRun.selectedOutlineLeafIds);
  for (const stage of Object.keys(targetRun.artifacts)) {
    assert.deepEqual(targetRun.artifacts[stage], sourceRun.artifacts[stage]);
    assert.equal(targetRun.stageReuse[stage].sourceArtifactSha256, digest(JSON.stringify(sourceRun.artifacts[stage])));
  }
  await assert.rejects(service.reuseStagePrefix(reuse), /Analyze 전에만/);
  const sameStop = await service.startRun({ ...config, stopAfterStage: "learning-design" });
  const completedReuse = await service.reuseStagePrefix({ ...reuse, runId: sameStop.runId });
  assert.equal(completedReuse.stoppedAfterStage, "learning-design");
  assert.equal(completedReuse.nextStage, null);
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
