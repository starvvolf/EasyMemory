/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { registerLearningWorkspace } = require('../learning-workspace');
const { AccountClient } = require('../account-client');

test('VS Code view bridge: 로컬 문제 등록·편집·재개, 실제 연결 잠금, 화면 요청 범위', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-view-'));
  const disposables = []; t.after(async () => { for (const d of disposables) d.dispose?.(); await fs.rm(root, { recursive: true, force: true }); });
  const providers = new Map(); const commands = new Map();
  const uri = (value) => ({ scheme: 'file', fsPath: value, toString: () => value });
  let chat, changeDocument, uriHandler, browserUrl, enabled = false, calls = 0, failSummary = false, contents = 'a+b';
  const secretValues = new Map(), metadata = new Map(), memoryRequests = [], questionInputs = [];
  let failMemory = false, memoryRevision = 0;
  const memoryEntry = { domain: 'algorithm', topic: 'BFS', confirmed: [], uncertain: ['방문 처리 확인'], basis: 'inference', updatedAt: '2026-09-07T00:00:00Z', evidence: { recordId: 'fixture', evidenceIds: ['m1'] } };
  const fetcher = async (url, options) => {
    let data;
    if (url.includes('/exchange')) data = { customToken: 'fixture-custom', firebaseApiKey: 'fixture-key', uid: 'fixture-uid', email: 'fixture@example.invalid' };
    else if (url.includes('signInWithCustomToken')) data = { idToken: `x.${Buffer.from(JSON.stringify({ sub: 'fixture-uid' })).toString('base64url')}.x`, refreshToken: 'fixture-refresh', expiresIn: 3600 };
    else {
      memoryRequests.push({ url, options });
      if (failMemory) return { ok: false, status: 503, text: async () => '{}' };
      if (url.includes('/context')) data = { kind: 'learner-memory-user-data', entries: [memoryEntry] };
      else { if (options.method === 'POST' || options.method === 'PATCH') memoryRevision++; data = { state: { ownerUid: 'fixture-uid', revision: memoryRevision, entries: [memoryEntry] } }; }
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  };
  function webviewMock() { const webview = { cspSource: 'fixture:', asWebviewUri: (value) => value, postMessage: (value) => { webview.state = structuredClone(value); }, onDidReceiveMessage: (handler) => { webview.receive = handler; return {}; } }; return webview; }
  const document = { uri: uri(path.join(root, 'main.py')), languageId: 'python', getText: () => contents, save: () => { throw new Error('user file must not be saved'); } };
  const fakeClient = { on: () => {}, close: () => {}, account: async () => ({ type: 'chatgpt' }), chat: async (input) => {
    calls++;
    if (input.outputSchema) {
      if (failSummary) throw new Error('mock summary failure');
      const text = Object.fromEntries(Object.keys(input.outputSchema.properties).map((key) => [key, []]));
      return { text: JSON.stringify(text) };
    }
    questionInputs.push(input); assert.match(input.text, /a\+b/); await input.onThread('mock-thread'); input.onDelta('모의 답변'); return { text: '모의 답변' };
  } };
  const vscode = {
    ViewColumn: { One: 1, Beside: -2 },
    Uri: { joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)), parse: (value) => ({ toString: () => value }) },
    env: { uriScheme: 'vscode', openExternal: async (value) => { browserUrl = value.toString(); return true; } },
    window: { activeTextEditor: { document, selection: { isEmpty: false } }, onDidChangeActiveTextEditor: () => ({}), registerWebviewViewProvider: (name, provider) => { providers.set(name, provider); return {}; },
      showOpenDialog: async () => [document.uri], showTextDocument: async () => {},
      registerUriHandler: (handler) => { uriHandler = handler; return {}; },
      createWebviewPanel: () => { chat = webviewMock(); return { webview: chat, onDidDispose: () => {}, dispose: () => {}, reveal: () => {} }; } },
    commands: { registerCommand: (name, handler) => { commands.set(name, handler); return {}; } },
    workspace: { openTextDocument: async () => document, asRelativePath: () => 'main.py', getConfiguration: () => ({ inspect: (key) => ({ globalValue: key === 'accountServerUrl' ? 'https://fixture.invalid' : enabled }) }), onDidChangeTextDocument: (handler) => { changeDocument = handler; return {}; } },
  };
  const extensionPath = path.resolve(__dirname, '..');
  registerLearningWorkspace(vscode, { storageUri: uri(root), globalStorageUri: uri(root), extensionPath, extensionUri: uri(extensionPath), subscriptions: disposables,
    secrets: { get: async (key) => secretValues.get(key), store: async (key, value) => { secretValues.set(key, value); }, delete: async (key) => { secretValues.delete(key); } },
    globalState: { get: (key) => metadata.get(key), update: async (key, value) => { metadata.set(key, value); } },
  }, { createClient: async () => fakeClient, createAccount: (options) => new AccountClient({ ...options, fetcher }), detect: async () => ({ available: true, version: 'mock runtime; never executed' }) });
  function view(name) {
    const webview = webviewMock();
    providers.get(name).resolveWebviewView({ webview, onDidDispose: () => ({}) }); return webview;
  }
  const problem = view('studyForge.problem'); const results = view('studyForge.results');
  await problem.receive({ type: 'ready' });
  assert.equal(problem.state.session, undefined);
  assert.match(problem.html, /default-src 'none'/);
  await problem.receive({ type: 'createProblem', problem: { title: 'fixture', text: '<script>bad()</script>', images: [], examples: [], sourceUrl: '' } });
  assert.equal(problem.state.session.problem.title, 'fixture');
  const id = problem.state.session.id;
  await problem.receive({ type: 'login' }); assert.match(problem.state.error, /허용되지/);
  await results.receive({ type: 'runExamples' }); assert.match(results.state.error, /신뢰/);
  await problem.receive({ type: 'selectSession', id }); assert.equal(problem.state.error, '');
  await problem.receive({ type: 'openChat' }); await chat.receive({ type: 'status' }); assert.match(chat.state.error, /보류/); assert.equal(calls, 0);
  await chat.receive({ type: 'attachCode' });
  assert.equal(chat.state.session.codeSnapshots[0].text, 'a+b');
  contents = 'a-b'; changeDocument({ document });
  // Drain the event microtask and serial local file write; no runtime/AI invocation.
  await new Promise((resolve) => setTimeout(resolve, 30));
  await chat.receive({ type: 'ready' }); assert.equal(chat.state.session.codeSnapshots.at(-1).text, 'a-b');
  assert.equal(calls, 0);
  enabled = true; await chat.receive({ type: 'question', question: '설명해줘' });
  assert.equal(calls, 1); assert.equal(chat.state.session.messages.at(-1).text, '모의 답변');
  await chat.receive({ type: 'summarize' }); assert.equal(calls, 2);
  const summary = structuredClone(chat.state.session.summary); failSummary = true;
  await chat.receive({ type: 'summarize' }); assert.deepEqual(chat.state.session.summary, summary); assert.match(chat.state.session.summaryError, /mock/);
  enabled = false; await chat.receive({ type: 'question', question: 'blocked' }); assert.match(chat.state.error, /보류/); assert.equal(calls, 3);
  contents = 'def solution(a: int, b: int) -> int:\n    return a+b\n';
  await results.receive({ type: 'chooseFile' });
  const analysis = results.state.executionAnalysis;
  await results.receive({ type: 'confirmExecution', sourceHash: 'stale', targetPath: document.uri.fsPath, execution: { mode: 'function', function: analysis.candidates[0] } });
  assert.match(results.state.error, /다시 확인/);
  const confirm = () => results.receive({ type: 'confirmExecution', sourceHash: results.state.executionAnalysis.hash, targetPath: document.uri.fsPath, execution: { mode: 'function', function: results.state.executionAnalysis.candidates[0] } });
  await confirm(); assert.equal(results.state.runnerAvailable, true);
  const confirmation = structuredClone(results.state.session.execution.confirmation);
  contents += '# change'; changeDocument({ document }); await new Promise((resolve) => setTimeout(resolve, 30));
  await results.receive({ type: 'ready' }); assert.equal(results.state.runnerAvailable, true); assert.notEqual(results.state.executionAnalysis.hash, analysis.hash);
  contents = contents.replace('return a+b', 'return a-b'); await results.receive({ type: 'ready' });
  assert.equal(results.state.runnerAvailable, true); assert.deepEqual(results.state.session.execution.confirmation, confirmation);
  contents = contents.replace('a: int', 'a: str'); await results.receive({ type: 'ready' }); assert.equal(results.state.runnerAvailable, false);
  await confirm(); assert.equal(results.state.runnerAvailable, true);
  document.uri = uri(path.join(root, 'other.py')); await results.receive({ type: 'chooseFile' });
  assert.equal(results.state.runnerAvailable, false, 'same source in another file needs confirmation even with same UI label');
  await confirm(); assert.equal(results.state.runnerAvailable, true);
  await problem.receive({ type: 'updateProblem', problem: { ...problem.state.session.problem, examples: [{ input: '["x",1]', expectedOutput: '2' }] } });
  assert.equal(results.state.runnerAvailable, false, 'example mapping changed');
  const content = JSON.parse(await fs.readFile(path.join(root, 'learning/learning.json'), 'utf8'));
  assert.equal(content.activeSessionId, id); assert.equal(content.sessions.length, 1);
  assert.equal(await fs.stat(path.join(root, 'managed-codex')).then(() => true, () => false), false);
  await chat.receive({ type: 'accountConnect' });
  const linkState = new URL(browserUrl).searchParams.get('state');
  await uriHandler.handleUri(vscode.Uri.parse(`vscode://study-forge-local.study-forge-vscode/firebase-auth?code=fixture-code&state=${linkState}`));
  assert.equal(chat.state.studyAccount.account.uid, 'fixture-uid'); assert.equal(chat.state.session.accountLink, undefined);
  assert.equal(memoryRequests.some((r) => r.options.method === 'POST'), false, 'connection never imports old sessions');
  enabled = true; failSummary = false;
  await chat.receive({ type: 'attachCode' }); await chat.receive({ type: 'question', question: 'a+b에서 BFS 질문', memoryDomain: 'algorithm', memoryTopics: ['BFS'] });
  assert.equal(questionInputs.at(-1).threadId, undefined, 'old local/other-account AI thread is not reused');
  assert.match(questionInputs.at(-1).text, /learner-memory-user-data/);
  await chat.receive({ type: 'summarize' }); assert.equal(memoryRequests.some((r) => r.options.method === 'POST'), false);
  await chat.receive({ type: 'memoryImport' }); assert.equal(chat.state.session.accountLink.uid, 'fixture-uid');
  const posted = JSON.parse(memoryRequests.find((r) => r.options.method === 'POST').options.body);
  assert.deepEqual(Object.keys(posted).sort(), ['expectedRevision', 'operationId', 'record']); assert.equal(posted.record.recordId, id);
  assert.ok(Array.isArray(posted.record.summary.sections)); assert.equal(JSON.stringify(posted).includes('data:image'), false);
  failMemory = true; await chat.receive({ type: 'summarize' }); assert.ok(chat.state.session.summary); assert.match(chat.state.memoryError, /로컬에 보존/);
  failMemory = false; await chat.receive({ type: 'memoryEdit', target: { domain: 'algorithm', topic: 'BFS' }, change: 'confirm' });
  assert.equal(memoryRequests.at(-1).options.method, 'PATCH');
  await problem.receive({ type: 'createProblem', problem: { title: 'new', text: 'new fixture', images: [], examples: [] } });
  assert.equal(problem.state.session.accountLink.uid, 'fixture-uid');
  await chat.receive({ type: 'accountDisconnect' }); assert.equal(chat.state.memoryState, null); assert.equal(secretValues.size, 0);
  const savedData = await fs.readFile(path.join(root, 'learning/learning.json'), 'utf8'); assert.equal(savedData.includes('fixture-refresh'), false);
});
