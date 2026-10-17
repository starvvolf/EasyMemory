import test from "node:test";
import assert from "node:assert/strict";
import { compareCandidate, type Evaluation } from "./pastexam-compare.ts";
const baseline:Evaluation={label:"base",accuracy:.9,quality:[{file:"invented.pdf",questions:5,fail:0,coveredObjectives:["a","b","c","d","e"],copyPublishedPassed:null}]};
const candidate:Evaluation={label:"candidate",accuracy:.8,quality:[{...baseline.quality[0],copyPublishedPassed:5}]};
test("all five gates pass without automatically adopting",()=>{
  const result=compareCandidate(baseline,candidate);
  assert.equal(result.eligible,true);
  assert.match(result.decision,/Manual review/);
});
test("coverage loss fails even when count loss is within twenty percent",()=>{
  const result=compareCandidate(baseline,{...candidate,quality:[{...candidate.quality[0],questions:4,coveredObjectives:["a","b","c","d"],copyPublishedPassed:4}]});
  assert.equal(result.checks.countRetained,true);
  assert.equal(result.checks.coverageRetained,false);
  assert.equal(result.eligible,false);
});
test("same accuracy, more defects or missing copy approval cannot pass",()=>{
  assert.equal(compareCandidate(baseline,{...candidate,accuracy:.9}).eligible,false);
  assert.equal(compareCandidate(baseline,{...candidate,quality:[{...candidate.quality[0],fail:1}]}).eligible,false);
  assert.equal(compareCandidate(baseline,{...candidate,quality:[{...candidate.quality[0],copyPublishedPassed:4}]}).eligible,false);
});
test("duplicate objectives do not inflate coverage",()=>{
  assert.throws(()=>compareCandidate(baseline,{...candidate,quality:[{...candidate.quality[0],coveredObjectives:["a","a","c","d","e"]}]}),/coverage/);
});
