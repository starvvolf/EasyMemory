/* eslint-disable @typescript-eslint/no-require-imports */
// Offline webview preview: synthetic problem/code only; no Codex or network bridge.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeSource } = require('../execution-contract');
const media = path.join(__dirname, '../media');
const theme = ':root{--vscode-foreground:#d8dbe3;--vscode-editor-background:#151922;--vscode-font-family:Arial,sans-serif;--vscode-descriptionForeground:#989fae;--vscode-input-background:#202634;--vscode-input-foreground:#eee;--vscode-panel-border:#343d4f;--vscode-button-background:#3565c5;--vscode-button-foreground:white;--vscode-button-secondaryBackground:#303a4c;--vscode-button-secondaryForeground:#eee;--vscode-focusBorder:#64a2ff;--vscode-errorForeground:#ff8c8c;--vscode-testing-iconPassed:#84d6aa;--vscode-textCodeBlock-background:#10141c;}';
const source = 'def solution(a: int, b: int) -> int:\n    return a+b\ndef helper(value: int) -> int:\n    return value\n';
const state = { type: 'state', sessions: [{ id: 'fixture', title: '두 수의 합 · 합성 문제' }],
  session: { id: 'fixture', problem: { title: '두 수의 합 · 합성 문제', text: '두 정수의 합을 반환하세요.', sourceUrl: '', images: [], examples: [{ input: '[1,2]', expectedOutput: '3' }] }, messages: [], codeSnapshots: [] },
  activeFile: 'fixture.py (모의 파일)', activeFileId: '/fixture/one.py', activeLanguage: 'python', executionAnalysis: analyzeSource('python', source), runtimeStatus: { available: true, version: 'Python · 모의 런타임 표시' },
  results: [], connection: '연결 전 · 오프라인 화면 검증', problemSaved: 0 };
const bridge = `window.acquireVsCodeApi=()=>({getState:()=>null,setState:()=>{},postMessage:(m)=>{window.parent.postMessage({preview:m},'*')}});`;
http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<html><head><title>Study Forge offline fixture</title><style>body{margin:0;background:#10141c;color:#ccc;font:14px Arial}header{padding:12px}main{display:grid;grid-template-columns:310px 1fr 390px;height:calc(100vh - 44px)}iframe{border:1px solid #303a4c;width:100%;height:100%;box-sizing:border-box}.center{display:grid;grid-template-rows:45% 55%}.editor{padding:20px;white-space:pre-wrap;font:15px/1.8 monospace}</style></head><body><header>Study Forge · 오프라인 화면 검증</header><main><iframe title="문제" src="/view?kind=problem"></iframe><div class="center"><div class="editor">main.py — 기본 코드 편집기 위치\n\na, b = map(int, input().split())\nprint(a + b)</div><iframe title="실행 결과" src="/view?kind=results"></iframe></div><iframe title="학습 대화" src="/view?kind=chat"></iframe></main><script>
let state=${JSON.stringify(state)}; const broadcast=()=>document.querySelectorAll('iframe').forEach(f=>f.contentWindow.postMessage(state,'*'));
for(const [label,change] of [['본문/주석 수정 fixture',()=>{state.executionAnalysis=${JSON.stringify(analyzeSource('python', source.replace('a+b', 'a-b') + '# comment'))};}],['호출 규격 수정 fixture',()=>{state.executionAnalysis=${JSON.stringify(analyzeSource('python', source.replace('a: int', 'a: str')))};state.runnerAvailable=false;state.executionConfirmed=false;}],['파일 교체 fixture',()=>{state.activeFileId='/fixture/two.py';state.runnerAvailable=false;state.executionConfirmed=false;}]]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{change();broadcast()};document.querySelector('header').append(b);}
addEventListener('message',e=>{const m=e.data.preview;if(!m)return;if(m.type==='createProblem'||m.type==='updateProblem'){state.session={id:'fixture',problem:m.problem,messages:[],updatedAt:Date.now()};state.sessions=[{id:'fixture',title:m.problem.title}];state.problemSaved++;}if(m.type==='confirmExecution'){state.session.execution=m.execution;state.runnerAvailable=true;state.executionConfirmed=true;}if(['login','status','question','runExamples'].includes(m.type))state.error='오프라인 미리보기입니다. 실제 연결/실행은 하지 않습니다.';broadcast()});</script></body></html>`);
  } else if (url.pathname === '/view') {
    const kind = ['problem', 'results', 'chat'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'problem';
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(fs.readFileSync(path.join(media, 'workspace.html'), 'utf8').replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, '').replaceAll('{{style}}', '/workspace.css').replaceAll('{{script}}', '/workspace.js').replaceAll('{{kind}}', kind).replace('<body', `<style>${theme}</style><script>${bridge}</script><body`));
  } else if (['/workspace.css', '/workspace.js'].includes(url.pathname)) {
    response.setHeader('Content-Type', url.pathname.endsWith('css') ? 'text/css' : 'application/javascript'); response.end(fs.readFileSync(path.join(media, url.pathname.slice(1))));
  } else { response.statusCode = 404; response.end(); }
}).listen(39127, '127.0.0.1', () => console.log('Offline fixture: http://127.0.0.1:39127'));
