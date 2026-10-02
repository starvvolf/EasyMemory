import { readFile, writeFile } from 'node:fs/promises';

const directory = new URL('./', import.meta.url);
const { packet } = (JSON.parse(await readFile(new URL('load-output.json', directory), 'utf8'))).structuredContent;
const source = (index) => packet.items[index];
const frame = (x, y, width, height) => ({ x, y, width, height });
const text = (id, value, x, y, width, height, style = 'body') => ({ id, kind: 'text', frame: frame(x, y, width, height), style, text: value });
const box = (id, value, x, y, width, height, tone = 'accent') => ({ id, kind: 'box', frame: frame(x, y, width, height), tone, label: value });
const reveal = (id, responseId, y, height = 65) => ({ id, kind: 'answer-reveal', frame: frame(55, y, 650, height), responseIds: [responseId], title: '정답과 풀이' });
const choices = (id, responseId, optionIds, y, height) => ({ id, kind: 'choice-set', frame: frame(55, y, 650, height), responseId, optionIds, columns: 1 });
const blank = (id, responseId, before, after, y) => ({ id, kind: 'blank', frame: frame(55, y, 650, 55), responseId, promptBefore: before, promptAfter: after });

const document = {
  schemaVersion: 'problem-authoring-v1',
  id: 'geometric-authoring-20260928-sol-medium',
  title: '기하변환 · 2차원 좌표와 행렬 적용',
  sharedSets: [{
    id: 'set-turn-then-shift',
    source: source(1),
    page: { width: 760, height: 235 },
    blocks: [
      text('set-title', '공통 자료 | 한 점에 두 변환을 순서대로 적용', 55, 36, 650, 43, 'heading'),
      box('set-data', '처음 점 P=(4,1)을 원점 기준 양의 90° 회전한 뒤, 3×3 평행이동 행렬 T를 적용한다. 최종 점은 Q=(−4,6)이다. 아래 두 문항은 이 같은 변환 과정을 사용한다.', 55, 92, 650, 104),
    ],
  }],
  questions: [
    {
      id: 'q-matrix-roles', source: source(5), page: { width: 760, height: 415 },
      blocks: [
        text('q1-stem', 'P′=M1·P+M2의 두 항과 결과 좌표를 모두 옳게 설명한 것은?', 55, 42, 650, 62, 'heading'),
        box('q1-data', 'P=(1,2), M1=[2 0; 0 3], M2=(−4,1)', 55, 113, 650, 55),
        choices('q1-choices', 'r-matrix-roles', ['q1-a', 'q1-b', 'q1-c', 'q1-d'], 185, 153),
        reveal('q1-reveal', 'r-matrix-roles', 353, 54),
      ],
      responses: [{
        id: 'r-matrix-roles', kind: 'single-choice', grading: 'exact', correctOptionId: 'q1-d',
        options: [
          { id: 'q1-a', text: 'M1P=(2,6), M2는 확대축소 항, P′=(−2,7)' },
          { id: 'q1-b', text: 'M1P=(−4,1), M2는 평행이동 항, P′=(−2,7)' },
          { id: 'q1-c', text: 'M1P=(2,6), M2는 평행이동 항, P′=(6,5)' },
          { id: 'q1-d', text: 'M1P=(2,6), M2는 평행이동 항, P′=(−2,7)' },
        ],
        explanation: 'M1은 좌표에 곱하는 2×2 행렬이므로 M1P=(2,6)이다. M2는 더하는 평행이동 항이어서 P′=(2,6)+(−4,1)=(−2,7)이다. PDF 5쪽.',
      }],
    },
    {
      id: 'q-homogeneous', source: source(3), page: { width: 760, height: 302 },
      blocks: [
        text('q2-stem', '동차좌표를 평면 좌표로 복원하시오.', 55, 43, 650, 48, 'heading'),
        box('q2-data', '동차좌표 (xh,yh,h)=(−12,18,3), h≠0', 55, 105, 650, 55),
        blank('q2-blank', 'r-homogeneous', '평면 좌표 (x,y)는', '이다. 좌표쌍으로 쓰시오.', 177),
        reveal('q2-reveal', 'r-homogeneous', 244, 50),
      ],
      responses: [{
        id: 'r-homogeneous', kind: 'short-text', acceptedAnswers: ['(−4,6)'], grading: 'exact-normalized',
        explanation: 'x=−12/3=−4, y=18/3=6이다. PDF 6쪽.',
      }],
    },
    {
      id: 'q-set-rotation', source: source(1), sharedSetId: 'set-turn-then-shift', page: { width: 760, height: 280 },
      blocks: [
        text('q3-stem', '첫 번째 변환인 양의 90° 회전을 마친 직후 점의 좌표는?', 55, 44, 650, 70, 'heading'),
        blank('q3-blank', 'r-set-rotation', '회전 직후 점은', '이다. 좌표쌍으로 쓰시오.', 129),
        reveal('q3-reveal', 'r-set-rotation', 202, 66),
      ],
      responses: [{
        id: 'r-set-rotation', kind: 'short-text', acceptedAnswers: ['(−1,4)'], grading: 'exact-normalized',
        explanation: '원점 기준 양의 90° 회전은 (x,y)→(−y,x)이므로 (4,1)→(−1,4)이다. PDF 3·7쪽.',
      }],
    },
    {
      id: 'q-set-translation-matrix', source: source(4), sharedSetId: 'set-turn-then-shift', page: { width: 760, height: 400 },
      blocks: [
        text('q4-stem', '회전 직후 점을 최종 점 Q로 옮기는 평행이동 행렬 T는?', 55, 42, 650, 66, 'heading'),
        box('q4-reminder', '행렬의 행은 세미콜론(;)으로 구분했다. T는 동차좌표 (x,y,1)에 왼쪽에서 곱한다.', 55, 111, 650, 64, 'plain'),
        choices('q4-choices', 'r-set-translation-matrix', ['q4-a', 'q4-b', 'q4-c', 'q4-d'], 190, 137),
        reveal('q4-reveal', 'r-set-translation-matrix', 344, 54),
      ],
      responses: [{
        id: 'r-set-translation-matrix', kind: 'single-choice', grading: 'exact', correctOptionId: 'q4-b',
        options: [
          { id: 'q4-a', text: '[1 0 3; 0 1 −2; 0 0 1]' },
          { id: 'q4-b', text: '[1 0 −3; 0 1 2; 0 0 1]' },
          { id: 'q4-c', text: '[1 0 0; 0 1 0; −3 2 1]' },
          { id: 'q4-d', text: '[1 0 2; 0 1 −3; 0 0 1]' },
        ],
        explanation: '회전 후 (−1,4)에서 Q=(−4,6)까지 변위는 (−3,2)다. tx,ty는 3×3 행렬의 첫째·둘째 행 셋째 열에 놓인다. PDF 7쪽.',
      }],
    },
  ],
};

