import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { applyRevision, gradeResponse, validateDocument, type SourceContent } from "./contract.ts";
import { mockDraft, mockPatch } from "./fixtures/mock-adapters.ts";
import { createProblemAuthoringMcpServer } from "./mcp-server.ts";
import { renderDocument } from "./renderer.ts";

async function fixture() {
  return JSON.parse(await readFile("tools/problem-authoring-lab/fixtures/science-source-packet.json", "utf8")) as { items: SourceContent[] };
}

test("실험 스킬은 유효한 이름·설명과 두 시작 유형 참조를 가진다", async () => {
  const skill = await readFile("tools/problem-authoring-lab/skill/problem-authoring/SKILL.md", "utf8");
  assert.match(skill, /^---\r?\nname: problem-authoring\r?\ndescription: .+\r?\n---/);
  assert.match(skill, /references\/multiple-choice\.md/);
  assert.match(skill, /references\/fill-blank\.md/);
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

test("기본 렌더는 외부 폰트 없이 현대적인 한글 시스템 UI 토큰을 사용한다", async () => {
  const document = mockDraft((await fixture()).items);
  const html = renderDocument(document, { revealAnswers: false });
  assert.match(html, /system-ui,-apple-system,"Segoe UI","Malgun Gothic"/);
  assert.match(html, /--accent:#4f46e5/);
  assert.match(html, /border-radius:16px/);
  assert.match(html, /white-space:pre-line/);
  assert.doesNotMatch(html, /fonts\.googleapis|@font-face/);
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
  const patched = await client.callTool({ name: "apply_problem_patch", arguments: { document, patch: mockPatch } });
  assert.equal((patched.structuredContent as { document: typeof document }).document.questions[1].blocks[0].id, "q2-title");
});

test("원문 페이지와 연결되지 않은 그림은 거부한다", async () => {
  const document = mockDraft((await fixture()).items);
  document.questions[0].blocks.push({ id: "bad-image", kind: "image", frame: { x: 50, y: 10, width: 100, height: 50 }, alt: "임의 도표", sourceAssetRef: { sourceId: "other", page: 99, assetId: "made-up" } });
  assert.ok(validateDocument(document).some((issue) => issue.code === "image-source"));
});
