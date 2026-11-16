// 생각 따라가기로 빈틈 뽑기 (11/16, 사용자 "그거로 다 바꿔서 v3 앱에 붙여"). 실험 tools/thought-trace/ 를 앱에 옮긴 것.
// 1) 따라가기(AI 1번): 풀이 기록을 시간 순서대로 통째로 주고, 알고리즘 발상에서 막힌 곳마다 생각 묶음으로 끊고,
//    걸린 것을 발상 · 기본기 · 애매(둘이 겹침) 세 갈래로 모은다. 애매는 기본기 쪽 · 발상 쪽으로 나눠 받는다.
// 2) 기본기 묶음(AI 1번): 두 모양이 헷갈린 것은 둘 중 고르기, 몰랐던 것은 아주 쉬운 코드 문제. 한 번에 만든다.
// 3) 발상 문제(대상 하나에 AI 1번, 동시에): 원래 문제와 다른 상황에서 그 발상 하나만 쓰면 풀리는 문제. 오답(mine)은 막힌 순간에 학습자가 실제로 쓴 모양.
// 장면은 기존 형식(write · choice)으로 저장해 화면 · 채점 · 사다리를 그대로 쓴다. 검사는 check.ts(정답은 코드가 돌려서, mine은 가르는 입력 둘 이상에서 틀려야).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkScene } from "./check.ts";
import type { Ask, Record_ } from "./extract.ts";
import { firstState } from "./ladder.ts";
import { changeGaps, newId, saveScene } from "./store.ts";
import { LAYER, type Evidence, type Gap, type GapKind, type Scene } from "./types.ts";

const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const arr = (items: unknown) => ({ type: "array", items });
const en = (...v: string[]) => ({ type: "string", enum: v });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const now = () => new Date().toISOString();

