import { test } from "node:test";
import assert from "node:assert/strict";
import { articleHtml, isHeading } from "./web-material.ts";

test("웹 글 → HTML: 짧은 줄·위키 표기는 소제목, 본문은 문단, 글자는 이스케이프", () => {
  assert.ok(isHeading("개요"));
  assert.ok(!isHeading("주가를 1주당 순이익으로 나눈 값이다."));
  const h = articleHtml({ title: "PER", url: "https://ko.wikipedia.org/wiki/x", text: "PER\n개요\n주가를 순이익으로 나눈다.\n== 역사 ==\n=== 채권 ETF ===\n<script>x</script> 는 글자다." });
  assert.ok(h.includes("<h2>개요</h2>") && h.includes("<h2>역사</h2>") && h.includes("<h3>채권 ETF</h3>"));
  assert.ok(h.includes("&lt;script&gt;") && !h.includes("<script>x"));
  assert.ok(!h.includes("<h1>PER</h1>\n<h2>PER"));
});
