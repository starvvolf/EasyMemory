import assert from "node:assert/strict";
import test from "node:test";
import { buildLexicon, chunkAt } from "./chunk.ts";

const words = (line: string) => line.split(" ");
const pick = (line: string, word: string, lexicon?: ReturnType<typeof buildLexicon>) => {
  const list = words(line); const c = chunkAt(list, list.indexOf(word), lexicon);
  return [list.slice(c.start, c.end + 1).join(" "), c.kind];
};

test("규칙: 영어는 기능어·쉼표·동사형에서 끊고 이웃 내용어를 묶는다", () => {
  const line = "Image produced as an array (the raster) of picture elements (pixels) in the frame buffer";
  assert.deepEqual(pick(line, "buffer"), ["frame buffer", "phrase"]);
  assert.deepEqual(pick(line, "elements"), ["picture elements", "phrase"]);
  assert.deepEqual(pick(line, "array"), ["array", "word"]);
  assert.deepEqual(pick("Input devices, CPU, GPU, Memory, Frame buffer, and Output devices", "devices,"), ["Input devices,", "phrase"]);
  assert.deepEqual(pick(line, "Image"), ["Image", "word"]);
});

test("규칙: 한글은 조사 붙은 말에서 끝난다", () => {
  const line = "도덕적 가치를 경제적 이익, 승진, 상사의 인정 등 다른 가치보다 우선 순위에 두는 단계";
  assert.deepEqual(pick(line, "가치를"), ["도덕적 가치를", "phrase"]);
  assert.deepEqual(pick(line, "경제적"), ["경제적 이익,", "phrase"]);
});

test("자료 용어가 규칙보다 먼저, 괄호 병기와 조사도 맞춘다", () => {
  const lexicon = buildLexicon({
    outline: [{ title: "개인 특성", objectives: [{ id: "o1", recall: "통제 위치(Locus of Control)", kind: "용어" }, { id: "o2", recall: "Raster-scan displays", part: "Raster-Scan Systems" }] }],
  }, ["picture elements (pixels)"]);
  assert.deepEqual(pick("결과의 원인을 보는 통제 위치를 측정한다", "위치를", lexicon), ["통제 위치를", "term"]);
  assert.deepEqual(pick("measured by Locus of Control scale", "of", lexicon), ["Locus of Control", "term"]);
  assert.deepEqual(pick("Raster-scan displays use a frame buffer", "displays", lexicon), ["Raster-scan displays", "term"]);
});

test("글머리표·대시는 단위에 넣지 않는다", () => {
  const lexicon = buildLexicon({ outline: [{ title: "Cathode-Ray Tubes (CRT)", objectives: [] }] });
  assert.deepEqual(pick("• Cathode-Ray Tubes (CRT)", "Tubes", lexicon), ["Cathode-Ray Tubes (CRT)", "term"]);
});
