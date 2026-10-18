import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ConceptTreeMcpService } from "../tools/concept-tree-mcp/service.ts";
import { createConceptTreeMcpServer } from "../tools/concept-tree-mcp/server.ts";
import type { ConceptTree } from "../tools/concept-tree-mcp/types.ts";

const outputRoot = path.join(process.cwd(), "eval", "runs", "concept-tree-experiment");
const service = new ConceptTreeMcpService(outputRoot);
const server = createConceptTreeMcpServer(service);
const client = new Client({ name: "concept-tree-experiment", version: "0.1.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

try {
  const pdfTree = await createPdfTree();
  const topicTree = await createTopicTree();

  console.log(JSON.stringify({
    outputRoot,
    pdf: summarize(pdfTree),
    topic: summarize(topicTree),
  }, null, 2));
} finally {
  await client.close();
  await server.close();
}

async function createPdfTree() {
  const started = await client.callTool({
    name: "start_pdf_concept_tree",
    arguments: {
      title: "운영체제 데드락 개념트리",
      files: [{ fileName: "technical-deadlocks.pdf", pageCount: 14 }],
      instruction: "강의자료에 실제로 등장하는 개념어와 그 관계만 남긴다.",
    },
  });
  const runId = readRunId(started.structuredContent);

  const submitted = await client.callTool({
    name: "submit_concept_tree_outline",
    arguments: {
      runId,
      outlineText: [
        "데드락",
        "- [정의] 차단된 프로세스 집합 — 서로가 유발할 사건을 무한히 기다리는 상태 (p.3)",
        "- [시스템 모델] 프로세스 (p.4)",
        "- [시스템 모델] 자원 유형 (p.4)",
        "  - [구성] 자원 인스턴스 (p.4)",
        "- [자원 사용 단계] 요청 (p.4)",
        "- [자원 사용 단계] 사용 (p.4)",
        "- [자원 사용 단계] 반납 (p.4)",
        "- [필요조건] 상호 배제 (p.5)",
        "- [필요조건] 점유와 대기 (p.5)",
        "- [필요조건] 비선점 (p.5)",
        "- [필요조건] 순환 대기 (p.5)",
        "- [표현] 자원 할당 그래프 (p.6)",
        "  - [정점] 프로세스 정점 (p.6)",
        "  - [정점] 자원 유형 정점 (p.6)",
        "  - [간선] 요청 간선 (p.6)",
        "  - [간선] 할당 간선 (p.6)",
        "  - [판별 기준] 사이클 (p.7)",
        "- [처리 전략] 예방 (p.8-9)",
        "- [처리 전략] 회피 (p.8,10-12)",
        "  - [상태] 안전 상태 (p.10)",
        "  - [상태] 불안전 상태 (p.10,12)",
        "  - [표현] 클레임 간선 (p.11)",
        "  - [알고리즘] 은행원 알고리즘 (p.11)",
        "- [처리 전략] 탐지와 복구 (p.8,13)",
        "  - [복구] 프로세스 종료 (p.13)",
        "  - [복구] 자원 선점 (p.13)",
      ].join("\n"),
    },
  });
  return readTree(submitted.structuredContent);
}

async function createTopicTree() {
  const started = await client.callTool({
    name: "start_topic_concept_tree",
    arguments: {
      topic: "고등학교 수준의 미분",
      title: "미분 개념트리",
      instruction: "계산 예제는 넣지 않고 미분을 이해하는 데 필요한 개념어만 구성한다.",
    },
  });
  const runId = readRunId(started.structuredContent);

  const submitted = await client.callTool({
    name: "submit_concept_tree_outline",
    arguments: {
      runId,
      outlineText: [
        "미분",
        "- [선행 개념] 함수",
        "- [선행 개념] 극한",
        "- [핵심 개념] 평균변화율",
        "- [핵심 개념] 순간변화율",
        "- [표현] 미분계수",
        "- [표현] 도함수",
        "  - [계산 규칙] 상수의 미분",
        "  - [계산 규칙] 합의 미분법",
        "  - [계산 규칙] 곱의 미분법",
        "  - [계산 규칙] 몫의 미분법",
        "  - [계산 규칙] 연쇄법칙",
        "- [기하적 의미] 접선의 기울기",
        "- [활용] 함수의 증가와 감소",
        "- [활용] 극값",
        "- [활용] 최적화",
      ].join("\n"),
    },
  });
  return readTree(submitted.structuredContent);
}

function readRunId(value: unknown) {
  const runId = (value as { runId?: unknown } | undefined)?.runId;
  if (typeof runId !== "string") throw new Error("MCP 응답에 runId가 없습니다.");
  return runId;
}

function readTree(value: unknown) {
  const tree = (value as { tree?: unknown } | undefined)?.tree;
  if (!tree || typeof tree !== "object") throw new Error("MCP 응답에 개념트리가 없습니다.");
  return tree as ConceptTree;
}

function summarize(tree: ConceptTree) {
  return {
    runId: tree.runId,
    treeId: tree.id,
    title: tree.title,
    sourceMode: tree.sourceMode,
    nodeCount: tree.nodes.length,
    maximumDepth: Math.max(...tree.nodes.map((node) => node.depth)),
    warningCount: tree.warnings.length,
    outline: tree.outlineText,
  };
}
