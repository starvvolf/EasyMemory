// NPC 한 명 한 판(설계 10번): 자기 데이터 폴더 → 문제 넣기 → 연출가가 앱 기능을 부르며 풂 → 문제 한 장 · 총정리 · 빈틈 → 채점 → 결과 파일.
// tools/npc/run.ts가 NPC마다 프로세스 하나로 부른다(tools/npc/one.ts). 다시 쓰기(--replay)는 저장한 판(데이터 폴더 · 정답지)에서 뒤 단계만.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterSolve, appDriver, collectRecord, setupProblem, usageOf, switchDataDir } from "./algo-driver.ts";
import { play } from "./director.ts";
import { installDry } from "./dry-ai.ts";
import type { ProblemPack } from "./map.ts";
import { autoChecks, keyGaps, npcReport, sceneStage, scoreGaps, scoreMemory, scoreTutor, type NpcScore } from "./score.ts";
import type { Played, ProblemMap, Spec } from "./types.ts";
import { aiVoice, dryVoice } from "./voice.ts";

export type NpcJob = { name: string; spec: Spec; mapFile: string; packModule: string; dataDir: string; outDir: string; dry: boolean; mode: "strict" | "loose";
  expect?: { route: string; see: string }; suspectAi?: boolean; scenes?: boolean };

/** 지도 · 문제 묶음 불러오기(문제 묶음은 모듈에서: 원문이 저장소에 없게 재료 파일로 둔다) */
export async function loadJob(job: NpcJob): Promise<{ map: ProblemMap; pack: ProblemPack }> {
  const map = JSON.parse(await readFile(job.mapFile, "utf8")) as ProblemMap;
  const mod = await import(path.resolve(job.packModule)) as Record<string, unknown>;
  const pack = Object.values(mod).find((v) => v && typeof v === "object" && "referenceJs" in (v as object) && (v as ProblemPack).number === map.problem) as ProblemPack | undefined;
  if (!pack) throw new Error(`${job.packModule}에 문제 ${map.problem} 묶음이 없어요.`);
  return { map, pack };
}

async function scoreAll(job: NpcJob, map: ProblemMap, pack: ProblemPack, played: Played, after: Awaited<ReturnType<typeof afterSolve>>): Promise<NpcScore> {
  const rec = await collectRecord(pack);
  const voice = job.dry ? dryVoice(map) : aiVoice();
  // (가)는 앱이 뽑은 빈틈으로만 잰다. 가짜 AI면 뽑기가 빈 목록이라 "AI 필요"로 적고, 장면 단계는 정답지로 만든 빈틈으로 돌린다.
  const gapScore = scoreGaps(map, played, after.gaps, rec.subs, after.gaps.length || !job.dry ? "ai" : "none");
  const gaps = job.dry ? await keyGaps(map, played, pack, rec.subs) : after.gaps;
  const errors = [...after.errors];
  const scenes = job.scenes === false ? [] : await sceneStage({ map, played, pack, gaps, voice }).catch((e) => { errors.push(`장면: ${(e as Error).message}`); return []; });
  const score: NpcScore = { name: job.name, played, gaps: gapScore, memory: scoreMemory(map, played, { lessons: rec.lessons as unknown as Array<Record<string, unknown>>, knowledge: rec.knowledge }),
    tutor: await scoreTutor(map, played, rec.talk, pack), scenes, ...(job.expect ? { expect: job.expect } : {}), checks: autoChecks(map, played, job.expect),
    // 가짜 AI 호출은 사용량이 아니다(토큰 0)
    usage: job.dry ? { ...(await usageOf(job.dataDir)), tokens: 0, measured: true } : await usageOf(job.dataDir), review: (after.review && "md" in after.review ? after.review.md : null), errors };
  await mkdir(job.outDir, { recursive: true });
  await writeFile(path.join(job.outDir, "record.json"), JSON.stringify({ talk: rec.talk, subs: rec.subs, sheets: rec.sheets, lessons: rec.lessons, events: rec.events }, null, 1), "utf8");
  await writeFile(path.join(job.outDir, "gaps.json"), JSON.stringify({ app: after.gaps, used: gaps }, null, 1), "utf8");
  await writeFile(path.join(job.outDir, "score.json"), JSON.stringify(score, null, 1), "utf8");
  await writeFile(path.join(job.outDir, "report.md"), npcReport(score), "utf8");
  return score;
}

/** 한 판 전부 */
export async function runNpc(job: NpcJob, log: (s: string) => void = () => undefined): Promise<NpcScore> {
  switchDataDir(job.dataDir);
  await mkdir(job.dataDir, { recursive: true });
  const { map, pack } = await loadJob(job);
  await setupProblem(pack);
  const dry = job.dry ? installDry(map) : null;
  const candidates: unknown[] = [];
  try {
    const played = await play({ spec: job.spec, map, problem: pack, voice: job.dry ? dryVoice(map) : aiVoice(), driver: appDriver(pack), mode: job.mode, suspectAi: job.suspectAi, log,
      onCandidate: (c) => candidates.push(c) });
    await mkdir(job.outDir, { recursive: true });
    await writeFile(path.join(job.outDir, "played.json"), JSON.stringify(played, null, 1), "utf8");
    await writeFile(path.join(job.outDir, "key.jsonl"), played.key.map((k) => JSON.stringify(k)).join("\n") + "\n", "utf8");
    if (candidates.length) await writeFile(path.join(job.outDir, "map-candidates.json"), JSON.stringify(candidates, null, 1), "utf8");
    log(`  풀이 끝: ${played.end.verdict} · 뒤 단계(문제 한 장 · 총정리 · 빈틈 뽑기)`);
    let t0 = Date.now();
    const after = await afterSolve(pack);
    log(`  뒤 단계 ${((Date.now() - t0) / 1000).toFixed(0)}초 · 채점(장면 다시 풀기 포함)`);
    t0 = Date.now();
    const score = await scoreAll(job, map, pack, played, after);
    log(`  채점 ${((Date.now() - t0) / 1000).toFixed(0)}초`);
    if (dry) await writeFile(path.join(job.outDir, "dry-calls.json"), JSON.stringify(dry.calls, null, 1), "utf8");
    return score;
  } finally { dry?.uninstall(); }
}

/** 다시 쓰기: 저장한 판(데이터 폴더 · played.json)을 새 폴더로 복사하고 빈틈 뽑기부터 다시(튜터는 다시 안 부름). */
export async function replayNpc(savedOut: string, job: Omit<NpcJob, "spec">, log: (s: string) => void = () => undefined): Promise<NpcScore> {
  const played = JSON.parse(await readFile(path.join(savedOut, "played.json"), "utf8")) as Played;
  const savedJob = JSON.parse(await readFile(path.join(savedOut, "job.json"), "utf8")) as NpcJob;
  await cp(savedJob.dataDir, job.dataDir, { recursive: true });
  switchDataDir(job.dataDir);
  const { map, pack } = await loadJob({ ...job, spec: played.spec });
  const dry = job.dry ? installDry(map) : null;
  try {
    log(`  다시 쓰기: ${savedOut} → 빈틈 뽑기 · 장면 · 채점`);
    const after = await afterSolve(pack);
    return await scoreAll({ ...job, spec: played.spec }, map, pack, played, after);
  } finally { dry?.uninstall(); }
}
