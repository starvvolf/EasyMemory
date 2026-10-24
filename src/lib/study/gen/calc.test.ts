import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSteps, evaluate, sameValue, stepScope } from "./calc.ts";

test("numbers, vectors and the functions a solution uses", () => {
  assert.ok(Math.abs((evaluate("(0.02/2 + -0.03) / -1") as number) - 0.02) < 1e-12);
  assert.deepEqual(evaluate("cross((2,0,0)-(0,0,0), (0,0,-2)-(0,0,0))"), [0, 4, 0]);
  assert.equal(evaluate("dot((1,2,3),(4,5,6))"), 32);
  assert.equal(evaluate("2 × 3 − 1"), 5);
  assert.equal(evaluate("2^3"), 8);
  assert.throws(() => evaluate("process.exit()"), /모르는 이름|읽을 수 없는/);
});

test("a written value is compared at the precision it is written with", () => {
  assert.equal(sameValue(0.3000001, "0.30"), true);
  assert.equal(sameValue(0.31, "0.30"), false);
  assert.equal(sameValue([0, 4, 0], "(0, 4, 0)"), true);
});

// 은면 제거 2번 문제의 풀이: 변을 따라 4줄, 오른쪽으로 6칸.
const z = [
  { what: "꼭짓점 깊이", expr: "0.02*10 - 0.03*20 + 0.5", value: "0.1", name: "z0" },
  { what: "변 따라 한 줄 내려갈 때 변화", expr: "(0.02/2 + -0.03) / -1", value: "0.02", name: "dEdge" },
  { what: "4줄 내려간 깊이", expr: "z0 + 4*dEdge", value: "0.18", name: "z4" },
  { what: "가로 한 칸 변화", expr: "-0.02 / -1", value: "0.02", name: "dx" },
  { what: "6칸 간 깊이", expr: "z4 + 6*dx", value: "0.30", name: "z" },
  { what: "depthBuff와 비교", expr: "", value: "0.30 > 0.25 → 안 그려짐" },
];

test("every step of a correct solution checks out, and a broken step is caught by number", () => {
  assert.ok(checkSteps(z).every((s) => s.ok));
  const broken = z.map((s, i) => i === 3 ? { ...s, expr: "0.02 / -1", value: "0.02" } : s);
  const result = checkSteps(broken);
  assert.equal(result[3].ok, false);
  assert.match(result[3].problem!, /^4단계/);
});

test("values written as math ($…$, \\left( \\right)) are read as plain values", () => {
  assert.equal(sameValue([0, 0, 2], "$(0,0,2)$"), true);
  assert.equal(sameValue(2, "$2$"), true);
  assert.equal(sameValue([1, 0, 0], "\\left(1, 0, 0\\right)"), true);
  assert.equal(sameValue(0.5, "\\frac{1}{2}"), true);
});

test("fractions and roots as LaTeX writes them", () => {
  assert.equal(sameValue(Math.sqrt(5), "$\\sqrt5$"), true);
  assert.equal(sameValue([2 / Math.sqrt(5), -1 / Math.sqrt(5), 0], "$\\dfrac{(2,-1,0)}{\\sqrt5}$"), true);
});

test("matrices, judgements, and functions a solution defines from its material", () => {
  // The material's matrices are not built in: the solution defines them, then uses them (02_Geometric Transformations p.11).
  const steps = [
    { what: "이동 행렬", name: "T(tx, ty)", expr: "((1,0,tx),(0,1,ty),(0,0,1))", value: "정의" },
    { what: "회전 행렬", name: "R(a)", expr: "((cosd(a),-sind(a),0),(sind(a),cosd(a),0),(0,0,1))", value: "정의" },
    { what: "고정점 회전", name: "M", expr: "T(2,0)*R(90)*T(-2,0)", value: "$\\begin{pmatrix} 0 & -1 & 2 \\\\ 1 & 0 & -2 \\\\ 0 & 0 & 1 \\end{pmatrix}$" },
    { what: "점에 적용", name: "p", expr: "M*join((3,1),1)", value: "(1,1,1)" },
    { what: "세 번째 열", name: null, expr: "col(M,3)", value: "(2,-2,1)" },
  ];
  assert.deepEqual(checkSteps(steps).filter((c) => !c.ok), []);
  const { vars, fns } = stepScope(steps);
  assert.ok(sameValue(evaluate("inv(M)*M", vars, fns), "((1,0,0),(0,1,0),(0,0,1))"));
  assert.match(checkSteps([steps[0], { ...steps[2], expr: "T(2,0)*R(90)" }])[1].problem ?? "", /R/);
  assert.equal(evaluate("det([[2,1],[1,3]])"), 5);
  assert.equal(evaluate("and(ge(x,0), le(x,4))", { x: 5 }), 0);
  assert.equal(evaluate("pick(lt(1,2), 7, 8)"), 7);
  assert.throws(() => evaluate("((1,2),(3,4))*(1,2,3)"), /곱할 수 없어요/);
});
