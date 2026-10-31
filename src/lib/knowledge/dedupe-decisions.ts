// 같은 지식 판정을 OpenAI Decisions API로 (2026-10-31 실험, 사용자 "같은지식판정에 openai decision 써보자").
// Decisions API (POST /v1/decisions, gpt-6-luna만): 질문마다 정해 둔 보기 중 하나와 보기별 확률을 돌려준다. 글을 쓰지 않아
// 출력 비용이 없고 Responses보다 빠르다고 한다. 여기서는 후보 쌍마다 "choice" 질문 하나(관계 11가지)를 보내고, 같음은 확률이
// 기준(sameMin) 이상일 때만 받는다 — 확률이 있으니 "자동 합치기는 판정이 충분히 정확할 때만"(10/28)의 기준을 숫자로 정할 수 있다.
// 시험(dedupe-eval.ts)과 실제 저장 경로(dedupe.ts judgeBatch, API 키가 있을 때만)에서 쓴다. 연결 문장(note)은 만들지 않는다(Decisions는 글을 쓰지 않음).
// 인증: 먼저 ChatGPT 로그인 토큰, 그 길이 막히면 OPENAI_API_KEY(.env.local, 사용자가 직접 넣음). 실제 경로는 routes로 API 키만 쓴다(ChatGPT 토큰은 401).
import { chatGptAccessToken } from "../ai/chatgpt-auth.ts";
import { LOCAL_CALLER, logAssistCall } from "../assist/model.ts";
import { linkMode, type JudgeItem, type LinkMode, type Verdict } from "./dedupe.ts";

const ENDPOINT = "https://api.openai.com/v1/decisions";
const MAX_RELATED = 2;
type Choice = { value: Verdict; description: string };
const CHOICES = (mode: LinkMode): Choice[] => [
  { value: "same", description: "같은 개념을 다른 말로 부른 것(이진 탐색 = 이분 탐색 = Binary Search, 깊이 우선 탐색 = DFS). 둘을 합쳐도 아무것도 잃지 않을 때만. 반대·대비되는 개념이나 비슷한 현상(교착 상태와 라이브락)은 같음이 아니다." },
  { value: "narrower", description: "새 지식이 후보의 한 종류·부분·특수한 경우(새=lower_bound, 후보=이분 탐색). 원인·결과나 조건은 종류가 아니다." },
  { value: "broader", description: "후보가 새 지식의 한 종류·부분·특수한 경우(새=이분 탐색, 후보=lower_bound)." },
  { value: "uses", description: "새 지식이 후보를 부품·도구로 쓴다(새=다익스트라, 후보=우선순위 큐)." },
  { value: "used_by", description: "후보가 새 지식을 부품·도구로 쓴다(새=우선순위 큐, 후보=다익스트라)." },
  ...(mode === "split" ? [
    { value: "requires" as const, description: "쓰는 조건. 새 지식을 쓰려면 데이터나 상황이 후보의 상태여야 한다(새=이분 탐색, 후보=정렬)." },
    { value: "required_by" as const, description: "후보를 쓰려면 데이터나 상황이 새 지식의 상태여야 한다(새=정렬, 후보=이분 탐색)." },
    { value: "needs" as const, description: "배우는 순서. 새 지식을 설명하려면 후보의 뜻이 그대로 필요하다(새=DFS, 후보=재귀)." },
    { value: "needed_by" as const, description: "후보를 설명하려면 새 지식의 뜻이 그대로 필요하다(새=재귀, 후보=DFS)." },
  ] : [
    { value: "needs" as const, description: "새 지식을 이해하거나 제대로 쓰려면 후보를 먼저 알아야 한다(새=이분 탐색, 후보=정렬)." },
    { value: "needed_by" as const, description: "후보를 이해하거나 제대로 쓰려면 새 지식을 먼저 알아야 한다(새=정렬, 후보=이분 탐색)." },
  ]),
  { value: "near", description: "뜻이 겹치거나 자주 같이 나오지만 위 관계와 방향이 분명하지 않다(해시와 Map)." },
  { value: "different", description: "그 밖의 모든 것: 관계가 약하거나, 같은 과목일 뿐이거나, 반대·대비되는 개념(깊이 우선 탐색과 너비 우선 탐색). 대부분의 후보는 이것이다." },
];
const line = (d: JudgeItem) => `${d.title}${d.aliases.length ? ` (다른 이름: ${d.aliases.slice(0, 5).join(", ")})` : ""} [${d.path || "폴더 없음"}] ${d.body.split("\n").find((l) => l.trim() && !l.startsWith("헷갈림:"))?.slice(0, 160) ?? "(뜻 없음)"}`;

