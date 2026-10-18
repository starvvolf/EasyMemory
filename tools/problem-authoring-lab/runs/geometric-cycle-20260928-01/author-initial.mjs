import { readFile, writeFile } from 'node:fs/promises';

const directory = new URL('./', import.meta.url);
const { packet } = JSON.parse(await readFile(new URL('load-output.json', directory), 'utf8')).structuredContent;
const source = (index) => packet.items[index];
const frame = (x, y, width, height) => ({ x, y, width, height });
const text = (id, content, x, y, width, height, style = 'body') => ({ id, kind: 'text', frame: frame(x, y, width, height), style, text: content });
const box = (id, label, x, y, width, height, tone = 'accent') => ({ id, kind: 'box', frame: frame(x, y, width, height), label, tone });
const choice = (id, responseId, optionIds, y, height, columns = 2) => ({ id, kind: 'choice-set', frame: frame(55, y, 650, height), responseId, optionIds, columns });
const blank = (id, responseId, before, after, y) => ({ id, kind: 'blank', frame: frame(55, y, 650, 55), responseId, promptBefore: before, promptAfter: after });
const reveal = (id, responseId, y, height = 58) => ({ id, kind: 'answer-reveal', frame: frame(55, y, 650, height), responseIds: [responseId], title: '정답과 풀이' });

const document = {
  schemaVersion: 'problem-authoring-v1',
  id: 'geometric-cycle-20260928-01-initial',
  title: '기하변환 · 좌표가 움직이는 두 단계',
  sharedSets: [{
    id: 'set-two-vertices', source: source(1), page: { width: 760, height: 235 },
    blocks: [
      text('set-heading', '공통 자료 | 두 꼭짓점의 연속 변환', 55, 37, 650, 45, 'heading'),
      { id: 'set-points', kind: 'table', frame: frame(55, 92, 270, 105), headerRows: 1, rows: [['점', 'x', 'y'], ['A', '−2', '1'], ['B', '1', '1']] },
      box('set-transform', '두 점에 같은 변환을 순서대로 적용한다.\n① T=(3,2)만큼 평행이동\n② 원점 기준 양의 90° 회전', 345, 92, 360, 105),
    ],
  }],
  questions: [
    {
      id: 'q-scale-two-points', source: source(2), page: { width: 760, height: 567 },
      blocks: [
        text('q1-heading', '서로 다른 두 점에 같은 확대축소 행렬을 적용했다. 두 결과와 균일 여부를 모두 맞힌 것은?', 55, 43, 650, 64, 'heading'),
        { id: 'q1-matrix', kind: 'math', frame: frame(55, 115, 650, 77), latex: 'S=\\begin{bmatrix}2&0&0\\\\0&3&0\\\\0&0&1\\end{bmatrix}', displayMode: true },
        box('q1-points', '원래 점 A=(1,−1), B=(3,1). 두 점에 각각 S를 적용한다.', 55, 205, 650, 62),
        text('q1-task', '결과 좌표 A′, B′와 균일 확대축소 여부를 판단하시오.', 55, 284, 650, 46),
        choice('q1-options', 'r-scale-two-points', ['q1-a', 'q1-b', 'q1-c', 'q1-d'], 345, 145),
        reveal('q1-reveal', 'r-scale-two-points', 504, 55),
      ],
      responses: [{
        id: 'r-scale-two-points', kind: 'single-choice', grading: 'exact', correctOptionId: 'q1-c',
        options: [
          { id: 'q1-a', text: 'A′=(3,−2), B′=(9,2), 균일하지 않음' },
          { id: 'q1-b', text: 'A′=(2,−3), B′=(6,3), 균일함' },
          { id: 'q1-c', text: 'A′=(2,−3), B′=(6,3), 균일하지 않음' },
          { id: 'q1-d', text: 'A′=(2,−3), B′=(6,−3), 균일하지 않음' },
        ],
        explanation: 'x에는 2, y에는 3을 곱한다. 따라서 A′=(2,−3), B′=(6,3)이고 sx≠sy이므로 균일 확대축소가 아니다. PDF 4·7쪽.',
      }],
    },
    {
      id: 'q-homogeneous-reverse', source: source(3), page: { width: 760, height: 311 },
      blocks: [
        text('q2-heading', '평면 점을 지정된 h의 동차좌표로 나타내시오.', 55, 43, 650, 52, 'heading'),
        box('q2-context', '평면 점 P=(−3,5)이고 동차좌표의 세 번째 성분 h=4이다.', 55, 109, 650, 61),
        blank('q2-input', 'r-homogeneous-reverse', '첫 두 성분 (xh,yh)는', '이다. 좌표쌍으로 쓰시오.', 184),
        reveal('q2-reveal', 'r-homogeneous-reverse', 253, 55),
      ],
      responses: [{
        id: 'r-homogeneous-reverse', kind: 'short-text', acceptedAnswers: ['(−12,20)', '−12,20'], grading: 'exact-normalized',
        explanation: 'x=xh/h, y=yh/h이므로 xh=−3×4=−12, yh=5×4=20이다. PDF 6쪽.',
      }],
    },
    {
      id: 'q-set-translate-a', source: source(0), sharedSetId: 'set-two-vertices', page: { width: 760, height: 287 },
      blocks: [
        text('q3-heading', '첫 단계인 평행이동을 마친 직후, 꼭짓점 A의 좌표는?', 55, 44, 650, 69, 'heading'),
        blank('q3-input', 'r-set-translate-a', '평행이동 후 A′는', '이다. 좌표쌍으로 쓰시오.', 133),
        reveal('q3-reveal', 'r-set-translate-a', 207, 63),
      ],
      responses: [{
        id: 'r-set-translate-a', kind: 'short-text', acceptedAnswers: ['(1,3)', '1,3'], grading: 'exact-normalized',
        explanation: 'A=(−2,1)에 T=(3,2)를 더하면 A′=(1,3)이다. PDF 2쪽.',
      }],
    },
    {
      id: 'q-set-final-b', source: source(1), sharedSetId: 'set-two-vertices', page: { width: 760, height: 397 },
      blocks: [
        text('q4-heading', '꼭짓점 B에 두 단계를 모두 적용한 최종 좌표는?', 55, 44, 650, 63, 'heading'),
        box('q4-order', 'B를 먼저 평행이동한 뒤, 그 결과를 원점 기준 양의 90° 회전한다.', 55, 113, 650, 63, 'plain'),
        choice('q4-options', 'r-set-final-b', ['q4-a', 'q4-b', 'q4-c', 'q4-d'], 192, 133),
        reveal('q4-reveal', 'r-set-final-b', 341, 54),
      ],
      responses: [{
        id: 'r-set-final-b', kind: 'single-choice', grading: 'exact', correctOptionId: 'q4-b',
        options: [
          { id: 'q4-a', text: '(3,4)' },
          { id: 'q4-b', text: '(−3,4)' },
          { id: 'q4-c', text: '(4,3)' },
          { id: 'q4-d', text: '(2,3)' },
        ],
        explanation: 'B=(1,1)→평행이동 후 (4,3)→양의 90° 회전 후 (−3,4)이다. PDF 2·3·7쪽.',
      }],
    },
  ],
};

await writeFile(new URL('initial-document.json', directory), JSON.stringify(document, null, 2));
await writeFile(new URL('validate-args.json', directory), JSON.stringify({ document, packetPath: 'runs/geometric-authoring-prototype/source-packet.json' }, null, 2));
await writeFile(new URL('render-args.json', directory), JSON.stringify({ document }, null, 2));
