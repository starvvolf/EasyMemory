// 생각 따라가기 (11/16 실험): 알고리즘 풀이 기록 하나를 시간 순서대로 통째로 AI에 한 번 주고,
// 학습자가 상호작용한 순간(질문 · 예제 실행 · 제출)마다 그때 머릿속 생각을 따라가며 추론하게 한다.
// 실행: node --experimental-strip-types tools/thought-trace/run.ts [문제 id] [--dry]
// 데이터 폴더는 STUDY_FORGE_DATA_DIR(없으면 ./data). 로그인은 앱과 같은 ChatGPT 로그인을 읽는다.
// 결과는 tools/thought-trace/out/ (기록 원문이 들어가므로 커밋하지 않는다).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const DATA = path.resolve(root, process.env.STUDY_FORGE_DATA_DIR || "data");
process.env.STUDY_FORGE_DATA_DIR = DATA;
process.env.STUDY_FORGE_AUTH_DIR ||= DATA;
process.env.STUDY_FORGE_MODEL_PROVIDER ||= "chatgpt";
if (!process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY) {
  const keyFile = path.join(os.homedir(), ".study-forge", "chatgpt-token-key");
  if (existsSync(keyFile)) process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY = readFileSync(keyFile, "utf8").trim();
}

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const problemId = args.find((a) => !a.startsWith("--")) || "cp_20ef08b5115a"; // 기본: 바이러스(백준 2606) 풀이

type Talk = { at: string; problemId: string; q: string; a: string; selection?: string; code?: string };
type Sub = { at: string; problemId: string; mode: string; verdict: string; passed?: number; total?: number; code: string; lang?: string };
const jsonl = <T>(file: string): T[] => existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
// 풀이 기록은 RECORD_DIR에서 읽기만 한다(없으면 데이터 폴더). 예: 배포판 코드 · 로그인으로 다른 폴더의 기록을 돌려 볼 때.
const REC = path.resolve(root, process.env.RECORD_DIR || DATA);
const problem = JSON.parse(readFileSync(path.join(REC, "code", "problems", `${problemId}.json`), "utf8"));
const talk = jsonl<Talk>(path.join(REC, "code", "tutor", "talk.jsonl")).filter((t) => t && t.problemId === problemId);
const subs = jsonl<Sub>(path.join(REC, "code", "submissions.jsonl")).filter((s) => s && s.problemId === problemId);
type Ev = { at: string; talk?: Talk; sub?: Sub };
const events: Ev[] = [...talk.map((t) => ({ at: t.at, talk: t })), ...subs.map((s) => ({ at: s.at, sub: s }))].sort((a, b) => a.at.localeCompare(b.at));
if (!events.length) { console.log(`${problemId}: 풀이 기록이 없어요.`); process.exit(1); }

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(11, 19);
const numbered = (code: string) => code.replace(/\r/g, "").replace(/\s+$/, "").split("\n").map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n");
let lastCode = "";
/** 바로 앞 순간 코드와 달라진 줄(+ 새로 생김 / - 없어짐). 코드에만 드러난 생각을 놓치지 않게. */
const diffLines = (before: string, after: string) => {
  const a = before ? before.split("\n").map((l) => l.trimEnd()) : [], b = after.split("\n").map((l) => l.trimEnd());
  const left = new Map<string, number>(); for (const l of a) left.set(l, (left.get(l) ?? 0) + 1);
  const added: string[] = []; for (const l of b) { const k = left.get(l) ?? 0; if (k) left.set(l, k - 1); else if (l.trim()) added.push(`+ ${l}`); }
  const removed = [...left.entries()].flatMap(([l, k]) => l.trim() ? Array(k).fill(`- ${l}`) : []);
  return [...added, ...removed].join("\n");
};
const blocks = events.map((e, i) => {
  const n = i + 1;
  const code = (e.talk?.code ?? e.sub?.code ?? "").replace(/\r/g, "").replace(/\s+$/, "");
  const diff = code === lastCode ? "" : diffLines(lastCode, code);
  const codePart = code === lastCode ? "그 순간 코드: (바로 앞 순간과 같음)" : `그 순간 코드:\n${numbered(code)}${lastCode && diff ? `\n바로 앞 순간과 달라진 줄:\n${diff}` : ""}`;
  lastCode = code;
  if (e.talk) {
    const sel = e.talk.selection?.trim() && !code.startsWith(e.talk.selection.trim().slice(0, 40)) ? `\n학습자가 골라 둔 부분: ${e.talk.selection.trim()}` : "";
    return `#${n} ${kst(e.at)} 질문\n학습자: ${e.talk.q}${sel}\n${codePart}\n튜터 답: ${e.talk.a}`;
  }
  const s = e.sub!;
  return `#${n} ${kst(e.at)} ${s.mode === "submit" ? "제출" : "예제 실행"} → ${s.verdict}${s.total ? ` (${s.passed}/${s.total})` : ""}\n${codePart}`;
});

