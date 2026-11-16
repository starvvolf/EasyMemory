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
const problem = JSON.parse(readFileSync(path.join(DATA, "code", "problems", `${problemId}.json`), "utf8"));
const talk = jsonl<Talk>(path.join(DATA, "code", "tutor", "talk.jsonl")).filter((t) => t && t.problemId === problemId);
const subs = jsonl<Sub>(path.join(DATA, "code", "submissions.jsonl")).filter((s) => s && s.problemId === problemId);
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
볼 것은 이 문제를 푸는 알고리즘 개념뿐이다(예: 연결을 어떻게 담나, 시작점에서 어떻게 퍼져 나가나, 무엇을 다시 보지 않게 막나, 언제까지 반복하나). 입력 받기 · 문법 · 표기 · 오타 · 앱 사용 같은 곁가지는 막힘으로 세지 않는다.

하는 일:
1. 생각을 따라간다. 생각이 이어지다가 알고리즘 개념에서 딱 막히는 순간을 체크한다.
2. 막힌 뒤 힌트(튜터 답)를 받아 다시 가다가 또 막히면 또 체크한다. 이렇게 막힘과 막힘 사이를 "생각 묶음" 하나로 나눈다. 묶음은 시간 순서대로 빠짐없이 이어져야 한다.
3. 묶음마다:
   - thinking: 그 묶음 안에서 학습자의 생각이 어떤 순서로 이어졌는지 짧게(→로 이어도 된다)
   - stuckAt / stuck: 어느 순간에, 어떤 알고리즘 개념에서 막혔는지
   - level: 그 개념을 애매하게 아는지(방향 · 이름은 있지만 구체적인 방법을 스스로 못 만듦), 모르는지(그게 무엇인지 자체를 모름)
   - missing: 스스로 만들지 못한 그 한 조각을 구체적으로
   - hint: 다시 움직이게 한 힌트의 요지
   - after: 힌트를 받은 뒤 생각이 어떻게 갔는지(이해한 것이 다음 코드나 말에 이어졌는지, 다시 막혔는지)
   마지막 묶음은 막히지 않고 끝났으면 stuckAt을 0, stuck과 level을 빈 값으로 둔다.
4. orderCheck: 묶음들을 띄워 놓고 보이는 생각의 순서 자체에 문제가 없는지 본다. 문제가 있으면 어떤 순서였고, 그 순서 때문에 무엇이 꼬였고, 어떤 순서였으면 덜 막혔을지 쓴다. 문제가 없으면 빈 배열.
5. flow: 묶음들을 이어 보면 생각이 어떻게 흘렀는지 몇 문장으로.

규칙: 말뿐 아니라 코드도 읽는다(바로 앞 순간과 달라진 줄 포함). 학습자를 평가하거나 탓하지 말고, 버릇을 단정하지 말고, 튜터를 평가하지 않는다. 드러나지 않은 것은 지어내지 않는다.`;
const USER = `[문제] ${problem.title}\n${problem.statement}\n\n[풀이 기록] 시간 순서, 한국 시간. 순간 ${events.length}개.\n\n${blocks.join("\n\n")}`;
const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const arr = (items: unknown) => ({ type: "array", items });
const en = (...v: string[]) => ({ type: "string", enum: v });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const SCHEMA = obj({
  segments: arr(obj({ moments: arr(int), thinking: str, stuckAt: int, stuck: str, level: en("애매", "모름", ""), missing: str, hint: str, after: str })),
  orderCheck: arr(obj({ moments: arr(int), order: str, problem: str, better: str })),
  flow: str,
});

const outDir = path.join(import.meta.dirname, "out");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
console.log(`${problem.title}: 순간 ${events.length}개, 보낼 글 ${SYSTEM.length + USER.length}자`);
if (dry) { writeFileSync(path.join(outDir, `${problemId}-${stamp}-input.txt`), `${SYSTEM}\n\n=====\n\n${USER}`); console.log("--dry: 보내지 않고 입력만 저장했어요."); process.exit(0); }

const { askJson } = await import("../../src/lib/assist/model.ts");
type Reply = { segments: Array<{ moments: number[]; thinking: string; stuckAt: number; stuck: string; level: string; missing: string; hint: string; after: string }>;
  orderCheck: Array<{ moments: number[]; order: string; problem: string; better: string }>; flow: string };
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
const md = [`# 생각 따라가기 — ${problem.title}`, "", `- 순간 ${events.length}개 · AI 1번 · ${sec}초 · 토큰 ${JSON.stringify(usage ?? {})}`, "",
  "## 생각 묶음 (막힌 곳마다 끊음)", "",
  ...reply.segments.flatMap((g, i) => [`### 묶음 ${i + 1} (${span(g.moments)})`, "", `- 생각: ${g.thinking}`,
    ...(g.stuckAt ? [`- **막힘 #${g.stuckAt}: ${g.stuck}** [${g.level}]`, `   - 빠진 조각: ${g.missing}`, `   - 힌트: ${g.hint}`, `   - 그 뒤: ${g.after}`] : ["- 막히지 않고 끝남"]), ""]),
  "## 생각의 순서", "",
  ...(reply.orderCheck.length ? reply.orderCheck.flatMap((o, i) => [`${i + 1}. ${o.order} (${o.moments.map((m) => `#${m}`).join(" ")})`, `   - 문제: ${o.problem}`, `   - 이랬으면: ${o.better}`]) : ["순서에 문제 없음"]), "",
  "## 전체 흐름", "", reply.flow, ""].join("\n");
writeFileSync(`${base}.md`, md);
console.log(`끝났어요: ${sec}초. 결과: ${base}.md`);
