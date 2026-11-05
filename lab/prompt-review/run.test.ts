import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { prepare, offlineProbes } from './run.ts';
import { setFakeModelResponder } from '../../src/lib/ai/model.ts';

test('C/B/A requests reuse live assembly without changing product data or making network calls', async()=>{
  const old={data:process.env.STUDY_FORGE_DATA_DIR,provider:process.env.STUDY_FORGE_MODEL_PROVIDER};
  const out=await mkdtemp(path.resolve('tmp/prompt-review-check-'));
  try {
    const trials=await prepare(out);
    assert.deepEqual(trials.map(x=>x.area),['C','C','C','B','B','B','A','A','A']);
    assert.equal(new Set(trials.map(x=>x.id)).size,9);
    for(const t of trials){assert.ok(t.request.schema);assert.ok(t.request.user);assert.notEqual(t.candidate,t.request.system);}
    assert.equal(trials[2].request.user.includes('공리주의'),true);
    assert.equal((await readFile(path.join(out,'trials.json'),'utf8')).includes('api_key'),false);
    assert.equal(process.env.STUDY_FORGE_DATA_DIR,path.join(out,'capture-data'));
    assert.equal(process.env.STUDY_FORGE_MODEL_PROVIDER,'fake');
  } finally {
    if(old.data===undefined)delete process.env.STUDY_FORGE_DATA_DIR;else process.env.STUDY_FORGE_DATA_DIR=old.data;
    if(old.provider===undefined)delete process.env.STUDY_FORGE_MODEL_PROVIDER;else process.env.STUDY_FORGE_MODEL_PROVIDER=old.provider;
  }
});
// 11/5: C가 정답 위치 고정과 점수 없는 보기 통과를 고쳤다 → 고친 것은 고친 채로, 남은 것(점검 안 한 보기 3, 빈칸 부분 일치)은 그대로 기록
test('C: fixed failures stay fixed, the remaining ones are still reproducible',()=>{
  const p=offlineProbes();
  assert.ok(p.shuffle.correctPositions.every(n=>n>150),`정답 위치가 고르게: ${p.shuffle.correctPositions}`);
  assert.equal(p.uncheckedPool,3);
  assert.equal(p.missingScorePool,0);
  assert.ok(p.substringAccepted.every(x=>x.substringPass));
});
// 11/5: A의 짧은 조각 유출은 토큰 창 검사로 막힘(code-ai.ts leaks). B 인용 검사는 아직 그대로.
test('B map still accepts an invented quote; A short reference fragments are now caught',async()=>{
  const old={data:process.env.STUDY_FORGE_DATA_DIR,provider:process.env.STUDY_FORGE_MODEL_PROVIDER};
  const out=await mkdtemp(path.resolve('tmp/prompt-review-boundary-'));
  try {
    await prepare(out);
    setFakeModelResponder(r=>r.purpose==='knowledge:map'
      ? JSON.stringify({genre:'concept',question:'무엇인가?',flow:[],claim:{text:'설명',basis:[]},ideas:[{title:'없는 내용',body:'만든 설명',ask:'무엇인가?',quote:'원문에 없는 인용문'}],terms:[],consider:[]})
      : JSON.stringify({state:'맞는 길',say:'target = a[1]'}));
    const {mapArticle}=await import('../../src/lib/assist/article-map.ts');
    const mapped=await mapArticle({title:'합성 자료',text:'해시는 키를 해시 값에 대응시킨다.'});
    assert.equal(mapped.ideas[0].quote,'원문에 없는 인용문');
    const {trainCheck}=await import('../../src/lib/assist/code-ai.ts');
    const advice=await trainCheck({problemId:'cp_promptreview',step:'model',answer:{구조:'모르겠어요'}});
    assert.notEqual(advice.say,'target = a[1]');
  } finally {
    setFakeModelResponder(null);
    if(old.data===undefined)delete process.env.STUDY_FORGE_DATA_DIR;else process.env.STUDY_FORGE_DATA_DIR=old.data;
    if(old.provider===undefined)delete process.env.STUDY_FORGE_MODEL_PROVIDER;else process.env.STUDY_FORGE_MODEL_PROVIDER=old.provider;
  }
});