type Answer = { type: string; name: string; choice?: string; probabilities?: Array<{ value: string; probability: number }>; confidence?: number };
type Reply = { answers?: Answer[]; usage?: Record<string, unknown> };
export type DecisionsInfo = { route: "chatgpt" | "api_key"; ms: number; usage?: Record<string, unknown>; /** questions asked / answered with a usable choice */ asked: number; answered: number };
type Route = DecisionsInfo["route"];

async function post(body: { model: string }, routes: Route[], timeoutMs?: number): Promise<{ reply: Reply; route: Route }> {
  const all: Array<[Route, () => Promise<string | undefined>]> = [
    ["chatgpt", () => chatGptAccessToken(LOCAL_CALLER.uid).catch(() => undefined)],
    ["api_key", async () => process.env.OPENAI_API_KEY?.trim() || undefined],
  ];
  const attempts = all.filter(([route]) => routes.includes(route));
  const refused: string[] = [];
  for (const [route, token] of attempts) {
    const key = await token();
    if (!key) { refused.push(`${route}: 인증 없음`); continue; }
    const started = Date.now();
    let ok = false, usage: Record<string, unknown> | undefined, status = 0;
    try {
      const res = await fetch(ENDPOINT, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body),
        ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) });
      status = res.status;
      const text = await res.text();
      if (res.ok) { const reply = JSON.parse(text) as Reply; ok = true; usage = reply.usage; return { reply, route }; }
      refused.push(`${route}: ${res.status} ${text.slice(0, 200)}`);
    } finally { logDecisions(body.model, route, started, ok, status, usage); }
  }
  throw new Error(`Decisions API를 부르지 못했어요 — ${refused.join(" / ")}`);
}
/**
 * assist-log.jsonl 한 줄(토큰 사용량 보기가 읽음), 실제로 보낸 요청마다: model gpt-6-luna · effort "decisions", tokens는 askJson 줄과 같은 칸.
 * (2026-10-31) 예전에는 저장 경로(dedupe.ts)에서만 썼다: 시험의 Decisions 호출은 성공해도 남지 않았고, 키가 없어 보내지도 않은 판정도 실패 줄이 됐다.
 */
function logDecisions(model: string, route: Route, started: number, ok: boolean, status: number, usage?: Record<string, unknown>) {
  const n = (v: unknown) => (typeof v === "number" ? v : undefined);
  const sub = (k: string) => (usage?.[k] ?? {}) as Record<string, unknown>;
  logAssistCall({ at: new Date(started).toISOString(), purpose: "knowledge:dedupe", model, effort: "decisions", engine: "decisions", route, ms: Date.now() - started, ok,
    ...(ok ? {} : { status }),
    ...(usage ? { tokens: { in: n(usage.input_tokens), cached: n(sub("input_tokens_details").cached_tokens), out: n(usage.output_tokens), reasoning: n(sub("output_tokens_details").reasoning_tokens) } } : {}) });
}

/** Same calls within one test run are answered once (several thresholds read the same probabilities). */
const memo = new Map<string, Promise<{ reply: Reply; route: Route; ms: number }>>();

