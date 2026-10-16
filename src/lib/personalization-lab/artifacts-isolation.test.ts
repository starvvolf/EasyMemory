import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("a missing or changed artifact does not hide another valid artifact", async () => {
  const project = process.cwd();
  const previousDataDirectory = process.env.STUDY_FORGE_DATA_DIR;
  const temporary = await mkdtemp(path.join(tmpdir(), "recaller-artifact-isolation-"));
  const runs = path.join(temporary, "tools", "problem-authoring-lab", "runs");
  const packet = "geometric-authoring-prototype/source-packet.json";
  const first = "geometric-cycle-20260928-01/design-fix-1/document.json";
  const second = "geometric-outline-cycle-20260928-02/iteration-0/document.json";
  try {
    for (const relative of [packet, first, second]) {
      const target = path.join(runs, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(project, "tools", "problem-authoring-lab", "runs", relative), target);
    }
    delete process.env.STUDY_FORGE_DATA_DIR;
    process.chdir(temporary);
    // Node's test runner needs the same extension and server-only resolution as Next.
    type ResolveHook = (specifier: string, context: object, nextResolve: (specifier: string, context: object) => { url: string }) => { url: string; shortCircuit?: boolean };
    const { registerHooks } = await import("node:module") as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
        try { return nextResolve(specifier, context); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
            return nextResolve(`${specifier}.ts`, context);
          }
          throw error;
        }
      },
    });
    const { listArtifacts, loadArtifact } = await import("./artifacts.ts");
    const initial = await listArtifacts();
    assert.deepEqual(initial.map((item) => item.id), ["geometry-4-final", "geometry-8-outline"]);

    await rm(path.join(runs, first));
    assert.deepEqual((await listArtifacts()).map((item) => item.id), ["geometry-8-outline"]);
    await assert.rejects(loadArtifact("geometry-4-final"));

    const changed = path.join(runs, second);
    await writeFile(changed, `${await readFile(changed, "utf8")} `);
    assert.deepEqual((await listArtifacts()).map((item) => item.id), []);
    await assert.rejects(loadArtifact("geometry-8-outline"), /SHA-256/);
  } finally {
    process.chdir(project);
    if (previousDataDirectory === undefined) delete process.env.STUDY_FORGE_DATA_DIR;
    else process.env.STUDY_FORGE_DATA_DIR = previousDataDirectory;
    await rm(temporary, { recursive: true, force: true });
  }
});
