/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { MemoryClient, indexEvidence, recordSnapshot } = require('../memory-client');
const { SECTION_KEYS, updateSummary } = require('../summary');
function sessionFixture() {
  return { id: 'fixture-record', accountLink: { uid: 'fixture-user', serverUrl: 'https://fixture.invalid' }, problem: { title: 'fixture', text: 'private problem original', images: [{ dataUrl: 'private-image' }] },
    messages: [{ id: 'm1', role: 'user', text: 'private original', status: 'sent' }], codeSnapshots: [{ id: 'c1', language: 'python', text: 'private source' }],
    summary: { throughMessageId: 'm1', updatedAt: '2026-09-07T00:00:00Z', automatic: false, sections: Object.fromEntries(SECTION_KEYS.map((key) => [key, []])),
      learnerMemoryCandidates: [{ domain: 'algorithm', topic: 'BFS', confirmed: [], uncertain: ['visited 처리 확인 필요'], evidenceIds: ['m1'], basis: 'inference' }] } };
}
function accountFixture(handler) {
  return { generation: 0, identity: { uid: 'fixture-user', serverUrl: 'https://fixture.invalid' },
    assertCurrent(generation, uid) { if (this.generation !== generation || (uid && uid !== this.identity?.uid)) throw new Error('stale account'); }, request: handler };
}
test('정리 DTO: 원문·이미지 제외, 안정적 근거 prefix·재시작 보존, 이전 세션 자동 반입 금지', async () => {
  const session = sessionFixture(), first = recordSnapshot(session), text = JSON.stringify(first);
  assert.equal(text.includes('private'), false); assert.ok(first.evidenceIndex.every((item) => /^[0-9a-f]{64}$/.test(item.contentHash)));
  session.messages.push({ id: 'm2', role: 'assistant', text: 'partial', status: 'pending' }); indexEvidence(session);
  assert.deepEqual(session.evidenceIndex, first.evidenceIndex);
  session.messages.at(-1).status = 'completed'; session.messages.at(-1).text = 'final'; indexEvidence(session);
  assert.deepEqual(session.evidenceIndex.slice(0, 2), first.evidenceIndex);
  const restored = JSON.parse(JSON.stringify(session)); assert.deepEqual(indexEvidence(restored), session.evidenceIndex);
  restored.messages[0].text = 'modified'; assert.throws(() => indexEvidence(restored), /변경/);
  let calls = 0; const client = new MemoryClient(accountFixture(async () => { calls++; }));
  delete session.accountLink; await client.apply(session); assert.equal(calls, 0);
  session.accountLink = { uid: 'other', serverUrl: 'https://fixture.invalid' }; await client.apply(session); assert.equal(calls, 0);
});
test('기존 정리 1회 응답에 basis 후보 보존, 원문 근거와 5개 섹션 유지', async () => {
  const session = sessionFixture(); let calls = 0;
  await updateSummary(session, async (text, schema) => {
    calls++; assert.match(text, /inference/); assert.ok(schema.properties.learnerMemoryCandidates);
    return { text: JSON.stringify({ ...session.summary.sections, learnerMemoryCandidates: session.summary.learnerMemoryCandidates }) };
  });
  assert.equal(calls, 1); assert.equal(session.summary.learnerMemoryCandidates[0].basis, 'inference');
});
test('기억 요청 실패·revision 역행·UID 전환에서 마지막 성공 상태 보호', async () => {
  const account = accountFixture(async () => ({ state: { ownerUid: 'fixture-user', revision: 2, entries: [] } }));
  const client = new MemoryClient(account); await client.load(); const prior = structuredClone(client.state);
  account.request = async () => { throw new Error('fixture failure'); };
  await assert.rejects(client.apply(sessionFixture()), /failure/); assert.deepEqual(client.state, prior);
  account.request = async () => ({ state: { ownerUid: 'fixture-user', revision: 1, entries: [] } }); await client.load(); assert.deepEqual(client.state, prior);
  account.request = async () => { account.generation++; account.identity.uid = 'other'; return { state: prior }; };
  await assert.rejects(client.load(), /stale/); assert.equal(client.snapshot(), null);
  account.request = async () => ({ state: prior }); await assert.rejects(client.load(), /응답/);
});
test('확장 소비자와 공통 HTTP·규칙 연결: apply→관련/무관련 context→수정/삭제→재접속', async (t) => {
  const root = process.env.STUDY_FORGE_MEMORY_COMMON_ROOT;
  if (!root) { t.skip('통합할 공통 learner-memory 모듈 경로 미지정'); return; }
  const common = await import(pathToFileURL(path.join(root, 'index.ts')).href);
  const { createMemoryHttpHandlers } = await import(pathToFileURL(path.join(root, 'http.ts')).href);
  let state = { ownerUid: 'fixture-user', revision: 0, entries: [], appliedSources: [] };
  const handlers = createMemoryHttpHandlers({ authenticate: async () => ({ uid: 'fixture-user' }), load: async () => structuredClone(state),
    apply: async (uid, record, options) => {
      state = common.applyMemorySummary(state, uid, options.expectedRevision, { ownerUid: uid, recordId: record.recordId,
        throughSequence: record.evidenceIndex.length - 1, events: record.evidenceIndex.map((entry, sequence) => ({ id: entry.id, sequence })) }, record.summary.learnerMemoryCandidates, '2026-09-07T00:00:00Z');
      return { state, status: 'applied' };
    },
    edit: async (uid, input, options) => { state = common.editMemoryEntry(state, uid, options.expectedRevision, input.target, input.change, '2026-09-07T00:01:00Z'); return { state }; },
    mapError: () => ({ status: 400, message: 'fixture invalid request' }),
  });
  const paths = [];
  const account = accountFixture(async (resource, options = {}) => {
    paths.push(resource); const request = new Request('https://fixture.invalid' + resource, options);
    const response = await handlers[resource.includes('/context') ? 'CONTEXT' : options.method || 'GET'](request);
    if (!response.ok) throw new Error((await response.json()).message); return response.json();
  });
  const client = new MemoryClient(account), session = sessionFixture();
  await client.apply(session); assert.equal(client.state.entries.length, 1);
  assert.equal((await client.context('algorithm', ['BFS'])).entries.length, 1);
  assert.equal((await client.context('algorithm', ['DFS'])).entries.length, 0);
  assert.equal((await client.context('cs', ['BFS'])).entries.length, 0);
  const count = paths.length; assert.equal(await client.context('algorithm', []), undefined); assert.equal(paths.length, count);
  await client.edit({ domain: 'algorithm', topic: 'BFS' }, { confirmed: ['사용자 정정'], uncertain: [] });
  assert.equal(client.state.entries[0].basis, 'self-report');
  const reconnected = new MemoryClient(account); await reconnected.load(); assert.equal(reconnected.state.entries[0].confirmed[0], '사용자 정정');
  await reconnected.edit({ domain: 'algorithm', topic: 'BFS' }, 'delete'); await reconnected.apply(session);
  assert.equal((await reconnected.context('algorithm', ['BFS'])).entries.length, 0);
});
