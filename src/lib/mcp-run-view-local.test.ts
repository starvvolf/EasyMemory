import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { getMcpRunView, listMcpRunViews } from "./mcp-run-view.ts";

test("a requestless local run is listed only with a registered PDF whose actual SHA matches", async () => {
  const previousDirectory = process.cwd();
  const previousDataDirectory = process.env.STUDY_FORGE_DATA_DIR;
  const temporary = await mkdtemp(path.join(tmpdir(), "recaller-requestless-run-"));
  try {
    process.chdir(temporary);
    delete process.env.STUDY_FORGE_DATA_DIR;
    const data = path.join(temporary, ".study-forge-data");
    const sourceDirectory = path.join(data, "mcp-sources");
    const runDirectory = path.join(data, "mcp", "chatgpt-runs");
    await Promise.all([mkdir(sourceDirectory, { recursive: true }), mkdir(runDirectory, { recursive: true })]);
    const pdf = Buffer.from("%PDF-1.4\nlocal test source\n");
    const sha256 = createHash("sha256").update(pdf).digest("hex");
    const sourceId = `src_${sha256}`;
    const sourceFileName = "study.pdf";
    await writeFile(path.join(sourceDirectory, `${sourceId}.pdf`), pdf);
    await writeFile(path.join(sourceDirectory, `${sourceId}.json`), JSON.stringify({
      id: sourceId, fileName: sourceFileName, pageCount: 2, sha256, createdAt: "2026-09-28T00:00:00.000Z",
    }));
    const run = (id: string, fileSha256 = sha256) => ({
      id, engine: "chatgpt-mcp", createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T01:00:00.000Z",
      config: { title: id, files: [{ fileName: sourceFileName, pageCount: 2, sourceId, sha256: fileSha256 }] },
      artifacts: { analyze: { sourceOutline: { nodes: [] } } },
    });
    const acceptedId = "chatgpt-request-accepted";
    const rejectedId = "chatgpt-request-bad-sha";
    const brokenId = "chatgpt-request-broken";
    await Promise.all([acceptedId, rejectedId, brokenId].map((id) => mkdir(path.join(runDirectory, id))));
    await Promise.all([
      writeFile(path.join(runDirectory, acceptedId, "run.json"), JSON.stringify(run(acceptedId))),
      writeFile(path.join(runDirectory, rejectedId, "run.json"), JSON.stringify(run(rejectedId, "0".repeat(64)))),
      writeFile(path.join(runDirectory, brokenId, "run.json"), "{broken"),
    ]);

    const listed = await listMcpRunViews();
    assert.deepEqual(listed.filter((item) => item.kind === "mcp-pipeline").map((item) => item.id), [`mcp:${acceptedId}`]);
    assert.equal(listed[0].requestRecordStatus, "not-recorded");
    assert.equal((await getMcpRunView(`mcp:${acceptedId}`))?.source.root, "local-data");
    assert.equal(await getMcpRunView(`mcp:${rejectedId}`), null);
    assert.equal(await getMcpRunView(`mcp:${brokenId}`), null);
    assert.equal(await getMcpRunView("mcp:../outside"), null);

    await writeFile(path.join(sourceDirectory, `${sourceId}.pdf`), Buffer.from("%PDF-1.4\nchanged\n"));
    assert.equal(await getMcpRunView(`mcp:${acceptedId}`), null);
    assert.equal((await readFile(path.join(runDirectory, acceptedId, "run.json"), "utf8")).length > 0, true);
  } finally {
    process.chdir(previousDirectory);
    if (previousDataDirectory === undefined) delete process.env.STUDY_FORGE_DATA_DIR;
    else process.env.STUDY_FORGE_DATA_DIR = previousDataDirectory;
    await rm(temporary, { recursive: true, force: true });
  }
});
