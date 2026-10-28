import { test } from "node:test";
import assert from "node:assert/strict";
import { coverage, linesFrom, normalizeText, routePage, splitSections, structure, titleKey, type PageStats, type TextRun } from "./prep.ts";

// One slide as pdf.js gives it (positions from 03_Three Dimensional Viewing p.5, page 960×540).
const slide: TextRun[] = [
  { str: "Overview of 3D Viewing Concepts", x: 55, y: 488, h: 29, w: 420 },
  { str: "•", x: 55, y: 439, h: 20, w: 7 }, { str: "Identifying Visible Lines and Surfaces", x: 82, y: 439, h: 20, w: 380, font: "f2" },
  { str: "–", x: 91, y: 387, h: 18, w: 9 }, { str: "Surface㎿rendering procedures are applied so that screen pixels contain only the color patterns for", x: 114, y: 387, h: 18, w: 760, font: "f4" },
  { str: "the front surfaces", x: 114, y: 365, h: 18, w: 140, font: "f4" },
  { str: "–", x: 91, y: 284, h: 18, w: 9 }, { str: "The direction for the", x: 114, y: 284, h: 18, w: 160, font: "f4" }, { str: "z", x: 274, y: 284, h: 18, w: 8, font: "math" }, { str: "axis", x: 282, y: 284, h: 18, w: 30, font: "f4" },
  { str: "5", x: 898, y: 21, h: 12, w: 6 },
];

test("lines keep bullets and their levels, join a line that only continues the one above, drop the page number", () => {
  const { title, text } = structure(linesFrom(slide), 540);
  assert.equal(title, "Overview of 3D Viewing Concepts");
  assert.deepEqual(text.split("\n"), [
    "- Identifying Visible Lines and Surfaces",
    "  - Surface-rendering procedures are applied so that screen pixels contain only the color patterns for the front surfaces",
    "  - The direction for the z axis",
  ]);
});

test("a word broken across lines joins without a space", () => {
  const runs: TextRun[] = [{ str: "•", x: 10, y: 100, h: 20, w: 6 }, { str: "Back", x: 30, y: 100, h: 20, w: 40 }, { str: "-Face Removal", x: 30, y: 80, h: 20, w: 120 }];
  assert.equal(structure(linesFrom(runs), 200).text, "- Back-Face Removal");
});

test("math-alphabet letters become plain letters", () => {
  assert.equal(normalizeText("\u{1D449}\u{1D463}\u{1D456}\u{1D452}\u{1D464} · \u{1D467}\u{1D463}"), "Vview · zv");
});

test("route: clean text stays on the text layer; pictures, formulas, drawings and scans go to the model", () => {
  const base: PageStats = { chars: 400, mathChars: 0, brokenChars: 0, lines: 10, orphanLines: 0, pictureCover: 0, pathOps: 5 };
  assert.equal(routePage(base).route, "layer");
  assert.equal(routePage({ ...base, pictureCover: 0.3 }).route, "figures");
  assert.equal(routePage({ ...base, mathChars: 12 }).route, "page");
  assert.equal(routePage({ ...base, pathOps: 600 }).route, "page");
  assert.equal(routePage({ ...base, chars: 12, pictureCover: 0.9 }).route, "page");
  assert.equal(routePage({ ...base, chars: 0, lines: 0, pathOps: 0 }).route, "empty");
});

test("prep-2 (실험): math letters stay on the text layer; garbled math fonts and short broken lines still go to the model", () => {
  const base: PageStats = { chars: 400, mathChars: 0, brokenChars: 0, lines: 10, orphanLines: 0, pictureCover: 0, pathOps: 5 };
  assert.equal(routePage({ ...base, mathChars: 12 }, "prep-2").route, "layer");
  assert.equal(routePage({ ...base, mathChars: 12, pictureCover: 0.3 }, "prep-2").route, "figures");
  assert.equal(routePage({ ...base, garbledChars: 6 }, "prep-2").route, "page");
  assert.equal(routePage({ ...base, orphanLines: 5 }, "prep-2").route, "page");
  // The default router is unchanged.
  assert.equal(routePage({ ...base, mathChars: 12 }).route, "page");
});

test("pictures hanging off the page and overlapping count once", () => {
  assert.equal(coverage([[0, 0, 480, 540], [240, 0, 960, 540]], 960, 540), 1);
  assert.equal(coverage([[0, 0, 480, 540]], 960, 540), 0.5);
});

test("consecutive slides with the same title are one section", () => {
  assert.equal(titleKey("Depth-Buffer (z-Buffer) Method"), titleKey("Depth-Buffer Method (cont.)"));
  const sections = splitSections([
    { page: 4, title: "Back-Face Detection", route: "layer" }, { page: 5, title: "Back-Face Detection (cont.)", route: "layer" },
    { page: 6, title: "Depth-Buffer Method", route: "layer" }, { page: 7, title: "", route: "figures" }, { page: 8, title: "Depth-Buffer (z-Buffer) Method", route: "layer" },
  ]);
  assert.deepEqual(sections.map((s) => s.pages), [[4, 5], [6, 7, 8]]);
});