/* ---------------- 1. 따라가기 ---------------- */
export const FOLLOW_SYSTEM = `너는 알고리즘 문제 풀이 기록을 처음부터 시간 순서대로 따라가며, 학습자의 생각이 어떻게 이어지다가 막히는지 본다.

[걸린 것의 세 갈래] 학습자가 걸린 것은 왜 막혔는지로 나눈다(겉모양이 아니라 이유로):
- 발상: 이 문제를 풀려고 떠올려야 하는 생각(예: 연결을 어떻게 담나, 시작점에서 어떻게 퍼져 나가나, 무엇을 다시 보지 않게 막나, 언제까지 반복하나).
- 기본기: 이 문제가 아니어도 그 언어를 쓰면 필요한 것(예: 입력 받기, for문, append, 리스트 만들기, +=, pop의 인자가 위치라는 것).
- 애매: 기본기와 발상이 겹쳐 있어 한쪽으로 나누기 어려운 것(예: 넣자마자 pop으로 다시 뺌 — pop 사용법도 흔들리고 "대기줄은 나중에 볼 목록"이라는 발상도 없음).
앱 사용 · 입력 칸 · 실행 환경 문제와 단순 오타는 넣지 않는다.
level: 애매하게 앎(방향 · 이름은 있지만 구체적인 방법을 스스로 못 만듦) / 모름(그게 무엇인지 자체를 모름).
end: 스스로 씀(뒤에 튜터 코드 없이 스스로 맞게 씀) / 튜터 코드 옮김 / 남음(끝까지 흔들림).

하는 일:
0. toc(목차): 먼저 이 문제의 풀이를 목차처럼 파트로 나눈다. 첫 파트는 "기본기", 그다음은 풀이를 이루는 단위들을 풀이 순서대로(예: 기본기 / 연결 저장 / BFS 한 바퀴). 파트 안에서 더 작게 나뉘면 작은 묶음(sub)을 두고, 나뉘지 않으면 sub 하나(name "")만 둔다.
   4번의 items를 하나도 빠짐없이, 겹치지 않게 어느 파트 · 묶음에 넣는다(items의 item 이름 그대로). 기본기 항목은 기본기 파트에, 발상 · 애매 항목은 그 발상이 속한 파트에. 걸린 것이 없는 파트 · 묶음은 만들지 않는다.
   파트 수 · 묶음 수는 정해져 있지 않다(예: 항목 14개가 5/5/4로 나뉠 수도, (2)(3)/5/(2)(2)로 나뉠 수도 있다). 합치면 하나의 단위가 되는 것끼리 같은 파트에 둔다.
1. 생각을 따라간다. 발상이나 애매에서 딱 막히는 순간을 체크하고, 막힘과 막힘 사이를 "생각 묶음" 하나로 나눈다. 기본기에서 걸린 것은 묶음을 끊지 않고 그 묶음의 basics에 적는다. 묶음은 시간 순서대로 빠짐없이 이어져야 한다.
2. 묶음마다: thinking(그 묶음 안에서 생각이 이어진 순서, →로 이어도 됨), stuckAt · stuck · kind · level(어느 순간에 무엇에서 막혔나, 발상인지 애매인지, 애매하게 아는지 모르는지), missing(스스로 만들지 못한 한 조각), hint(다시 움직이게 한 힌트의 요지), after(힌트 뒤 생각이 어떻게 갔나), basics(이 묶음 안에서 걸린 기본기). 마지막 묶음이 막히지 않고 끝났으면 stuckAt 0, stuck · kind · level은 빈 값.
3. orderCheck: 묶음들을 띄워 놓고 보이는 생각의 순서 자체에 문제가 없는지 본다. 있으면 어떤 순서였고, 그 순서 때문에 무엇이 꼬였고, 어떤 순서였으면 덜 막혔을지. 없으면 빈 배열.
4. items: 기록 전체에서 걸린 것을 모두 모은다(발상 · 애매 · 기본기). 같은 것이 여러 번 걸렸으면 하나로 모으고 순간들을 다 적는다.
   애매 항목은 basicPart(기본기 쪽에서 빠진 것)와 ideaPart(발상 쪽에서 빠진 것)를 따로 쓴다. 발상 · 기본기 항목은 둘 다 빈 문자열.
   wrote: 학습자가 그 항목에서 실제로 틀리게 쓴 줄(예: virus=+1, queue.pop(neighbor)). 없으면 빈 문자열.
5. flow: 묶음들을 이어 보면 생각이 어떻게 흘렀는지 몇 문장으로.

규칙: 말뿐 아니라 코드도 읽는다(바로 앞 순간과 달라진 줄 포함, 튜터 답에 있던 코드를 옮긴 것인지 구분). 학습자를 평가하거나 탓하지 말고, 버릇을 단정하지 말고, 튜터를 평가하지 않는다. 드러나지 않은 것은 지어내지 않는다.`;
export const FOLLOW_SCHEMA = obj({
  toc: arr(obj({ part: str, subs: arr(obj({ name: str, items: arr(str) })) })),
  segments: arr(obj({ moments: arr(int), thinking: str, stuckAt: int, stuck: str, kind: en("발상", "애매", ""), level: en("애매하게 앎", "모름", ""), missing: str, hint: str, after: str, basics: arr(str) })),
  orderCheck: arr(obj({ moments: arr(int), order: str, problem: str, better: str })),
  items: arr(obj({ item: str, kind: en("발상", "애매", "기본기"), level: en("애매하게 앎", "모름"), moments: arr(int), missing: str, why: str, end: en("스스로 씀", "튜터 코드 옮김", "남음"), basicPart: str, ideaPart: str, wrote: str })),
  flow: str,
});
export type FollowReply = {
  toc?: Array<{ part: string; subs: Array<{ name: string; items: string[] }> }>;
  segments: Array<{ moments: number[]; thinking: string; stuckAt: number; stuck: string; kind: string; level: string; missing: string; hint: string; after: string; basics: string[] }>;
  orderCheck: Array<{ moments: number[]; order: string; problem: string; better: string }>;
  items: Array<{ item: string; kind: string; level: string; moments: number[]; missing: string; why: string; end: string; basicPart: string; ideaPart: string; wrote: string }>;
  flow: string;
};

