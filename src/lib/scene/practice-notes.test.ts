// 실습 정리: 기록 글 만들기 · 코드 조각은 기록에 있는 것만 · 기본기 층은 맨 앞 · 카드 모양
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanNotes, notesUser } from "./practice-notes.ts";

const chapters = [{ goal: "파일 읽기", events: [
  { at: "2026-11-12T01:00:00Z", kind: "me" as const, text: "파일 어떻게 열어?" },
  { at: "2026-11-12T01:01:00Z", kind: "save" as const, text: "", file: "main.py", diff: ["+ with open('a.txt') as f:", "+     for line in f:"] },
  { at: "2026-11-12T01:02:00Z", kind: "cmd" as const, text: "python main.py", ok: false, err: "FileNotFoundError" },
] }];

test("실습 기록을 순간 번호가 붙은 글로", () => {
  const { text, count } = notesUser("단어 세기", chapters);
  assert.equal(count, 3);
  assert.match(text, /\[목표\] 파일 읽기/);
  assert.match(text, /#2 10:01 저장 main\.py\n\+ with open/);
  assert.match(text, /#3 10:02 실행: python main\.py → 실패 \(FileNotFoundError\)/);
});

test("코드 조각은 기록에 있는 것만, 기본기는 맨 앞, 빈 층은 뺌", () => {
  const { text } = notesUser("단어 세기", chapters);
  const card = (q = "", a = "") => ({ q, a });
  const out = cleanNotes({ made: "단어 세는 프로그램", layers: [
    { name: "파일 읽기", items: [{ name: "with open", learned: "열고 저절로 닫기", code: "with open('a.txt') as f:", state: "애매", moments: [2], card: card("저절로 닫히게 열려면?", "with open(...) as f:") },
      { name: "지어낸 것", learned: "x", code: "print('없는 코드')", state: "확실", moments: [1], card: card() }] },
    { name: "빈 층", items: [] },
    { name: "기본기", items: [{ name: "실행", learned: "python 파일 이름", code: "python main.py", state: "확실", moments: [3], card: card() }] },
  ] }, text);
  assert.deepEqual(out.layers.map((l) => l.name), ["기본기", "파일 읽기"]);
  assert.equal(out.layers[1].items[0].code, "with open('a.txt') as f:");
  assert.equal(out.layers[1].items[1].code, "", "기록에 없는 코드는 지운다");
  assert.equal(out.layers[1].items[0].card.q, "저절로 닫히게 열려면?");
});

test("따라가 보기: 기록에 있는 코드 블록만(+ 표시는 떼고), 블록이나 상황이 없으면 뺀다", () => {
  const { text } = notesUser("단어 세기", chapters);
  const out = cleanNotes({ made: "", layers: [], traces: [
    { title: "파일 읽기", blocks: [{ file: "main.py", code: "+ with open('a.txt') as f:\n+     for line in f:" }], cases: [{ situation: "a.txt가 없으면", result: "FileNotFoundError" }], why: "없는 파일을 열어서", moments: [3] },
    { title: "지어냄", blocks: [{ file: "x.py", code: "print('없음')" }], cases: [{ situation: "s", result: "r" }], why: "", moments: [] },
  ] }, text);
  assert.equal(out.traces?.length, 1);
  assert.equal(out.traces?.[0].blocks[0].code, "with open('a.txt') as f:\n    for line in f:");
});
