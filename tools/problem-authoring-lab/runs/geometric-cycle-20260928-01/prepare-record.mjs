import { readFile, writeFile } from 'node:fs/promises';

const directory = new URL('./', import.meta.url);
const document = JSON.parse(await readFile(new URL('initial-document.json', directory), 'utf8'));
const inspection = JSON.parse(await readFile(new URL('validate-output.json', directory), 'utf8')).structuredContent;
await writeFile(new URL('record-0-args.json', directory), JSON.stringify({
  runId: 'geometric-cycle-20260928-01', iteration: 0,
  packetPath: 'runs/geometric-authoring-prototype/source-packet.json',
  document, issues: inspection.issues,
  execution: {
    model: 'gpt-6-sol (medium)',
    sessionId: '01a06c91-acf6-76c1-93e6-41d40849d215',
    usage: { inputTokens: null, outputTokens: null, reason: 'current host does not expose per-turn token usage to this task' },
    toolCalls: ['load_source_packet', 'get_authoring_instructions(selection,recall-blank,graph-geometry)', 'validate_problem_document', 'render_problem_preview', 'record_problem_iteration(iteration=0)'],
  },
}, null, 2));
