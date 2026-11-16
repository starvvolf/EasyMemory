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

지식 하나(item)는 짧은 이름으로 쓴다(예: "for문 문법", "인접 리스트에 담을 것", "BFS에서 대기줄의 역할", "pop(0)이 하는 일"). 크게 뭉뚱그리지 말고, 막힌 부분이 드러나게 잘게 쓴다.
level 기준:
- exact(정확히 앎): 튜터가 보여 주기 전에 스스로 맞게 쓴 코드, 또는 구체적인 방법까지 맞게 말함. 튜터가 준 코드를 그대로 옮긴 것은 exact가 아니다.
- vague(애매하게 앎): 방향이나 이름은 맞지만 구체적인 방법을 스스로 만들지 못함. 신호:
  · 구체성이 없는 말: "~하면 되는 거네", "이제 탐색하면 되네", "감이 안 오네", "헷갈려", "원리가 이해가 안 돼"
  · 이름만 앎: 개념 이름(BFS 등)은 꺼내지만 어떻게 움직이는지는 묻거나 못 씀
  · 확인 요청: "이건가?", "이거지?", "이제 된 거임?" — 코드가 맞아도 스스로 확신하지 못함
  · 튜터가 준 코드를 옮긴 직후이거나, 설명을 듣고 "알겠어"라고 했지만 다음 코드에 반영하지 못함
  · 같은 것을 여러 번 다시 묻거나, 고친 뒤 비슷한 곳을 또 틀림
- unknown(모름): 그것이 무엇인지 자체를 물음("neighbor는 뭐야", "for문 어케 씀"), 또는 전혀 다른 생각으로 씀.
vague에는 missing을 꼭 쓴다: 무엇은 되고 무엇이 빠져서 애매한지, 학습자가 스스로 만들지 못한 그 한 조각을 구체적으로("BFS라는 이름과 '1번부터 본다'는 말은 하지만, 꺼낸 컴퓨터의 이웃을 다시 대기줄에 넣어 건너서 퍼지게 하는 것은 못 만듦").

규칙:
- 각 순간은 그 순간까지 보인 것(문제, 앞선 대화와 튜터 답, 그 순간의 말과 코드)만 근거로 한다. 뒤에 일어날 일을 아는 것처럼 쓰지 않는다. 그 순간의 튜터 답은 질문한 뒤에 본 것이므로 다음 순간부터 반영한다.
- 말뿐 아니라 코드도 읽는다. "바로 앞 순간과 달라진 줄"에서 새로 쓴 줄이 튜터 답에 있던 코드인지, 스스로 쓴 것인지 구분한다. 말에는 없고 코드에만 드러난 틀린 생각도 적는다(예: 연결을 한쪽에만 담음, 리스트 칸을 하나 적게 만듦).
- wrongIdea에는 생각의 실수만 쓴다. 오타 · 띄어쓰기 · 문법 실수(for_in, =+ 같은 것)는 slips에 따로 쓴다. 문법 실수 뒤에 생각의 실수가 숨어 있으면 둘 다 쓴다.
- thinking은 질문을 다시 말하지 말고, 왜 그 말이나 코드가 나왔는지(그때 머릿속에 있던 그림)를 한두 문장으로 쓴다.
- changed: 바로 앞 순간에서 무엇이 바뀌었는지, 튜터 답이 무엇을 바꿨는지(첫 순간이면 빈 문자열).
- 드러나지 않은 것은 지어내지 않는다. 모든 순간을 빠짐없이 순서대로 쓴다.
- 끝에 vague 목록: 기록 전체에서 애매하게 알았던 지식을 모은다. 지식마다 나온 순간들, 확실했던 부분(solid), 빠진 조각(missing), 끝(end: 스스로 풀림 / 튜터 코드로 덮음 / 남음), 근거 인용. 나중에 다시 물어야 할 순서대로 쓴다(남음 → 튜터 코드로 덮음 → 스스로 풀림).
- flow: 무엇이 어떤 순서로 애매했다가 어떻게 되었는지 몇 문장으로.`;
const USER = `[문제] ${problem.title}\n${problem.statement}\n\n[풀이 기록] 시간 순서, 한국 시간. 순간 ${events.length}개.\n\n${blocks.join("\n\n")}`;
const str = { type: "string" } as const;
const arr = (items: unknown) => ({ type: "array", items });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const SCHEMA = obj({
  moments: arr(obj({ n: { type: "integer" }, at: str, act: str, thinking: str,
    knowledge: arr(obj({ item: str, level: { type: "string", enum: ["exact", "vague", "unknown"] }, missing: str, evidence: str })),
    wrongIdea: str, slips: arr(str), changed: str })),
  vague: arr(obj({ item: str, moments: arr({ type: "integer" }), solid: str, missing: str, end: { type: "string", enum: ["스스로 풀림", "튜터 코드로 덮음", "남음"] }, evidence: arr(str) })),
  flow: str,
});

const outDir = path.join(import.meta.dirname, "out");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
console.log(`${problem.title}: 순간 ${events.length}개, 보낼 글 ${SYSTEM.length + USER.length}자`);
if (dry) { writeFileSync(path.join(outDir, `${problemId}-${stamp}-input.txt`), `${SYSTEM}\n\n=====\n\n${USER}`); console.log("--dry: 보내지 않고 입력만 저장했어요."); process.exit(0); }

const { askJson } = await import("../../src/lib/assist/model.ts");
type Know = { item: string; level: "exact" | "vague" | "unknown"; missing: string; evidence: string };
type Reply = { moments: Array<{ n: number; at: string; act: string; thinking: string; knowledge: Know[]; wrongIdea: string; slips: string[]; changed: string }>;
  vague: Array<{ item: string; moments: number[]; solid: string; missing: string; end: string; evidence: string[] }>; flow: string };
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
const md = [`# 생각 따라가기 — ${problem.title}`, "", `- 순간 ${events.length}개 · AI 1번 · ${sec}초 · 토큰 ${JSON.stringify(usage ?? {})}`, "",
  "## 애매하게 안 것 (다시 물을 순서)", "",
  ...reply.vague.flatMap((v, i) => [`${i + 1}. **${v.item}** — ${v.end} (순간 ${v.moments.map((m) => `#${m}`).join(" ")})`, `   - 확실했던 것: ${v.solid}`, `   - 빠진 조각: ${v.missing}`, ...(v.evidence.length ? [`   - 근거: ${v.evidence.join(" / ")}`] : [])]), "",
  "## 순간마다", "",
  ...reply.moments.map((m) => [`### #${m.n} ${m.at} ${m.act}`, "", m.thinking, "",
    ...m.knowledge.map((k) => `- [${LV[k.level] ?? k.level}] ${k.item}${k.missing ? ` — 빠진 것: ${k.missing}` : ""}${k.evidence ? ` (근거: ${k.evidence})` : ""}`),
    m.wrongIdea ? `- 틀린 생각: ${m.wrongIdea}` : "", m.slips.length ? `- 문법 · 오타: ${m.slips.join(" / ")}` : "", m.changed ? `- 바뀐 것: ${m.changed}` : "", ""].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n")),
  "## 전체 흐름", "", reply.flow, ""].join("\n");
writeFileSync(`${base}.md`, md);
console.log(`끝났어요: ${sec}초. 결과: ${base}.md`);
