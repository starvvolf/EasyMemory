/* global acquireVsCodeApi */
(() => {
  const api = acquireVsCodeApi();
  const app = document.querySelector('#app');
  const kind = document.body.dataset.kind;
  let state = {}, draft = null, editing = false, newProblem = false, draftDirty = false;
  let executionDraft, executionKey, templateLanguage = 'python', templateMode = 'stdio';
  let memoryDomain = 'algorithm', memoryTopics = '', memoryGeneration;
  const memoryEdits = new Map();
  const saved = api.getState() || {};
  let question = saved.question || '';
  if (saved.draft) { draft = saved.draft; editing = true; newProblem = saved.newProblem; draftDirty = true; }
  const send = (type, fields = {}) => api.postMessage({ type, ...fields });
  const node = (tag, text, className) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; };
  const button = (text, action, secondary = false) => { const item = node('button', text, secondary ? 'secondary' : ''); item.type = 'button'; item.onclick = action; return item; };
  const row = (...children) => { const item = node('div', undefined, 'row'); item.append(...children); return item; };
  const persist = () => { api.setState({ question, draft: draftDirty ? draft : null, newProblem });
    if (kind === 'problem') send('saveDraft', { draft: draftDirty ? { problem: draft, sessionId: newProblem ? null : state.session?.id, newProblem } : null });
    syncRunButton();
  };
  function syncRunButton() {
    const run = document.querySelector('#run-examples');
    if (run) run.disabled = !state.runnerAvailable || state.running || state.busy || draftChanged();
  }
  function draftChanged() {
    const shape = (value) => value && ({ mode: value.mode, mainClass: value.mode === 'stdio' ? value.mainClass : '',
      function: value.mode === 'function' && value.function ? { name: value.function.name, className: value.function.className, isStatic: value.function.isStatic, parameters: value.function.parameters, returnType: value.function.returnType } : null });
    return JSON.stringify(shape(executionDraft)) !== JSON.stringify(shape(state.session?.execution));
  }
  function field(parent, title, value, change, large = false, single = false) {
    const id = `field-${Math.random().toString(36).slice(2)}`;
    const label = node('label', title); label.htmlFor = id;
    const input = node(single ? 'input' : 'textarea'); input.id = id; input.value = value || '';
    if (large) input.className = 'large';
    input.oninput = () => { change(input.value); persist(); };
    parent.append(label, input); return input;
  }
  function imageList(parent, images, removable = false) {
    const container = node('div', undefined, 'images');
    images.forEach((image, index) => {
      const img = node('img'); img.src = image.dataUrl; img.alt = `문제 그림 ${index + 1}`; container.append(img);
      if (removable) container.append(button('그림 삭제', () => { draft.images.splice(index, 1); draftDirty = true; persist(); render(); }, true));
    });
    parent.append(container);
  }
  async function addFiles(files) {
    try {
      for (const file of files) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024 || draft.images.length >= 5) throw new Error('PNG/JPEG/WebP 그림을 개당 3MB, 최대 5개까지 등록할 수 있습니다.');
        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
        draft.images.push({ dataUrl }); draftDirty = true;
      }
      persist(); render();
    } catch (error) { document.querySelector('#error').textContent = error.message; }
  }
  function beginEdit(fresh) {
    newProblem = fresh; editing = true; draftDirty = true;
    draft = fresh ? { title: '', text: '', sourceUrl: '', images: [], examples: [] } : structuredClone(state.session.problem);
    persist(); render();
  }
  function renderProblem() {
    app.append(node('div', 'STUDY FORGE', 'eyebrow'), node('h1', '문제와 함께 배우기'));
    const selector = node('select'); selector.setAttribute('aria-label', '저장한 문제');
    selector.append(new Option('저장한 문제 선택', ''));
    for (const session of state.sessions || []) selector.append(new Option(session.title, session.id));
    selector.value = state.session?.id || ''; selector.disabled = state.busy || state.running;
    selector.onchange = () => { if (selector.value && (!draftDirty || confirm('저장하지 않은 문제 편집을 버리고 이동할까요?'))) { editing = false; draftDirty = false; persist(); send('selectSession', { id: selector.value }); } };
    app.append(selector, row(button('새 문제', () => beginEdit(true), true), button('학습 대화 열기', () => send('openChat'))));
    if (!state.session && !editing) { app.append(node('p', '문제 본문과 그림을 한 번 등록하면 코드 옆에서 보며 질문할 수 있습니다.', 'muted')); return; }
    if (editing) {
      const form = node('form');
      const change = (key) => (value) => { draft[key] = value; draftDirty = true; };
      field(form, '문제 제목', draft.title, change('title'), false, true);
      field(form, '문제 본문 · 여기에 그림도 붙여넣을 수 있어요', draft.text, change('text'), true);
      field(form, '원문 링크 (선택)', draft.sourceUrl, change('sourceUrl'), false, true);
      const upload = node('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/webp'; upload.multiple = true; upload.setAttribute('aria-label', '문제 그림 첨부'); upload.onchange = () => addFiles(upload.files);
      form.append(upload); imageList(form, draft.images, true);
      form.onpaste = (event) => {
        const files = [...(event.clipboardData?.items || [])].filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter(Boolean);
        if (files.length) { event.preventDefault(); void addFiles(files); }
      };
      form.append(node('h2', '문제에 주어진 예제'), node('p', '입력과 기대 출력을 확인해서 등록하세요. 공백과 줄바꿈을 보존합니다.', 'muted'));
      draft.examples.forEach((example, index) => {
        const card = node('div', undefined, 'card'); card.append(node('h2', `예제 ${index + 1}`));
        field(card, '입력', example.input, (value) => { example.input = value; draftDirty = true; });
        field(card, '기대 출력', example.expectedOutput, (value) => { example.expectedOutput = value; draftDirty = true; });
        card.append(button('예제 삭제', () => { draft.examples.splice(index, 1); draftDirty = true; persist(); render(); }, true)); form.append(card);
      });
      form.append(button('예제 추가', () => { if (draft.examples.length < 20) { draft.examples.push({ input: '', expectedOutput: '' }); draftDirty = true; persist(); render(); } }, true));
      const save = button(newProblem ? '확인한 문제와 예제 등록' : '변경 저장', () => send(newProblem ? 'createProblem' : 'updateProblem', { problem: draft }));
      save.disabled = state.busy || state.running;
      form.append(row(save, button('편집 취소', () => { editing = false; draftDirty = false; persist(); render(); }, true)));
      form.onsubmit = (event) => event.preventDefault(); app.append(form);
    } else {
      const problem = state.session.problem;
      app.append(node('h2', problem.title), node('div', problem.text, 'prose')); imageList(app, problem.images);
      if (problem.sourceUrl) { const link = node('a', '원문 열기'); link.href = problem.sourceUrl; app.append(link); }
      problem.examples.forEach((example, index) => { const card = node('div', undefined, 'card'); card.append(node('h2', `예제 ${index + 1}`), node('small', '입력'), node('pre', example.input), node('small', '기대 출력'), node('pre', example.expectedOutput)); app.append(card); });
      app.append(button('문제·예제 편집', () => beginEdit(false), true));
    }
  }
  function renderChat() {
    app.append(node('div', 'LEARNING CONVERSATION', 'eyebrow'), node('h1', state.session?.problem.title || '학습 대화'));
    if (memoryGeneration !== state.studyAccount?.generation) { memoryGeneration = state.studyAccount?.generation; memoryTopics = ''; memoryEdits.clear(); }
    const account = state.studyAccount?.account;
    const accountBox = node('details', undefined, 'card account-box');
    accountBox.append(node('summary', account ? `Study Forge 계정 · ${account.email}` : 'Study Forge 계정 연결'));
    accountBox.append(node('p', '학습 기억 저장용 계정입니다. ChatGPT 구독 로그인과 별개입니다.', 'muted'));
    accountBox.append(button(account ? '다른 계정 연결' : '계정 연결', () => send('accountConnect'), true));
    if (account || state.studyAccount?.connecting) accountBox.append(button(state.studyAccount.connecting ? '계정 연결 취소' : '계정 연결 해제', () => send('accountDisconnect'), true));
    if (state.studyAccount?.connecting) accountBox.append(node('p', '브라우저에서 연결 계정을 확인하세요.'));
    if (state.accountError) accountBox.append(node('p', state.accountError, 'error'));
    if (account) {
      accountBox.append(node('small', account.serverUrl));
      const linked = state.session?.accountLink?.uid === account.uid && state.session?.accountLink?.serverUrl === account.serverUrl;
      accountBox.append(node('p', linked ? '이 세션은 정리 성공 시 정리와 근거 참조를 계정에 저장합니다.' : '기존 로컬 세션은 자동으로 가져오지 않습니다. 연결 후 만든 새 세션부터 정리를 계정에 저장합니다.', 'muted'));
      const importButton = button('이 세션의 정리·근거 참조만 계정으로 가져오기', () => send('memoryImport'), true);
      importButton.disabled = !state.session?.summary || state.busy || state.running || linked;
      accountBox.append(importButton, node('small', '원문·그림은 업로드하지 않으며 로컬 기록은 보존합니다.'));
      accountBox.append(button('계정 기억 새로 읽기', () => send('memoryLoad'), true));
      if (linked) accountBox.append(button('현재 정리의 계정 저장 재시도', () => send('memoryApply'), true));
      if (state.memoryError) accountBox.append(node('p', state.memoryError, 'error'));
      for (const entry of state.memoryState?.entries || []) {
        if (entry.deleted) continue;
        const key = JSON.stringify([entry.domain, entry.topic, entry.updatedAt]);
        if (!memoryEdits.has(key)) memoryEdits.set(key, { confirmed: entry.confirmed.join('\n'), uncertain: entry.uncertain.join('\n') });
        const edit = memoryEdits.get(key), card = node('details', undefined, 'card');
        card.append(node('summary', `${entry.domain} · ${entry.topic}`), node('small', `${entry.updatedAt} · ${{ observation: '관찰', 'self-report': '자기평가', inference: '추론' }[entry.basis] || entry.basis}`));
        card.append(node('p', entry.userEdited ? '사용자 확인·수정으로 자동 덮어쓰기 잠금' : '정리에서 얻은 내용이며 숙달 판정이 아닙니다.', 'muted'));
        field(card, '확인된 내용 (한 줄에 하나)', edit.confirmed, (value) => { edit.confirmed = value; });
        field(card, '아직 확인되지 않은 내용 (한 줄에 하나)', edit.uncertain, (value) => { edit.uncertain = value; });
        const target = { domain: entry.domain, topic: entry.topic };
        card.append(row(button('내용 확인', () => send('memoryEdit', { target, change: 'confirm' }), true),
          button('수정 저장', () => send('memoryEdit', { target, change: { confirmed: edit.confirmed.split('\n').filter((line) => line.trim()), uncertain: edit.uncertain.split('\n').filter((line) => line.trim()) } }), true),
          button('기억 삭제', () => send('memoryEdit', { target, change: 'delete' }), true)));
        card.append(node('small', '기존 기록 근거'), node('pre', JSON.stringify(entry.evidence))); accountBox.append(card);
      }
    }
    app.append(accountBox);
    app.append(node('p', state.connection, 'muted'), row(button('ChatGPT 로그인', () => send('login'), true), button('연결 확인', () => send('status'), true)));
    const close = button('학습 세션 닫기', () => send('closeSession'), true); close.disabled = state.busy || state.running || !state.session; app.append(close);
    app.append(node('p', '이 문제의 대화는 로컬에 보존됩니다. 질문을 보낼 때 등록한 본문과 그림을 AI에 전달합니다.', 'muted'));
    if (state.session?.linkedFile) app.append(node('small', `연결 파일 ${state.session.linkedFile.label} · 변경 원문 로컬 자동 기록`));
    const summary = node('details', undefined, 'card');
    summary.append(node('summary', state.summaryBusy ? '학습 정리 중…' : '학습 정리'));
    summary.append(node('p', '정리도 ChatGPT 구독 사용량을 씁니다. 자동 갱신은 첫 정리 후 새 대화가 있을 때만 10분마다 실행합니다.', 'muted'));
    const summarize = button('현재 대화 정리', () => send('summarize')); summarize.disabled = state.busy || !state.session?.messages.length;
    const autoLabel = node('label'); const auto = node('input'); auto.type = 'checkbox'; auto.checked = state.session?.summaryAutoEnabled === true; auto.disabled = !state.session;
    auto.onchange = () => send('summaryAuto', { enabled: auto.checked }); autoLabel.append(auto, document.createTextNode('새 대화가 있을 때 자동 갱신')); summary.append(summarize, autoLabel);
    if (state.session?.summaryError) summary.append(node('p', `갱신 실패 · 기존 정리 유지: ${state.session.summaryError}`, 'error'));
    if (state.session?.summary) {
      summary.append(node('small', `마지막 정리 ${new Date(state.session.summary.updatedAt).toLocaleString()}`));
      const labels = { concepts: '다룬 개념', difficulties: '막힌 부분', observedActions: '확인된 행동', unverifiedUnderstanding: '아직 확인되지 않은 이해', reviewItems: '다시 볼 내용' };
      for (const [key, label] of Object.entries(labels)) {
        summary.append(node('h2', label));
        for (const item of state.session.summary.sections[key]) {
          summary.append(node('p', item.text));
          const evidence = node('details'); evidence.append(node('summary', '원문 근거'));
          for (const id of item.messageIds) { const message = state.session.messages.find((m) => m.id === id); if (message) evidence.append(node('pre', `${message.role}: ${message.text}`)); }
          for (const id of item.codeIds) { const code = state.session.codeSnapshots?.find((c) => c.id === id); if (code) evidence.append(node('small', code.filePath), node('pre', code.text)); }
          summary.append(evidence);
        }
      }
    }
    app.append(summary);
    const messages = node('div', undefined, 'messages'); messages.setAttribute('aria-live', 'polite');
    for (const message of state.session?.messages || []) {
      const item = node('article', undefined, `message ${message.role}`);
      item.append(node('strong', message.role === 'user' ? '나' : '학습 도우미'), node('div', message.text || '답변 대기 중…', 'prose'));
      if (message.status === 'interrupted') item.append(node('p', message.error || '완료되지 않은 응답입니다.', 'muted'));
      if (message.context) {
        const detail = node('details'); detail.append(node('summary', '함께 보낸 문맥'));
        const { images, ...problem } = message.context.problem;
        detail.append(node('pre', JSON.stringify({ ...message.context, problem: { ...problem, imageCount: images.length } }, null, 2)));
        imageList(detail, images); item.append(detail);
      }
      messages.append(item);
    }
    app.append(messages);
    const composer = node('form', undefined, 'composer');
    if (state.pendingCode) { const detail = node('details'); detail.append(node('summary', `첨부 코드 · ${state.pendingCode.label}`), node('pre', state.pendingCode.text)); composer.append(detail, button('코드 제외', () => send('clearCode'), true)); }
    if (state.pendingFailures?.length) { const detail = node('details'); detail.append(node('summary', `첨부 실행 결과 ${state.pendingFailures.length}개`), node('pre', JSON.stringify(state.pendingFailures, null, 2))); composer.append(detail, button('결과 제외', () => send('clearFailures'), true)); }
    const input = field(composer, '질문', question, (value) => { question = value; }); input.id = 'question'; composer.querySelector('label').htmlFor = 'question';
    if (account) {
      const referenceSetup = node('details'); referenceSetup.append(node('summary', '이번 질문의 기억 참고 (선택)'));
      const domain = node('select'); domain.setAttribute('aria-label', '이번 질문의 학습 영역');
      for (const [value, label] of [['algorithm', '알고리즘'], ['cs', '컴퓨터 과학'], ['opic', '말하기'], ['report', '보고서']]) domain.append(new Option(label, value));
      domain.value = memoryDomain; domain.onchange = () => { memoryDomain = domain.value; }; referenceSetup.append(domain);
      field(referenceSetup, '이번 질문에 참고할 기억 주제 (한 줄에 하나, 선택)', memoryTopics, (value) => { memoryTopics = value; });
      referenceSetup.append(node('small', '지정한 주제와 일치하는 기억만 참고합니다. 비우면 기억을 전달하지 않습니다.')); composer.append(referenceSetup);
    }
    const submit = button('질문 보내기', () => { question = input.value; persist(); const topics = memoryTopics.split('\n').filter((topic) => topic.trim()); memoryTopics = ''; send('question', { question, memoryDomain, memoryTopics: topics }); }); submit.disabled = state.busy || !state.session;
    const stop = button('답변 중지', () => send('stopChat'), true); stop.disabled = !state.busy;
    composer.append(row(button('선택 코드 첨부', () => send('attachCode'), true), submit, stop));
    composer.onsubmit = (event) => { event.preventDefault(); if (!submit.disabled) submit.click(); }; app.append(composer);
  }
  function renderResults() {
    app.append(node('div', 'EXAMPLE TESTS', 'eyebrow'), node('h1', '등록한 예제 실행'));
    app.append(node('p', '문제에 등록한 예제만 비교합니다. 숨은 테스트나 원사이트 합격 판정이 아닙니다.', 'muted'));
    function select(options, value, change, label) {
      const input = node('select'); input.setAttribute('aria-label', label);
      for (const [key, title] of options) input.append(new Option(title, key));
      input.value = value; input.onchange = () => { change(input.value); syncRunButton(); }; return input;
    }
    const modes = [['stdio', '전체 프로그램 · 표준입력 → 출력'], ['function', '함수/메서드 · 인자 → 반환값']];
    app.append(row(select([['python', 'Python'], ['csharp', 'C#'], ['java', 'Java']], templateLanguage, (value) => { templateLanguage = value; }, '기본 코드 언어'),
      select(modes, templateMode, (value) => { templateMode = value; }, '기본 코드 형식'),
      button('기본 코드 열기', () => send('newSource', { language: templateLanguage, mode: templateMode }), true)));
    app.append(node('small', '기본 코드는 새 미저장 문서로 열립니다. 저장한 뒤 실행 파일로 선택하세요.'));
    app.append(node('p', state.activeFile || '실행할 파일을 선택하세요.'));
    app.append(row(button('실행 파일 선택', () => send('chooseFile'), true), button('런타임 다시 확인', () => send('checkRuntime'), true)));
    if (state.runtimeStatus) app.append(node('p', state.runtimeStatus.available ? state.runtimeStatus.version : state.runtimeStatus.reason, state.runtimeStatus.available ? 'muted' : 'error'));
    if (state.executionAnalysis) {
      const analysis = state.executionAnalysis, key = JSON.stringify([state.session?.id, state.activeFileId || state.activeFile, state.activeLanguage, analysis.candidates, analysis.className, analysis.entrypoints]);
      if (key !== executionKey) {
        executionKey = key;
        executionDraft = { mode: state.session?.execution?.mode || 'stdio', mainClass: analysis.className || '',
          function: analysis.candidates.length === 1 ? structuredClone(analysis.candidates[0]) : null };
        if (state.executionConfirmed) {
          executionDraft = structuredClone(state.session.execution);
          const candidate = analysis.candidates.find((c) => c.declaration === executionDraft.function?.declaration && c.name === executionDraft.function?.name);
          if (candidate) executionDraft.function.sourceIndex = candidate.sourceIndex;
        }
      }
      const setup = node('details', undefined, 'card'); setup.open = !state.runnerAvailable;
      setup.append(node('summary', '실행 형식과 호출 규격 확인'), select(modes, executionDraft.mode, (value) => { executionDraft.mode = value; render(); }, '실행 형식'));
      if (analysis.reason) setup.append(node('p', analysis.reason, 'error'));
      if (executionDraft.mode === 'stdio') {
        setup.append(node('p', '등록 예제의 입력 원문을 표준입력으로 전달합니다. 출력은 공백을 보존해 비교합니다.', 'muted'));
        if (state.activeLanguage === 'java') field(setup, 'main 메서드가 있는 클래스', executionDraft.mainClass, (value) => { executionDraft.mainClass = value; }, false, true);
      } else {
        setup.append(node('p', '입력은 인자 순서의 JSON 배열, 기대 출력은 JSON 값입니다. 배열 인자 1개는 [[1,2]], 문자열 인자 1개는 ["text"]로 입력합니다.', 'muted'));
        const candidates = [['', '호출할 후보를 선택하세요'], ...analysis.candidates.map((candidate, i) => [String(i), `${candidate.className ? candidate.className + '.' : ''}${candidate.name}(${candidate.parameters.map((p) => `${p.name}: ${p.type || '?'}`).join(', ')})`])];
        const selected = executionDraft.function?.sourceIndex ?? -1;
        setup.append(select(candidates, selected < 0 ? '' : String(selected), (value) => { executionDraft.function = value === '' ? null : structuredClone(analysis.candidates[Number(value)]); render(); }, '함수 후보'));
        setup.append(node('small', analysis.note || '후보를 확인하세요.'));
        const fn = executionDraft.function;
        if (!fn) setup.append(node('p', '모호한 후보는 자동 선택하지 않습니다. 후보가 없으면 현재 지원하지 않는 선언 형식인지 확인하세요.', 'error'));
        else {
          if (fn.unsupportedReason) setup.append(node('p', fn.unsupportedReason, 'error'));
          field(setup, '함수/메서드 이름', fn.name, (value) => { fn.name = value; }, false, true);
          if (state.activeLanguage !== 'python') {
            field(setup, '클래스 이름', fn.className, (value) => { fn.className = value; }, false, true);
            setup.append(select([['static', 'static 메서드'], ['instance', '인자 없는 생성자의 인스턴스 메서드']], fn.isStatic ? 'static' : 'instance', (value) => { fn.isStatic = value === 'static'; }, '메서드 호출 방식'));
          }
          const types = ['', 'int', 'long', 'double', 'bool', 'string', 'int[]', 'long[]', 'double[]', 'bool[]', 'string[]'].map((type) => [type, type || '타입 확인 필요']);
          fn.parameters.forEach((parameter, index) => {
            const item = node('div', undefined, 'card');
            field(item, `인자 ${index + 1} 이름`, parameter.name, (value) => { parameter.name = value; }, false, true);
            item.append(select(types, parameter.type, (value) => { parameter.type = value; }, `인자 ${index + 1} 자료형`)); setup.append(item);
          });
          setup.append(node('label', '반환 자료형'), select(types, fn.returnType, (value) => { fn.returnType = value; }, '반환 자료형'));
          setup.append(node('small', 'int는 32비트, long은 ±9,007,199,254,740,991 범위입니다. 1차원 배열만 지원하며 실수는 오차 허용 없이 비교합니다.'));
        }
      }
      const confirm = button('이 호출 규격과 등록 예제를 확인', () => send('confirmExecution', { execution: executionDraft, sourceHash: analysis.hash, targetPath: state.activeFileId }));
      confirm.disabled = state.running || state.busy || Boolean(analysis.reason); setup.append(confirm); app.append(setup);
    }
    const run = button('모든 예제 실행', () => send('runExamples')); run.id = 'run-examples'; run.disabled = !state.runnerAvailable || state.running || state.busy || draftChanged();
    const stop = button('실행 중지', () => send('stopExamples'), true); stop.disabled = !state.running;
    app.append(row(run, stop));
    if (!state.runnerAvailable) app.append(node('p', '런타임과 현재 코드의 호출 규격을 확인하면 실행할 수 있습니다.', 'muted'));
    app.append(node('small', '컴파일 10초 · 예제당 3초 · 출력 합계 64KB · 전체프로그램: CRLF/마지막 줄바꿈 1개 정규화 · 함수: JSON 값/배열 순서 비교'));
    const labels = { passed: '통과', failed: '출력 불일치', error: '실행 오류', timeout: '시간 초과', 'output-limit': '출력 초과', stopped: '중지', 'termination-error': '프로세스 종료 확인 실패' };
    (state.results || []).forEach((result, index) => {
      const card = node('article', undefined, 'card'); card.append(node('h2', `${result.stage === 'compile' ? '컴파일' : `예제 ${index + 1}`} · ${labels[result.status]}`, result.status));
      const grid = node('div', undefined, 'grid');
      for (const [label, value] of [['입력', result.input], ['기대 출력', result.expectedOutput], ['실제 출력', result.actualOutput], ['오류', result.stderr]]) {
        const cell = node('div'); cell.append(node('small', label), node('pre', value)); grid.append(cell);
      }
      card.append(grid); app.append(card);
      if (result.stdout) card.append(node('small', '함수 실행 중 출력(반환값과 별도)'), node('pre', result.stdout));
    });
    const attach = button('실패 결과를 질문에 첨부', () => send('attachFailures'), true); attach.disabled = state.running || !state.results?.some((result) => result.status !== 'passed'); app.append(attach);
  }
  function render() {
    const focused = document.activeElement?.id;
    const selection = focused === 'question' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    app.replaceChildren();
    ({ problem: renderProblem, chat: renderChat, results: renderResults })[kind]();
    document.querySelector('#error').textContent = state.error || '';
    if (selection) { const input = document.querySelector('#question'); input.focus(); input.setSelectionRange(...selection); }
  }
  window.addEventListener('message', (event) => {
    if (event.data.type !== 'state') return;
    const previous = state; state = event.data;
    if (kind === 'problem' && !app.hasChildNodes() && !draft && state.draft) {
      draft = state.draft.problem; newProblem = state.draft.newProblem; editing = true; draftDirty = true;
    }
    if (editing && previous.problemSaved !== undefined && state.problemSaved !== previous.problemSaved) { editing = false; draftDirty = false; persist(); }
    if (state.session?.messages.length > (previous.session?.messages.length || 0)) { question = ''; persist(); }
    if (kind === 'problem' && editing && app.hasChildNodes()) { document.querySelector('#error').textContent = state.error || ''; return; }
    render();
  });
  send('ready');
})();