const SYSTEM = `너는 알고리즘 문제 풀이 기록을 처음부터 시간 순서대로 따라가며, 학습자의 생각이 어떻게 이어지다가 막히는지 본다.

[걸린 것의 세 갈래] 학습자가 걸린 것은 왜 막혔는지로 나눈다(겉모양이 아니라 이유로):
- 발상: 이 문제를 풀려고 떠올려야 하는 생각(예: 연결을 어떻게 담나, 시작점에서 어떻게 퍼져 나가나, 무엇을 다시 보지 않게 막나, 언제까지 반복하나).
- 기본기: 이 문제가 아니어도 그 언어를 쓰면 필요한 것(예: 입력 받기, for문, append, 리스트 만들기, +=, pop의 인자가 위치라는 것).
- 애매: 기본기와 발상이 겹쳐 있어 한쪽으로 나누기 어려운 것(예: 넣자마자 pop으로 다시 뺌 — pop 사용법도 흔들리고 "대기줄은 나중에 볼 목록"이라는 발상도 없음). 어느 부분이 기본기고 어느 부분이 발상인지 why에 쓴다.
앱 사용 · 입력 칸 · 실행 환경 문제와 단순 오타는 넣지 않는다.
level: 애매하게 앎(방향 · 이름은 있지만 구체적인 방법을 스스로 못 만듦) / 모름(그게 무엇인지 자체를 모름).
end: 스스로 씀(뒤에 튜터 코드 없이 스스로 맞게 씀) / 튜터 코드 옮김 / 남음(끝까지 흔들림).

하는 일:
1. 생각을 따라간다. 발상이나 애매에서 딱 막히는 순간을 체크하고, 막힘과 막힘 사이를 "생각 묶음" 하나로 나눈다. 기본기에서 걸린 것은 묶음을 끊지 않고 그 묶음의 basics에 적는다. 묶음은 시간 순서대로 빠짐없이 이어져야 한다.
2. 묶음마다:
   - thinking: 그 묶음 안에서 생각이 어떤 순서로 이어졌는지 짧게(→로 이어도 된다)
   - stuckAt / stuck / kind / level: 어느 순간에, 무엇에서 막혔는지, 발상인지 애매인지, 애매하게 아는지 모르는지
   - missing: 스스로 만들지 못한 그 한 조각을 구체적으로
   - hint: 다시 움직이게 한 힌트의 요지
   - after: 힌트를 받은 뒤 생각이 어떻게 갔는지(이해한 것이 다음 코드나 말에 이어졌는지, 다시 막혔는지)
   - basics: 이 묶음 안에서 걸린 기본기(짧게)
   마지막 묶음이 막히지 않고 끝났으면 stuckAt을 0, stuck · kind · level을 빈 값으로 둔다.
3. orderCheck: 묶음들을 띄워 놓고 보이는 생각의 순서 자체에 문제가 없는지 본다. 문제가 있으면 어떤 순서였고, 그 순서 때문에 무엇이 꼬였고, 어떤 순서였으면 덜 막혔을지 쓴다. 문제가 없으면 빈 배열.
4. items: 기록 전체에서 걸린 것을 모두 모은다(발상 · 애매 · 기본기). 같은 것이 여러 번 걸렸으면 하나로 모으고 순간들을 다 적는다.
   애매 항목은 basicPart(기본기 쪽에서 빠진 것)와 ideaPart(발상 쪽에서 빠진 것)를 따로 쓴다. 발상 · 기본기 항목은 둘 다 빈 문자열.
   wrote: 학습자가 그 항목에서 실제로 틀리게 쓴 줄(예: virus=+1, queue.pop(neighbor)). 없으면 빈 문자열.
5. flow: 묶음들을 이어 보면 생각이 어떻게 흘렀는지 몇 문장으로.

규칙: 말뿐 아니라 코드도 읽는다(바로 앞 순간과 달라진 줄 포함, 튜터 답에 있던 코드를 옮긴 것인지 구분). 학습자를 평가하거나 탓하지 말고, 버릇을 단정하지 말고, 튜터를 평가하지 않는다. 드러나지 않은 것은 지어내지 않는다.`;
const USER = `[문제] ${problem.title}\n${problem.statement}\n\n[풀이 기록] 시간 순서, 한국 시간. 순간 ${events.length}개.\n\n${blocks.join("\n\n")}`;
const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const arr = (items: unknown) => ({ type: "array", items });
const en = (...v: string[]) => ({ type: "string", enum: v });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const KIND = en("발상", "애매", "기본기");
const LEVEL = en("애매하게 앎", "모름");
const SCHEMA = obj({
  segments: arr(obj({ moments: arr(int), thinking: str, stuckAt: int, stuck: str, kind: en("발상", "애매", ""), level: en("애매하게 앎", "모름", ""), missing: str, hint: str, after: str, basics: arr(str) })),
  orderCheck: arr(obj({ moments: arr(int), order: str, problem: str, better: str })),
  items: arr(obj({ item: str, kind: KIND, level: LEVEL, moments: arr(int), missing: str, why: str, end: en("스스로 씀", "튜터 코드 옮김", "남음"), basicPart: str, ideaPart: str, wrote: str })),
  flow: str,
});

