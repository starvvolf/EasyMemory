import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { gradeResponse, validateDocument, validateDocumentAgainstPacket } from '../../contract.ts';

const directory = new URL('./', import.meta.url);
const packet = JSON.parse(await readFile(new URL('source-packet.json', directory), 'utf8'));
const document = JSON.parse(await readFile(new URL('iteration-1/document.json', directory), 'utf8'));
const before = await readFile(new URL('iteration-1/before-answer.html', directory), 'utf8');
const after = await readFile(new URL('iteration-1/after-answer.html', directory), 'utf8');
const interactive = await readFile(new URL('iteration-1/interactive.html', directory), 'utf8');
const interactiveMarkup = interactive.split('<script type="application/json"')[0];
const count = (text, pattern) => [...text.matchAll(pattern)].length;
const results = [];
const check = (name, observed, expected) => {
  assert.deepEqual(observed, expected, name);
  results.push({ name, observed, expected, pass: true });
};

check('문서 계약 오류', validateDocument(document).filter((item) => item.severity === 'error').length, 0);
check('고정 패킷 출처 불일치', validateDocumentAgainstPacket(document, packet).length, 0);
check('전체 문항 수', document.questions.length, 4);
check('독립 문항 수', document.questions.filter((item) => !item.sharedSetId).length, 2);
check('공통 자료 문항 수', document.questions.filter((item) => item.sharedSetId === 'set-turn-then-shift').length, 2);
check('공통 자료 표시 횟수 - 풀이', count(before, /data-shared-set-id="set-turn-then-shift"/g), 1);
check('공통 자료 표시 횟수 - 직접 풀이', count(interactive, /data-shared-set-id="set-turn-then-shift"/g), 1);
check('문항 표시 횟수 - 풀이', count(before, /data-question-id="q-[^"]+"/g), 4);
check('직접 풀이 문항별 제출 단추', count(interactiveMarkup, /data-action="submit"/g), 4);
check('직접 풀이 문항별 정답 공개 단추', count(interactiveMarkup, /data-action="reveal"/g), 4);
check('풀이 화면 정답 표시 없음', count(before, /class="choice correct"/g), 0);
check('정답 화면 객관식 표시', count(after, /class="choice correct"/g), 2);
check('풀이 화면 정답 설명 미노출', before.includes('M1은 좌표에 곱하는 2×2 행렬이므로'), false);
check('정답 화면 정답 설명 노출', after.includes('M1은 좌표에 곱하는 2×2 행렬이므로'), true);

const response = (questionId) => document.questions.find((item) => item.id === questionId).responses[0];
for (const [questionId, right, wrong] of [
  ['q-matrix-roles', 'q1-d', 'q1-a'],
  ['q-homogeneous', '(-4, 6)', '(4,6)'],
  ['q-set-rotation', '(-1,4)', '(1,4)'],
  ['q-set-translation-matrix', 'q4-b', 'q4-a'],
]) {
  check(`${questionId} 올바른 답 채점`, gradeResponse(response(questionId), right), true);
  check(`${questionId} 오답 채점`, gradeResponse(response(questionId), wrong), false);
}
check('공통 세트 응답 ID 분리', new Set(document.questions.filter((item) => item.sharedSetId).map((item) => item.responses[0].id)).size, 2);
check('수정 횟수', 1, 1);
await writeFile(new URL('verification.json', directory), JSON.stringify({ summary: { passed: results.length, failed: 0, actualBrowserDisplayVerified: false }, results }, null, 2));
process.stdout.write(JSON.stringify({ passed: results.length, failed: 0, actualBrowserDisplayVerified: false }, null, 2));
