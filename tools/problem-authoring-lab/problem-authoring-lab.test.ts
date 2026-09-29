import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script } from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { applyRevision, gradeResponse, validateDocument, validateDocumentAgainstPacket, validateFormatOverride, type AuthoringDocument, type SourceContent } from "./contract.ts";
import { mockDraft, mockPatch } from "./fixtures/mock-adapters.ts";
import { createProblemAuthoringMcpServer } from "./mcp-server.ts";
import { adaptLearningDesignArtifact, type EngineLearningDesignArtifact } from "./learning-design-bridge.ts";
import { renderDocument, renderInteractiveDocument } from "./renderer.ts";
import { normalizeExactAnswer } from "./grading.ts";

async function fixture() {
  return JSON.parse(await readFile("tools/problem-authoring-lab/fixtures/science-source-packet.json", "utf8")) as { items: SourceContent[] };
}

test("실험 스킬은 유효한 이름·설명과 선택 가능한 네 방법 참조를 가진다", async () => {
  const skill = await readFile("tools/problem-authoring-lab/skill/problem-authoring/SKILL.md", "utf8");
  assert.match(skill, /^---\r?\nname: problem-authoring\r?\ndescription: .+\r?\n---/);
  assert.match(skill, /references\/multiple-choice\.md/);
  assert.match(skill, /references\/fill-blank\.md/);
  assert.match(skill, /references\/relationship-structure\.md/);
  assert.match(skill, /references\/graph-geometry\.md/);
  assert.doesNotMatch(skill, /\[TODO:/);
});

test("4개 문항은 안정 ID와 명시적인 답안 계약을 가진다", async () => {
  const document = mockDraft((await fixture()).items);
  assert.equal(document.questions.length, 4);
  assert.deepEqual(validateDocument(document), []);
  assert.equal(gradeResponse(document.questions[0].responses[0], "1000만K"), true);
  assert.equal(gradeResponse(document.questions[2].responses[0], "o3"), true);
});

test("정답 전 화면은 답을 숨기고 정답 후 화면은 계약의 답을 표시한다", async () => {
  const document = mockDraft((await fixture()).items);
  const before = renderDocument(document, { revealAnswers: false });
  const after = renderDocument(document, { revealAnswers: true });
  assert.match(before, /정답을 확인한 뒤 표시됩니다/);
  assert.doesNotMatch(before, /choice correct/);
  assert.match(after, /choice correct/);
  assert.match(after, /1000만 K/);
});

test("긴 자기확인 답은 여러 줄로 입력하고 수식 정답은 공개할 때 조판한다", async () => {
  const document = mockDraft((await fixture()).items);
  const response = document.questions[0]!.responses.find((item) => item.kind === "short-text");
  assert.ok(response && response.kind === "short-text");
  response.grading = "self-check";
  response.acceptedAnswers = ["\\frac{1}{2}"];
  const interactive = renderInteractiveDocument(document);
  const revealed = renderDocument(document, { revealAnswers: true });
  assert.match(interactive, /class="block blank long-answer"[^>]*>[\s\S]*?<textarea[^>]*data-response-id="r-lu2-temp"/);
  assert.match(interactive, /input\[data-response-id\],textarea\[data-response-id\]/);
  assert.match(interactive, /answer\.innerHTML = response\.displayAnswerHtml/);
  assert.match(interactive, /class="block reveal hidden-answer"[^>]*>정답을 확인한 뒤 표시됩니다\.<\/div>/);
  assert.match(revealed, /class="block reveal"[\s\S]*?class="katex"/);
});

test("원문 근거와 학습 내용은 공개 전 HTML에 없고 공개 시에만 삽입할 수 있다", async () => {
  const document = mockDraft((await fixture()).items);
  const source = document.questions[0]!.source;
  source.sourcePages = [34, 35];
  source.sourceRange = "공개 전 감춰야 할 근거 문장";
  source.knowledgeContent = "공개 전 감춰야 할 학습 내용";
  const before = renderDocument(document, { revealAnswers: false });
  const interactive = renderInteractiveDocument(document);
  const after = renderDocument(document, { revealAnswers: true });
  for (const html of [before, interactive]) {
    assert.match(html, /class="source-line">원문 34, 35쪽<\/div>/);
    assert.ok(!html.includes(source.sourceRange));
    assert.ok(!html.includes(source.knowledgeContent));
  }
  assert.match(after, /근거: 공개 전 감춰야 할 근거 문장/);
  assert.match(after, /학습 내용: 공개 전 감춰야 할 학습 내용/);
  const encoded = interactive.match(/id="source-contract">([^<]+)<\/script>/)?.[1];
  assert.ok(encoded);
  const payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Array<{ id: string; sourceRange: string; knowledgeContent: string }>;
  assert.equal(payload.find((item) => item.id === document.questions[0]!.id)?.sourceRange, source.sourceRange);
  assert.match(interactive, /sourceLine\.append\(detail\)/);
});

test("기본 렌더는 로컬 Pretendard 가변 웹폰트와 시스템 fallback을 사용한다", async () => {
  const document = mockDraft((await fixture()).items);
  const html = renderDocument(document, { revealAnswers: false });
  assert.match(html, /@font-face\{font-family:"Pretendard Variable"/);
  assert.match(html, /PretendardVariable\.woff2/);
  assert.match(html, /font-weight:45 920/);
  assert.match(html, /"Pretendard Variable",system-ui,-apple-system,"Segoe UI","Malgun Gothic"/);
  assert.match(html, /--accent:#4f46e5/);
  assert.match(html, /border-radius:16px/);
  assert.match(html, /white-space:pre-line/);
  assert.doesNotMatch(html, /https?:\/\/|fonts\.googleapis/);
  const font = await readFile("tools/problem-authoring-lab/assets/fonts/pretendard-1.3.9/PretendardVariable.woff2");
  assert.equal(font.subarray(0, 4).toString("ascii"), "wOF2");
  assert.ok(font.byteLength > 1_000_000);
  const license = await readFile("tools/problem-authoring-lab/assets/fonts/pretendard-1.3.9/LICENSE.txt", "utf8");
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
});

test("부분수정은 지정 블록만 바꾸고 문항·응답 ID를 보존한다", async () => {
  const document = mockDraft((await fixture()).items);
  const next = applyRevision(document, mockPatch);
  assert.equal(next.questions[1].blocks[0].id, "q2-title");
  assert.equal(next.questions[1].responses[0].id, document.questions[1].responses[0].id);
  assert.deepEqual(next.questions[0], document.questions[0]);
});

test("실제 MCP 도구로 입력→검사→렌더→부분수정 흐름을 수행한다", async (t) => {
  const server = createProblemAuthoringMcpServer();
  const client = new Client({ name: "problem-authoring-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await server.close(); });
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    "apply_problem_patch", "get_authoring_instructions", "load_source_packet", "record_problem_iteration", "render_problem_preview", "validate_problem_document",
  ]);
  const loaded = await client.callTool({ name: "load_source_packet", arguments: {} });
  const items = ((loaded.structuredContent as { packet: { items: SourceContent[] } }).packet.items);
  const document = mockDraft(items);
  const checked = await client.callTool({ name: "validate_problem_document", arguments: { document } });
  assert.equal((checked.structuredContent as { valid: boolean }).valid, true);
  const rendered = await client.callTool({ name: "render_problem_preview", arguments: { document } });
  assert.match((rendered.structuredContent as { beforeAnswerHtml: string }).beforeAnswerHtml, /q-lu5-choice/);
  assert.match((rendered.structuredContent as { interactiveHtml: string }).interactiveHtml, /data-action="submit"/);
  const patched = await client.callTool({ name: "apply_problem_patch", arguments: { document, patch: mockPatch } });
  assert.equal((patched.structuredContent as { document: typeof document }).document.questions[1].blocks[0].id, "q2-title");
  const graphLoaded = await client.callTool({ name: "load_source_packet", arguments: { packetId: "graph-one" } });
  assert.equal((graphLoaded.structuredContent as { packet: { items: SourceContent[] } }).packet.items.length, 1);
  const graphInstructions = await client.callTool({ name: "get_authoring_instructions", arguments: { methods: ["graph-geometry"] } });
  const instructionContent = graphInstructions.structuredContent as { references: Record<string, string>; multipleChoice?: string; skillVersion: string };
  assert.deepEqual(Object.keys(instructionContent.references), ["graph-geometry"]);
  assert.equal(instructionContent.multipleChoice, undefined);
  assert.equal(instructionContent.skillVersion, "problem-authoring-method-v2");
  const bridgeLoaded = await client.callTool({
    name: "load_source_packet",
    arguments: { packetPath: "runs/learning-design-bridge-fixture/source-packet.json" },
  });
  const bridgePacket = (bridgeLoaded.structuredContent as { packet: { schemaVersion: string; items: SourceContent[] } }).packet;
  assert.equal(bridgePacket.schemaVersion, "authoring-source-packet-v2");
  assert.equal(bridgePacket.items.length, 1);
  const geometricLoaded = await client.callTool({ name: "load_source_packet", arguments: { packetPath: "runs/geometric-authoring-prototype/source-packet.json" } });
  assert.equal((geometricLoaded.structuredContent as { packet: { items: SourceContent[] } }).packet.items.length, 6);
});

test("현재 Learning Design 계약을 문제 작성 패킷으로 손실 없이 연결한다", async () => {
  const artifact = JSON.parse(await readFile(
    "tools/problem-authoring-lab/fixtures/learning-design-current-engine.json",
    "utf8",
  )) as EngineLearningDesignArtifact;
  const result = adaptLearningDesignArtifact(artifact);
  const item = result.packet.items[0]!;
  const design = artifact.learningDesignResult.learningDesign!;
  assert.equal(result.packet.schemaVersion, "authoring-source-packet-v2");
  assert.equal(result.packet.items.length, 1);
  assert.equal(item.learningUnitId, "knowledge-unit-1");
  assert.equal(item.objectiveId, "objective-1");
  assert.equal(item.assessmentBlueprint.id, "blueprint-1");
  assert.equal(item.sourceId, "source-deadlock");
  assert.equal(item.sourcePage, 7);
  assert.deepEqual(item.objective, design.objectives[0]);
  assert.deepEqual(item.knowledgeUnit, design.knowledgeUnits[0]);
  assert.deepEqual(item.assessmentBlueprint, design.assessmentBlueprints[0]);
  assert.deepEqual(item.successCriteria, ["네 조건을 빠짐없이 복원한다."]);
  assert.match(result.packet.origin.analyzeSha256, /^[a-f0-9]{64}$/);
  assert.match(result.packet.origin.planSha256, /^[a-f0-9]{64}$/);
  assert.match(result.packet.origin.learningDesignSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.report.counts, { objectives: 1, knowledgeUnits: 1, assessmentBlueprints: 1, authoringItems: 1 });
});

test("Plan과 다른 Learning Design 원문 출처는 브리지에서 거부한다", async () => {
  const artifact = JSON.parse(await readFile(
    "tools/problem-authoring-lab/fixtures/learning-design-current-engine.json",
    "utf8",
  )) as EngineLearningDesignArtifact;
  artifact.learningDesignResult.learningDesign!.knowledgeUnits[0]!.sourcePage = 8;
  assert.throws(() => adaptLearningDesignArtifact(artifact), /Plan 목차 출처와 다릅니다/);
});

test("평가 설계에서 누락된 지식 단위는 작성 패킷으로 조용히 손실시키지 않는다", async () => {
  const artifact = JSON.parse(await readFile(
    "tools/problem-authoring-lab/fixtures/learning-design-current-engine.json",
    "utf8",
  )) as EngineLearningDesignArtifact;
  artifact.learningDesignResult.learningDesign!.assessmentBlueprints = [];
  assert.throws(() => adaptLearningDesignArtifact(artifact), /목표·지식 단위·평가 설계가 모두 필요합니다/);
});

test("원문 페이지와 연결되지 않은 그림은 거부한다", async () => {
  const document = mockDraft((await fixture()).items);
  document.questions[0].blocks.push({ id: "bad-image", kind: "image", frame: { x: 50, y: 10, width: 100, height: 50 }, alt: "임의 도표", sourceAssetRef: { sourceId: "other", page: 99, assetId: "made-up" } });
  assert.ok(validateDocument(document).some((issue) => issue.code === "image-source"));
});

test("생성 SVG는 원문 그림과 분리해 로컬 경로와 재현 해시를 검증한다", async () => {
  const packet = JSON.parse(await readFile("tools/problem-authoring-lab/fixtures/graph-one-source-packet.json", "utf8")) as { items: SourceContent[] };
  const document: AuthoringDocument = {
    schemaVersion: "problem-authoring-v1",
    id: "generated-graph-contract-test",
    title: "그래프 계약 검사",
    questions: [{
      id: "graph-q01",
      source: packet.items[0]!,
      page: { width: 760, height: 600 },
      blocks: [{
        id: "graph-q01-asset",
        kind: "generated-image",
        frame: { x: 40, y: 40, width: 680, height: 360 },
        alt: "이차함수와 직선의 두 교점 그래프",
        generatedAssetRef: {
          assetId: "curve-line-intersections-v1",
          path: "assets/curve-line-intersections.svg",
          mimeType: "image/svg+xml",
          sha256: "a".repeat(64),
          generator: "python-matplotlib",
          generatorVersion: "3.9.4",
          scriptPath: "tools/problem-authoring-lab/graph-assets/generate_curve_line_svg.py",
          specPath: "tools/problem-authoring-lab/fixtures/graph-one-spec.json",
          specSha256: "b".repeat(64),
        },
      }],
      responses: [],
    }],
  };
  assert.deepEqual(validateDocument(document), []);
  assert.match(renderDocument(document, { revealAnswers: false }), /<img src="assets\/curve-line-intersections\.svg"/);
  const unsafe = structuredClone(document);
  const block = unsafe.questions[0]!.blocks[0]!;
  if (block.kind !== "generated-image") throw new Error("test setup failed");
  block.generatedAssetRef.path = "https://example.com/answer.svg";
  assert.ok(validateDocument(unsafe).some((issue) => issue.code === "generated-asset-contract"));
});

test("고정 그래프 자산은 spec과 일치하고 외부 SVG 리소스를 참조하지 않는다", async () => {
  const root = "tools/problem-authoring-lab/runs/graph-one-mcp/iteration-0/assets";
  const svg = await readFile(`${root}/curve-line-intersections.svg`);
  const metadata = JSON.parse(await readFile(`${root}/curve-line-intersections.meta.json`, "utf8")) as {
    sha256: string;
    specSha256: string;
    intersections: Array<{ label: string; x: number; y: number }>;
  };
  const spec = await readFile("tools/problem-authoring-lab/fixtures/graph-one-spec.json");
  const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
  assert.equal(hash(svg), metadata.sha256);
  assert.equal(hash(spec), metadata.specSha256);
  assert.deepEqual(metadata.intersections, [{ label: "A", x: 1, y: 0 }, { label: "B", x: 4, y: 3 }]);
  const hrefs = [...svg.toString("utf8").matchAll(/(?:xlink:)?href="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(hrefs.every((href) => href?.startsWith("#")));
});

test("수식 블록과 행렬 선지는 KaTeX로 조판하고 ID 기준 채점을 유지한다", async () => {
  const document = mockDraft((await fixture()).items);
  const question = document.questions[2]!;
  question.page.height = 500;
  question.blocks.push({ id: "math-example", kind: "math", frame: { x: 50, y: 410, width: 500, height: 70 }, latex: "\\frac{1}{2}+x^2" });
  const response = question.responses.find((item) => item.kind === "single-choice");
  assert.ok(response && response.kind === "single-choice");
  response.options = [
    { id: "matrix-a", latex: "\\begin{bmatrix}1&0&3\\\\0&1&-2\\\\0&0&1\\end{bmatrix}" },
    { id: "matrix-b", latex: "\\begin{bmatrix}1&0&-3\\\\0&1&2\\\\0&0&1\\end{bmatrix}" },
  ];
  response.correctOptionId = "matrix-b";
  const choice = question.blocks.find((block) => block.kind === "choice-set");
  assert.ok(choice && choice.kind === "choice-set");
  choice.optionIds = ["matrix-a", "matrix-b"];
  assert.deepEqual(validateDocument(document), []);
  assert.equal(gradeResponse(response, "matrix-b"), true);
  const before = renderDocument(document, { revealAnswers: false });
  const after = renderDocument(document, { revealAnswers: true });
  const interactive = renderInteractiveDocument(document);
  assert.match(before, /\.katex-mathml\{/);
  assert.match(before, /url\(data:font\/woff2;base64,/);
  assert.doesNotMatch(before, /url\(fonts\//);
  assert.doesNotMatch(before, /<link rel="stylesheet"/);
  assert.match(before, /class="katex"/);
  assert.match(before, /class="choice-content"><span class="katex"/);
  assert.doesNotMatch(before, /\[1 0 -3;/);
  assert.match(after, /choice correct/);
  assert.match(after, /class="block reveal"[\s\S]*class="katex"/);
  assert.match(interactive, /content\.cloneNode\(true\)/);
  const font = await readFile("tools/problem-authoring-lab/assets/katex/fonts/KaTeX_Main-Regular.woff2");
  assert.equal(font.subarray(0, 4).toString("ascii"), "wOF2");
});

test("깨진 수식과 텍스트·수식을 동시에 지정한 선지는 거부한다", async () => {
  const document = mockDraft((await fixture()).items);
  document.questions[2]!.page.height = 500;
  document.questions[2]!.blocks.push({ id: "bad-math", kind: "math", frame: { x: 50, y: 410, width: 500, height: 70 }, latex: "\\begin{bmatrix}1&2" });
  const response = document.questions[2]!.responses.find((item) => item.kind === "single-choice");
  assert.ok(response && response.kind === "single-choice");
  response.options[0] = { ...response.options[0]!, latex: "x^2" };
  response.options[1] = { ...response.options[1]!, text: undefined, latex: "\\frac{" };
  const issues = validateDocument(document);
  assert.ok(issues.some((issue) => issue.code === "math-syntax" && issue.blockId === "bad-math"));
  assert.ok(issues.some((issue) => issue.code === "single-choice-answer"));
  assert.ok(issues.some((issue) => issue.code === "math-syntax" && issue.questionId === document.questions[2]!.id));
  assert.match(renderDocument(document, { revealAnswers: false }), /class="math-error"/);
});

test("일반 텍스트에 남은 세미콜론 행렬은 경고한다", async () => {
  const document = mockDraft((await fixture()).items);
  const question = document.questions[0]!;
  question.blocks.push({ id: "plain-matrix", kind: "box", frame: { x: 40, y: 40, width: 200, height: 50 }, label: "M=[2 0; 0 3]" });
  assert.ok(validateDocument(document).some((issue) => issue.code === "plain-matrix" && issue.severity === "warning" && issue.blockId === "plain-matrix"));
  question.blocks[question.blocks.length - 1] = { id: "plain-matrix", kind: "math", frame: { x: 40, y: 40, width: 200, height: 50 }, latex: "M=\\begin{bmatrix}2&0\\\\0&3\\end{bmatrix}" };
  assert.ok(!validateDocument(document).some((issue) => issue.code === "plain-matrix"));
});

test("공통 자료는 한 번 표시하고 각 문항의 응답은 독립적으로 유지한다", async () => {
  const source = (await fixture()).items[0]!;
  const document: AuthoringDocument = {
    schemaVersion: "problem-authoring-v1", id: "shared-test", title: "세트 검사",
    sharedSets: [{ id: "set-1", source, page: { width: 760, height: 120 }, blocks: [{ id: "shared-text", kind: "text", frame: { x: 40, y: 35, width: 680, height: 65 }, text: "공통 상황" }] }],
    questions: [1, 2].map((number) => ({
      id: `q${number}`, source, sharedSetId: "set-1", page: { width: 760, height: 230 },
      blocks: [
        { id: `prompt-${number}`, kind: "text" as const, frame: { x: 40, y: 35, width: 680, height: 45 }, text: `질문 ${number}` },
        { id: `blank-${number}`, kind: "blank" as const, frame: { x: 40, y: 95, width: 680, height: 45 }, responseId: `r${number}`, promptBefore: "답", promptAfter: "" },
        { id: `reveal-${number}`, kind: "answer-reveal" as const, frame: { x: 40, y: 155, width: 680, height: 50 }, responseIds: [`r${number}`] },
      ],
      responses: [{ id: `r${number}`, kind: "short-text" as const, acceptedAnswers: [`답${number}`], grading: "exact-normalized" as const, explanation: `해설${number}` }],
    })),
  };
  assert.deepEqual(validateDocument(document), []);
  assert.deepEqual(validateDocumentAgainstPacket(document, { items: [source] }), []);
  const html = renderInteractiveDocument(document);
  const browserCode = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(browserCode);
  assert.doesNotThrow(() => new Script(browserCode));
  assert.equal((html.match(/data-shared-set-id="set-1"/g) ?? []).length, 1);
  assert.equal((html.match(/<button type="button" data-action="submit"/g) ?? []).length, 2);
  assert.match(html, /data-question-id="q1"/);
  assert.match(html, /data-question-id="q2"/);
  assert.equal(gradeResponse(document.questions[0]!.responses[0]!, "답1"), true);
  assert.equal(gradeResponse(document.questions[1]!.responses[0]!, "답1"), false);
  assert.deepEqual(validateFormatOverride(document, { q1: "short-text" }), []);
  assert.ok(validateFormatOverride(document, { q1: "single-choice" }).some((issue) => issue.code === "format-override"));
  const broken = structuredClone(document);
  broken.questions[1]!.sharedSetId = "missing";
  assert.ok(validateDocument(broken).some((issue) => issue.code === "missing-shared-set"));
  const changed = structuredClone(document);
  changed.questions[0]!.source.target = "다른 목표";
  assert.ok(validateDocumentAgainstPacket(changed, { items: [source] }).some((issue) => issue.code === "packet-source-mismatch"));
  const revised = applyRevision(document, { instruction: "공통 상황 문장 수정", operations: [{ op: "replace-shared-block", sharedSetId: "set-1", blockId: "shared-text", value: { id: "shared-text", kind: "text", frame: { x: 40, y: 35, width: 680, height: 65 }, text: "수정 상황" } }] });
  assert.equal(revised.sharedSets?.[0]?.blocks[0]?.kind, "text");
  assert.deepEqual(revised.questions, document.questions);
});

test("짧은 답은 안전한 표기만 통일하고 값·순서·단위를 보존한다", () => {
  const response = { id: "r", kind: "short-text" as const, acceptedAnswers: ["(−2, 3)"], grading: "exact-normalized" as const };
  assert.equal(gradeResponse(response, "(-2,3)"), true);
  assert.equal(gradeResponse(response, "(2,3)"), false);
  assert.equal(gradeResponse(response, "(-2,4)"), false);
  assert.equal(gradeResponse(response, "-2,3"), false);
  const prime = { id: "prime", kind: "short-text" as const, acceptedAnswers: ["x′=3"], grading: "exact-normalized" as const };
  assert.equal(gradeResponse(prime, "x'=3"), true);
  assert.equal(gradeResponse(prime, "x`=3"), true);
  assert.equal(gradeResponse(prime, "x´=3"), true);
  const exponent = { id: "exponent", kind: "short-text" as const, acceptedAnswers: ["R^-1"], grading: "exact-normalized" as const };
  assert.equal(gradeResponse(exponent, "R^{-1}"), true);
  assert.equal(gradeResponse(exponent, "R⁻¹"), true);
  assert.equal(gradeResponse(exponent, "R-1"), false);
  assert.equal(gradeResponse({ ...response, acceptedAnswers: ["sinθ,-sinθ"] }, "-sinθ,sinθ"), false);
  assert.equal(gradeResponse({ ...response, acceptedAnswers: ["75°"] }, "75"), false);
  assert.equal(gradeResponse({ ...response, acceptedAnswers: ["a·b"] }, "ab"), false);
  assert.equal(gradeResponse({ ...response, acceptedAnswers: ["a;b"] }, "a,b"), false);
});

test("원문 그림 crop은 좌상단 기준 페이지 비율 0~1만 받는다", async () => {
  const document = mockDraft((await fixture()).items);
  const source = document.questions[0]!.source;
  const image = { id: "crop-image", kind: "image" as const, frame: { x: 50, y: 10, width: 100, height: 50 }, alt: "원문 도표",
    sourceAssetRef: { sourceId: source.sourceId, page: source.sourcePage, assetId: "figure-1", crop: { x: 0.5, y: 0, width: 0.5, height: 1 } } };
  document.questions[0]!.blocks.push(image);
  assert.ok(!validateDocument(document).some((issue) => issue.code === "image-crop"));
  image.sourceAssetRef.crop.width = 0.6;
  assert.ok(validateDocument(document).some((issue) => issue.code === "image-crop"));
});

test("그림을 겹쳐 놓지 않는 문항은 데스크톱에서도 흐름 배치를 쓴다", async () => {
  const document = mockDraft((await fixture()).items);
  const html = renderDocument({ ...document, questions: document.questions.slice(0, 1) }, { revealAnswers: false });
  assert.match(html, /class="question-page flow-page"/);
  assert.match(html, /\.flow-page \.block\{position:static!important/);
});

test("브라우저에 주입한 채점 함수는 서버와 동일하다", async () => {
  const document = mockDraft((await fixture()).items);
  const html = renderInteractiveDocument(document);
  const embedded = html.match(/const normalize = (function normalizeExactAnswer\([\s\S]*?\n\});/)?.[1];
  assert.ok(embedded);
  const browserNormalize = new Script(`(${embedded})`).runInNewContext() as (value: string) => string;
  for (const value of ["x′=3", "x'=3", "R^-1", "R⁻¹", "R^{-1}", "75°", "75", "a·b", "ab", "a;b", "a,b", "sinθ,-sinθ", "-sinθ,sinθ"]) {
    assert.equal(browserNormalize(value), normalizeExactAnswer(value));
  }
  for (const question of document.questions) {
    for (const response of question.responses) {
      if (response.kind !== "short-text" || response.grading !== "exact-normalized") continue;
      for (const answer of response.acceptedAnswers) {
        assert.equal(response.acceptedAnswers.some((expected) => browserNormalize(expected) === browserNormalize(answer)), gradeResponse(response, answer));
      }
    }
  }
  assert.match(html, /revealed \? "정답 공개 후 제출\(독립 풀이 기록 제외\)"/);
});

test("실제 MCP Learning Design 패킷은 제출된 목표 여섯 개와 원문 해시를 보존한다", async () => {
  const packet = JSON.parse(await readFile("tools/problem-authoring-lab/runs/geometric-authoring-prototype/source-packet.json", "utf8")) as { schemaVersion: string; items: SourceContent[]; origin: { sha256: Record<string, string> } };
  assert.equal(packet.schemaVersion, "authoring-source-packet-v3");
  assert.equal(packet.items.length, 6);
  assert.deepEqual(packet.items.map((item) => item.sourcePage), [2, 3, 4, 6, 7, 5]);
  assert.ok(Object.values(packet.origin.sha256).every((value) => /^[a-f0-9]{64}$/.test(value)));
});