/** 풀이 기록의 순간들(질문 · 예제 실행 · 제출)을 시간 순서로 */
export type Moment = { n: number; at: string; code: string; talk?: { q: string; a: string; selection?: string }; sub?: { id: string; mode: string; verdict: string; passed?: number; total?: number } };
export function momentsOf(rec: Record_): Moment[] {
  const clean = (c: string) => c.replace(/\r/g, "").replace(/\s+$/, "");
  const evs = [
    ...rec.talk.map((t) => { const sel = (t as { selection?: string }).selection; return { at: t.at, code: clean(t.code ?? ""), talk: { q: t.q, a: t.a, ...(sel ? { selection: sel } : {}) } }; }),
    ...rec.subs.map((s) => { const n = s as { passed?: number; total?: number }; return { at: s.at, code: clean(s.code), sub: { id: s.id, mode: s.mode, verdict: s.verdict, ...(n.total ? { passed: n.passed, total: n.total } : {}) } }; }),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return evs.map((e, i) => ({ n: i + 1, ...e }));
}
const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(11, 19);
const numbered = (code: string) => code.split("\n").map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n");
/** 바로 앞 순간 코드와 달라진 줄(+ 생김 / - 없어짐) */
function diffLines(before: string, after: string) {
  const a = before ? before.split("\n").map((l) => l.trimEnd()) : [], b = after.split("\n").map((l) => l.trimEnd());
  const left = new Map<string, number>(); for (const l of a) left.set(l, (left.get(l) ?? 0) + 1);
  const added: string[] = []; for (const l of b) { const k = left.get(l) ?? 0; if (k) left.set(l, k - 1); else if (l.trim()) added.push(`+ ${l}`); }
  const removed = [...left.entries()].flatMap(([l, k]) => (l.trim() ? Array(k).fill(`- ${l}`) : []));
  return [...added, ...removed].join("\n");
}
export function followUser(rec: Pick<Record_, "title" | "statement">, moments: Moment[]) {
  let last = "";
  const blocks = moments.map((m) => {
    const diff = m.code === last ? "" : diffLines(last, m.code);
    const codePart = m.code === last ? "그 순간 코드: (바로 앞 순간과 같음)" : `그 순간 코드:\n${numbered(m.code)}${last && diff ? `\n바로 앞 순간과 달라진 줄:\n${diff}` : ""}`;
    last = m.code;
    if (m.talk) {
      const sel = m.talk.selection?.trim() && !m.code.startsWith(m.talk.selection.trim().slice(0, 40)) ? `\n학습자가 골라 둔 부분: ${m.talk.selection.trim()}` : "";
      return `#${m.n} ${kst(m.at)} 질문\n학습자: ${m.talk.q}${sel}\n${codePart}\n튜터 답: ${m.talk.a}`;
    }
    const s = m.sub!;
    return `#${m.n} ${kst(m.at)} ${s.mode === "submit" ? "제출" : "예제 실행"} → ${s.verdict}${s.total ? ` (${s.passed}/${s.total})` : ""}\n${codePart}`;
  });
  return `[문제] ${rec.title}\n${rec.statement}\n\n[풀이 기록] 시간 순서, 한국 시간. 순간 ${moments.length}개.\n\n${blocks.join("\n\n")}`;
}

/* ---------------- 2 · 3. 장면 만들기 ---------------- */
const BASIC_SYSTEM = `학습자가 알고리즘 문제를 풀다가 걸린 기본기(언어 문법 · 기본 사용법)마다 다시 확인하는 문제를 하나씩 만든다. 원래 문제의 이야기는 쓰지 않는다. 언어는 [언어]를 따른다.
- 두 모양이 헷갈린 것(예: += 와 =+, pop(0) 과 pop(값))이면 format=choice: right(맞는 모양)와 mine(학습자가 실제로 쓴 틀린 모양, 없으면 흔히 헷갈리는 모양) 두 보기 중 고르게 한다. 두 보기 길이는 비슷하게. reference · mineCode · inputs는 비운다.
- 아예 몰랐던 것(예: 입력 받기, for문, append)이면 format=code: 코드 1~3줄로 풀리는 아주 쉬운 문제. 학습자는 프로그램 전체를 쓴다(표준 입력을 읽고 표준 출력으로). reference는 정답 전체 코드, mineCode는 그 기본기를 모를 때 쓸 법한 틀린 코드(학습자가 실제로 쓴 모양이 있으면 그것을 옮긴다, 문법 오류가 나지 않게), inputs는 4~6개(그중 둘 이상에서 mineCode가 틀리게, mineCode가 모든 입력에서 틀리면 셋 이상). 기대 출력은 쓰지 않는다(코드가 reference를 돌려 만든다). right · mine은 비운다.
- ask는 짧게, 무엇을 하라는지만. explain은 정답의 이유 한 줄.`;
const BASIC_SCHEMA = obj({ problems: arr(obj({ target: str, format: en("choice", "code"), ask: str, right: str, mine: str, reference: str, mineCode: str, inputs: arr(str), explain: str })) });
type BasicReply = { problems: Array<{ target: string; format: "choice" | "code"; ask: string; right: string; mine: string; reference: string; mineCode: string; inputs: string[]; explain: string }> };

const IDEA_SYSTEM = `학습자가 알고리즘 문제를 풀다가 막힌 "발상" 하나만 노리는 연습 문제를 만든다. 언어는 [언어]를 따른다.
- 원래 문제와 다른 상황(다른 이야기, 다른 출력)으로 만든다. 그 발상 하나만 있으면 풀리고, 나머지는 다 주어진다.
- 프로그램은 setup(입력 읽기 · 미리 준비한 것) + 학습자가 쓰는 부분 + after(출력)로 이어 붙여 실행된다. 학습자가 쓰는 부분은 들여쓰기 없는 맨 바깥 코드 몇 줄(블록 하나)로 만든다. setup · after도 맨 바깥 코드다.
- reference: 학습자 부분의 정답. mine: 학습자가 그때 쓴 모양(아래 [그때 코드])을 새 상황에 옮긴 학습자 부분 — 그 발상이 빠진 모양이고, 문법은 맞아야 한다.
- inputs: 4~8개. 그중 둘 이상에서 mine이 틀리게(예: 건너서 이어지는 연결, 뒤에서 앞으로 가는 연결). mine이 모든 입력에서 틀리면 셋 이상. 기대 출력은 쓰지 않는다(코드가 돌려서 만든다). 아무것도 안 쓰면(pass) 틀리게.
- story는 상황을 짧게, ask는 학습자가 무엇을 쓰면 되는지 짧게. 풀이 방법이나 정답 줄을 글에 쓰지 않는다. explain은 답한 뒤 보여 줄 한두 문장(그 발상).`;
const IDEA_SCHEMA = obj({ story: str, ask: str, explain: str, setup: str, after: str, reference: str, mine: str, inputs: arr(str) });
type IdeaReply = { story: string; ask: string; explain: string; setup: string; after: string; reference: string; mine: string; inputs: string[] };

const baseScene = (gap: Gap, lang: string): Omit<Scene, "format" | "story" | "ask" | "explain" | "reference" | "wrongs" | "inputs"> => ({
  id: newId("sc"), gapId: gap.id, lang, distance: gap.state.distance, target: gap.target, setup: "", after: "", alsoRight: [], topic: gap.topic, createdAt: now(), madeBy: "ai",
});
function basicScene(gap: Gap, p: BasicReply["problems"][number], lang: string): Scene {
  if (p.format === "choice") {
    const choices = [{ text: p.right, thought: "right" }, { text: p.mine, thought: "mine" }];
    if (gap.id.charCodeAt(gap.id.length - 1) % 2) choices.reverse(); // 맞는 보기가 늘 위에 오지 않게
    return { ...baseScene(gap, lang), format: "choice", story: "", ask: p.ask, explain: p.explain, reference: "", wrongs: [{ id: "mine", what: gap.wrong || "헷갈린 모양", code: p.mine }], inputs: [], choices };
  }
  return { ...baseScene(gap, lang), format: "write", story: "", ask: p.ask, explain: p.explain, reference: p.reference,
    wrongs: [{ id: "mine", what: gap.wrong || "그 기본기를 모를 때의 모양", code: p.mineCode }], inputs: p.inputs.map((stdin) => ({ role: "basic" as const, stdin })) };
}
const ideaScene = (gap: Gap, r: IdeaReply, lang: string): Scene => ({ ...baseScene(gap, lang), format: "write", story: r.story, ask: r.ask, explain: r.explain || gap.missed,
  setup: r.setup, after: r.after, reference: r.reference, wrongs: [{ id: "mine", what: gap.wrong || "그때 쓴 모양", code: r.mine }], inputs: r.inputs.map((stdin) => ({ role: "basic" as const, stdin })) });

/** 기본기 묶음: AI 1번, 검사에 걸린 것만 한 번 더 */
async function basicScenes(gaps: Gap[], lang: string, ask: Ask): Promise<Map<string, Scene>> {
  const out = new Map<string, Scene>();
  let todo = gaps, why = "";
  for (let tries = 1; tries <= 2 && todo.length; tries++) {
    const user = `[언어] ${lang}\n[걸린 기본기]\n${todo.map((g, i) => `${i + 1}. ${g.title}\n   빠진 것: ${g.missed}${g.wrong ? `\n   학습자가 실제로 쓴 모양: ${g.wrong}` : ""}`).join("\n")}${why}`;
    const reply = await ask<BasicReply>("scene:basics", BASIC_SYSTEM, user, BASIC_SCHEMA).catch(() => null);
    if (!reply) break;
    const failed: string[] = [];
    for (const [i, p] of (reply.problems ?? []).entries()) {
      const gap = todo.find((g) => g.title === p.target) ?? todo[i];
      if (!gap || out.has(gap.id)) continue;
      const scene = await checkScene(basicScene(gap, p, lang));
      if (scene.check?.ok) out.set(gap.id, scene); else failed.push(`- ${gap.title}: ${(scene.check?.problems ?? []).join(" ")}`);
    }
    todo = todo.filter((g) => !out.has(g.id));
    why = failed.length ? `\n\n[지난번 검사에서 걸린 것 — 고쳐서 다시]\n${failed.join("\n")}` : "";
  }
  return out;
}
/** 발상 문제 하나: AI 1번, 검사에 걸리면 이유를 붙여 한 번 더 */
async function ideaScene1(gap: Gap, origin: string, stuck: { code: string; hint: string }, lang: string, ask: Ask): Promise<Scene | null> {
  let why = "";
  for (let tries = 1; tries <= 2; tries++) {
    const user = `[언어] ${lang}\n[노릴 발상] ${gap.title}\n[빠진 조각] ${gap.missed}\n[원래 문제] ${origin} — 이것과 다른 상황으로\n[그때 코드] 학습자가 막힌 순간에 쓴 코드:\n${stuck.code || "(없음)"}\n[그때 받은 힌트] ${stuck.hint || "(없음)"}${why}`;
    const r = await ask<IdeaReply>("scene:idea-problem", IDEA_SYSTEM, user, IDEA_SCHEMA).catch(() => null);
    if (!r) continue;
    const scene = await checkScene(ideaScene(gap, r, lang));
    if (scene.check?.ok) return scene;
    why = `\n\n[지난번 검사에서 걸린 것 — 고쳐서 다시]\n- ${(scene.check?.problems ?? ["검사 실패"]).join("\n- ")}`;
  }
  return null;
}

/* ---------------- 지금 무엇을 하는지(화면의 "…" 옆 글, 11/16) ---------------- */
const stages = new Map<string, { text: string; started: number; at: number }>();
const stage = (problemId: string, text: string) => { const o = stages.get(problemId); stages.set(problemId, { text, started: o?.started ?? Date.now(), at: Date.now() }); };
/** 빈틈 찾기 진행: 없거나 끝났으면 null */
export function followProgress(problemId: string) {
  const s = stages.get(problemId);
  return s ? { text: s.text, seconds: Math.round((Date.now() - s.started) / 1000) } : null;
}

/* ---------------- 빈틈으로 ---------------- */
const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");

/**
 * 따라가기로 빈틈 뽑기 + 첫 장면 만들기. 발상 · 애매(발상 쪽)는 "알고리즘 구현" 빈틈, 기본기 · 애매(기본기 쪽)는 "문법" 빈틈.
 * 첫 장면은 원래 문제와 다른 상황이므로 거리는 "비슷하게"에서 시작한다. 장면 검사를 통과하면(그때 쓴 모양이 가르는 입력 둘 이상에서 틀림) wrongVerified.
 * 장면을 못 만든 빈틈은 그대로 두면 나중에 기존 장면 만들기(make.ts)가 맡는다.
 */
export async function followGaps(problemId: string, rec: Record_, ask: Ask): Promise<Gap[]> {
  const lang = rec.subs.at(-1)?.lang ?? "python";
  const moments = momentsOf(rec);
  stages.delete(problemId);
  stage(problemId, `풀이 기록(순간 ${moments.length}개)을 처음부터 따라가며 막힌 곳과 목차를 정리하는 중`);
  try { return await followGapsIn(problemId, rec, ask, lang, moments); } finally { stages.delete(problemId); }
}
async function followGapsIn(problemId: string, rec: Record_, ask: Ask, lang: string, moments: Moment[]): Promise<Gap[]> {
  const reply = await ask<FollowReply>("scene:follow", FOLLOW_SYSTEM, followUser(rec, moments), FOLLOW_SCHEMA);
  await mkdir(path.join(dataDir(), "scene", "follow"), { recursive: true });
  await writeFile(path.join(dataDir(), "scene", "follow", `${problemId}.json`), JSON.stringify({ at: now(), problemId, reply }, null, 1), "utf8");

  const at = (n: number) => moments.find((m) => m.n === n);
  const stuckOf = (ms: number[]) => [...reply.segments].reverse().find((s) => s.stuckAt && ms.includes(s.stuckAt))?.stuckAt ?? Math.max(1, ...ms);
  const evidenceOf = (n: number): Evidence[] => {
    const m = at(n); if (!m) return [];
    return m.talk ? [{ type: "talk", at: m.at, quote: m.talk.q.slice(0, 200) }] : [{ type: "submission", id: m.sub!.id, verdict: m.sub!.verdict }];
  };
  // 목차: 항목 이름 → 파트 · 묶음 · 순서(코드가 확인: 목록에 없는 이름은 무시, 처음 넣은 곳만). 애매의 기본기 쪽은 기본기 파트로.
  const unitOf = new Map<string, { part: string; sub: string; order: number }>();
  const firstOrder = new Map<string, number>();
  let order = 0;
  for (const p of reply.toc ?? []) for (const sub of p.subs ?? []) {
    order++; if (!firstOrder.has(p.part)) firstOrder.set(p.part, order);
    for (const it of sub.items ?? []) if (!unitOf.has(it)) unitOf.set(it, { part: p.part, sub: sub.name, order });
  }
  const basicPart = (reply.toc ?? []).find((p) => /기본기/.test(p.part))?.part ?? "기본기";
  const basicUnit = { part: basicPart, sub: "", order: firstOrder.get(basicPart) ?? 0 };
  const made: Array<{ gap: Gap; stuck: { code: string; hint: string } }> = [];
  const add = (kind: GapKind, title: string, missed: string, x: FollowReply["items"][number]) => {
    const n = stuckOf(x.moments), m = at(n), seg = reply.segments.find((s) => s.stuckAt === n);
    const unit = x.kind === "애매" && kind === "문법" ? basicUnit : unitOf.get(x.item) ?? (kind === "문법" ? basicUnit : undefined);
    const evidence = evidenceOf(n);
    if (!missed.trim() || !evidence.length) return;
    const dose = x.level === "모름" ? 3 : 2;
    const state = { ...firstState(dose as 2 | 3), distance: "near" as const };
    made.push({ stuck: { code: m?.code ?? "", hint: seg?.hint || m?.talk?.a || "" }, gap: {
      id: newId("gap"), branch: "algo", kind, layer: LAYER[kind], title: title.slice(0, 80), target: kind === "문법" ? "form" : "ability",
      missed: missed.slice(0, 300), wrong: (x.wrote ?? "").slice(0, 300), ...(m?.code ? { wrongCode: m.code } : {}), wrongVerified: false,
      kernel: { lang, code: "", needs: [] }, evidence, origin: { problemId, title: rec.title, lang }, topic: `${kind}.${title}`.slice(0, 60),
      scope: kind === "문법" ? "line" : "piece", dose: { level: dose as 2 | 3 }, state, createdAt: now(), ...(unit ? { unit } : {}) } });
  };
  for (const x of reply.items ?? []) {
    if (x.kind === "발상") add("알고리즘 구현", x.item, x.missing, x);
    else if (x.kind === "기본기") add("문법", x.item, x.missing, x);
    else if (x.kind === "애매") { add("알고리즘 구현", `${x.item} (발상 쪽)`, x.ideaPart, x); add("문법", `${x.item} (기본기 쪽)`, x.basicPart, x); }
  }

  // 장면: 기본기는 한 번에, 발상은 하나씩 동시에
  const basics = made.filter((x) => x.gap.kind === "문법").map((x) => x.gap);
  const ideas = made.filter((x) => x.gap.kind !== "문법");
  const total = ideas.length + (basics.length ? 1 : 0);
  let done = 0;
  const tick = () => stage(problemId, `다시 물을 문제를 만들고 코드로 확인하는 중 (${done}/${total} · 기본기 ${basics.length}개는 한 번에, 발상 ${ideas.length}개는 하나씩 동시에)`);
  tick();
  const counted = <T,>(p: Promise<T>) => p.finally(() => { done++; tick(); });
  const [basicMade, ideaMade] = await Promise.all([
    basics.length ? counted(basicScenes(basics, lang, ask)) : Promise.resolve(new Map<string, Scene>()),
    Promise.all(ideas.map((x) => counted(ideaScene1(x.gap, rec.title, x.stuck, lang, ask)).then((s) => [x.gap.id, s] as const))),
  ]);
  stage(problemId, "저장하는 중");
  const scenes = new Map<string, Scene>([...basicMade, ...ideaMade.flatMap(([id, s]) => (s ? [[id, s] as const] : []))]);
  for (const s of scenes.values()) await saveScene(s);
  for (const { gap } of made) if (scenes.has(gap.id)) gap.wrongVerified = true; // 그때 쓴 모양이 새 장면에서 실제로 틀림(검사 통과)

  // 이 문제의 옛 빈틈은 바꾼다(같은 생각이 다른 문제에서 나왔으면 세기만 올림 — 기존 뽑기와 같음)
  return changeGaps((gaps) => {
    for (let i = gaps.length - 1; i >= 0; i--) if (gaps[i].origin.problemId === problemId) gaps.splice(i, 1);
    const out: Gap[] = [];
    for (const { gap } of made) {
      const same = gaps.find((x) => x.topic === gap.topic && !x.state.known);
      if (same) { same.dose = { level: Math.min(3, Math.max(same.dose.level, gap.dose.level) + 1) as 1 | 2 | 3 }; same.evidence.push(...gap.evidence); out.push(same); }
      else { gaps.push(gap); out.push(gap); }
    }
    return out;
  });
}

/** 화면에서 볼 따라가기 결과(생각 묶음 · 순서 · 흐름) */
export async function readFollow(problemId: string) {
  try { return JSON.parse(await readFile(path.join(dataDir(), "scene", "follow", `${problemId}.json`), "utf8")) as { at: string; reply: FollowReply }; }
  catch { return null; }
}
