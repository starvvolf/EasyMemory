import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTerms, sameKnowledge } from "./terms.ts";

// Structured page text as preprocessing writes it (03_Three Dimensional Viewing p.8–9 style).
const pages = new Map([
  [8, "# 3D Viewing-Coordinate Parameters\n- Establishing a three-dimensional viewing reference frame\n  - Select a world-coordinate position $P_0=(x_0,y_0,z_0)$ for the viewing origin (view point)\n  - Specify a view-up vector $V$, which defines the $y_{view}$ direction"],
  [9, "# 3D Viewing-Coordinate Parameters\n- The View-Plane Normal Vector\n  - Defined with a view-plane normal vector $N$\n    - An additional scalar parameter $z_{vp}$ for setting the position of the view plane\n  - Or, the direction from a reference (look-at) point $P_{ref}$ to the viewing origin $P_0$\n[색 강조] 빨강: 원근 투영"],
]);

test("terms with their symbols come out of the prepared text", () => {
  const terms = extractTerms(pages);
  const find = (name: string) => terms.find((t) => t.name.toLowerCase() === name);
  assert.equal(find("view-up vector")?.symbol, "V");
  assert.equal(find("view-plane normal vector")?.symbol, "N");
  assert.equal(find("scalar parameter")?.symbol, "z_{vp}");
  assert.equal(find("reference point")?.symbol, "P_{ref}");
  assert.equal(find("viewing origin")?.symbol, "P_0");
  assert.deepEqual(find("viewing origin")?.pages, [8, 9]);
  assert.ok(find("원근 투영"), "강조된 말");
  assert.ok(find("3d viewing-coordinate parameters"), "제목");
});

test("cards about the same thing are told apart from ones that only share words", () => {
  const a = { title: "V와 y_view축", mistakes: ["V가 z_view축 방향을 정한다고 혼동한다"] };
  const b = { title: "3D 뷰 기준틀 설정", mistakes: ["V를 y_view가 아닌 z_view 방향을 정의하는 벡터로 혼동한다"] };
  const c = { title: "뷰 평면의 방향", mistakes: ["뷰 평면이 z_view 축에 평행하다고 생각한다"] };
  assert.equal(sameKnowledge(a, { title: "V와 y_view 축", mistakes: [] }), true);
  assert.equal(sameKnowledge(a, c), false);
  assert.equal(typeof sameKnowledge(a, b), "boolean");
  assert.equal(sameKnowledge({ title: "n-type Extrinsic", mistakes: ["n >> p를 반대로 쓴다"] }, { title: "p-type Extrinsic", mistakes: ["p >> n을 반대로 쓴다"] }), false);
});

test("a Korean name next to its English one keeps only that word, not the particles before it", () => {
  const terms = extractTerms(new Map([[1, "메모리는 크게 휘발성(Volatile)과 비휘발성(Non-volatile)으로 나뉜다"]]));
  assert.ok(terms.some((t) => t.name === "Volatile (휘발성)"), JSON.stringify(terms));
  assert.ok(terms.some((t) => t.name === "Non-volatile (비휘발성)"), JSON.stringify(terms));
});

test("an expression is not a symbol", () => {
  const terms = extractTerms(new Map([[1, "- a viewing-coordinate reference frame $a=(a_x,a_y),\\quad b=$\n- Select a world-coordinate position $P_0=(x_0,y_0,z_0)$ here"]]));
  assert.ok(terms.every((t) => !/[=\\]/.test(t.symbol)), JSON.stringify(terms));
  assert.equal(terms.find((t) => t.name === "world-coordinate position")?.symbol, "P_0");
});
