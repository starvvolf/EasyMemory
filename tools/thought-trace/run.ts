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
const blocks = events.map((e, i) => {
  const n = i + 1;
  const code = (e.talk?.code ?? e.sub?.code ?? "").replace(/\r/g, "").replace(/\s+$/, "");
  const codePart = code === lastCode ? "그 순간 코드: (바로 앞 순간과 같음)" : `그 순간 코드:\n${numbered(code)}`;
  lastCode = code;
  if (e.talk) {
    const sel = e.talk.selection?.trim() && !code.startsWith(e.talk.selection.trim().slice(0, 40)) ? `\n학습자가 골라 둔 부분: ${e.talk.selection.trim()}` : "";
    return `#${n} ${kst(e.at)} 질문\n학습자: ${e.talk.q}${sel}\n${codePart}\n튜터 답: ${e.talk.a}`;
  }
  const s = e.sub!;
  return `#${n} ${kst(e.at)} ${s.mode === "submit" ? "제출" : "예제 실행"} → ${s.verdict}${s.total ? ` (${s.passed}/${s.total})` : ""}\n${codePart}`;
});

const SYSTEM = `너는 프로그래밍 학습자의 풀이 기록을 처음부터 시간 순서대로 따라가며, 학습자가 상호작용한 순간(질문 · 예제 실행 · 제출)마다 그 순간 학습자의 머릿속에 어떤 생각이 있었는지 추론한다.
규칙:
- 각 순간은 그 순간까지 보인 것(문제, 앞선 대화와 튜터 답, 그 순간의 말과 코드)만 근거로 추론한다. 뒤에 일어날 일을 아는 것처럼 쓰지 않는다. 그 순간의 튜터 답은 학습자가 질문한 뒤에 본 것이므로 그 순간의 생각에는 쓰지 않고, 다음 순간에 반영한다.
- thinking: 그 순간 학습자가 하던 생각을 한두 문장으로. 학습자의 말투를 흉내 내지 말고 관찰자 입장에서 쓴다.
- believes: 학습자가 맞다고 믿고 있는 것. unsure: 헷갈리거나 모르는 것. wrongIdea: 말이나 코드에 드러난 틀린 생각(없으면 빈 문자열).
- changed: 바로 앞 순간과 비교해 생각이 어떻게 바뀌었는지, 튜터 답이 무엇을 바꿨는지(첫 순간이면 빈 문자열).
- evidence: 근거가 된 그 순간의 말이나 코드 줄을 짧게 인용한다(줄 번호 포함 가능).
- 드러나지 않은 것은 지어내지 말고 confidence를 low로 둔다. 오타 · 문법 실수와 생각의 실수를 구분한다.
- 모든 순간을 빠짐없이 순서대로 쓴다. 마지막 flow에 생각이 어떤 순서로 막히고 풀렸는지 몇 문장으로 정리한다.`;
const USER = `[문제] ${problem.title}\n${problem.statement}\n\n[풀이 기록] 시간 순서, 한국 시간. 순간 ${events.length}개.\n\n${blocks.join("\n\n")}`;
const str = { type: "string" } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const SCHEMA = obj({
  moments: { type: "array", items: obj({ n: { type: "integer" }, at: str, act: str, thinking: str, believes: { type: "array", items: str }, unsure: { type: "array", items: str },
    wrongIdea: str, changed: str, evidence: { type: "array", items: str }, confidence: { type: "string", enum: ["high", "mid", "low"] } }) },
  flow: str,
});

const outDir = path.join(import.meta.dirname, "out");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
console.log(`${problem.title}: 순간 ${events.length}개, 보낼 글 ${SYSTEM.length + USER.length}자`);
if (dry) { writeFileSync(path.join(outDir, `${problemId}-${stamp}-input.txt`), `${SYSTEM}\n\n=====\n\n${USER}`); console.log("--dry: 보내지 않고 입력만 저장했어요."); process.exit(0); }

const { askJson } = await import("../../src/lib/assist/model.ts");
type Reply = { moments: Array<{ n: number; at: string; act: string; thinking: string; believes: string[]; unsure: string[]; wrongIdea: string; changed: string; evidence: string[]; confidence: string }>; flow: string };
const effort = process.env.THOUGHT_EFFORT || "medium";
console.log(`ChatGPT에 한 번 보내요(gpt-6.1-terra · ${effort}). 1~3분쯤 걸려요...`);
const started = Date.now();
let usage: unknown;
const reply = await askJson<Reply>("scene:follow-thought", SYSTEM, USER, SCHEMA, { effort, onUsage: (u) => { usage = u; } });
const sec = Math.round((Date.now() - started) / 1000);
const md = [`# 생각 따라가기 — ${problem.title}`, "", `- 순간 ${events.length}개 · AI 1번 · ${sec}초 · 토큰 ${JSON.stringify(usage ?? {})}`, "",
  ...reply.moments.map((m) => [`## #${m.n} ${m.at} ${m.act} (확신 ${m.confidence})`, "", m.thinking, "",
    m.believes.length ? `- 믿는 것: ${m.believes.join(" / ")}` : "", m.unsure.length ? `- 헷갈림: ${m.unsure.join(" / ")}` : "",
    m.wrongIdea ? `- 틀린 생각: ${m.wrongIdea}` : "", m.changed ? `- 바뀐 것: ${m.changed}` : "", m.evidence.length ? `- 근거: ${m.evidence.join(" / ")}` : "", ""].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n")),
  "## 전체 흐름", "", reply.flow, ""].join("\n");
const base = path.join(outDir, `${problemId}-${stamp}`);
writeFileSync(`${base}.json`, JSON.stringify({ problemId, at: new Date().toISOString(), sec, usage, effort, reply }, null, 1));
writeFileSync(`${base}.md`, md);
console.log(`끝났어요: ${sec}초. 결과: ${base}.md`);
