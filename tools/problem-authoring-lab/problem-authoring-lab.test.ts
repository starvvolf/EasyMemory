import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { applyRevision, gradeResponse, validateDocument, type AuthoringDocument, type SourceContent } from "./contract.ts";
import { mockDraft, mockPatch } from "./fixtures/mock-adapters.ts";
import { createProblemAuthoringMcpServer } from "./mcp-server.ts";
import { renderDocument } from "./renderer.ts";

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
  const patched = await client.callTool({ name: "apply_problem_patch", arguments: { document, patch: mockPatch } });
  assert.equal((patched.structuredContent as { document: typeof document }).document.questions[1].blocks[0].id, "q2-title");
  const graphLoaded = await client.callTool({ name: "load_source_packet", arguments: { packetId: "graph-one" } });
  assert.equal((graphLoaded.structuredContent as { packet: { items: SourceContent[] } }).packet.items.length, 1);
  const graphInstructions = await client.callTool({ name: "get_authoring_instructions", arguments: { methods: ["graph-geometry"] } });
  const instructionContent = graphInstructions.structuredContent as { references: Record<string, string>; multipleChoice?: string; skillVersion: string };
  assert.deepEqual(Object.keys(instructionContent.references), ["graph-geometry"]);
  assert.equal(instructionContent.multipleChoice, undefined);
  assert.equal(instructionContent.skillVersion, "problem-authoring-method-v2");
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
