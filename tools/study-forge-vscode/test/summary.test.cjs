/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SummaryScheduler, summaryInput, validateSummary, updateSummary, SECTION_KEYS } = require('../summary');

function session() { return { id: 's1', problem: { title: '합', text: '더하기' }, messages: [{ id: 'm1', role: 'user', text: '설명해줘', status: 'sent' }], codeSnapshots: [{ id: 'c1', filePath: 'a.py', language: 'python', text: 'a+b' }], summaryAutoEnabled: false }; }

test('정리 근거 ID 검증, 미확인 이해 분리, 원문 한도 초과 시 조용한 절단 금지', () => {
  const s = session(); const input = summaryInput(s);
  const output = Object.fromEntries(SECTION_KEYS.map((key) => [key, []]));
  output.unverifiedUnderstanding.push({ text: '독립 풀이 여부 미확인', messageIds: ['m1'], codeIds: [] });
  assert.equal(validateSummary(JSON.stringify(output), input).unverifiedUnderstanding.length, 1);
  output.observedActions.push({ text: '코드 작성', messageIds: [], codeIds: ['unknown'] });
  assert.throws(() => validateSummary(JSON.stringify(output), input), /근거/);
  s.messages[0].text = 'x'.repeat(180001); assert.throws(() => summaryInput(s), /한도/);
});

test('기본 off, 첫 정리 없이 자동 생성 금지, 새 대화 있을 때만 갱신, 재개 소급 금지', async () => {
  const s = session(); let starts = 0, calls = 0;
  const scheduler = new SummaryScheduler({ getSession: () => s, isBusy: () => false,
    refresh: async () => { calls++; s.summary.throughMessageId = s.messages.at(-1).id; },
    setIntervalFn: () => { starts++; return starts; }, clearIntervalFn: () => {},
  });
  scheduler.activate(); assert.equal(starts, 0);
  s.summaryAutoEnabled = true; scheduler.activate();
  s.messages.push({ id: 'm2', status: 'completed' }); await scheduler.tick(); assert.equal(calls, 0);
  s.summary = { throughMessageId: 'm2' }; await scheduler.tick(); assert.equal(calls, 0);
  s.messages.push({ id: 'm3', status: 'completed' }); await scheduler.tick(); assert.equal(calls, 1);
  await scheduler.tick(); assert.equal(calls, 1);
  s.messages.push({ id: 'm4', status: 'completed' }); scheduler.activate(); await scheduler.tick(); assert.equal(calls, 1);
  s.messages.push({ id: 'm5', status: 'completed' }); await scheduler.tick(); assert.equal(calls, 2);
  scheduler.dispose();
});

test('갱신 중첩/응답 진행 중 갱신 금지 및 실패 후 기존 cursor 보존', async () => {
  const s = session(); s.summaryAutoEnabled = true; s.summary = { throughMessageId: 'm1', sections: { concepts: ['old'] } };
  let finish, calls = 0, busy = false;
  const scheduler = new SummaryScheduler({ getSession: () => s, isBusy: () => busy,
    refresh: () => { calls++; return new Promise((resolve) => { finish = resolve; }); }, setIntervalFn: () => 1, clearIntervalFn: () => {},
  });
  scheduler.activate(); s.messages.push({ id: 'm2', status: 'completed' });
  busy = true; await scheduler.tick(); assert.equal(calls, 0); busy = false;
  const first = scheduler.tick(); await scheduler.tick(); assert.equal(calls, 1);
  finish(); await first; assert.equal(s.summary.throughMessageId, 'm1');
  assert.deepEqual(s.summary.sections.concepts, ['old']); scheduler.dispose();
});

test('정리 실패 시 이전 내용 유지, 성공 cursor는 요청 순간 대화까지만 반영', async () => {
  const s = session(); s.summary = { throughMessageId: 'old', sections: { concepts: ['keep'] } };
  const original = structuredClone(s.summary);
  await assert.rejects(updateSummary(s, async () => { throw new Error('offline failure'); }));
  assert.deepEqual(s.summary, original);
  await assert.rejects(updateSummary(s, async () => ({ text: '{}' })));
  assert.deepEqual(s.summary, original);
  const output = Object.fromEntries(SECTION_KEYS.map((key) => [key, []]));
  output.concepts.push({ text: '덧셈 질문', messageIds: ['m1'], codeIds: [] });
  await updateSummary(s, async () => { s.messages.push({ id: 'new', status: 'completed', text: 'later' }); return { text: JSON.stringify(output) }; });
  assert.equal(s.summary.throughMessageId, 'm1');
});
