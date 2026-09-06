import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPdfPage,
  findExactPdfSourceIndex,
  matchesPdfSource,
} from "../src/app/pdf-source-navigation.ts";

test("explicit source id selects only its exact PDF", () => {
  const sources = [
    { id: "source-a", fileName: "chapter.pdf" },
    { id: "source-b", fileName: "appendix.pdf" },
  ];

  assert.equal(findExactPdfSourceIndex(sources, "source-b"), 1);
  assert.equal(findExactPdfSourceIndex(sources, "missing-source"), -1);
});

test("normalized exact filename is accepted without choosing a fallback", () => {
  const sources = [
    { id: "source-a", fileName: "기초.PDF" },
    { id: "source-b", fileName: "심화.pdf" },
  ];

  assert.equal(matchesPdfSource(sources[0], "folder\\기초.pdf"), true);
  assert.equal(findExactPdfSourceIndex(sources, "기초 요약.pdf"), -1);
});

test("page navigation clamps invalid and out-of-range values", () => {
  assert.equal(clampPdfPage(Number.NaN, 10), 1);
  assert.equal(clampPdfPage(-4, 10), 1);
  assert.equal(clampPdfPage(4.9, 10), 4);
  assert.equal(clampPdfPage(99, 10), 10);
});
