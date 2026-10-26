// 코드 학습의 AI 부분: 힌트 3단계, 드래그한 코드 설명, "맞는지 봐 줘", 에러 설명, 반례 입력, 문제 만들기.
// Whether code is right is never the model's call: that is the judge (src/lib/code). The model explains and hints.
import { askJson, askText, S } from "./model.ts";
import { LANG_LABEL, judge, normalizeOutput, type Lang, type TestCase } from "../code/run.ts";
import { answerWithReference, CodeError, crossCheck, findCounterexample, matchSourceExamples, readProblem, saveProblem, type Problem, type ProblemCheck } from "../code/problems.ts";
import { memoryEvents, searchKnowledge } from "../knowledge/store.ts";
import { currentAttempt } from "../code/service.ts";

const TUTOR = `너는 알고리즘을 가르치는 튜터다. 학습자가 스스로 고치게 돕는다. 한국어로 짧게 답한다.
- 통과 여부는 채점기가 정한다. 너는 맞았다/틀렸다를 단정하지 않는다.
- [학습자가 전에 막힌 기록]은 예전 풀이의 일이다. 같은 실수면 "지난번에도 …" 하고 짚는다.
- [이번 풀이에서 있었던 일]은 지금 이 문제를 푸는 중에 일어난 일이다. "지난번"이라고 하지 않고, 앞서 준 힌트에 이어서 말한다.
- 코드 블록은 꼭 필요할 때만, 짧게.`;

function problemBlock(p: Problem) {
  return `[문제] ${p.title}\n${p.statement}\n[입력] ${p.inputText}\n[출력] ${p.outputText}\n[이 문제가 확인하는 지식] ${p.knowledge.join(", ")}`;
}
export type LastResult = { verdict?: string; input?: string; expected?: string; got?: string; stderr?: string; compile?: string };
function resultBlock(r?: LastResult) {
  if (!r) return "";
  if (r.compile) return `[채점 결과] 컴파일 에러\n${r.compile.slice(0, 3000)}`;
  return `[채점 결과] ${r.verdict ?? ""}\n[실패한 입력]\n${(r.input ?? "").slice(0, 1500)}\n[기대 출력]\n${(r.expected ?? "").slice(0, 800)}\n[내 출력]\n${(r.got ?? "").slice(0, 800)}${r.stderr ? `\n[에러]\n${r.stderr.slice(0, 1500)}` : ""}`;
}
/** Memory level 3 for this problem's knowledge: the learner's own earlier misses, so a hint can say "지난번에도". */
async function pastMisses(p: Problem) {
  const lines: string[] = [];
  for (const id of p.knowledgeIds.slice(0, 4)) {
    const { text } = await memoryEvents({ knowledgeId: id, kinds: ["wrong", "hint", "asked"], limit: 5 });
    if (text !== "기록이 없어요.") lines.push(text);
  }
  return lines.length ? `[학습자가 전에 막힌 기록]\n${lines.join("\n")}` : "";
}
const ATTEMPT_LABEL = { wrong: "틀림", hint: "힌트 받음", asked: "물어봄" } as const;
/** This attempt so far (src/lib/code/service.ts): hints given and misses since the problem was opened. */
async function thisAttempt(p: Problem) {
  const events = await currentAttempt(p.id);
  return events.length ? `[이번 풀이에서 있었던 일]\n${events.map((e) => `- ${ATTEMPT_LABEL[e.kind]}: ${e.detail}`).join("\n")}` : "";
}

