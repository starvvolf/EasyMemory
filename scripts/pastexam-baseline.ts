// Explicit study preparation; private checkpoints prevent duplicate submissions.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { forkGen, createGen, runGen, loadGen, listGens } from '../src/lib/study/gen/runner.ts';
import { registerMcpSource } from '../src/lib/mcp-source-registry.ts';
process.loadEnvFile('.env.local');
const root = process.env.STUDY_FORGE_DATA_DIR!;
if (!root || !path.isAbsolute(root)) throw new Error('Private data root required');
const target = path.join(root, '기출분석', '그래픽스');
await mkdir(target, {recursive:true});
const folder = process.argv[2];
if (!folder || !path.isAbsolute(folder)) throw new Error('Explicit source directory required');
const checkpoint = path.join(target,'baseline.json');
let jobs: Record<string,{id:string;status:string;calls:number}> = {};
try { jobs = JSON.parse(await readFile(checkpoint,'utf8')); } catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
const existing = await listGens();
for (const name of (await readdir(folder)).filter(n=>/^0[1-4]_.*\.pdf$/.test(n)).sort()) {
  let state = jobs[name] ? await loadGen(jobs[name].id) : null;
  if (!state) {
    const source = await registerMcpSource(name,await readFile(path.join(folder,name)));
    const base = existing.find(s=>s.input.sourceId===source.id && s.input.origin==='study' && s.sections.length && s.sections.every(x=>x.design));
    state = base ? await forkGen(base.id,{from:'author',autoConfirm:true}) : await createGen({sourceId:source.id,fileName:name,pageNumbers:Array.from({length:source.pageCount},(_,i)=>i+1),purpose:'core',autoConfirm:true,provider:'chatgpt',models:{},signals:{weakSpots:[],reports:[]},origin:'study',readImages:true});
    jobs[name]={id:state.id,status:state.status,calls:state.calls};
    await writeFile(checkpoint,JSON.stringify(jobs,null,2));
  }
  console.log(JSON.stringify({file:name,id:state.id,status:state.status}));
  if(state.status==='done')continue;
  for(let attempt=0;attempt<2;attempt++) {
    state=await runGen(state.id,{uid:'local-experiment'});
    jobs[name]={id:state.id,status:state.status,calls:state.calls};
    await writeFile(checkpoint,JSON.stringify(jobs,null,2));
    console.log(JSON.stringify({id:state.id,status:state.status,calls:state.calls}));
    if(state.status==='paused-login'||state.status==='paused-usage-limit') {console.log('AUTH_OR_LIMIT_STOP');process.exit(2);}
    if(state.status==='done')break;
  }
}
