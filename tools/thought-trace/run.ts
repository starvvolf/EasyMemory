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

const SYSTEM = `너는 프로그래밍 학습자의 풀이 기록을 처음부터 시간 순서대로 따라가며, 학습자가 상호작용한 순간(질문 · 예제 실행 · 제출)마다 그 순간 학습자의 머릿속을 추론한다.
가장 중요한 일은 "애매하게 아는 것"을 짚는 것이다. 정확히 아는 것은 대개 AI에게 묻지 않으므로 기록에 잘 나오지 않는다. 기록에 나오는 것은 대부분 애매하게 알거나 모르는 것이고, 이 둘을 구분해야 한다.

[지식]
지식 하나(item)는 짧은 이름으로 잘게 쓴다(예: "BFS에서 대기줄의 역할", "pop(0)이 하는 일"). 앱 사용법 · 입력 칸 · 실행 환경 문제는 지식이 아니므로 넣지 않는다.
weight: 이 문제를 푸는 데 핵심인 생각이면 "핵심", 문법 · 표기처럼 곁가지면 "곁".
level 기준:
- exact(정확히 앎): 튜터가 보여 주기 전에 스스로 맞게 쓴 코드, 또는 구체적인 방법까지 맞게 말함. 튜터가 준 코드를 그대로 옮긴 것은 exact가 아니다.
- vague(애매하게 앎): 방향이나 이름은 맞지만 구체적인 방법을 스스로 만들지 못함. 구체성이 없는 말("~하면 되는 거네", "감이 안 오네"), 이름만 앎, 맞는지 확인을 구하는 말, 튜터 코드를 옮긴 직후, 설명을 듣고 알겠다고 했지만 다음 코드에 반영 못 함, 같은 것을 다시 물음, 고친 뒤 비슷한 곳을 또 틀림 등. 이런 신호는 말투가 다양하니 뜻으로 판단한다.
- unknown(모름): 그것이 무엇인지 자체를 물음, 또는 전혀 다른 생각으로 씀.
vague에는 missing을 꼭 쓴다: 무엇은 되고 어떤 한 조각을 스스로 만들지 못하는지 구체적으로.

[생각의 줄기와 끊김]
생각은 줄기(thread)로 이어진다(예: "연결을 저장하기", "1번부터 퍼져 나가게 하기"). 막히면 줄기가 갑자기 끊기고, 다른 데로 옮겨 갔다가 돌아오거나 돌아오지 않는다. 순간마다 어느 줄기인지와 움직임(move)을 쓴다:
- 새로 시작 / 이어짐 / 끊김(이 순간에 다른 줄기로 옮겨 감) / 돌아옴(끊겼던 줄기로 다시 옴)
끊김에는 원인을 생각한다: 문법에 막힘, 튜터가 다른 것을 지적함, 혼란으로 더 작은 것으로 물러남, 다음 걸음을 튜터에게 넘김 등.
돌아왔을 때 끊기기 전의 생각이 살아 있는지 본다: 살아서 돌아옴 / 바뀌어 돌아옴(예: 자기 생각이 사라지고 튜터에게 묻는 모양으로) / 사라짐(돌아오지 않음).
특히 "알았다가 잃은 것"을 짚는다: 어떤 순간에 이해한 것이 끊긴 뒤 다음 코드나 말에 이어지지 않으면, 그것은 애매하게 아는 것의 강한 증거다. 끊기면서 고쳐지지 않고 묻힌 틀린 생각도 짚는다.
모든 끊김이 문제는 아니다. 작은 문법을 처리하고 같은 생각으로 돌아오는 것은 정상이다.
순간마다 시각이 있으니 순간 사이 간격도 참고한다(긴 간격은 혼자 오래 붙잡았을 수 있음). 단정하지는 않는다.

[순서의 문제]
생각의 순서 때문에 꼬인 곳을 짚는다(예: 작은 예를 손으로 따라가 보기 전에 코드부터 씀, 계획 없이 다음 한 줄을 계속 받음, 구조를 다시 보지 않고 같은 곳만 고침, 실행해 보기 전에 AI에게 맞는지 물음, 문제가 요구하는 출력을 마지막에 챙김). 다음 걸음을 튜터가 정해 준 것인지, 학습자가 먼저 꺼낸 것인지 구분하고, 튜터가 정한 순서를 학습자 탓으로 쓰지 않는다. 기록 하나뿐이므로 버릇이라고 단정하지 않는다.

[규칙]
- 각 순간은 그 순간까지 보인 것(문제, 앞선 대화와 튜터 답, 그 순간의 말과 코드)만 근거로 한다. 뒤에 일어날 일을 아는 것처럼 쓰지 않는다. 그 순간의 튜터 답은 질문한 뒤에 본 것이므로 다음 순간부터 반영한다. 단, 끝의 목록(vague · threads · orderIssues)은 기록 전체를 보고 쓴다.
- 말뿐 아니라 코드도 읽는다. "바로 앞 순간과 달라진 줄"에서 새로 쓴 줄이 튜터 답에 있던 코드인지 스스로 쓴 것인지 구분한다. 코드에만 드러난 틀린 생각도 적는다.
- wrongIdea에는 생각의 실수만 쓴다. 오타 · 띄어쓰기 · 문법 실수는 slips에 따로 쓴다.
- thinking은 질문을 다시 말하지 말고, 왜 그 말이나 코드가 나왔는지(그때 머릿속 그림)를 한두 문장으로 쓴다.
- 드러나지 않은 것은 지어내지 않는다. 모든 순간을 빠짐없이 순서대로 쓴다.
- vague 목록: 기록 전체에서 애매하게 알았던 지식. 지식마다 weight, 나온 순간들, 확실했던 부분(solid), 빠진 조각(missing), 끝(end), 근거 인용.
- threads 목록: 줄기마다 나온 순간들, 끊김들(어느 순간에, 원인, 돌아온 모양, 끊기며 잃은 것).
- flow: 생각이 어떤 순서로 이어지고 끊기고 돌아왔는지 몇 문장으로.`;
const USER = `[문제] ${problem.title}\n${problem.statement}\n\n[풀이 기록] 시간 순서, 한국 시간. 순간 ${events.length}개.\n\n${blocks.join("\n\n")}`;
const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const arr = (items: unknown) => ({ type: "array", items });
const en = (...v: string[]) => ({ type: "string", enum: v });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const SCHEMA = obj({
  moments: arr(obj({ n: int, at: str, act: str, thread: str, move: en("새로 시작", "이어짐", "끊김", "돌아옴"), thinking: str,
    knowledge: arr(obj({ item: str, weight: en("핵심", "곁"), level: en("exact", "vague", "unknown"), missing: str, evidence: str })),
    wrongIdea: str, slips: arr(str), changed: str })),
  vague: arr(obj({ item: str, weight: en("핵심", "곁"), moments: arr(int), solid: str, missing: str, end: en("스스로 풀림", "튜터 코드로 덮음", "남음"), evidence: arr(str) })),
  threads: arr(obj({ name: str, moments: arr(int), breaks: arr(obj({ at: int, cause: str, back: en("살아서 돌아옴", "바뀌어 돌아옴", "사라짐"), backAt: int, lost: str })) })),
  orderIssues: arr(obj({ pattern: str, moments: arr(int), whoLed: en("학습자", "튜터", "섞임"), why: str, better: str })),
  flow: str,
});