const LEVELS: Record<1 | 2 | 3, string> = {
  1: "힌트 1단계: 방향만. 어떤 지식(문제가 확인하는 지식 이름을 그대로)의 어느 부분을 다시 보라고 1~2문장. 코드 줄을 짚지 않는다.",
  2: "힌트 2단계: 문제가 되는 줄이나 조건을 짚는다. 왜 틀리는지 실패한 입력으로 설명한다. 고친 코드는 주지 않는다.",
  3: "힌트 3단계: 고친 코드를 보여 준다. 바꾼 줄만, 바꾼 이유와 함께. 전체 코드를 다시 쓰지 않는다.",
};
export async function hint(input: { problemId: string; lang: Lang; code: string; level: 1 | 2 | 3; last?: LastResult }) {
  const p = await readProblem(input.problemId);
  const user = [problemBlock(p), `[언어] ${LANG_LABEL[input.lang]}`, `[학습자 코드]\n${input.code.slice(0, 20000)}`, resultBlock(input.last), await pastMisses(p), await thisAttempt(p), LEVELS[input.level]].filter(Boolean).join("\n\n");
  return { text: await askText("code:hint", TUTOR, user, { heavy: input.level > 1 }) };
}
export async function explainCode(input: { problemId?: string; lang: Lang; code: string; selection: string; question?: string }) {
  const p = input.problemId ? await readProblem(input.problemId).catch(() => null) : null;
  const user = [p ? problemBlock(p) : "", `[언어] ${LANG_LABEL[input.lang]}`, `[전체 코드]\n${input.code.slice(0, 20000)}`, `[학습자가 드래그한 부분]\n${input.selection.slice(0, 4000)}`,
    input.question ? `[질문] ${input.question}` : "드래그한 부분이 무엇을 하는지 한 줄씩 쉽게 설명한다."].filter(Boolean).join("\n\n");
  return { text: await askText("code:explain", TUTOR, user) };
}
export async function reviewApproach(input: { problemId: string; lang: Lang; code: string; note?: string }) {
  const p = await readProblem(input.problemId);
  const user = [problemBlock(p), `[언어] ${LANG_LABEL[input.lang]}`, `[학습자 코드 (아직 제출 전)]\n${input.code.slice(0, 20000)}`, input.note ? `[학습자 메모] ${input.note}` : "", await pastMisses(p), await thisAttempt(p),
    "학습자가 '맞는지 봐 줘'라고 했다. 접근이 문제에 맞는지, 시간 안에 돌지(입력 크기 기준), 놓친 경우(경계, 자료형 범위)가 있는지 짧게 확인해 준다. 고친 코드는 주지 않는다."].filter(Boolean).join("\n\n");
  return { text: await askText("code:review", TUTOR, user, { heavy: true }) };
}
export async function explainError(input: { problemId?: string; lang: Lang; code: string; error: string }) {
  const p = input.problemId ? await readProblem(input.problemId).catch(() => null) : null;
  const user = [p ? problemBlock(p) : "", `[언어] ${LANG_LABEL[input.lang]}`, `[코드]\n${input.code.slice(0, 20000)}`, `[에러 메시지]\n${input.error.slice(0, 6000)}`,
    "에러가 무슨 뜻인지, 몇 번째 줄의 무엇 때문인지 쉬운 말로 설명한다. 고치는 방향만 말하고 고친 코드는 주지 않는다."].filter(Boolean).join("\n\n");
  return { text: await askText("code:error", TUTOR, user) };
}

/** 반례 찾기: the model proposes small tricky inputs; the reference and the learner's code decide which one breaks it. */
export async function counterexample(input: { problemId: string; lang: Lang; code: string }) {
  const p = await readProblem(input.problemId);
  const data = await askJson<{ inputs: string[] }>("code:counter",
    "문제의 입력 형식을 정확히 지키는 작고 까다로운 입력을 10개 만든다 (경계값, 최소 크기, 같은 값 반복, 음수, 자료형 범위). 각 입력은 프로그램 표준입력에 그대로 들어갈 문자열.",
    [problemBlock(p), `[학습자 코드]\n${input.code.slice(0, 12000)}`].join("\n\n"), S.obj({ inputs: S.arr(S.str) }));
  return findCounterexample(p.id, input.lang, input.code, data.inputs.slice(0, 12));
}

