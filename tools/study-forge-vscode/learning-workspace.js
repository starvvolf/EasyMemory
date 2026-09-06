/* eslint-disable @typescript-eslint/no-require-imports */
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { LearningStore, normalizeProblem, questionContext } = require('./learning-state');
const { createLocalCodexClient } = require('./codex-client');
const { LanguageRunner } = require('./language-runner');
const { analyzeSource, confirmExecution, validateExecution, starter } = require('./execution-contract');
const { detectRuntime } = require('./local-runtimes');
const { SummaryScheduler, updateSummary } = require('./summary');

function registerLearningWorkspace(vscode, context, { createClient = createLocalCodexClient, detect = detectRuntime } = {}) {
  const directory = (context.storageUri || context.globalStorageUri).fsPath;
  const store = new LearningStore(path.join(directory, 'learning'));
  const runner = new LanguageRunner();
  const views = new Map();
  let client, chatPanel, pendingCode, pendingFailures, activeFile, busy = false, results = [], error = '', connection = '연결 전', problemSaved = 0, summaryBusy = false;
  let lastEditor = vscode.window.activeTextEditor;
  let runtimeStatus;
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => { if (editor) lastEditor = editor; }));
  let loadError;
  const scheduler = new SummaryScheduler({ getSession: () => store.active(), refresh: refreshSummary, isBusy: () => busy || runner.running,
    onError: (cause) => { error = `정리 저장 실패: ${cause.message}`; broadcast(); } });
  const ready = store.load().then(() => scheduler.activate()).catch((cause) => { loadError = cause; error = `기록을 읽지 못했습니다: ${cause.message}`; });

  function snapshot() {
    const executionAnalysis = activeFile ? analyzeSource(activeFile.language, activeFile.document.getText()) : undefined;
    let executionConfirmed = false;
    if (activeFile && store.active()?.execution) {
      try { validateExecution(activeFile.language, activeFile.document.getText(), store.active().execution, store.active().problem.examples, activeFile.path); executionConfirmed = true; } catch { /* Changed contracts need user confirmation. */ }
    }
    return { session: store.active(), sessions: store.state.sessions.map((s) => ({ id: s.id, title: s.problem.title })),
      pendingCode, pendingFailures, busy, results, running: runner.running, error, connection,
      activeFile: activeFile?.label, activeFileId: activeFile?.path, activeLanguage: activeFile?.language, runtimeStatus, executionAnalysis, executionConfirmed,
      runnerAvailable: Boolean(executionConfirmed && runtimeStatus?.available), problemSaved, summaryBusy, draft: store.state.draft,
    };
  }
  function broadcast() { for (const webview of views.values()) void webview.postMessage({ type: 'state', ...snapshot() }); }
  async function connect() {
    const config = vscode.workspace.getConfiguration('studyForge');
    const enabled = config.inspect('enableLiveConnection')?.globalValue === true;
    if (!enabled) { client?.close(); throw new Error('실제 연결 시험이 보류되어 있습니다. 승인 후 사용자 설정에서 실제 연결을 켜세요.'); }
    if (client && !client.closed) return client;
    client = await createClient({
      root: context.globalStorageUri.fsPath,
      command: config.inspect('codexExecutable')?.globalValue || '',
      enabled,
    });
    client.on('notification', (method, params) => {
      if (method === 'account/login/completed') {
        connection = params.success ? 'ChatGPT 로그인 완료' : '로그인을 완료하지 못했습니다.';
        broadcast();
      }
    });
    return client;
  }
  function requireIdle() {
    if (busy || runner.running) throw new Error('진행 중인 답변 또는 예제 실행을 먼저 중지하세요.');
  }
  function requireSession() {
    const session = store.active();
    if (!session) throw new Error('왼쪽에서 문제를 먼저 등록하세요.');
    return session;
  }
  function captureEditor(selectionOnly) {
    const editor = vscode.window.activeTextEditor || lastEditor;
    if (!editor || editor.document.uri.scheme !== 'file') throw new Error('기본 코드 편집기에서 파일을 선택하세요.');
    if (selectionOnly && editor.selection.isEmpty) throw new Error('질문에 포함할 코드를 먼저 선택하세요.');
    return { path: editor.document.uri.fsPath, label: vscode.workspace.asRelativePath(editor.document.uri, false),
      language: editor.document.languageId, text: selectionOnly ? editor.document.getText(editor.selection) : undefined,
      document: editor.document };
  }
  async function preserveCode(document) {
    const session = store.active();
    if (!session || document.uri.fsPath !== session.linkedFile?.path) return;
    const text = document.getText();
    if (text.length > 100000) throw new Error('연결 코드가 100,000자를 넘어 자동 기록하지 못했습니다.');
    session.codeSnapshots ||= [];
    if (session.codeSnapshots.at(-1)?.text === text) return;
    session.codeSnapshots.push({ id: randomUUID(), filePath: session.linkedFile.label, language: document.languageId, text, createdAt: new Date().toISOString() });
    await store.save();
  }
  async function linkCode(captured) {
    const session = requireSession();
    session.linkedFile = { path: captured.path, label: captured.label, language: captured.language };
    await preserveCode(captured.document);
  }
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
    void ready.then(() => preserveCode(event.document)).then(() => { if (event.document === activeFile?.document) broadcast(); }).catch((cause) => { error = cause.message; broadcast(); });
  }));
  async function checkRuntime() {
    if (!activeFile) throw new Error('실행할 파일을 먼저 선택하세요.');
    const config = vscode.workspace.getConfiguration('studyForge');
    const setting = (name) => config.inspect(name)?.globalValue || undefined;
    runtimeStatus = await detect(activeFile.language, { python: setting('pythonExecutable'), dotnet: setting('dotnetExecutable'), java: setting('javaExecutable'), javac: setting('javacExecutable') });
  }
  async function refreshSummary(automatic = false) {
    const session = store.active();
    if (!session) return;
    if (busy || runner.running) { if (!automatic) { error = '진행 중인 답변 또는 실행 후 정리하세요.'; broadcast(); } return; }
    const previousSummary = session.summary;
    busy = true; summaryBusy = true; session.summaryError = ''; broadcast();
    try {
      const transport = await connect();
      // Separate from the learning conversation; repeated summaries never become user dialogue.
      await updateSummary(session, (text, outputSchema) => transport.chat({ text, outputSchema }), automatic);
      await store.save();
    } catch (cause) { session.summary = previousSummary; session.summaryError = cause.message; }
    finally { busy = false; summaryBusy = false; await store.save(); broadcast(); }
  }
  async function sendQuestion(message) {
    requireIdle();
    const session = requireSession();
    const code = pendingCode ? { filePath: pendingCode.label, language: pendingCode.language, text: pendingCode.text } : undefined;
    const reference = questionContext(session, message.question, code, pendingFailures);
    busy = true; broadcast();
    let assistant, saveTimer;
    try {
      const transport = await connect();
      if ((await transport.account())?.type !== 'chatgpt') throw new Error('먼저 ChatGPT 구독으로 로그인하세요.');
      const user = { id: randomUUID(), role: 'user', text: message.question, context: reference, status: 'sent', createdAt: new Date().toISOString() };
      assistant = { id: randomUUID(), role: 'assistant', text: '', status: 'pending', createdAt: new Date().toISOString() };
      session.messages.push(user, assistant);
      await store.save();
      pendingCode = undefined; pendingFailures = undefined;
      broadcast();
      const { images, ...problemText } = reference.problem;
      const text = JSON.stringify({ question: message.question, referenceMaterial: { ...reference, problem: { ...problemText, imageCount: images.length } } });
      const result = await transport.chat({ threadId: session.threadId, text, images,
        onThread: async (threadId) => { session.threadId = threadId; await store.save(); },
        onDelta: (text) => { assistant.text = text; broadcast();
          if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; void store.save().catch((cause) => { error = cause.message; broadcast(); }); }, 300);
        },
      });
      assistant.text = result.text; assistant.status = 'completed';
    } catch (cause) {
      if (assistant) { assistant.status = 'interrupted'; assistant.error = cause.message; }
      throw cause;
    } finally {
      clearTimeout(saveTimer); busy = false; session.updatedAt = new Date().toISOString(); await store.save(); broadcast();
    }
  }
  async function onMessage(message, kind) {
    await ready;
    try {
      if (!message || typeof message.type !== 'string') return;
      if (message.type === 'ready') { broadcast(); return; }
      if (loadError) throw loadError;
      error = '';
      const allowed = {
        problem: ['createProblem', 'updateProblem', 'saveDraft', 'selectSession', 'openChat'],
        chat: ['login', 'status', 'question', 'stopChat', 'attachCode', 'clearCode', 'clearFailures', 'summarize', 'summaryAuto', 'closeSession'],
        results: ['chooseFile', 'checkRuntime', 'confirmExecution', 'newSource', 'runExamples', 'stopExamples', 'attachFailures'],
      };
      if (!allowed[kind]?.includes(message.type)) throw new Error('허용되지 않은 화면 요청입니다.');
      switch (message.type) {
        case 'createProblem': requireIdle(); await store.create(message.problem); store.state.draft = null; await store.save(); scheduler.activate(); problemSaved++; activeFile = undefined; runtimeStatus = undefined; results = []; pendingCode = undefined; pendingFailures = undefined; break;
        case 'updateProblem': {
          requireIdle(); const session = requireSession();
          session.problem = normalizeProblem(message.problem); session.updatedAt = new Date().toISOString();
          store.state.draft = null; results = []; pendingFailures = undefined; await store.save(); problemSaved++; break;
        }
        case 'saveDraft': {
          if (JSON.stringify(message.draft).length > 23 * 1024 * 1024) throw new Error('문제 초안이 너무 큽니다.');
          store.state.draft = message.draft; await store.save(); break;
        }
        case 'selectSession': requireIdle(); await store.select(message.id); scheduler.activate(); activeFile = undefined; runtimeStatus = undefined; results = []; pendingCode = undefined; pendingFailures = undefined; break;
        case 'openChat': openChat(); break;
        case 'login': {
          requireIdle(); const transport = await connect(); const login = await transport.login();
          const url = new URL(login.authUrl);
          if (url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com', 'auth.chatgpt.com'].includes(url.hostname)) throw new Error('허용되지 않은 로그인 주소입니다.');
          await vscode.env.openExternal(vscode.Uri.parse(login.authUrl)); connection = '브라우저 로그인 대기'; break;
        }
        case 'status': { const account = await (await connect()).account(); connection = account?.type === 'chatgpt' ? 'ChatGPT 구독 연결' : 'ChatGPT 로그인 필요'; break; }
        case 'attachCode': { const captured = captureEditor(true); await linkCode(captured); pendingCode = { label: captured.label, language: captured.language, text: captured.text }; break; }
        case 'clearCode': pendingCode = undefined; break;
        case 'clearFailures': pendingFailures = undefined; break;
        case 'question': {
          if (/^정리해\s*줘[.!?\s]*$/.test(message.question || '')) {
            requireIdle(); const session = requireSession();
            if (!session.messages.length) throw new Error('정리할 대화가 아직 없습니다.');
            session.messages.push({ id: randomUUID(), role: 'user', text: message.question, status: 'local-request', createdAt: new Date().toISOString() });
            await store.save(); await refreshSummary();
          } else await sendQuestion(message);
          break;
        }
        case 'summarize': await refreshSummary(); break;
        case 'summaryAuto': requireSession().summaryAutoEnabled = message.enabled === true; await store.save(); scheduler.activate(); break;
        case 'closeSession': requireIdle(); store.state.activeSessionId = null; await store.save(); scheduler.activate(); activeFile = undefined; runtimeStatus = undefined; results = []; pendingCode = undefined; pendingFailures = undefined; break;
        case 'stopChat': await client?.interrupt(); break;
        case 'chooseFile': {
          requireIdle(); requireSession(); const picked = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFiles: true, canSelectFolders: false, openLabel: '예제 실행 파일 선택' });
          if (picked?.[0]) {
            const document = await vscode.workspace.openTextDocument(picked[0]);
            await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
            activeFile = { path: picked[0].fsPath, label: vscode.workspace.asRelativePath(picked[0], false), language: document.languageId, document };
            await linkCode(activeFile);
            await checkRuntime();
          }
          break;
        }
        case 'checkRuntime': requireIdle(); await checkRuntime(); break;
        case 'confirmExecution': {
          requireIdle(); const session = requireSession();
          if (!activeFile) throw new Error('실행할 파일을 먼저 선택하세요.');
          const source = activeFile.document.getText();
          if (message.sourceHash !== analyzeSource(activeFile.language, source).hash || message.targetPath !== activeFile.path) throw new Error('화면의 실행 대상이 바뀌었습니다. 다시 확인하세요.');
          session.execution = confirmExecution(activeFile.language, source, message.execution, session.problem.examples, activeFile.path); await store.save(); break;
        }
        case 'newSource': {
          requireIdle(); const content = starter(message.language, message.mode);
          const document = await vscode.workspace.openTextDocument({ language: message.language, content });
          await vscode.window.showTextDocument(document, vscode.ViewColumn.One); break;
        }
        case 'runExamples': {
          requireIdle(); const session = requireSession();
          if (!vscode.workspace.isTrusted) throw new Error('신뢰한 작업 폴더에서만 예제를 실행할 수 있습니다.');
          if (!activeFile) throw new Error('실행 파일을 선택하세요.');
          if (activeFile.document.isDirty) throw new Error('선택 파일을 저장한 뒤 실행하세요.');
          if (!session.problem.examples.length) throw new Error('문제의 예제를 먼저 등록하세요.');
          results = []; pendingFailures = undefined;
          const execution = runner.runSource({ source: activeFile.document.getText(), language: activeFile.language, targetPath: activeFile.path,
            execution: session.execution, examples: session.problem.examples, runtime: runtimeStatus },
          (result) => { results.push({ ...result, filePath: activeFile.label }); broadcast(); });
          broadcast(); await execution; break;
        }
        case 'stopExamples': runner.stop(); break;
        case 'attachFailures': pendingFailures = results.filter((result) => result.status !== 'passed'); openChat(); break;
      }
    } catch (cause) { error = cause instanceof Error ? cause.message : '요청을 처리하지 못했습니다.'; }
    broadcast();
  }
  function setup(webview, kind) {
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = randomUUID().replace(/-/g, '');
    webview.html = fs.readFileSync(path.join(context.extensionPath, 'media', 'workspace.html'), 'utf8')
      .replaceAll('{{nonce}}', nonce).replaceAll('{{cspSource}}', webview.cspSource)
      .replaceAll('{{script}}', webview.asWebviewUri(vscode.Uri.joinPath(media, 'workspace.js')).toString())
      .replaceAll('{{style}}', webview.asWebviewUri(vscode.Uri.joinPath(media, 'workspace.css')).toString())
      .replaceAll('{{kind}}', kind);
    views.set(kind, webview);
    context.subscriptions.push(webview.onDidReceiveMessage((message) => onMessage(message, kind)));
    void ready.then(broadcast);
  }
  function openChat() {
    if (chatPanel) { chatPanel.reveal(vscode.ViewColumn.Beside, true); return; }
    chatPanel = vscode.window.createWebviewPanel('studyForge.chat', '학습 대화', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    scheduler.activate();
    setup(chatPanel.webview, 'chat');
    chatPanel.onDidDispose(() => { scheduler.dispose(); chatPanel = undefined; views.delete('chat'); });
  }
  for (const kind of ['problem', 'results']) {
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(`studyForge.${kind}`, {
      resolveWebviewView(view) { setup(view.webview, kind); view.onDidDispose(() => views.delete(kind)); },
    }, { webviewOptions: { retainContextWhenHidden: true } }));
  }
  context.subscriptions.push(vscode.commands.registerCommand('studyForge.openLearning', async () => {
    await vscode.commands.executeCommand('studyForge.problem.focus');
    await vscode.commands.executeCommand('studyForge.results.focus'); openChat();
  }));
  context.subscriptions.push({ dispose() { scheduler.dispose(); runner.stop(); client?.close(); chatPanel?.dispose(); } });
}

module.exports = { registerLearningWorkspace };
