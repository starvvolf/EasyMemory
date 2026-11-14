// 실습용 풀이 조각 지도 (설계 2번 끝 "실습도 같아요"): 공유 카운터 — 여러 작업이 같은 값을 읽고 쓰면 올린 것이 사라진다.
// 설계의 예(공유 체력: lock / Interlocked / 한 스레드가 순서대로 / ✗"요청이 빨라서 안 겹친다")를 Node로 옮긴 손 지도.
// 길 코드 = counter.js 파일 전체. 판정은 작업 폴더에서 `node test.js`를 실제로 돌려 잰다(맞음 = OK, 종료 코드 0).
import type { Fragment, ProblemMap, Route } from "./types.ts";

export const PRACTICE_FILES: Record<string, string> = {
  "counter.js": `// 저장소 흉내: 읽기 · 쓰기에 시간이 조금 걸린다\nconst store = { value: 0 };\nconst wait = () => new Promise((r) => setTimeout(r, Math.random() * 4));\nasync function read() { await wait(); return store.value; }\nasync function write(v) { await wait(); store.value = v; }\n\nasync function increase() {\n  const v = await read();\n  await write(v + 1);\n}\nasync function addMany(n) {\n  await Promise.all(Array.from({ length: n }, () => increase()));\n  return store.value;\n}\nmodule.exports = { addMany, store };\n`,
  "test.js": `const { addMany, store } = require("./counter");\n(async () => {\n  store.value = 0;\n  const got = await addMany(40);\n  console.log(got === 40 ? "OK" : \`FAIL: 40번 올렸는데 \${got}\`);\n  process.exit(got === 40 ? 0 : 1);\n})();\n`,
  "README.md": "# 공유 카운터\n\n`addMany(n)`이 `increase()`를 동시에 n번 불러도 값이 정확히 n만큼 늘게 `counter.js`를 고치세요. `node test.js`가 OK를 찍으면 끝이에요.\n",
};
export const PRACTICE_GOAL = "counter.js의 addMany(40)이 정확히 40을 돌려주게 고치기(node test.js가 OK)";