/* ---------- 문제 만들기 ---------- */
// docs/DECISIONS.md 2026-10-26 "코드 문제 받아오기": every input (topic, lesson, a pasted problem) ends as the same problem
// shape and goes through the same check. A pasted problem's examples are the answer key; without them the reference is
// cross-checked against a simple solution. A draft that fails is asked again with the reason, twice at most, then refused.
type Drafted = {
  title: string; statement: string; inputText: string; outputText: string; answerKind: "one" | "many" | "approx";
  sourceExamples: Array<{ input: string; output: string }>; exampleInputs: string[]; testInputs: string[];
  reference: string; brute: string; smallInputs: string[]; knowledge: string[]; folder: string; blank: { code: string; filled: string };
};
const MAKE_SYSTEM = `알고리즘 연습 문제를 하나 세팅한다. 입력은 주제, 강의 글, 또는 학습자가 붙여 넣은 문제 글이다.
- 붙여 넣은 글에 이미 문제(설명과 예제 입출력)가 있으면 그 문제를 그대로 세팅한다. statement·inputText·outputText는 원문 뜻 그대로 한국어로, 예제는 sourceExamples에 원문 글자 그대로(입력과 출력 모두) 옮긴다. 원문에 없는 예제는 sourceExamples에 넣지 않는다.
- 그런 문제가 없으면 공부한 내용을 직접 써먹는 문제를 새로 쓴다. 기존 저지 문제를 베끼지 않는다. statement는 한국어, 상황과 핵심을 짧게. sourceExamples는 빈 배열.
- answerKind: 정답 출력이 하나로 정해지면 "one", 정답이 여러 개 가능하면(아무거나 출력) "many", 실수 오차를 허용하면 "approx".
- exampleInputs: sourceExamples가 비었을 때만 예제 입력 1~2개, 아니면 빈 배열. testInputs: 채점용 입력 8~12개. 작은 경계 경우와 큰 경우를 섞는다 (큰 경우는 문자열 길이 20만자 이내). 모든 입력은 문제의 입력 형식과 범위를 지킨다.
- reference: 정답 프로그램. 반드시 JavaScript(Node.js), require("fs").readFileSync(0, "utf8")로 표준입력을 읽고 console.log로 출력. 출력은 이것으로 만든다.
- brute: sourceExamples가 비었을 때만. reference와 다른 방법의, 느리지만 단순해서 틀리기 어려운 풀이(모든 경우를 다 해 보기). 같은 입출력 규칙의 JavaScript. 아니면 빈 문자열.
- smallInputs: sourceExamples가 비었을 때만. brute가 1초 안에 푸는 작은 입력 20~30개 (최소 크기, 경계, 같은 값 반복 포함). 아니면 빈 배열.
- knowledge: 이 문제가 확인하는 지식 이름 1~3개 (학습자 지식 목록에 같은 것이 있으면 그 이름 그대로).
- folder: "알고리즘/이분 탐색"처럼.
- blank: 빈칸 문제를 요청받았을 때만. code는 요청한 언어의 완성된 풀이에서 핵심 줄 2~4곳을 ____ 로 바꾼 것, filled는 빈칸을 채운 완성 코드. 아니면 둘 다 빈 문자열.`;
const MAKE_SCHEMA = S.obj({ title: S.str, statement: S.str, inputText: S.str, outputText: S.str, answerKind: S.oneOf("one", "many", "approx"),
  sourceExamples: S.arr(S.obj({ input: S.str, output: S.str })), exampleInputs: S.arr(S.str), testInputs: S.arr(S.str), reference: S.str, brute: S.str, smallInputs: S.arr(S.str),
  knowledge: S.arr(S.str), folder: S.str, blank: S.obj({ code: S.str, filled: S.str }) });
const MAKE_RETRIES = 2;
const CROSS_MIN = 10;

type Checked = { ok: true; examples: TestCase[]; tests: TestCase[]; check: Omit<ProblemCheck, "tries">; from: "source" | "made" } | { ok: false; reason: string };
/** One draft through the check. Returns the reason it failed (sent back to the model) or the tests that survived. */
type Human = { lang: Lang; code: string };
async function checkDraft(d: Drafted, kind: "full" | "blank", lang: Lang, pasted: string, human?: Human): Promise<Checked> {
  // An example counts as the answer key only if its input and output are really in the pasted text (spacing ignored).
  const squash = (text: string) => text.replace(/\s+/g, "");
  const inPasted = (text: string) => !squash(text) || squash(pasted).includes(squash(text));
  const given = d.sourceExamples.filter((ex) => ex.input.trim() || ex.output.trim());
  const source = given.filter((ex) => inPasted(ex.input) && inPasted(ex.output)).slice(0, 5);
  if (given.length && source.length < given.length) return { ok: false, reason: `sourceExamples ${given.length - source.length}개가 붙여 넣은 글에 없음 (원문에 있는 예제만 넣는다)` };
  let examples: TestCase[]; let check: Omit<ProblemCheck, "tries">;
  if (source.length) {
    const mismatch = await matchSourceExamples(d.reference, source);
    if (mismatch) return { ok: false, reason: mismatch };
    examples = source.map((ex) => ({ input: ex.input, output: normalizeOutput(ex.output) }));
    check = { by: "source", cases: source.length };
  } else {
    if (!d.brute.trim()) return { ok: false, reason: "원문 예제가 없는데 단순 풀이(brute)가 비어 있음" };
    const cross = await crossCheck(d.reference, d.brute, d.smallInputs.slice(0, 30));
    if (cross.mismatch) return { ok: false, reason: cross.mismatch };
    if (cross.compared < CROSS_MIN) return { ok: false, reason: `단순 풀이로 확인된 작은 입력이 ${cross.compared}개뿐 (${CROSS_MIN}개 이상 필요)` };
    examples = (await answerWithReference(d.reference, d.exampleInputs.slice(0, 3))).tests;
    check = { by: "cross", cases: cross.compared };
  }
  const answered = await answerWithReference(d.reference, d.testInputs.slice(0, 14));
  if (answered.tests.length + examples.length < 3 || !examples.length) return { ok: false, reason: `모범 풀이로 답이 나온 테스트가 부족함 (${answered.dropped.length}개 실패: ${answered.dropped.slice(0, 2).map((x) => x.why).join(" / ")})` };
  if (human) {
    // A person's solution from the sources outranks the model's: it must print the same on every kept test.
    const theirs = await judge(human.lang, human.code, [...examples, ...answered.tests], { stopAtFirstFail: true });
    const miss = theirs.results.find((r) => r.verdict !== "AC");
    if (theirs.verdict === "MISSING" || theirs.verdict === "CE") check = { ...check, human: "skipped" };
    else if (miss) return { ok: false, reason: `사람이 쓴 정답 코드와 모범 풀이가 다름: 테스트 입력 (${miss.input.replace(/\n/g, " ⏎ ").slice(0, 80)})에서 모범 풀이 ${miss.expected.slice(0, 60)}, 사람 코드 ${(miss.got || miss.verdict).slice(0, 60)}` };
    else check = { ...check, human: "match" };
  }
  if (kind === "blank") {
    if (!d.blank.code.includes("____") || !d.blank.filled.trim()) return { ok: false, reason: "빈칸 코드(____)나 채운 코드가 비어 있음" };
    const filled = await judge(lang, d.blank.filled, [...examples, ...answered.tests], { stopAtFirstFail: true });
    if (filled.verdict === "MISSING") throw new CodeError(422, `${LANG_LABEL[lang]} 실행기가 없어 빈칸 문제를 확인할 수 없어요.`);
    if (filled.verdict !== "AC") return { ok: false, reason: `빈칸을 채운 코드가 테스트를 통과하지 못함 (${filled.verdict})` };
  }
  return { ok: true, examples, tests: answered.tests, check, from: source.length ? "source" : "made" };
}

