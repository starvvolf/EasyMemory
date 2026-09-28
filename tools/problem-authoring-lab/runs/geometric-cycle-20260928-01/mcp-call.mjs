import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const runDirectory = path.dirname(fileURLToPath(import.meta.url));
const labRoot = path.resolve(runDirectory, '../..');
const workspace = path.resolve(labRoot, '../..');
const [toolName, argsFile, outputFile] = process.argv.slice(2);
if (!toolName || !argsFile || !outputFile) throw new Error('Expected <tool> <args.json> <output.json>');
const args = JSON.parse(await readFile(path.resolve(runDirectory, argsFile), 'utf8'));
const client = new Client({ name: 'geometric-cycle-evaluation', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', path.join(labRoot, 'mcp-server.ts')], cwd: workspace });
try {
  await client.connect(transport);
  const result = await client.callTool({ name: toolName, arguments: args });
  await writeFile(path.resolve(runDirectory, outputFile), JSON.stringify(result, null, 2));
  const structured = result.structuredContent ?? {};
  const summary = toolName === 'render_problem_preview'
    ? Object.fromEntries(Object.entries(structured).map(([key, value]) => [key, String(value).length]))
    : toolName === 'load_source_packet'
      ? { inputHash: structured.inputHash, items: structured.packet?.items?.length }
      : toolName === 'get_authoring_instructions'
        ? { skillVersion: structured.skillVersion, skillHash: structured.skillHash, referenceHashes: structured.referenceHashes }
        : toolName === 'apply_problem_patch'
          ? { issues: structured.issues, documentId: structured.document?.id }
          : structured;
  process.stdout.write(JSON.stringify({ toolName, isError: result.isError ?? false, summary }, null, 2));
} finally {
  await client.close();
}
