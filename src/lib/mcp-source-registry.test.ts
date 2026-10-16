import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getRegisteredMcpSource, listRegisteredMcpSources, readRegisteredMcpSourcePdf, registerMcpSource } from "./mcp-source-registry.ts";

test("PDF bytes determine stable identity, pages and restart-safe storage", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "study-forge-mcp-source-"));
  process.env.STUDY_FORGE_DATA_DIR = folder;
  try {
    const firstBytes = await readFile(path.join(process.cwd(), "eval/corpus/user-test-pdfs/cornell-bfs-2pages.pdf"));
    const secondBytes = await readFile(path.join(process.cwd(), "eval/corpus/user-test-pdfs/dfs-bfs.pdf"));
    const first = await registerMcpSource("lesson.pdf", firstBytes);
    assert.equal(first.pageCount, 2);
    assert.deepEqual(await registerMcpSource("renamed.pdf", firstBytes), first);
    const second = await registerMcpSource("lesson.pdf", secondBytes);
    assert.notEqual(second.id, first.id);
    assert.equal((await listRegisteredMcpSources()).length, 2);
    assert.equal((await getRegisteredMcpSource(first.id))?.sha256, first.sha256);
    assert.deepEqual(await readRegisteredMcpSourcePdf(first.id), firstBytes);
    await assert.rejects(registerMcpSource("bad.pdf", Buffer.from("not a pdf")));
    await writeFile(path.join(folder, "mcp-sources", `${first.id}.pdf`), secondBytes);
    assert.equal(await getRegisteredMcpSource(first.id), null);
    await assert.rejects(registerMcpSource("lesson.pdf", firstBytes), { status: 409 });
  } finally {
    delete process.env.STUDY_FORGE_DATA_DIR;
    await rm(folder, { recursive: true, force: true });
  }
});
