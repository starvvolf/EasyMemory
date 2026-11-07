// 가상 학습자 실험 (2026-11-08, 실험 A·C): 기억 규칙이 "몰랐던 것"만 기억으로 넣는지(정밀도·재현율), 그 기억을 복습에서
// 어떤 질문으로 꺼낼 수 있는지. AI 없음(힌트 정리는 가짜 모델). 결과 표는 실행할 때 출력되고, 핵심 성질만 assert 한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PAT = ["visited", "bfs-distance", "multi-source", "components", "stack-match", "sort-key"];
const model = (number: string, pattern: string) => ({
  number, title: `문제 ${number}`, chapter: "0x09", role: "basic", url: "u", statement: "s", inputText: "i", outputText: "o", summary: `${pattern} 요약 ${number}`,
  maxN: 1000, patterns: [pattern], signals: [`${pattern}의 신호`],
  approaches: [{ name: `${pattern} 풀이`, verdict: "best", why: "의도" }, { name: "모두 해 보기", verdict: "slow", why: "N이 커서 느림" }, { name: "정렬 한 번", verdict: "wrong", why: "순서가 답을 정하지 않음" }],
  state: { right: `${pattern} 상태`, wrong: ["합계", "포인터 하나"] }, update: "넣을 때 갱신", complexity: "n", pitfalls: ["경계 검사"],
  walkthrough: { observe: "o", choose: `${pattern}를 고른다`, compare: "x", verify: "v" }, predict: { question: "출력은?", input: "1", answer: "3" }, at: "",
});
const PROBLEMS = PAT.flatMap((p, i) => [String(1000 + i * 2), String(1001 + i * 2)].map((n) => model(n, p)));

type Step = (p: ReturnType<typeof model>, knows: boolean, r: () => number) => Array<Record<string, unknown>>;
const right = (p: ReturnType<typeof model>) => [
  { kind: "walkthrough", number: p.number, pattern: p.patterns[0], predict: "3" },
  { kind: "drill", number: p.number, pattern: p.patterns[0], mixed: true, choice: p.approaches[0].name },
  { kind: "design", number: p.number, pattern: p.patterns[0], mixed: true, state: p.state.right, complexity: "n" },
];
const wrong = (p: ReturnType<typeof model>) => [
  { kind: "walkthrough", number: p.number, pattern: p.patterns[0], predict: "" },
  { kind: "drill", number: p.number, pattern: p.patterns[0], mixed: true, choice: "정렬 한 번" },
  { kind: "design", number: p.number, pattern: p.patterns[0], mixed: true, state: "합계", complexity: "n" },
];
const LEARNERS: Record<string, { knows: (p: string) => boolean; steps: Step }> = {
  "고수(다 앎)": { knows: () => true, steps: (p) => right(p) },
  "초보(다 모름)": { knows: () => false, steps: (p) => wrong(p) },
  "보기만 함": { knows: () => false, steps: (p) => [{ kind: "walkthrough", number: p.number, pattern: p.patterns[0] }] },
  "찍기(모름, 무작위)": { knows: () => false, steps: (p, _k, r) => [
    { kind: "drill", number: p.number, pattern: p.patterns[0], mixed: true, choice: p.approaches[Math.floor(r() * 3)].name },
    { kind: "design", number: p.number, pattern: p.patterns[0], mixed: true, state: [p.state.right, ...p.state.wrong][Math.floor(r() * 3)], complexity: "n" }] },
  "힌트 의존": { knows: () => false, steps: (p) => [
    { kind: "drill", number: p.number, pattern: p.patterns[0], mixed: false, hinted: true, choice: p.approaches[0].name },
    { kind: "design", number: p.number, pattern: p.patterns[0], mixed: false, hinted: true, state: p.state.right, complexity: "n" }] },
  "반반": { knows: (p) => PAT.indexOf(p) % 2 === 0, steps: (p, k) => (k ? right(p) : wrong(p)) },
  "고수 + 실수 한 번": { knows: () => true, steps: (p) => (p.number === "1004" ? [right(p)[0], { ...right(p)[1], choice: "모두 해 보기" }, right(p)[2]] : right(p)) },
  "처음 틀리고 다음엔 맞힘": { knows: () => false, steps: (p) => (Number(p.number) % 2 === 0 ? wrong(p) : right(p)) },
};

