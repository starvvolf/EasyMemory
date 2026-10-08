/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LearningStore, normalizeProblem, questionContext } = require('../learning-state');
const { ExampleRunner } = require('../example-runner');
const { CodexClient, createLocalCodexClient, FIXED_CONFIG } = require('../codex-client');
const { spawn } = require('node:child_process');

const problem = () => ({ title: '합 구하기', text: '두 수를 더하세요.', sourceUrl: 'https://example.org/problem', images: [], examples: [{ input: '1 2\n', expectedOutput: '3\n' }] });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=';

test('문제 검증: 공백·줄바꿈 보존, 이미지/링크/크기 경계', () => {
  const input = problem(); input.images = [{ dataUrl: png }];
  assert.equal(normalizeProblem(input).examples[0].input, '1 2\n');
  assert.throws(() => normalizeProblem({ ...input, sourceUrl: 'javascript:alert(1)' }));
  assert.throws(() => normalizeProblem({ ...input, images: [{ dataUrl: 'data:image/svg+xml;base64,AAAA' }] }));
  assert.throws(() => normalizeProblem({ ...input, images: [{ dataUrl: 'data:image/png;base64,AAAA' }] }));
  assert.throws(() => normalizeProblem({ ...input, text: 'x'.repeat(50001) }));
});

test('원문 대화·첨부 보존, 재시작 시 미완료 표시, 문제 간 분리', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-learning-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new LearningStore(root); await store.load();
  const first = await store.create(problem());
  first.messages.push({ role: 'assistant', text: '부분 답변', status: 'pending' });
  await store.save();
  const other = await store.create({ ...problem(), title: '두 번째' });
  assert.notEqual(first.id, other.id);
  await store.select(first.id);
  const restarted = new LearningStore(root); await restarted.load();
  assert.equal(restarted.active().messages[0].status, 'interrupted');
  assert.equal(restarted.active().messages[0].text, '부분 답변');
  const context = questionContext(first, '힌트만 알려줘', { text: 'a+b', language: 'python' }, [{ status: 'failed', input: '1 2', expectedOutput: '3', actualOutput: '12', stderr: '' }]);
  assert.equal(context.failures[0].actualOutput, '12');
  assert.equal('mastery' in context, false);
});

function launch(mode) { return { command: process.execPath, args: [path.join(__dirname, 'fixtures/program.cjs'), mode], cwd: __dirname }; }
test('여러 예제별 출력/실패/오류 및 쉘 메타문자 stdin 보존', async () => {
  const runner = new ExampleRunner();
  const examples = [{ id: 'a', input: 'x & echo nope\n', expectedOutput: 'x & echo nope\n' }, { id: 'b', input: 'actual', expectedOutput: 'expected' }];
  const results = await runner.run(examples, launch('echo'));
  assert.deepEqual(results.map((x) => x.status), ['passed', 'failed']);
  assert.equal(results[1].actualOutput, 'actual');
  const errors = await runner.run(examples.slice(0, 1), launch('error'));
  assert.equal(errors[0].status, 'error'); assert.equal(errors[0].exitCode, 2);
});
test('시간·출력 제한 및 중지 후 나머지 예제 실행 금지', async () => {
  const runner = new ExampleRunner(); const examples = [{ input: '', expectedOutput: '' }, { input: '', expectedOutput: '' }];
  assert.equal((await runner.run(examples.slice(0, 1), launch('hang'), undefined, { timeoutMs: 100 }))[0].status, 'timeout');
  const flood = await runner.run(examples.slice(0, 1), launch('flood'), undefined, { outputBytes: 1024 });
  assert.equal(flood[0].status, 'output-limit'); assert.ok(flood[0].actualOutput.length <= 1024);
  const pending = runner.run(examples, launch('hang')); setTimeout(() => runner.stop(), 100);
  const stopped = await pending; assert.equal(stopped.length, 1); assert.equal(stopped[0].status, 'stopped');
});
test('프로세스 트리 종료 거부 시 무한 대기 없이 실패 표시 및 후속 예제 중단', async () => {
  const runner = new ExampleRunner({ terminateTree: async () => false });
  const result = await runner.run([{ input: '', expectedOutput: '' }, { input: '', expectedOutput: '' }], launch('hang'), undefined, { timeoutMs: 100 });
  assert.equal(result.length, 1); assert.equal(result[0].status, 'termination-error');
  assert.match(result[0].stderr, /종료를 확인하지/);
});

async function fake(t, mode, options = {}) {
  const child = spawn(process.execPath, [path.join(__dirname, 'fixtures/app-server.cjs'), mode || 'normal'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const client = new CodexClient(child, { cwd: __dirname, timeoutMs: 2000, ...options });
  t.after(() => client.close()); await client.initialize(); return client;
}
test('App Server 초기화, managed 로그인, 빠른 완료 이벤트 및 대화 재개', async (t) => {
  const client = await fake(t); const methods = [];
  const original = client.write.bind(client); client.write = (message) => { methods.push(message); original(message); };
  assert.equal((await client.login()).type, 'chatgpt');
  let persisted; const deltas = [];
  const response = await client.chat({ text: '설명', images: [{ dataUrl: png }], onThread: async (id) => { persisted = id; }, onDelta: (text) => deltas.push(text) });
  assert.equal(response.text, '모의 설명'); assert.equal(persisted, 'thread-1'); assert.deepEqual(deltas, ['모의 설명']);
  assert.equal(methods.find((m) => m.id === 'approval-1').error.code, -32601);
  assert.equal(methods.find((m) => m.method === 'turn/start').params.input[1].url, png);
  await client.chat({ threadId: response.threadId, text: '추가 질문' });
  assert.ok(methods.some((m) => m.method === 'thread/resume'));
});
test('API 키 계정에서 turn/start 금지, live 기본 잠금, 도구 비활성 설정', async (t) => {
  const client = await fake(t, 'apikey');
  await assert.rejects(client.chat({ text: '설명' }), /ChatGPT 구독/);
  await assert.rejects(createLocalCodexClient({ enabled: false }), /보류/);
  assert.match(FIXED_CONFIG, /forced_login_method = "chatgpt"/);
  assert.match(FIXED_CONFIG, /shell_tool = false/);
});
test('응답 시간 초과/사용자 중지/중복 요청 차단', async (t) => {
  const client = await fake(t, 'hang', { turnTimeoutMs: 150 });
  const pending = client.chat({ text: '설명' });
  await assert.rejects(client.chat({ text: '중복' }), /이미/);
  await assert.rejects(pending, /중지|제한 시간/);
});
