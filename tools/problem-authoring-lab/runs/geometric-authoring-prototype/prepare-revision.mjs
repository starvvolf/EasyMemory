import { readFile, writeFile } from 'node:fs/promises';

const directory = new URL('./', import.meta.url);
const document = JSON.parse(await readFile(new URL('iteration-0/document.json', directory), 'utf8'));
const block = (questionId, blockId) => document.questions.find((item) => item.id === questionId).blocks.find((item) => item.id === blockId);
const patch = {
  instruction: '단일 열 4개 선지가 프레임 높이에 비해 길어 스크롤될 수 있으므로 두 문항의 선택지만 2열로 바꾼다. 질문, 보기, 정답 및 안정 ID는 유지한다.',
  operations: [
    { op: 'replace-block', questionId: 'q-matrix-roles', blockId: 'q1-choices', value: { ...block('q-matrix-roles', 'q1-choices'), columns: 2 } },
    { op: 'replace-block', questionId: 'q-set-translation-matrix', blockId: 'q4-choices', value: { ...block('q-set-translation-matrix', 'q4-choices'), columns: 2 } },
  ],
};
await writeFile(new URL('patch-1.json', directory), JSON.stringify(patch, null, 2));
await writeFile(new URL('apply-1-args.json', directory), JSON.stringify({ document, patch, packetPath: 'runs/geometric-authoring-prototype/source-packet.json' }, null, 2));
try {
  const revised = JSON.parse(await readFile(new URL('apply-1-output.json', directory), 'utf8')).structuredContent.document;
  await writeFile(new URL('validate-1-args.json', directory), JSON.stringify({ document: revised, packetPath: 'runs/geometric-authoring-prototype/source-packet.json' }, null, 2));
  await writeFile(new URL('render-1-args.json', directory), JSON.stringify({ document: revised }, null, 2));
  await writeFile(new URL('record-1-args.json', directory), JSON.stringify({
    runId: 'geometric-authoring-prototype', iteration: 1,
    packetPath: 'runs/geometric-authoring-prototype/source-packet.json',
    document: revised, issues: [], patch,
    execution: {
      model: 'gpt-6-sol (medium)',
      sessionId: '01a06c91-acf6-76c1-93e6-41d40849d215',
      usage: { inputTokens: null, outputTokens: null, status: 'per-turn token telemetry not exposed to this evaluation task' },
      toolCalls: ['apply_problem_patch', 'validate_problem_document(packetPath)', 'render_problem_preview', 'record_problem_iteration(iteration=1)'],
    },
  }, null, 2));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
