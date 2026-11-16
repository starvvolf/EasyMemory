import test from "node:test";
import assert from "node:assert/strict";
import { fromOf, settle } from "./intake.ts";

const r = (o: Record<string, unknown>) => ({ route: "find", say: "", kind: "full", lang: "", from: "", lesson: "", assumed: [], candidates: [], ...o }) as Parameters<typeof settle>[0];
const none = new Set<string>();

test("번호 · 주소 알아보기", () => {
  assert.equal(fromOf("7785"), "7785");
  assert.equal(fromOf("https://www.acmicpc.net/problem/2606"), "2606");
  assert.equal(fromOf("https://school.programmers.co.kr/learn/courses/30/lessons/43165"), "https://school.programmers.co.kr/learn/courses/30/lessons/43165");
  assert.equal(fromOf("BFS 쉬운 거"), "");
});

test("캡처: 옮겨 적은 글 + 채운 조건 + 덧붙인 말", () => {
  const out = settle(r({ route: "image", lesson: "문제\n정수 N이 주어진다. N을 출력한다.\n입력 ...", assumed: ["N의 범위가 잘려서 1 ≤ N ≤ 100으로 둠"], kind: "blank", lang: "cpp" }), { text: "빈칸으로 C++", image: "data:image/png;base64,AAAA" }, none);
  assert.equal(out.route, "image"); assert.equal(out.kind, "blank"); assert.equal(out.lang, "cpp");
  assert.match(out.lesson!, /안 보여 채운 조건[\s\S]*1 ≤ N ≤ 100/); assert.match(out.lesson!, /덧붙인 말\] 빈칸으로 C\+\+/);
  assert.throws(() => settle(r({ route: "image", lesson: "" }), { text: "", image: "data:image/png;base64,AAAA" }, none), /읽지 못했어요/);
});

test("붙여 넣은 글은 원문 그대로 넘긴다(AI가 옮겨 쓴 글이 아니라)", () => {
  const text = "문제\n두 수 A와 B를 입력받아 A+B를 출력하라.\n입력: 첫째 줄에 A, B";
  const out = settle(r({ route: "paste", lesson: "AI가 바꿔 쓴 글" }), { text }, none);
  assert.equal(out.route, "paste"); assert.equal(out.lesson, text);
});

test("이름 · 번호는 그 문제로, 못 찾으면 후보로", () => {
  assert.deepEqual(settle(r({ route: "named", from: "7576" }), { text: "백준 토마토" }, none).from, "7576");
  assert.equal(settle(r({ route: "find" }), { text: "1260" }, none).from, "1260");
  const miss = settle(r({ route: "named", from: "", candidates: [{ title: "A", number: "1000", url: "", site: "", why: "", level: "", pattern: "" }] }), { text: "그 유명한 문제" }, none);
  assert.equal(miss.route, "find"); assert.equal(miss.candidates?.[0].number, "1000");
});

test("찾기: 이미 있는 번호는 코드가 거른다", () => {
  const out = settle(r({ route: "find", candidates: [{ title: "A", number: "1000", url: "", site: "", why: "", level: "", pattern: "" }, { title: "B", number: "2178", url: "", site: "", why: "", level: "", pattern: "" }] }), { text: "BFS 쉬운 거" }, new Set(["1000"]));
  assert.deepEqual(out.candidates?.map((x) => x.title), ["B"]);
});
