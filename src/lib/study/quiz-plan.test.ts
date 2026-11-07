import { test } from "node:test";
import assert from "node:assert/strict";
import { planQuiz, sameAnswer } from "./quiz-plan.ts";
import type { MaterialMap } from "./material-map.ts";
import type { Structure } from "./structure.ts";

const card = (id: string, kind: string, core = false) => ({ id, ref: id, kind, title: id, core, shape: { form: "term", name: id, definition: `${id} 뜻` }, pages: [1], quotes: [], mistakes: [], takes: [], gives: [], questions: 0, same: [], state: "new" });
const map = { id: "gen_x", title: "t", status: "done", pages: 3, chains: [], topics: [], counts: {}, sections: [
  { id: "t1", title: "a", pages: [1], cards: [card("t1.1c1", "절차", true), card("t1.1c2", "공식", true), card("t1.1c3", "공식", true)] },
  { id: "t2", title: "b", pages: [2], cards: [card("t2.1c1", "용어", true), card("t2.1c2", "용어", true)] },
  { id: "t3", title: "c", pages: [3], cards: [card("t3.1c1", "사실")] }] } as unknown as MaterialMap;
const structure = { groups: [
  { id: "g1", name: "브레젠험", parent: "", head: "t1.1c1", cards: ["t1.1c2", "t1.1c3"], members: "순서", explain: "" },
  { id: "g2", name: "용어", parent: "", cards: ["t2.1c1", "t2.1c2", "t3.1c1"], members: "묶음", explain: "" }],
  versus: [{ a: "t2.1c1", b: "t2.1c2", on: "x" }], edges: [], pairs: [], fixes: [] } as unknown as Structure;

test("구조 단위 출제 계획: 차례 상자는 한 문제, 대비 쌍, 주제마다 하나, 용어는 플래시카드", () => {
  const p = planQuiz(map, structure);
  const seq = p.items.find((x) => x.unit === "차례")!;
  assert.deepEqual(seq.cards, ["t1.1c1", "t1.1c2", "t1.1c3"]);
  assert.equal(seq.form, "short");
  assert.ok(p.items.some((x) => x.unit === "대비"));
  assert.equal(p.coveredTopics, 3);
  assert.equal(p.flashcards.length, 2);
  assert.equal(p.items.length + p.later.length, 3);
});
test("답 맞추기", () => {
  assert.ok(sameAnswer("choice", "2", "2번"));
  assert.ok(!sameAnswer("choice", "2", "3"));
  assert.ok(sameAnswer("order", "3,1,2", "3, 1, 2"));
  assert.ok(sameAnswer("ox", "X", "x"));
  assert.ok(sameAnswer("short", "(21, 11)", "(21,11)"));
});
test("답 맞추기: 빼기 기호·문장으로 쓴 답", () => {
  assert.ok(sameAnswer("short", "(A,B,C,D)=(3,2,6,-6)", "(3,2,6,−6)"));
  assert.ok(sameAnswer("short", "거부, 요청 간선", "순환이 생기므로 요청을 거부한다. P2 → R2는 요청 간선이다."));
  assert.ok(!sameAnswer("short", "허용, 할당 간선", "요청을 거부한다. 요청 간선이다."));
});

test("설정: 처음 공부는 쉽게, 시험 대비는 어렵게, 핵심만은 낱장 없음", async () => {
  const { planQuiz: plan } = await import("./quiz-plan.ts");
  const easy = plan(map, structure, { goal: "처음" }).items.find((x) => x.unit === "대비")!;
  const hard = plan(map, structure, { goal: "시험" }).items.find((x) => x.unit === "대비")!;
  assert.ok(easy.level < hard.level);
  const core = plan(map, structure, { scope: "핵심" });
  assert.ok([...core.items, ...core.later].every((x) => x.unit !== "낱장"));
  assert.equal(plan(map, structure, { figures: "끔" }).figureQuizzes.length, 0);
});
test("모양 검사: short에 보기, choice 보기 수", async () => {
  const { shapeProblem } = await import("./quiz-plan.ts");
  assert.ok(shapeProblem({ form: "short", level: 4, stem: "값은?", options: ["1"], answer: "1", explain: "", uses: [] }, { form: "short", level: 4 }));
  assert.ok(shapeProblem({ form: "short", level: 4, stem: "고르시오\n1. a\n2. b", options: [], answer: "2", explain: "", uses: [] }, { form: "short", level: 4 }));
  assert.ok(shapeProblem({ form: "choice", level: 3, stem: "?", options: ["a", "b"], answer: "1", explain: "", uses: [] }, { form: "choice", level: 3 }));
  assert.equal(shapeProblem({ form: "choice", level: 3, stem: "?", options: ["a", "b", "c", "d"], answer: "1", explain: "", uses: [] }, { form: "choice", level: 3 }), null);
});
test("그림 알아보기(코드): 같은 그림을 쓰는 카드는 오답에서 뺀다", async () => {
  const { figureIdQuizzes } = await import("./quiz-plan.ts");
  const f = (id: string, file?: string) => ({ ...card(id, "개념"), title: `이름 ${id}`, ...(file ? { figure: { page: 1, role: "근거", says: "", file } } : {}) });
  const all = [f("t1.1c1", "a.jpg"), f("t1.1c2", "a.jpg"), f("t1.1c3"), f("t1.1c4"), f("t1.1c5")] as never[];
  const st = { groups: [{ id: "g1", name: "x", parent: "", cards: ["t1.1c1", "t1.1c2", "t1.1c3", "t1.1c4", "t1.1c5"], explain: "" }], versus: [], edges: [], pairs: [], fixes: [] } as unknown as Structure;
  const [q] = figureIdQuizzes(all, st, [], 5);
  assert.ok(q && !q.options.includes("이름 t1.1c2"));
  assert.equal(q.options[q.answer - 1], "이름 t1.1c1");
});
test("그림 안 글이 답을 말하면 샌 것", async () => {
  const { figureLeaks } = await import("./quiz-plan.ts");
  const q = (answer: string, options: string[], figure_text: string) => ({ form: "choice" as const, level: 3, stem: "?", options, answer, explain: "", uses: [], figure_text });
  assert.ok(figureLeaks(q("2", ["grant", "deny", "wait", "abort"], "If we grant it, a cycle is formed. So, deny!!!")));
  assert.ok(!figureLeaks(q("2", ["P1", "P2 → R2 요청 간선", "R1", "R2"], "If we grant it, a cycle is formed.")));
  assert.ok(!figureLeaks(q("1", ["교착 상태"], "")));
});
test("보기 섞기: 정답을 따라 옮기고 같은 씨앗이면 같게", async () => {
  const { shuffleChoice } = await import("./quiz-plan.ts");
  const make = () => ({ form: "choice" as const, level: 3, stem: "?", options: ["정답", "b", "c", "d"], answer: "1", explain: "1번이 맞다.", uses: [] });
  const a = make(), b = make();
  shuffleChoice(a, "x"); shuffleChoice(b, "x");
  assert.equal(a.options[Number(a.answer) - 1], "정답");
  assert.deepEqual(a.options, b.options);
  assert.ok(!/1번/.test(a.explain));
});
