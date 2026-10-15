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

test("제목 속 핵심 용어: 'X의 … 개요'에서 가운데 용어를 꺼낸다(개요는 문장이 아님)", () => {
  const lexicon = buildLexicon({ outline: [{ title: "개인의 도덕 발달 단계", objectives: [{ id: "o1", part: "Kohlberg의 인지적 도덕 발달 이론 개요" }] }] });
  assert.deepEqual(pick("Kohlberg의 인지적 도덕 발달 이론 개요", "도덕", lexicon), ["인지적 도덕 발달 이론", "term"]);
  assert.deepEqual(pick("이것이 인지적 도덕 발달 이론을 만든 배경", "발달", lexicon), ["인지적 도덕 발달 이론을", "term"]);
});

test("전치사·한정사에서 끊는다(along, all)", () => {
  assert.deepEqual(pick("Relocating all the coordinate positions by the same displacement along parallel paths", "displacement"), ["same displacement", "phrase"]);
  assert.deepEqual(pick("Relocating all the coordinate positions by the same displacement along parallel paths", "paths"), ["parallel paths", "phrase"]);
});

test("중요 용어: 핵심 용어·개념 목표만, 한 낱말도, 쪽에서 찾을 때 조사 붙은 꼴도", async () => {
  const { importantTerms, findTerms } = await import("./chunk.ts");
  const terms = importantTerms({
    outline: [{ title: "t", objectives: [
      { id: "o1", recall: "앵커링 효과", kind: "용어", importance: "core" },
      { id: "o2", recall: "윤리경영", kind: "개념", importance: "core" },
      { id: "o3", recall: "집단 사고", kind: "용어", importance: "support" },
      { id: "o4", recall: "3가지 수준(Level)과 각 수준별 2개 단계 씩 총 6개 단계(Stage)", kind: "사실", importance: "core" },
      { id: "o5", recall: "Intensity", kind: "용어", importance: "core" },
    ] }],
    items: [{ objectiveId: "o1", format: "card", answer: "앵커링 효과(Anchoring Effect)" }],
  });
  const words = "협상에서 앵커링 효과를 보이고 윤리경영 대신 집단 사고 그리고 Anchoring Effect, Intensity".split(" ");
  assert.deepEqual(findTerms(words, terms).map(({ start, end }) => words.slice(start, end + 1).join(" ")), ["앵커링 효과를", "윤리경영", "Anchoring Effect,", "Intensity"]);
});

test("용어 이름 꺼내기: 단서·떠올릴 것에서", async () => {
  const { termCandidates } = await import("./chunk.ts");
  assert.ok(termCandidates("준법 경영 (Compliance): 법적 테두리를 지키는 최소한의 도덕").includes("준법 경영 (Compliance)"));
  assert.ok(termCandidates("기업윤리의 정의").includes("기업윤리"));
  assert.ok(termCandidates("Shadow-mask methods가 이용하는 색 인지 방식").includes("Shadow-mask methods"));
  assert.ok(termCandidates("Color Cathode-Ray Tubes의 색 표현").includes("Color Cathode-Ray Tubes"));
});