await writeFile(new URL('draft-document.json', directory), JSON.stringify(document, null, 2));
await writeFile(new URL('validate-args.json', directory), JSON.stringify({ document, packetPath: 'runs/geometric-authoring-prototype/source-packet.json' }, null, 2));
await writeFile(new URL('format-override-args.json', directory), JSON.stringify({ document, packetPath: 'runs/geometric-authoring-prototype/source-packet.json', formatOverride: { 'q-matrix-roles': 'single-choice', 'q-homogeneous': 'short-text' } }, null, 2));
await writeFile(new URL('render-args.json', directory), JSON.stringify({ document }, null, 2));
await writeFile(new URL('record-0-args.json', directory), JSON.stringify({
  runId: 'geometric-authoring-prototype',
  iteration: 0,
  packetPath: 'runs/geometric-authoring-prototype/source-packet.json',
  document,
  issues: [],
  execution: {
    model: 'gpt-6-sol (medium)',
    sessionId: '01a06c91-acf6-76c1-93e6-41d40849d215',
    usage: { inputTokens: null, outputTokens: null, status: 'per-turn token telemetry not exposed to this evaluation task' },
    toolCalls: [
      'load_source_packet',
      'get_authoring_instructions(selection,recall-blank)',
      'validate_problem_document(packetPath)',
      'validate_problem_document(packetPath,formatOverride)',
      'render_problem_preview',
      'record_problem_iteration(iteration=0)',
    ],
  },
}, null, 2));
