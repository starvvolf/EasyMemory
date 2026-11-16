// 생각 따라가기 2~3단계 (11/16): 따라가기 결과로 다시 물을 문제를 만든다.
// - 기본기: 한 번에 묶어서(AI 1번). 두 모양이 헷갈린 것은 둘 중 고르기, 몰랐던 것은 아주 쉬운 코드 문제.
// - 발상: 대상 하나에 AI 1번. 원래 문제와 다른 상황에서 그 발상 하나만 노리는 빈칸 · 줄 배치 · 짧은 함수.
// 모든 코드 문제는 코드가 실행해서 확인한다: 정답은 돌고, 빈 답과 오답(학습자가 그때 쓴 모양)은 틀려야 한다.
import { askJson } from "../../src/lib/assist/model.ts";
import { runAll, sameOut, type RunOut } from "../../src/lib/scene/exec.ts";

export type Item = { item: string; kind: string; level: string; moments: number[]; missing: string; why: string; end: string; basicPart?: string; ideaPart?: string; wrote?: string };
export type Segment = { moments: number[]; stuckAt: number; stuck: string; kind: string; missing: string; hint: string };
export type Moment = { n: number; code: string; hint: string };
type IdeaTarget = { name: string; missing: string; moment: number; code: string; hint: string };
type BasicTarget = { name: string; missing: string; wrote: string };

const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const arr = (items: unknown) => ({ type: "array", items });
const en = (...v: string[]) => ({ type: "string", enum: v });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });

/** 1단계(코드): 따라가기 결과에서 낼 대상을 모은다. 오답 예시는 막힌 순간에 학습자가 실제로 쓴 코드. */
export function targetsOf(items: Item[], segments: Segment[], moments: Moment[]) {
  const at = (n: number) => moments.find((m) => m.n === n);
  const stuckMoment = (ms: number[]) => [...segments].reverse().find((s) => s.stuckAt && ms.includes(s.stuckAt))?.stuckAt ?? Math.max(...ms, 1);
  const ideas: IdeaTarget[] = [], basics: BasicTarget[] = [];
  for (const x of items) {
    const ideaMissing = x.kind === "발상" ? x.missing : x.kind === "애매" ? (x.ideaPart || "") : "";
    const basicMissing = x.kind === "기본기" ? x.missing : x.kind === "애매" ? (x.basicPart || "") : "";
    if (ideaMissing) {
      const n = stuckMoment(x.moments);
      const seg = segments.find((s) => s.stuckAt === n);
      ideas.push({ name: x.kind === "애매" ? `${x.item} (발상 쪽)` : x.item, missing: ideaMissing, moment: n, code: at(n)?.code ?? "", hint: seg?.hint || at(n)?.hint || "" });
    }
    if (basicMissing) basics.push({ name: x.kind === "애매" ? `${x.item} (기본기 쪽)` : x.item, missing: basicMissing, wrote: x.wrote ?? "" });
  }
  ideas.sort((a, b) => a.moment - b.moment); // 생각의 순서대로
  return { ideas, basics };
}

/* ---------------- 2단계: 기본기 묶음 ---------------- */
const BASIC_SYSTEM = `학습자가 알고리즘 문제를 풀다가 걸린 기본기(언어 문법 · 기본 사용법)마다 다시 확인하는 문제를 하나씩 만든다. 원래 문제의 이야기는 쓰지 않는다.
- 두 모양이 헷갈린 것(예: += 와 =+, pop(0) 과 pop(값))이면 format=choice: 두 보기 중 맞는 것을 고르게 한다. 보기 하나는 학습자가 실제로 쓴 모양(wrote)으로 한다. answer는 맞는 보기의 번호(0 또는 1). reference · tests는 비운다.
- 아예 몰랐던 것(예: 입력 받기, for문, append)이면 format=code: 코드 1~3줄로 풀리는 아주 쉬운 문제. 표준 입력을 읽고 표준 출력으로 낸다. reference는 정답 전체 코드, tests는 입력 2~4개(기대 출력은 쓰지 않는다, 코드가 reference를 돌려 만든다). wrong은 그 기본기를 모를 때 쓸 법한 틀린 코드(학습자가 실제로 쓴 모양이 있으면 그것을 옮긴다), 없으면 빈 문자열. options는 빈 배열, answer는 -1.
- question은 짧게, 무엇을 하라는지만. explain은 정답의 이유 한 줄.
- 언어는 {lang}.`;
const BASIC_SCHEMA = obj({ problems: arr(obj({ target: str, format: en("choice", "code"), question: str, options: arr(str), answer: int, reference: str, tests: arr(str), wrong: str, explain: str })) });
type Basic = { target: string; format: "choice" | "code"; question: string; options: string[]; answer: number; reference: string; tests: string[]; wrong: string; explain: string };
export type BasicMade = Basic & { expected?: string[]; problems?: string[] };

const differs = (got: RunOut[], expected: string[]) => got.filter((r, i) => !r.ok || !sameOut(r.out, expected[i])).length;