const outDir = path.join(import.meta.dirname, "out");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
console.log(`${problem.title}: 순간 ${events.length}개, 보낼 글 ${SYSTEM.length + USER.length}자`);
if (dry) { writeFileSync(path.join(outDir, `${problemId}-${stamp}-input.txt`), `${SYSTEM}\n\n=====\n\n${USER}`); console.log("--dry: 보내지 않고 입력만 저장했어요."); process.exit(0); }

const { askJson } = await import("../../src/lib/assist/model.ts");
type Reply = { segments: Array<{ moments: number[]; thinking: string; stuckAt: number; stuck: string; kind: string; level: string; missing: string; hint: string; after: string; basics: string[] }>;
  orderCheck: Array<{ moments: number[]; order: string; problem: string; better: string }>;
  items: Array<{ item: string; kind: string; level: string; moments: number[]; missing: string; why: string; end: string; basicPart: string; ideaPart: string; wrote: string }>; flow: string };
const effort = process.env.THOUGHT_EFFORT || "medium";
if (!process.env.THOUGHT_REPLY_FILE) console.log(`ChatGPT에 한 번 보내요(gpt-6.1-terra · ${effort}). 1~3분쯤 걸려요...`);
const started = Date.now();
let usage: unknown;
// THOUGHT_REPLY_FILE=<전에 받은 .json>: AI를 다시 부르지 않고 그 답으로 결과 글만 다시 만든다.
const saved = process.env.THOUGHT_REPLY_FILE ? JSON.parse(readFileSync(process.env.THOUGHT_REPLY_FILE, "utf8")) : null;
const reply: Reply = saved ? saved.reply : await askJson<Reply>("scene:follow-thought", SYSTEM, USER, SCHEMA, { effort, onUsage: (u) => { usage = u; } });
if (saved) usage = saved.usage;
const sec = saved ? saved.sec : Math.round((Date.now() - started) / 1000);
const base = path.join(outDir, `${problemId}-${stamp}`);
if (!saved) writeFileSync(`${base}.json`, JSON.stringify({ problemId, at: new Date().toISOString(), sec, usage, effort, reply }, null, 1));
const span = (xs: number[]) => xs.length ? (xs.length > 1 ? `#${Math.min(...xs)}~#${Math.max(...xs)}` : `#${xs[0]}`) : "";
const ms = (xs: number[]) => xs.map((m) => `#${m}`).join(" ");
// 갈래별로 코드가 모은다: 발상 → 애매 → 기본기, 그 안에서 남음 → 튜터 코드 옮김 → 스스로 씀
const END = ["남음", "튜터 코드 옮김", "스스로 씀"];
const group = (kind: string) => reply.items.filter((x) => x.kind === kind).sort((x, y) => END.indexOf(x.end) - END.indexOf(y.end))
  .flatMap((x) => [`- **${x.item}** — ${x.level}, ${x.end} (${ms(x.moments)})`, ...(x.missing ? [`   - 빠진 조각: ${x.missing}`] : []), ...(x.why ? [`   - ${kind === "애매" ? "어디가 기본기 · 어디가 발상" : "왜"}: ${x.why}`] : [])]);
