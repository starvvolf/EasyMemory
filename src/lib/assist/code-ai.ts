// 코드 학습의 AI 부분: 힌트 3단계, 드래그한 코드 설명, "맞는지 봐 줘", 에러 설명, 반례 입력, 문제 만들기.
// Whether code is right is never the model's call: that is the judge (src/lib/code). The model explains and hints.
import { askJson, askText, S } from "./model.ts";
import { LANG_LABEL, judge, type Lang } from "../code/run.ts";
import { answerWithReference, findCounterexample, readProblem, saveProblem, type Problem } from "../code/problems.ts";
import { memoryEvents, searchKnowledge } from "../knowledge/store.ts";

const TUTOR = `너는 알고리즘을 가르치는 튜터다. 학습자가 스스로 고치게 돕는다. 한국어로 짧게 답한다.
- 통과 여부는 채점기가 정한다. 너는 맞았다/틀렸다를 단정하지 않는다.
- 학습자가 이미 겪은 실수 기록이 주어지면, 같은 실수면 "지난번에도 …" 하고 짚는다.
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

const LEVELS: Record<1 | 2 | 3, string> = {
  1: "힌트 1단계: 방향만. 어떤 지식(문제가 확인하는 지식 이름을 그대로)의 어느 부분을 다시 보라고 1~2문장. 코드 줄을 짚지 않는다.",
  2: "힌트 2단계: 문제가 되는 줄이나 조건을 짚는다. 왜 틀리는지 실패한 입력으로 설명한다. 고친 코드는 주지 않는다.",
  3: "힌트 3단계: 고친 코드를 보여 준다. 바꾼 줄만, 바꾼 이유와 함께. 전체 코드를 다시 쓰지 않는다.",
};
export async function hint(input: { problemId: string; lang: Lang; code: string; level: 1 | 2 | 3; last?: LastResult }) {
  const p = await readProblem(input.problemId);
  const user = [problemBlock(p), `[언어] ${LANG_LABEL[input.lang]}`, `[학습자 코드]\n${input.code.slice(0, 20000)}`, resultBlock(input.last), await pastMisses(p), LEVELS[input.level]].filter(Boolean).join("\n\n");
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
  const user = [problemBlock(p), `[언어] ${LANG_LABEL[input.lang]}`, `[학습자 코드 (아직 제출 전)]\n${input.code.slice(0, 20000)}`, input.note ? `[학습자 메모] ${input.note}` : "", await pastMisses(p),
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
type Drafted = {
  title: string; statement: string; inputText: string; outputText: string; exampleInputs: string[]; testInputs: string[];
  reference: string; knowledge: string[]; folder: string; blank: { code: string; filled: string };
};
const MAKE_SYSTEM = `알고리즘 연습 문제를 하나 만든다. 학습자가 공부한 내용(주제나 강의 글)을 직접 써먹는 문제로.
- 기존 저지 문제를 베끼지 말고 새로 쓴다. statement는 한국어, 상황과 핵심을 짧게.
- exampleInputs: 예제 입력 1~2개. testInputs: 채점용 입력 8~12개. 작은 경계 경우와 큰 경우를 섞는다 (큰 경우는 문자열 길이 20만자 이내).
- reference: 정답 프로그램. 반드시 JavaScript(Node.js), require("fs").readFileSync(0, "utf8")로 표준입력을 읽고 console.log로 출력. 출력은 이것으로 만든다.
- knowledge: 이 문제가 확인하는 지식 이름 1~3개 (학습자 지식 목록에 같은 것이 있으면 그 이름 그대로).
- folder: "알고리즘/이분 탐색"처럼.
- blank: 빈칸 문제를 요청받았을 때만. code는 요청한 언어의 완성된 풀이에서 핵심 줄 2~4곳을 ____ 로 바꾼 것, filled는 빈칸을 채운 완성 코드. 아니면 둘 다 빈 문자열.`;
const MAKE_SCHEMA = S.obj({ title: S.str, statement: S.str, inputText: S.str, outputText: S.str, exampleInputs: S.arr(S.str), testInputs: S.arr(S.str), reference: S.str,
  knowledge: S.arr(S.str), folder: S.str, blank: S.obj({ code: S.str, filled: S.str }) });

/**
 * A new problem from a topic or a lesson. The reference answers every test; tests it cannot answer are dropped, and a
 * problem with fewer than 3 surviving tests (or a blank version whose filled code fails) is refused rather than saved.
 */
export async function makeProblem(input: { topic?: string; lesson?: string; kind: "full" | "blank"; lang?: Lang; sourceTitle?: string; sourceUrl?: string }) {
  const names = (await searchKnowledge(input.topic || input.lesson?.slice(0, 200) || "", { limit: 12 })).map((h) => h.title);
  const user = [input.topic ? `[주제] ${input.topic}` : "", input.lesson ? `[강의 글]\n${input.lesson.slice(0, 30000)}` : "", names.length ? `[학습자 지식 목록] ${names.join(", ")}` : "",
    input.kind === "blank" ? `[빈칸 문제 언어] ${LANG_LABEL[input.lang ?? "python"]}` : "[빈칸 문제 아님]"].filter(Boolean).join("\n\n");
  const d = await askJson<Drafted>("code:make", MAKE_SYSTEM, user, MAKE_SCHEMA, { heavy: true });
  const examples = (await answerWithReference(d.reference, d.exampleInputs.slice(0, 3))).tests;
  const answered = await answerWithReference(d.reference, d.testInputs.slice(0, 14));
  if (answered.tests.length + examples.length < 3 || !examples.length) throw new Error(`만든 문제의 테스트가 모범 풀이로 확인되지 않았어요 (${answered.dropped.length}개 실패). 다시 만들어 주세요.`);
  const lang = input.lang ?? "python";
  if (input.kind === "blank") {
    if (!d.blank.code.includes("____") || !d.blank.filled.trim()) throw new Error("빈칸 코드를 만들지 못했어요. 다시 만들어 주세요.");
    const check = await judge(lang, d.blank.filled, [...examples, ...answered.tests], { stopAtFirstFail: true });
    if (check.verdict === "MISSING") throw new Error(`${LANG_LABEL[lang]} 실행기가 없어 빈칸 문제를 확인할 수 없어요.`);
    if (check.verdict !== "AC") throw new Error("빈칸을 채운 코드가 테스트를 통과하지 못해서 저장하지 않았어요. 다시 만들어 주세요.");
  }
  return saveProblem({ title: d.title, statement: d.statement, inputText: d.inputText, outputText: d.outputText, examples, tests: answered.tests, timeLimitMs: 2000,
    kind: input.kind, templates: input.kind === "blank" ? { [lang]: d.blank.code } : {}, reference: { lang: "javascript", code: d.reference },
    knowledge: d.knowledge.slice(0, 3), folder: d.folder || "알고리즘", source: { kind: "ai", title: input.sourceTitle || (input.topic ? `주제: ${input.topic}` : "강의 글"), ...(input.sourceUrl ? { url: input.sourceUrl } : {}) } });
}