async function checkBasic(p: Basic, lang: string): Promise<BasicMade> {
  const problems: string[] = [];
  if (p.format === "choice") {
    if (p.options.length !== 2 || p.options[0].trim() === p.options[1].trim()) problems.push("보기는 서로 다른 두 개여야 해요.");
    if (p.answer !== 0 && p.answer !== 1) problems.push("answer는 0 또는 1이어야 해요.");
    return { ...p, problems };
  }
  if (!p.reference.trim() || p.tests.length < 2) return { ...p, problems: ["정답 코드와 입력 2개 이상이 필요해요."] };
  const ref = await runAll(lang, p.reference, p.tests);
  const broken = ref.find((r) => !r.ok);
  if (broken && !broken.ok) return { ...p, problems: [`정답 코드가 돌지 않아요: ${broken.error}`.slice(0, 200)] };
  const expected = ref.map((r) => (r as { out: string }).out);
  if (expected.every((e) => !e.trim())) problems.push("정답 출력이 비어 있어요.");
  if (p.wrong.trim() && !differs(await runAll(lang, p.wrong, p.tests), expected)) problems.push("오답 코드도 모든 입력에서 맞아요. 오답을 걸러 내는 입력을 넣어 주세요.");
  return { ...p, expected, problems };
}

export async function makeBasics(targets: BasicTarget[], lang: string, log: (s: string) => void) {
  if (!targets.length) return [] as BasicMade[];
  const user = (ts: BasicTarget[], why = "") => `[걸린 기본기]\n${ts.map((t, i) => `${i + 1}. ${t.name}\n   빠진 것: ${t.missing}${t.wrote ? `\n   학습자가 실제로 쓴 모양: ${t.wrote}` : ""}`).join("\n")}${why}`;
  log(`기본기 문제 ${targets.length}개를 한 번에 만들어요 (AI 1번)`);
  let made = await Promise.all((await askJson<{ problems: Basic[] }>("scene:basics", BASIC_SYSTEM.replace("{lang}", lang), user(targets), BASIC_SCHEMA)).problems.map((p) => checkBasic(p, lang)));
  const bad = made.filter((p) => p.problems?.length);
  if (bad.length) {
    log(`기본기 ${bad.length}개가 확인에서 걸려 그것만 다시 만들어요 (AI 1번)`);
    const again = targets.filter((t) => bad.some((b) => b.target === t.name));
    const why = `\n\n[지난번 확인에서 걸린 이유]\n${bad.map((b) => `- ${b.target}: ${b.problems!.join(" ")}`).join("\n")}`;
    const redo = await Promise.all((await askJson<{ problems: Basic[] }>("scene:basics", BASIC_SYSTEM.replace("{lang}", lang), user(again.length ? again : targets, why), BASIC_SCHEMA)).problems.map((p) => checkBasic(p, lang)));
    made = [...made.filter((p) => !p.problems?.length), ...redo];
  }
  return made;
}

/* ---------------- 3단계: 발상 문제 ---------------- */
const BLANK_LINE = "# [빈칸]";
const IDEA_SYSTEM = `학습자가 알고리즘 문제를 풀다가 막힌 "발상" 하나만 노리는 연습 문제를 만든다.
- 원래 문제와 다른 상황(다른 이야기, 다른 출력)으로 만든다. 그 발상 하나만 있으면 풀리고, 나머지는 다 주어진다.
- format: 빈칸(나머지 코드는 다 주고 발상이 들어갈 자리만 비움) / 줄 배치(필요한 줄들을 주고 반복 · 들여쓰기 구조로 배치하게 함, 줄 바꿈 · 범위가 발상일 때) / 짧은 함수(발상 하나가 함수 하나일 때).
- starter: 학습자가 받는 시작 코드(전체 프로그램). 비운 자리는 그 줄에 "${BLANK_LINE}" 주석 한 줄만 둔다(들여쓰기는 맞춘다). 줄 배치면 starter는 빈칸 없이 위아래 고정 부분만 두고, 배치할 줄들은 lines에 섞어서 준다.
- reference: 빈칸을 채운 정답 전체 프로그램. 표준 입력을 읽고 표준 출력으로 낸다.
- wrong: 학습자가 그때 쓴 모양(아래 [그때 코드])을 새 상황에 옮긴 오답 전체 프로그램. 그 발상이 빠진 모양이어야 한다.
- tests: 입력 4~8개. 그중 2개 이상은 wrong이 틀리게 되는 입력(예: 건너서 이어지는 연결, 뒤에서 앞으로 가는 연결). 기대 출력은 쓰지 않는다(코드가 reference를 돌려 만든다).
- story · task: 짧게. 풀이 방법이나 정답 줄을 글에 쓰지 않는다. aims: 이 문제가 노리는 것 한 줄.
- 언어는 {lang}.`;
const IDEA_SCHEMA = obj({ story: str, task: str, format: en("빈칸", "줄 배치", "짧은 함수"), starter: str, lines: arr(str), reference: str, wrong: str, tests: arr(str), aims: str });
type Idea = { story: string; task: string; format: string; starter: string; lines: string[]; reference: string; wrong: string; tests: string[]; aims: string };
export type IdeaMade = Idea & { target: string; moment: number; expected?: string[]; problems: string[]; tries: number };

