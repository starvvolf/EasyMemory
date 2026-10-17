// Explicit private experiment, resumes only its own checkpoints. No holdout source may be passed here.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { forkGen, loadGen, runGen, readGenCalls, readSectionDocument } from "../src/lib/study/gen/runner.ts";
import { scorecard } from "../src/lib/study/gen/scorecard.ts";
import type { AuthoringDocument } from "../tools/problem-authoring-lab/contract.ts";
process.loadEnvFile('.env.local');
const root = process.env.STUDY_FORGE_DATA_DIR;
const examId = process.argv[2];
const manifestName = process.argv[3] ?? "vibe-runs.json";
if (!/^[a-z0-9-]+\.json$/.test(manifestName) || manifestName === "baseline.json") throw new Error("Separate candidate manifest required");
if (!root || !path.isAbsolute(root) || !/^src_[a-f0-9]{64}$/.test(examId ?? '')) throw new Error('Private root and explicit tuning exam ID required');
const dir = path.join(root,'기출분석','그래픽스');
const checkpoint = path.join(dir,manifestName);
type Job = { id: string; status: string; calls: number };
let jobs: Record<string,Job> = {};
try { jobs = JSON.parse(await readFile(checkpoint,'utf8')); } catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
// Keep the exact authored policy next to each private candidate, never overwrite a previous round.
const code = Object.fromEntries(await Promise.all(["runner.ts", "pastexam.ts", "prompts.ts"].map(async name =>
  [name, await readFile(path.join("src/lib/study/gen", name), "utf8")])));
const signature = createHash("sha256").update(JSON.stringify({ examId, code })).digest("hex");
const versionFile = path.join(dir, manifestName.replace(/\.json$/, "-code.json"));
try {
  const prior = JSON.parse(await readFile(versionFile, "utf8"));
  if (prior.signature !== signature && Object.values(jobs).some(job => job.status !== "done"))
    throw new Error("Candidate code changed; use a new manifest instead of mixing versions");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  if (Object.keys(jobs).length) throw new Error("Existing candidate has no code snapshot; do not invent provenance");
  await writeFile(versionFile, JSON.stringify({ createdAt: new Date().toISOString(), examId, signature, code }, null, 2), { flag: "wx" });
}
const deadline = Date.now() + 2*60*60*1000;
let baseline: Record<string,Job>;
for (;;) {
  baseline = JSON.parse(await readFile(path.join(dir,'baseline.json'),'utf8'));
  if (Object.values(baseline).some(v=>v.status==='paused-login'||v.status==='paused-usage-limit')) throw new Error('BASELINE_AUTH_OR_LIMIT_STOP');
  if (Object.keys(baseline).length===4 && Object.values(baseline).every(v=>v.status==='done')) break;
  if (Date.now()>deadline || Object.values(baseline).some(v=>v.status==='failed')) throw new Error('BASELINE_INCOMPLETE');
  await new Promise(resolve=>setTimeout(resolve,10000));
}
for (const [name, original] of Object.entries(baseline)) {
  let state = jobs[name] ? await loadGen(jobs[name].id) : null;
  if (!state) {
    state = await forkGen(original.id,{from:'author',autoConfirm:true,pastExamSourceIds:[examId]});
    jobs[name]={id:state.id,status:state.status,calls:state.calls};
    await writeFile(checkpoint,JSON.stringify(jobs,null,2));
  }
  console.log(JSON.stringify({file:name,id:state.id,status:state.status}));
  for(let attempt=0;attempt<2 && state.status!=='done';attempt++) {
    state = await runGen(state.id,{uid:'local-experiment'});
    jobs[name]={id:state.id,status:state.status,calls:state.calls};
    await writeFile(checkpoint,JSON.stringify(jobs,null,2));
    console.log(JSON.stringify(jobs[name]));
    if(state.status==='paused-login'||state.status==='paused-usage-limit') { console.log('AUTH_OR_LIMIT_STOP'); process.exit(2); }
    if(state.status==='failed') break;
  }
  const documents = new Map<string, AuthoringDocument | null>();
  for(const section of state.sections) documents.set(section.id,await readSectionDocument(state.id,section.id) as AuthoringDocument|null);
  await writeFile(path.join(dir,state.id+'.score.json'),JSON.stringify(scorecard(state,await readGenCalls(state.id),documents),null,2));
}
