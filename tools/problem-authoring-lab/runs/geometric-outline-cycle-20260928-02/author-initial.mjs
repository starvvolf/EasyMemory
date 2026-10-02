import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runDirectory = path.dirname(fileURLToPath(import.meta.url));
const packet = JSON.parse(await readFile(path.resolve(runDirectory, '../geometric-authoring-prototype/source-packet.json'), 'utf8'));
const sources = Object.fromEntries(packet.items.map((item) => [item.learningUnitId, item]));
const frame = (y, height) => ({ x: 55, y, width: 650, height });

function choiceQuestion({ id, unit, heading, context, math, options, correct, explanation, columns = 2, optionHeight = 175 }) {
  const responseId = `r-${id}`;
  const blocks = [{ id: `${id}-heading`, kind: 'text', frame: frame(40, 72), style: 'heading', text: heading }];
  let nextY = 126;
  if (context) {
    blocks.push({ id: `${id}-context`, kind: 'box', frame: frame(nextY, 68), label: context, tone: 'accent' });
    nextY += 82;
  }
  if (math) {
    blocks.push({ id: `${id}-math`, kind: 'math', frame: frame(nextY, 104), latex: math, displayMode: true });
    nextY += 120;
  }
  blocks.push({ id: `${id}-choices`, kind: 'choice-set', frame: frame(nextY, optionHeight), responseId, optionIds: options.map((option) => option.id), columns });
  nextY += optionHeight + 18;
  blocks.push({ id: `${id}-reveal`, kind: 'answer-reveal', frame: frame(nextY, 66), responseIds: [responseId], title: '정답과 풀이' });
  return {
    id,
    source: sources[unit],
    page: { width: 760, height: nextY + 75 },
    blocks,
    responses: [{ id: responseId, kind: 'single-choice', grading: 'exact', correctOptionId: correct, options, explanation }],
  };
}

function shortQuestion({ id, unit, heading, context, promptBefore, promptAfter, acceptedAnswers, explanation }) {
  const responseId = `r-${id}`;
  return {
    id,
    source: sources[unit],
    page: { width: 760, height: 390 },
    blocks: [
      { id: `${id}-heading`, kind: 'text', frame: frame(40, 75), style: 'heading', text: heading },
      { id: `${id}-context`, kind: 'box', frame: frame(130, 65), label: context, tone: 'accent' },
      { id: `${id}-blank`, kind: 'blank', frame: frame(210, 66), responseId, promptBefore, promptAfter },
      { id: `${id}-reveal`, kind: 'answer-reveal', frame: frame(295, 70), responseIds: [responseId], title: '정답과 풀이' },
    ],
    responses: [{ id: responseId, kind: 'short-text', grading: 'exact-normalized', acceptedAnswers, explanation }],
  };
}

