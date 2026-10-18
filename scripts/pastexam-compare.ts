// Offline acceptance gates. Passing these gates is eligibility, not automatic adoption.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Material = { file: string; questions: number; fail: number; coveredObjectives: string[]; copyPublishedPassed: number | null };
export type Evaluation = { label: string; accuracy: number; quality: Material[] };
export function compareCandidate(previous: Evaluation, candidate: Evaluation) {
  for (const result of [previous, candidate]) {
    if (!Number.isFinite(result.accuracy) || result.accuracy < 0 || result.accuracy > 1 || !result.quality.length ||
      new Set(result.quality.map(m => m.file)).size !== result.quality.length) throw new Error("Invalid evaluation summary");
    for (const material of result.quality) if (!Number.isInteger(material.questions) || material.questions <= 0 ||
      !Number.isInteger(material.fail) || material.fail < 0 || material.fail > material.questions ||
      material.coveredObjectives.length !== material.questions ||
      new Set(material.coveredObjectives).size !== material.questions) throw new Error("Invalid question coverage");
  }
  const total = (result: Evaluation, field: "questions" | "fail") => result.quality.reduce((n,m)=>n+m[field],0);
  const missing = previous.quality.flatMap(material => {
    const next = candidate.quality.find(m=>m.file===material.file);
    return material.coveredObjectives.filter(id=>!next?.coveredObjectives.includes(id)).map(id=>({file:material.file,objectiveId:id}));
  });
  const checks = {
    accuracyLower: candidate.accuracy < previous.accuracy,
    failuresNotIncreased: total(candidate,"fail") <= total(previous,"fail"),
    copyPass100: candidate.quality.every(m=>m.copyPublishedPassed === m.questions),
    countRetained: total(candidate,"questions") >= total(previous,"questions") * .8,
    coverageRetained: missing.length === 0,
  };
  return { previous: previous.label, candidate: candidate.label, eligible: Object.values(checks).every(Boolean), checks,
    metrics: { accuracyBefore: previous.accuracy, accuracyAfter: candidate.accuracy,
      failuresBefore: total(previous,"fail"), failuresAfter: total(candidate,"fail"),
      countBefore: total(previous,"questions"), countAfter: total(candidate,"questions") },
    missing, decision: "Manual review for metric gaming and source fidelity is still required." };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.loadEnvFile(".env.local");
  const root=process.env.STUDY_FORGE_DATA_DIR;
  const [before,after]=process.argv.slice(2);
  if (!root || !path.isAbsolute(root) || ![before,after].every(v=>/^[a-z0-9-]+$/.test(v??""))) throw new Error("Private root and two evaluation labels required");
  const dir=path.join(root,"기출분석","그래픽스","evaluation");
  const result=compareCandidate(JSON.parse(await readFile(path.join(dir,before,"summary.json"),"utf8")),
    JSON.parse(await readFile(path.join(dir,after,"summary.json"),"utf8")));
  await writeFile(path.join(dir,after,"acceptance.json"),JSON.stringify(result,null,2),{flag:"wx"});
  console.log(JSON.stringify(result));
}