const outDir = path.join(import.meta.dirname, "out");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
console.log(`${problem.title}: 순간 ${events.length}개, 보낼 글 ${SYSTEM.length + USER.length}자`);
if (dry) { writeFileSync(path.join(outDir, `${problemId}-${stamp}-input.txt`), `${SYSTEM}\n\n=====\n\n${USER}`); console.log("--dry: 보내지 않고 입력만 저장했어요."); process.exit(0); }

const { askJson } = await import("../../src/lib/assist/model.ts");
type Know = { item: string; weight: string; level: "exact" | "vague" | "unknown"; missing: string; evidence: string };
type Reply = { moments: Array<{ n: number; at: string; act: string; thread: string; move: string; thinking: string; knowledge: Know[]; wrongIdea: string; slips: string[]; changed: string }>;
  vague: Array<{ item: string; weight: string; moments: number[]; solid: string; missing: string; end: string; evidence: string[] }>;
  threads: Array<{ name: string; moments: number[]; breaks: Array<{ at: number; cause: string; back: string; backAt: number; lost: string }> }>;
  orderIssues: Array<{ pattern: string; moments: number[]; whoLed: string; why: string; better: string }>; flow: string };
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
const LV = { exact: "정확", vague: "애매", unknown: "모름" } as const;
// 정렬은 코드가: 핵심 먼저, 그다음 남음 → 튜터 코드로 덮음 → 스스로 풀림
const END = ["남음", "튜터 코드로 덮음", "스스로 풀림"];
const vague = [...reply.vague].sort((x, y) => (x.weight === "핵심" ? 0 : 1) - (y.weight === "핵심" ? 0 : 1) || END.indexOf(x.end) - END.indexOf(y.end));
const ms = (xs: number[]) => xs.map((m) => `#${m}`).join(" ");
const md = [`# 생각 따라가기 — ${problem.title}`, "", `- 순간 ${events.length}개 · AI 1번 · ${sec}초 · 토큰 ${JSON.stringify(usage ?? {})}`, "",
  "## 애매하게 안 것 (핵심 먼저, 남음 → 덮음 → 풀림)", "",
  ...vague.flatMap((v, i) => [`${i + 1}. **${v.item}** [${v.weight}] — ${v.end} (${ms(v.moments)})`, `   - 확실했던 것: ${v.solid}`, `   - 빠진 조각: ${v.missing}`, ...(v.evidence.length ? [`   - 근거: ${v.evidence.join(" / ")}`] : [])]), "",
  "## 생각의 줄기와 끊김", "",
  ...reply.threads.flatMap((t) => [`- **${t.name}** (${ms(t.moments)})`, ...t.breaks.map((b) => `   - #${b.at}에서 끊김: ${b.cause} → ${b.back}${b.back !== "사라짐" && b.backAt ? ` (#${b.backAt})` : ""}${b.lost ? ` · 잃은 것: ${b.lost}` : ""}`)]), "",
  "## 순서의 문제", "",
  ...reply.orderIssues.flatMap((o, i) => [`${i + 1}. **${o.pattern}** (${ms(o.moments)}, 이끈 쪽: ${o.whoLed})`, `   - 왜 문제: ${o.why}`, `   - 더 나은 순서: ${o.better}`]), "",
  "## 순간마다", "",
  ...reply.moments.map((m) => [`### #${m.n} ${m.at} ${m.act} · ${m.thread} (${m.move})`, "", m.thinking, "",
    ...m.knowledge.map((k) => `- [${LV[k.level] ?? k.level}·${k.weight}] ${k.item}${k.missing ? ` — 빠진 것: ${k.missing}` : ""}${k.evidence ? ` (근거: ${k.evidence})` : ""}`),
    m.wrongIdea ? `- 틀린 생각: ${m.wrongIdea}` : "", m.slips.length ? `- 문법 · 오타: ${m.slips.join(" / ")}` : "", m.changed ? `- 바뀐 것: ${m.changed}` : "", ""].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n")),
  "## 전체 흐름", "", reply.flow, ""].join("\n");
writeFileSync(`${base}.md`, md);
console.log(`끝났어요: ${sec}초. 결과: ${base}.md`);