const md = [`# 생각 따라가기 — ${problem.title}`, "", `- 순간 ${events.length}개 · AI 1번 · ${sec}초 · 토큰 ${JSON.stringify(usage ?? {})}`, "",
  "## 생각 묶음 (발상 · 애매에서 막힌 곳마다 끊음)", "",
  ...reply.segments.flatMap((g, i) => [`### 묶음 ${i + 1} (${span(g.moments)})`, "", `- 생각: ${g.thinking}`,
    ...(g.stuckAt ? [`- **막힘 #${g.stuckAt} [${g.kind} · ${g.level}]: ${g.stuck}**`, `   - 빠진 조각: ${g.missing}`, `   - 힌트: ${g.hint}`, `   - 그 뒤: ${g.after}`] : ["- 막히지 않고 끝남"]),
    ...(g.basics.length ? [`- 걸린 기본기: ${g.basics.join(" / ")}`] : []), ""]),
  "## 생각의 순서", "",
  ...(reply.orderCheck.length ? reply.orderCheck.flatMap((o, i) => [`${i + 1}. ${o.order} (${ms(o.moments)})`, `   - 문제: ${o.problem}`, `   - 이랬으면: ${o.better}`]) : ["순서에 문제 없음"]), "",
  "## 걸린 것 세 갈래", "", "### 발상", "", ...group("발상"), "", "### 애매 (기본기 + 발상)", "", ...group("애매"), "", "### 기본기", "", ...group("기본기"), "",
  "## 전체 흐름", "", reply.flow, ""].join("\n");
let full = md;
if (!args.includes("--follow-only")) {
  const { targetsOf, makeBasics, makeIdeas, renderProblems } = await import("./make.ts");
  const lang = subs.at(-1)?.lang || "python";
  const momentList = events.map((e, i) => ({ n: i + 1, code: (e.talk?.code ?? e.sub?.code ?? "").replace(/\r/g, "").replace(/\s+$/, ""), hint: e.talk?.a ?? "" }));
  const { ideas, basics } = targetsOf(reply.items, reply.segments, momentList);
  console.log(`다시 물을 문제: 기본기 ${basics.length}개(묶음) · 발상 ${ideas.length}개`);
  const t0 = Date.now();
  const [basicMade, ideaMade] = await Promise.all([makeBasics(basics, lang, console.log), makeIdeas(ideas, lang, problem.title, console.log)]);
  const made = { sec: Math.round((Date.now() - t0) / 1000), basics: basicMade, ideas: ideaMade };
  writeFileSync(`${base}-problems.json`, JSON.stringify(made, null, 1));
  full = [md, `# 다시 물을 문제 (${made.sec}초)`, "", ...renderProblems(basicMade, ideaMade)].join("\n");
}
writeFileSync(`${base}.md`, full);
console.log(`끝났어요: ${sec}초. 결과: ${base}.md`);
