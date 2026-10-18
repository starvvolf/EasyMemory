import { readFile, writeFile } from 'node:fs/promises';

const directory = new URL('./', import.meta.url);
const preview = JSON.parse(await readFile(new URL('render-output.json', directory), 'utf8')).structuredContent;
for (const [key, name] of [
  ['beforeAnswerHtml', 'preview-before.html'],
  ['afterAnswerHtml', 'preview-after.html'],
  ['interactiveHtml', 'preview-interactive.html'],
]) await writeFile(new URL(name, directory), preview[key]);
