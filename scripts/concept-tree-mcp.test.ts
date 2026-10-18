import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parseConceptTreeOutline } from "../tools/concept-tree-mcp/outline-parser.ts";
import { ConceptTreeMcpService } from "../tools/concept-tree-mcp/service.ts";
import { createConceptTreeMcpServer } from "../tools/concept-tree-mcp/server.ts";

test("자연어 목차를 관계·설명·페이지가 있는 트리로 구조화한다", () => {
  const nodes = parseConceptTreeOutline([
    "데드락",
    "- [필요조건] 상호 배제 — 한 자원을 동시에 공유할 수 없음 (lecture8.pdf p.12)",
    "- [처리 방식] 예방 (lecture8.pdf p.14)",
    "  - [방법] 순환 대기 제거 (lecture8.pdf p.15-16)",
  ].join("\n"), [{ fileName: "lecture8.pdf", pageCount: 30 }]);

  assert.equal(nodes.length, 4);
  assert.equal(nodes[1].parentId, nodes[0].id);
  assert.equal(nodes[1].relation, "필요조건");
  assert.equal(nodes[1].description, "한 자원을 동시에 공유할 수 없음");
  assert.deepEqual(nodes[3].sourceRefs[0].pageNumbers, [15, 16]);
  assert.equal(nodes[3].parentId, nodes[2].id);
});

test("채팅 주제 기반 트리를 저장하고 같은 결과를 다시 읽는다", async (t) => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "concept-tree-topic-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const service = new ConceptTreeMcpService(dataRoot);
  const started = await service.startTopicRun({ topic: "미분", instruction: "고등학교 수준" });
  const tree = await service.submitOutline({
    runId: started.runId,
    outlineText: [
      "미분",
      "- [기초 개념] 함수",
      "- [기초 개념] 극한",
      "- [핵심 개념] 도함수",
      "  - [계산 규칙] 연쇄법칙",
    ].join("\n"),
  });
  assert.equal(tree.sourceMode, "topic");
  assert.equal(tree.nodes.length, 5);
  assert.equal((await service.getTree(started.runId)).id, tree.id);
});

test("PDF와 주제 두 MCP 흐름이 같은 자연어 제출 도구를 사용한다", async (t) => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "concept-tree-mcp-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const service = new ConceptTreeMcpService(dataRoot);
  const server = createConceptTreeMcpServer(service);
  const client = new Client({ name: "concept-tree-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    "get_concept_tree",
    "start_pdf_concept_tree",
    "start_topic_concept_tree",
    "submit_concept_tree_outline",
  ]);

  const started = await client.callTool({
    name: "start_pdf_concept_tree",
    arguments: {
      title: "데드락 개념트리",
      files: [{ fileName: "lecture8.pdf", pageCount: 30 }],
    },
  });
  const runId = (started.structuredContent as { runId: string }).runId;
  const submitted = await client.callTool({
    name: "submit_concept_tree_outline",
    arguments: {
      runId,
      outlineText: "데드락\n- [필요조건] 상호 배제 (p.12)\n- [필요조건] 순환 대기 (p.13)",
    },
  });
  const tree = (submitted.structuredContent as { tree: { nodes: unknown[]; warnings: string[] } }).tree;
  assert.equal(tree.nodes.length, 3);
  assert.deepEqual(tree.warnings, []);
});

test("잘못된 들여쓰기와 같은 부모의 중복 개념을 거부한다", () => {
  assert.throws(
    () => parseConceptTreeOutline("데드락\n   - 상호 배제"),
    /두 칸 단위/,
  );
  assert.throws(
    () => parseConceptTreeOutline("데드락\n- 상호 배제\n- 상호 배제"),
    /중복된 개념/,
  );
});
