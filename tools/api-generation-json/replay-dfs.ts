import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { materializeAppResult, validateStageOutput, type RunInput } from "./pipeline.ts";
import { cardsSchema, prepareSchema, recallSchema } from "./schemas.ts";

const expected = {
  recall: "bceb152a1853fac7a7b1dda1fcc3009f1082d50a721986d00cd703789c28a110",
  prepare: "bfb55a828a314a4746c9e8e29e63e8919eb715ff47584c32211d4295eaa47593",
  cards: "be7d3ba93b5d395cacc6cb9496bc675c94bbace725d67a1116789c55b7b39838",
};

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

const fixture = async (name: keyof typeof expected) => {
  const bytes = await readFile(new URL(`./fixtures/dfs-bfs-${name}-raw.json`, import.meta.url));
  const actual = sha256(bytes);
  if (actual !== expected[name]) throw new Error(`${name} fixture 해시가 평가 원본과 다릅니다.`);
  return { bytes, actual, json: JSON.parse(bytes.toString("utf8")) as unknown };
};

export async function replayDfs() {
  const [recallFile, prepareFile, cardsFile] = await Promise.all([
    fixture("recall"), fixture("prepare"), fixture("cards"),
  ]);
  const recall = recallSchema.parse(recallFile.json);
  const prepare = prepareSchema.parse(prepareFile.json);
  const cards = cardsSchema.parse(cardsFile.json);
  const input: RunInput = {
    pdfPath: "historical/05 DFS BFS.pdf",
    fileName: "05 DFS BFS.pdf",
    pdfSha256: "historical-fixture",
    pageCount: 22,
    title: "DFS BFS",
    learningGoal: "그래프 탐색을 구현하고 적용한다.",
    instruction: "원문 조건을 보존한다.",
    sourceExpressionMode: "adapt",
  };
  validateStageOutput("cards", cards, { recall, prepare }, input);
  const result = materializeAppResult(cards);
  const blankCounts = result.generatedCards.map((card, index) => ({
    card: index + 1,
    blanks: card.clozeText.match(/____/g)?.length ?? 0,
    answers: card.answers.length,
  }));
  return {
    sourceSha256: { recall: recallFile.actual, prepare: prepareFile.actual, cards: cardsFile.actual },
    cardCount: result.generatedCards.length,
    invalidBlankCounts: blankCounts.filter((item) => item.blanks !== item.answers),
    historicallyDamagedCards: [5, 6, 10, 16].map((number) => blankCounts[number - 1]),
    contentPreserved: result.contentPreserved,
    generatedContentSha256: result.generatedContentSha256,
    appContentSha256: result.appContentSha256,
    metadataAdded: result.metadataAdded,
    contentTransformsApplied: result.contentTransformsApplied,
  };
}

replayDfs().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
