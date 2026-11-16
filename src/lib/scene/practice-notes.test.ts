// 실습 정리: 기록 글 만들기 · 코드 조각은 기록에 있는 것만 · 빈 단계는 뺌
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

test("단계의 코드 조각은 기록에 있는 것만(+ 표시는 떼고), 빈 단계는 뺀다", () => {
  const { text } = notesUser("단어 세기", chapters);
  const out = cleanNotes({ made: "단어 세는 프로그램", steps: [
    { title: "파일 열기", why: "글을 읽으려고", how: "with open으로 열고 한 줄씩 읽었다.", remember: "다 읽으면 저절로 닫힌다", moments: [2],
      code: [{ file: "main.py", code: "+ with open('a.txt') as f:\n+     for line in f:" }, { file: "x.py", code: "print('지어냄')" }] },
    { title: "", why: "", how: "", remember: "", moments: [], code: [] },
  ] }, text);
  assert.equal(out.steps.length, 1);
  assert.deepEqual(out.steps[0].code, [{ file: "main.py", code: "with open('a.txt') as f:\n    for line in f:" }]);
});