test("가상 학습자: 몰랐던 것만 기억이 되고, 기억마다 복습 질문이 나온다", async () => {
  const prior = { data: process.env.STUDY_FORGE_DATA_DIR, after: process.env.RECALLER_AFTER_SAVE };
  const rows: string[] = [];
  const results: Record<string, { precision: number; recall: number; memories: number; unknown: number; kinds: string }> = {};
  try {
    for (const [name, learner] of Object.entries(LEARNERS)) {
      const dir = await mkdtemp(path.join(os.tmpdir(), "tutor-sim-"));
      process.env.STUDY_FORGE_DATA_DIR = dir; process.env.RECALLER_AFTER_SAVE = "off";
      await mkdir(path.join(dir, "code", "tutor"), { recursive: true });
      await writeFile(path.join(dir, "code", "tutor", "models.json"), JSON.stringify(Object.fromEntries(PROBLEMS.map((p) => [p.number, p]))));
      const { answer } = await import("./service.ts");
      const { searchKnowledge, getKnowledge } = await import("../../knowledge/api.ts");
      const { patternOf } = await import("./patterns.ts");
      const { psQuestions } = await import("./review.ts");
      let h = 7; const r = () => ((h = (h * 48271) % 2147483647) / 2147483647);
      for (const p of PROBLEMS) for (const s of learner.steps(p, learner.knows(p.patterns[0]), r)) await answer(s as never);
      const items = [];
      for (const pid of PAT) {
        const hit = (await searchKnowledge(patternOf(pid)!.name)).find((x) => x.title === patternOf(pid)!.name);
        if (hit) items.push((await getKnowledge(hit.id)).item);
      }
      const mem = new Set(items.flatMap((k) => (k.sources ?? []).map((s) => /^tutor:pattern:(.+)$/.exec(s.ref ?? "")?.[1]).filter(Boolean) as string[]));
      const unknown = new Set(PAT.filter((p) => !learner.knows(p)));
      const hit = [...mem].filter((p) => unknown.has(p)).length;
      const kinds = new Map<string, number>();
      for (const k of items) for (const q of (await psQuestions(k, "s1")).slice(0, 1)) kinds.set(q.label, (kinds.get(q.label) ?? 0) + 1);
      const res = { precision: mem.size ? hit / mem.size : 1, recall: unknown.size ? hit / unknown.size : 1, memories: mem.size, unknown: unknown.size, kinds: [...kinds].map(([k, v]) => `${k} ${v}`).join(", ") || "-" };
      results[name] = res;
      rows.push(`| ${name} | ${res.unknown} | ${res.memories} | ${res.precision.toFixed(2)} | ${res.recall.toFixed(2)} | ${res.kinds} |`);
      for (const k of items) assert.ok((await psQuestions(k, "s1")).length >= 1, `${name}: every memory can be asked about`);
      await rm(dir, { recursive: true, force: true });
    }
  } finally {
    for (const [key, v] of [["STUDY_FORGE_DATA_DIR", prior.data], ["RECALLER_AFTER_SAVE", prior.after]] as const) { if (v === undefined) delete process.env[key]; else process.env[key] = v; }
  }
  console.log(["| 학습자 | 모르는 패턴 | 생긴 기억 | 정밀도 | 재현율 | 첫 복습 질문 |", "|---|---|---|---|---|---|", ...rows].join("\n"));
  assert.equal(results["고수(다 앎)"].memories, 0, "an expert gets no memories");
  assert.equal(results["보기만 함"].memories, 0, "watching alone is no evidence");
  assert.equal(results["초보(다 모름)"].recall, 1);
  assert.equal(results["힌트 의존"].recall, 1, "help reveals the gap");
  for (const n of ["초보(다 모름)", "반반", "찍기(모름, 무작위)", "힌트 의존", "처음 틀리고 다음엔 맞힘"]) assert.equal(results[n].precision, 1, `${n}: no false memory`);
  assert.equal(results["고수 + 실수 한 번"].memories, 1, "one slip makes one (false) memory: the review then confirms it quickly");
});
