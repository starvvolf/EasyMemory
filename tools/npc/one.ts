// NPC 한 명 = 프로세스 하나(설계 10번). tools/npc/run.ts가 부른다: node --experimental-strip-types tools/npc/one.ts <job.json> [--replay <저장한 판>]
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { replayNpc, runNpc, type NpcJob } from "../../src/lib/npc/run-npc.ts";

const [jobFile, flag, saved] = process.argv.slice(2);
const job = JSON.parse(await readFile(jobFile, "utf8")) as NpcJob;
const log = (s: string) => console.log(`[${job.name}] ${s}`);
try {
  const score = flag === "--replay" && saved ? await replayNpc(saved, job, log) : await runNpc(job, log);
  log(`끝: ${score.played.end.verdict} · 길 ${score.played.end.route} · ${path.join(job.outDir, "report.md")}`);
  process.exit(0);
} catch (e) {
  await writeFile(path.join(job.outDir, "error.txt"), String((e as Error)?.stack ?? e), "utf8").catch(() => undefined);
  log(`실패: ${(e as Error)?.message ?? e}`);
  process.exit(1);
}