const FR: Fragment[] = [
  { id: "syntax.js.async", layer: 1, what: "async 함수 안에서 await로 Promise를 기다린다", example: "async function f() {\n  const v = await read();\n  return v;\n}", keys: ["async", "await"], leak: [] },
  { id: "idea.await-gap", layer: 5, what: "await 사이에 다른 작업이 끼어들어, 읽은 값이 쓸 때는 이미 낡을 수 있다(경쟁 상태)", example: "const v = await read(); // 여기서 다른 작업이 값을 바꿀 수 있다\nawait write(v + 1);", keys: ["끼어들", "경쟁", "race", "낡", "동시에 읽"] },
  { id: "tool.lock-chain", layer: 4, what: "Promise 사슬로 한 번에 하나만 들어가게 잠근다", example: "let last = Promise.resolve();\nfunction locked(fn) {\n  const run = last.then(fn);\n  last = run.catch(() => {});\n  return run;\n}", keys: ["잠그", "lock", "사슬", "한 번에 하나"] },
  { id: "tool.sequential", layer: 4, what: "for와 await로 하나씩 차례로 처리한다", example: "for (let i = 0; i < n; i++) {\n  await increase();\n}", keys: ["차례로", "하나씩", "순서대로", "for .*await"] },
  { id: "idea.atomic-update", layer: 5, what: "읽고 쓰는 것을 await 없이 한 번에 한다(그 사이에 아무도 못 끼어듦)", example: "store.value = store.value + 1; // await 없이 한 줄로", keys: ["한 번에", "원자", "atomic", "await 없이"] },
  { id: "wrong.too-fast", layer: 5, wrong: true, right: "idea.await-gap", what: "요청이 빨라서 안 겹친다(그대로 둬도 된다)", example: "// 빠르니까 괜찮다", keys: ["빨라서 안 겹", "안 겹친다"] },
];
const head = "// 저장소 흉내: 읽기 · 쓰기에 시간이 조금 걸린다\nconst store = { value: 0 };\nconst wait = () => new Promise((r) => setTimeout(r, Math.random() * 4));\nasync function read() { await wait(); return store.value; }\nasync function write(v) { await wait(); store.value = v; }";
const tail = "module.exports = { addMany, store };";
const R: Route[] = [
  { id: "A", name: "잠그기(lock)", prior: 0.5, needs: ["syntax.js.async", "idea.await-gap", "tool.lock-chain"], slots: {},
    steps: [{ text: "저장소 흉내는 그대로", uses: [], code: head },
      { text: "한 번에 하나만 들어가는 잠금 만들기", uses: ["idea.await-gap", "tool.lock-chain"], code: "let last = Promise.resolve();\nfunction locked(fn) {\n  const run = last.then(fn);\n  last = run.catch(() => {});\n  return run;\n}" },
      { text: "읽고 쓰는 부분을 잠금 안에서", uses: ["tool.lock-chain", "syntax.js.async"], code: "async function increase() {\n  return locked(async () => {\n    const v = await read();\n    await write(v + 1);\n  });\n}" },
      { text: "addMany는 그대로", uses: ["syntax.js.async"], code: "async function addMany(n) {\n  await Promise.all(Array.from({ length: n }, () => increase()));\n  return store.value;\n}" }, { text: "내보내기", uses: [], code: tail }] },
  { id: "B", name: "한 번에 올리기(Interlocked 흉내)", prior: 0.2, needs: ["syntax.js.async", "idea.await-gap", "idea.atomic-update"], slots: {},
    steps: [{ text: "저장소 흉내는 그대로", uses: [], code: head },
      { text: "읽고 쓰기를 await 없이 한 번에", uses: ["idea.await-gap", "idea.atomic-update"], code: "async function increase() {\n  await wait();\n  store.value = store.value + 1;\n}" },
      { text: "addMany는 그대로", uses: ["syntax.js.async"], code: "async function addMany(n) {\n  await Promise.all(Array.from({ length: n }, () => increase()));\n  return store.value;\n}" }, { text: "내보내기", uses: [], code: tail }] },
  { id: "C", name: "하나씩 차례로", prior: 0.3, needs: ["syntax.js.async", "idea.await-gap", "tool.sequential"], slots: {},
    steps: [{ text: "저장소 흉내는 그대로", uses: [], code: head },
      { text: "increase는 그대로", uses: ["syntax.js.async"], code: "async function increase() {\n  const v = await read();\n  await write(v + 1);\n}" },
      { text: "동시에 말고 하나씩 차례로 부르기", uses: ["idea.await-gap", "tool.sequential"], code: "async function addMany(n) {\n  for (let i = 0; i < n; i++) await increase();\n  return store.value;\n}" }, { text: "내보내기", uses: [], code: tail }] },
  { id: "D", name: "그대로 둠(안 겹친다고 믿음)", prior: 0.1, needs: ["syntax.js.async", "wrong.too-fast"], slots: {},
    steps: [{ text: "저장소 흉내는 그대로", uses: [], code: head },
      { text: "빠르니까 그대로 둠", uses: ["wrong.too-fast", "syntax.js.async"], code: "async function increase() {\n  const v = await read();\n  await write(v + 1);\n}\nasync function addMany(n) {\n  await Promise.all(Array.from({ length: n }, () => increase()));\n  return store.value;\n}" }, { text: "내보내기", uses: [], code: tail }] },
];
export const PRACTICE_MAP: ProblemMap = { problem: "practice-counter", title: "공유 카운터(경쟁 상태)", lang: "python", source: "hand", madeAt: "2026-11-15T00:00:00.000Z", fragments: FR, routes: R,
  notes: ["실습 지도: 길 코드는 counter.js 전체(JavaScript). lang 칸은 지도 모양 맞추기용이고, 판정은 node test.js로 잰다."] };
/** 길 코드 → counter.js */
export const counterOf = (r: Route, upto?: number) => r.steps.slice(0, upto ?? r.steps.length).map((s) => s.code).join("\n") + "\n";