const document = {
  schemaVersion: 'problem-authoring-v1',
  id: 'geometric-outline-cycle-20260928-02-v0',
  title: '기하 변환 · 원문 하위목차 8개 핵심 확인',
  sharedSets: [],
  questions: [
    shortQuestion({
      id: 'q-outline-3-translation', unit: 'mcp-learning-1',
      heading: '평행이동 뒤 점의 좌표를 구하시오.',
      context: '점 P=(−4,2)를 x축 방향으로 +7, y축 방향으로 −5만큼 옮긴다.',
      promptBefore: '이동한 점 P′는', promptAfter: '이다. 좌표쌍으로 쓰시오.',
      acceptedAnswers: ['(3,−3)', '3,−3'],
      explanation: '평행이동은 각 좌표에 대응하는 변위를 더한다. −4+7=3, 2−5=−3이므로 P′=(3,−3). PDF 2쪽.',
    }),
    choiceQuestion({
      id: 'q-outline-4-rotation', unit: 'mcp-learning-2',
      heading: '점 (3,−2)을 원점 기준 양의 90° 회전하면 어디에 놓이는가?',
      context: '양의 각도는 반시계 방향이다. 점의 부호와 좌표 순서를 함께 판단하시오.',
      options: [
        { id: 'rot-a', text: '(−2,−3)' },
        { id: 'rot-b', text: '(2,3)' },
        { id: 'rot-c', text: '(−3,2)' },
        { id: 'rot-d', text: '(2,−3)' },
      ], correct: 'rot-b',
      explanation: '원점 기준 양의 90°는 (x,y)→(−y,x)이므로 (3,−2)→(2,3)이다. PDF 3쪽.',
    }),
    choiceQuestion({
      id: 'q-outline-5-scaling', unit: 'mcp-learning-3',
      heading: '축별 확대축소 뒤 좌표와 균일 여부를 모두 맞힌 것은?',
      context: '점 P=(−2,4)에 sx=2, sy=1/2를 적용한다.',
      options: [
        { id: 'scale-a', text: 'P′=(−4,2), 균일 확대축소' },
        { id: 'scale-b', text: 'P′=(−1,8), 비균일 확대축소' },
        { id: 'scale-c', text: 'P′=(−4,2), 비균일 확대축소' },
        { id: 'scale-d', text: 'P′=(4,−2), 비균일 확대축소' },
      ], correct: 'scale-c',
      explanation: 'x에는 2, y에는 1/2를 곱해 P′=(−4,2)이다. sx≠sy이므로 균일하지 않다. PDF 4쪽.',
    }),
    choiceQuestion({
      id: 'q-outline-7-general-matrix', unit: 'mcp-learning-6',
      heading: '일반 변환식에서 M1과 M2의 역할을 옳게 구별한 것은?',
      math: "P'=M_1P+M_2",
      options: [
        { id: 'general-a', text: 'M1은 평행이동 두 성분, M2는 곱셈 계수의 2×2 행렬이다.' },
        { id: 'general-b', text: 'M1은 곱셈 계수의 2×2 행렬, M2는 평행이동 두 성분이다.' },
        { id: 'general-c', text: 'M1은 변환 전 좌표, M2는 변환 후 좌표이다.' },
        { id: 'general-d', text: 'M1은 평행이동만, M2는 회전과 확대축소만 표현한다.' },
      ], correct: 'general-b', optionHeight: 220,
      explanation: 'M1은 P에 곱해지는 2×2 계수 행렬이고 M2는 더해지는 두 성분의 평행이동 항이다. PDF 5쪽.',
    }),
    choiceQuestion({
      id: 'q-outline-8-homogeneous', unit: 'mcp-learning-4',
      heading: '동차좌표 H=(18,−12,6)에서 원래 평면 좌표와 h≠0인 이유를 함께 맞힌 것은?',
      options: [
        { id: 'hom-a', text: 'P=(3,−2); h=0이면 h로 나눌 수 없다.' },
        { id: 'hom-b', text: 'P=(3,−2); h=0이어도 같은 좌표를 복원한다.' },
        { id: 'hom-c', text: 'P=(108,−72); h=0이면 h로 나눌 수 없다.' },
        { id: 'hom-d', text: 'P=(3,2); h=0이면 h로 나눌 수 없다.' },
      ], correct: 'hom-a', optionHeight: 185,
      explanation: 'x=18/6=3, y=−12/6=−2이다. 이 복원은 h로 나누므로 h는 0이 아니어야 한다. PDF 6쪽.',
    }),
    choiceQuestion({
      id: 'q-outline-9-translation-matrix', unit: 'mcp-learning-5',
      heading: '변위 (tx,ty)=(−3,4)를 나타내는 3×3 평행이동 행렬은?',
      context: '열벡터 (x,y,1)에 왼쪽에서 행렬을 곱하는 표기다.',
      options: [
        { id: 'tm-a', latex: 'T=\\begin{bmatrix}1&0&-3\\\\0&1&4\\\\0&0&1\\end{bmatrix}' },
        { id: 'tm-b', latex: 'T=\\begin{bmatrix}1&0&0\\\\0&1&0\\\\-3&4&1\\end{bmatrix}' },
        { id: 'tm-c', latex: 'T=\\begin{bmatrix}1&0&4\\\\0&1&-3\\\\0&0&1\\end{bmatrix}' },
        { id: 'tm-d', latex: 'T=\\begin{bmatrix}-3&0&0\\\\0&4&0\\\\0&0&1\\end{bmatrix}' },
      ], correct: 'tm-a', columns: 1, optionHeight: 400,
      explanation: '평행이동 행렬의 첫째·둘째 행 셋째 열에 tx,ty가 들어간다. 따라서 각각 −3,4다. PDF 7쪽.',
    }),
    choiceQuestion({
      id: 'q-outline-10-rotation-matrix', unit: 'mcp-learning-2',
      heading: '원점 기준 양의 90° 회전을 나타내는 3×3 행렬은?',
      context: '평행이동 없이 동차좌표 열벡터 (x,y,1)에 작용한다.',
      options: [
        { id: 'rm-a', latex: 'R=\\begin{bmatrix}0&1&0\\\\-1&0&0\\\\0&0&1\\end{bmatrix}' },
        { id: 'rm-b', latex: 'R=\\begin{bmatrix}-1&0&0\\\\0&-1&0\\\\0&0&1\\end{bmatrix}' },
        { id: 'rm-c', latex: 'R=\\begin{bmatrix}0&-1&0\\\\1&0&0\\\\0&0&1\\end{bmatrix}' },
        { id: 'rm-d', latex: 'R=\\begin{bmatrix}0&-1&1\\\\1&0&0\\\\0&0&1\\end{bmatrix}' },
      ], correct: 'rm-c', columns: 1, optionHeight: 400,
      explanation: 'R(θ)의 왼쪽 위는 [cosθ,−sinθ; sinθ,cosθ]이다. θ=90°이면 [0,−1;1,0]이고 평행이동 열은 0이다. PDF 7쪽.',
    }),
    choiceQuestion({
      id: 'q-outline-11-scaling-matrix', unit: 'mcp-learning-3',
      heading: '주어진 3×3 확대축소 행렬이 평면의 점에 미치는 효과는?',
      math: 'S=\\begin{bmatrix}\\tfrac{1}{2}&0&0\\\\0&2&0\\\\0&0&1\\end{bmatrix}',
      options: [
        { id: 'sm-a', text: 'x는 절반, y는 두 배가 되고 비균일하다.' },
        { id: 'sm-b', text: 'x는 절반, y는 두 배가 되고 균일하다.' },
        { id: 'sm-c', text: 'x는 두 배, y는 절반이 되고 비균일하다.' },
        { id: 'sm-d', text: 'x는 절반, y는 두 배가 되며 평행이동도 있다.' },
      ], correct: 'sm-a', optionHeight: 190,
      explanation: '대각의 sx=1/2, sy=2가 각 축에 곱해진다. 두 계수가 다르고 셋째 열 평행이동 항이 0이므로 비균일 확대축소만 있다. PDF 7쪽.',
    }),
  ],
};

await writeFile(path.join(runDirectory, 'initial-document.json'), JSON.stringify(document, null, 2));
process.stdout.write(JSON.stringify({ documentId: document.id, questionIds: document.questions.map((question) => question.id) }, null, 2));