async function checkIdea(p: Idea, lang: string) {
  const problems: string[] = [];
  if (p.tests.length < 4) problems.push("입력이 4개 이상 필요해요.");
  const ref = await runAll(lang, p.reference, p.tests);
  if (ref.some((r) => !r.ok)) return { problems: [...problems, "정답 코드가 어떤 입력에서 돌지 않아요."], expected: undefined };
  const expected = ref.map((r) => (r as { out: string }).out);
  const wrongMiss = differs(await runAll(lang, p.wrong, p.tests), expected);
  if (wrongMiss < 2) problems.push(`오답(그때 쓴 모양)이 ${wrongMiss}개 입력에서만 틀려요. 2개 이상에서 틀리게 하는 입력을 넣어 주세요.`);
  if (p.format !== "줄 배치") {
    if (!p.starter.includes(BLANK_LINE)) problems.push(`시작 코드에 "${BLANK_LINE}" 자리가 없어요.`);
    else if (!differs(await runAll(lang, p.starter, p.tests), expected)) problems.push("빈칸을 비운 채로 내도 모든 입력에서 맞아요.");
  } else if (p.lines.length < 2) problems.push("줄 배치에는 배치할 줄이 2개 이상 필요해요.");
  return { problems, expected };
}

export async function makeIdeas(targets: IdeaTarget[], lang: string, origin: string, log: (s: string) => void) {
  return Promise.all(targets.map(async (t, i): Promise<IdeaMade> => {
    const base = `[노릴 발상] ${t.name}\n[빠진 조각] ${t.missing}\n[원래 문제] ${origin} — 이것과 다른 상황으로\n[그때 코드] 학습자가 막힌 순간(#${t.moment})에 쓴 코드:\n${t.code || "(없음)"}\n[그때 받은 힌트] ${t.hint || "(없음)"}`;
    let why = "", made: IdeaMade | null = null;
    for (let tries = 1; tries <= 2; tries++) {
      log(`발상 ${i + 1}/${targets.length} "${t.name}" 문제를 만들어요${tries > 1 ? " (다시)" : ""} (AI 1번)`);
      const p = await askJson<Idea>("scene:idea-problem", IDEA_SYSTEM.replace("{lang}", lang), base + why, IDEA_SCHEMA);
      const c = await checkIdea(p, lang);
      made = { ...p, target: t.name, moment: t.moment, expected: c.expected, problems: c.problems, tries };
      if (!c.problems.length) break;
      why = `\n\n[지난번 확인에서 걸린 이유] ${c.problems.join(" ")}`;
    }
    return made!;
  }));
}

/** 결과 글 */
export function renderProblems(basics: BasicMade[], ideas: IdeaMade[]) {
  const fence = (code: string) => ["```python", code.replace(/\s+$/, ""), "```"];
  const io = (tests: string[], expected?: string[]) => tests.slice(0, 3).flatMap((t, i) => [`- 입력 ${i + 1}: \`${t.replace(/\n/g, "⏎")}\` → 출력 \`${(expected?.[i] ?? "?").replace(/\n/g, "⏎")}\``]);
  return [
    "## 기본기 묶음 (한 번에)", "",
    ...basics.flatMap((b, i) => [`### 기본기 ${i + 1}. ${b.target} ${b.problems?.length ? "⚠ 확인 실패: " + b.problems.join(" ") : "✓"}`, "", b.question, "",
      ...(b.format === "choice" ? [...b.options.map((o, k) => `${k === b.answer ? "**(정답)**" : "-"} \`${o}\``), ""] : [...io(b.tests, b.expected), "", "정답 코드:", ...fence(b.reference), ...(b.wrong ? ["", "걸러지는 오답:", ...fence(b.wrong)] : [])]),
      "", `설명: ${b.explain}`, ""]),
    "## 발상 문제 (생각의 순서대로 하나씩)", "",
    ...ideas.flatMap((d, i) => [`### 발상 ${i + 1}. ${d.target} — 막힌 순간 #${d.moment} · ${d.format} ${d.problems.length ? "⚠ 확인 실패: " + d.problems.join(" ") : "✓ 코드 확인 통과"}${d.tries > 1 ? " (다시 만듦)" : ""}`, "",
      `노리는 것: ${d.aims}`, "", `**${d.story}**`, "", d.task, "", "시작 코드:", ...fence(d.starter),
      ...(d.lines.length ? ["", "배치할 줄:", ...d.lines.map((l) => `- \`${l}\``)] : []), "", ...io(d.tests, d.expected), "",
      "<details><summary>정답 · 걸러지는 오답</summary>", "", "정답:", ...fence(d.reference), "", "오답(그때 쓴 모양):", ...fence(d.wrong), "", "</details>", ""]),
  ];
}