/**
 * judgeBatch with Decisions: one request per batch, one choice question per (new item, candidate). `sameMin`: below
 * this probability a "same" answer becomes the next most likely other verdict. reason carries the probabilities.
 * The saving path passes `routes: ["api_key"]`, a timeout and `cache: false` (the memo is for one test run, not a server).
 */
export async function judgeBatchDecisions(work: Array<{ item: JudgeItem; cands: JudgeItem[] }>,
  options: { model?: string; sameMin?: number; mode?: LinkMode; routes?: Route[]; timeoutMs?: number; cache?: boolean } = {}) {
  const mode = options.mode ?? linkMode(), sameMin = options.sameMin ?? 0.5;
  const out = work.map((w) => w.cands.map(() => ({ verdict: "different" as Verdict, reason: "", note: "" })));
  if (!work.length) return { verdicts: out, info: undefined };
  const choices = CHOICES(mode);
  const input = `학습자의 지식 저장소에 새 지식이 들어왔다. 새 지식마다 뜻이 가까운 기존 지식 후보가 있다. 질문마다 새 지식 하나와 후보 하나의 관계를 고른다. 방향이 있는 관계는 "새 지식 → 후보" 쪽이면 앞의 것(uses, needs …), 반대면 _by 쪽이다. 애매하면 same이 아니라 near나 different를 고른다. 잘못 합치는 것이 놓치는 것보다 나쁘다.\n\n`
    + work.map((w, n) => `[새 지식 ${n}] ${line(w.item)}\n${w.cands.map((c, m) => `  후보 ${n}-${m}. ${line(c)}`).join("\n")}`).join("\n\n");
  const questions = work.flatMap((w, n) => w.cands.map((c, m) => ({ type: "choice", name: `q_${n}_${m}`,
    instructions: `새 지식 ${n}(${w.item.title})과 후보 ${n}-${m}(${c.title})의 관계는?`, choices })));
  const body = { model: options.model || "gpt-6-luna", input, questions };
  const call = async () => { const t0 = Date.now(); const r = await post(body, options.routes ?? ["chatgpt", "api_key"], options.timeoutMs); return { ...r, ms: Date.now() - t0 }; };
  let got;
  if (options.cache === false) got = await call();
  else {
    const key = JSON.stringify(body);
    if (!memo.has(key)) memo.set(key, call());
    try { got = await memo.get(key)!; } catch (error) { memo.delete(key); throw error; }
  }
  let answered = 0;
  for (const a of got.reply.answers ?? []) {
    const mm = /^q_(\d+)_(\d+)$/.exec(a.name);
    if (!mm || a.type !== "choice" || !out[+mm[1]]?.[+mm[2]]) continue;
    answered++;
    const probs = [...(a.probabilities ?? [])].sort((x, y) => y.probability - x.probability);
    const pSame = probs.find((p) => p.value === "same")?.probability ?? 0;
    let verdict = (a.choice ?? "different") as Verdict;
    if (verdict === "same" && pSame < sameMin) verdict = (probs.find((p) => p.value !== "same")?.value ?? "different") as Verdict;
    out[+mm[1]][+mm[2]] = { verdict, note: "", reason: `p(같음)=${pSame.toFixed(2)} · 확신 ${(a.confidence ?? 0).toFixed(2)} · ${probs.slice(0, 3).map((p) => `${p.value} ${p.probability.toFixed(2)}`).join(", ")}` };
  }
  // 고리는 새 지식 하나에 활용·조건·먼저 각각 2개까지(judgeBatch와 같은 규칙), 나머지는 가까움.
  for (const row of out) {
    const count: Record<string, number> = {};
    for (const v of row) {
      const group = v.verdict.replace(/_by$/, "");
      if (["uses", "needs", "requires"].includes(group) && (count[group] = (count[group] ?? 0) + 1) > MAX_RELATED) v.verdict = "near";
    }
  }
  return { verdicts: out, info: { route: got.route, ms: got.ms, usage: got.reply.usage, asked: questions.length, answered } as DecisionsInfo };
}
