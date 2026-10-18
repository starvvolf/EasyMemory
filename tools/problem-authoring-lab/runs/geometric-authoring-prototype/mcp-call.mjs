import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const labRoot = path.resolve(directory, '../..');
const workspace = path.resolve(labRoot, '../..');
const [toolName, argsFile, outputFile] = process.argv.slice(2);
if (!toolName || !argsFile || !outputFile) {
  throw new Error('Usage: node mcp-call.mjs <tool> <args.json> <output.json>');
}
const args = JSON.parse(await readFile(path.resolve(directory, argsFile), 'utf8'));
const client = new Client({ name: 'geometric-authoring-evaluation', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', path.join(labRoot, 'mcp-server.ts')],
  cwd: workspace,
});
try {
  await client.connect(transport);
  const response = await client.callTool({ name: toolName, arguments: args });
  await writeFile(path.resolve(directory, outputFile), JSON.stringify(response, null, 2));
  process.stdout.write(JSON.stringify({
    tool: toolName,
    isError: response.isError ?? false,
    output: path.resolve(directory, outputFile),
    summary: toolName === 'render_problem_preview'
      ? Object.fromEntries(Object.entries(response.structuredContent ?? {}).map(([key, value]) => [key, String(value).length]))
      : response.structuredContent,
  }, null, 2));
} finally {
  await client.close();
}