/** A new problem from a topic, a lesson or a pasted problem. Saved only after the check passes; otherwise refused with the reason. */
export async function makeProblem(input: { topic?: string; lesson?: string; kind: "full" | "blank"; lang?: Lang; sourceTitle?: string; sourceUrl?: string; human?: Human; folder?: string; id?: string }) {
  const names = (await searchKnowledge(input.topic || input.lesson?.slice(0, 200) || "", { limit: 12 })).map((h) => h.title);
  const user = [input.topic ? `[주제] ${input.topic}` : "", input.lesson ? `[강의 글 또는 붙여 넣은 문제]\n${input.lesson.slice(0, 30000)}` : "", names.length ? `[학습자 지식 목록] ${names.join(", ")}` : "",
    input.kind === "blank" ? `[빈칸 문제 언어] ${LANG_LABEL[input.lang ?? "python"]}` : "[빈칸 문제 아님]"].filter(Boolean).join("\n\n");
  const lang = input.lang ?? "python";
  const reasons: string[] = [];
  for (let tries = 1; tries <= 1 + MAKE_RETRIES; tries++) {
    const retry = reasons.length ? `\n\n[지난 시도에서 막힌 곳]\n${reasons.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n같은 실수가 없게 다시 세팅한다.` : "";
    const d = await askJson<Drafted>("code:make", MAKE_SYSTEM, user + retry, MAKE_SCHEMA, { heavy: true });
    if (d.answerKind !== "one") throw new CodeError(422, "답이 여러 개이거나 소수점 오차를 허용하는 문제는 아직 채점할 수 없어서 만들지 않았어요.");
    const checked = await checkDraft(d, input.kind, lang, input.lesson ?? "", input.human);
    if (!checked.ok) { reasons.push(checked.reason); continue; }
    return saveProblem({ ...(input.id ? { id: input.id } : {}), title: d.title, statement: d.statement, inputText: d.inputText, outputText: d.outputText, examples: checked.examples, tests: checked.tests, timeLimitMs: 2000,
      kind: input.kind, templates: input.kind === "blank" ? { [lang]: d.blank.code } : {}, reference: { lang: "javascript", code: d.reference },
      knowledge: d.knowledge.slice(0, 3), folder: input.folder || d.folder || "알고리즘", examplesFrom: checked.from, check: { ...checked.check, tries },
      source: { kind: "ai", title: input.sourceTitle || (input.topic ? `주제: ${input.topic}` : "강의 글"), ...(input.sourceUrl ? { url: input.sourceUrl } : {}) } });
  }
  throw new CodeError(422, `모범 풀이를 확인하지 못해서 저장하지 않았어요 (${1 + MAKE_RETRIES}번 시도). 마지막에 막힌 곳: ${reasons.at(-1)}`);
}
