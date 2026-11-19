// 실습 정리: 기록 글 만들기 · 개념만(코드 블록은 걷어냄) · 빈 개념은 뺌
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

test("개념 글에서 코드 블록은 걷어내고, 빈 개념 · 없는 순간 번호는 뺀다", () => {
  const out = cleanNotes({ made: "단어 세는 프로그램", lessons: [
    { title: "파일 열기와 닫기", concept: "파일은 열어야 읽을 수 있다.", principle: "with로 열면 다 쓴 뒤 저절로 닫힌다.\n```python\nwith open('a.txt') as f:\n```",
      inPractice: "글자 수를 세려고 파일을 한 줄씩 읽었다.", remember: "다 읽으면 저절로 닫힌다", moments: [2, 9] },
    { title: "", concept: "", principle: "", inPractice: "", remember: "", moments: [] },
  ] }, 3);
  assert.equal(out.lessons.length, 1);
  assert.equal(out.lessons[0].principle, "with로 열면 다 쓴 뒤 저절로 닫힌다.");
  assert.deepEqual(out.lessons[0].moments, [2]);
});

test("교과서식 정리(11/20): 코드 칸은 코드 그대로(울타리만 걷음), 끝 정리는 있는 개념 이름만", () => {
  const out = cleanNotes({ made: "단어 세는 프로그램", intro: "파일을 읽어 단어를 센다.", lessons: [
    { title: "파일 열기", concept: "파일은 열어야 읽을 수 있다.", why: "닫지 않으면 자원이 남는다.", how: "1. 연다\n2. 읽는다", code: "```python\nwith open('a.txt') as f:\n    data = f.read()\n```",
      codeNote: "with 줄이 파일을 연다.", inPractice: "글자 수를 셌다.", remember: "with로 열면 저절로 닫힌다", moments: [1] },
  ], summary: [{ title: "파일 열기", line: "with로 연다" }, { title: "없는 개념", line: "빠져야 함" }] }, 3);
  assert.equal(out.intro, "파일을 읽어 단어를 센다.");
  assert.equal(out.lessons[0].code, "with open('a.txt') as f:\n    data = f.read()");
  assert.equal(out.lessons[0].how, "1. 연다\n2. 읽는다");
  assert.deepEqual(out.summary, [{ title: "파일 열기", line: "with로 연다" }]);
});
