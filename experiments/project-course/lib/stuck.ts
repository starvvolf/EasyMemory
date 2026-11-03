// [막혔어요] — 막히면 거꾸로 내려가는 기초 세션(DECISIONS 11/3, 사용자 설계).
// 칸(frame) 하나 = 튜터 대화 하나. 함수 호출처럼: 막히면 한 칸 아래를 열고, 맨 아래에서 풀리면 결과를 들고 위로 돌아간다.
// - 칸을 열고 닫는 것, 깊이·반복 막기, 기록은 코드가 한다. 무엇이 비었는지 이름 붙이기와 "풀렸다" 판단은 튜터(도구) 또는 학습자([이제 알겠어요]).
// - 깊이는 정해진 제한이 없고, 말도 안 되는 깊이(MAX_DEPTH)와 같은 칸이 스택에 또 나오는 것만 막는다.
import path from "node:path";
import { DATA, read, update } from "./store.ts";
import { basicName, findBasic, markResolved, markStuck, normOther, type Lang } from "./basics.ts";

/** 칸이 바뀌면 알림(수업이 지금 칸 표시를 맞춘다) */
let onChange: (runId: string) => void | Promise<void> = () => {};
export function onStuckChange(fn: (runId: string) => void | Promise<void>) { onChange = fn; }
export const MAX_DEPTH = Number(process.env.PC_STUCK_MAX) || 10;
/** 학습자가 고르는 막힘 종류(화면 문구는 web/app.js, 튜터에게는 why) */
export const CHOICES = {
  word: { label: "모르는 단어가 있어요", why: "코드에 나온 이름(단어)이 무슨 일을 하는지 모름" },
  shape: { label: "처음 보는 모양이 있어요", why: "기호·문법 모양(=>, { }, <T> 같은 것)을 처음 봄" },
  when: { label: "이게 언제 실행되는지 모르겠어요", why: "이 줄(함수)이 언제 실행되는지 모름" },
  where: { label: "이 값이 어디서 오는지 모르겠어요", why: "이 값·이름에 무엇이 어디서 들어오는지 모름" },
  same: { label: "비슷한 이름이 같은 건지 헷갈려요", why: "비슷한 이름 둘이 같은 건지 다른 건지 헷갈림" },
  lost: { label: "어디가 막혔는지도 모르겠어요", why: "어디가 막혔는지 스스로 말하지 못함(짧은 질문으로 층을 짚어야 함)" },
} as const;
export type Choice = keyof typeof CHOICES;

export type Quote = { file: string; from: number; to: number; code: string };
export type Frame = {
  id: string; parent?: string; depth: number; at: string;
  /** 처음 칸(학습자가 누른 곳)만: 고른 막힘 · 단어 · 고른 코드 */
  choice?: Choice; word?: string; quote?: Quote;
  /** 아래 칸: 위 칸에서 왜 내려왔는지 */
  why?: string;
  /** 무엇이 비었는지(기초 칸 id) 또는 목록에 없으면 제 말로 */
  concept?: string; other?: string;
  status: "open" | "resolved" | "left"; closedAt?: string; result?: string; by?: "tutor" | "learner";
  /** 이 칸에서 학습자가 답한 수(풀림 판단의 최소 조건) */
  replies: number;
  /** 아래 칸이 하나라도 풀려서 돌아왔는지(처음 칸은 이게 있어야 튜터가 닫을 수 있다) */
  childDone?: boolean;
};
type Store = { frames: Frame[] };
const file = (runId: string) => path.join(DATA, "stuck", `${runId}.json`);
const err = (status: number, message: string) => Object.assign(new Error(message), { status });
const now = () => new Date().toISOString();

export const stuckOf = (runId: string) => read<Store>(file(runId), { frames: [] });
/** 열린 칸들(위 → 아래). 맨 끝이 지금 칸 */
export function openStack(s: Store) { return s.frames.filter((f) => f.status === "open").sort((a, b) => a.depth - b.depth); }
export const labelOf = (f: Frame) => f.concept ? basicName(f.concept) : f.other ? f.other
  : f.word ? `\`${f.word}\`` : f.quote ? `${f.quote.file} ${f.quote.from}줄` : f.choice ? CHOICES[f.choice].label : "막힌 곳";

const sameGap = (a: Frame, g: { concept?: string; other?: string }) =>
  (g.concept && a.concept === g.concept) || (g.other && a.other && normOther(a.other) === normOther(g.other));

/** 처음 칸 열기(학습자가 [막혔어요]). 이미 열린 칸이 있으면 그 아래로 한 칸(학습자가 안에서 또 누름) */
export async function openRoot(runId: string, x: { choice: Choice; word?: string; quote?: Quote }) {
  if (!CHOICES[x.choice]) throw err(400, "막힌 종류를 골라 주세요.");
  let out!: Frame;
  await update<Store>(file(runId), { frames: [] }, (s) => {
    const st = openStack(s);
    const top = st.at(-1);
    if (st.length >= MAX_DEPTH) throw err(409, "너무 깊이 내려왔어요. 한 칸 위로 돌아가서 다시 볼게요.");
    out = { id: `f${Date.now().toString(36)}${s.frames.length}`, parent: top?.id, depth: st.length, at: now(), choice: x.choice, word: x.word?.slice(0, 60), quote: x.quote, status: "open", replies: 0 };
    s.frames.push(out);
  });
  return out;
}

/** 지금 칸에 무엇이 비었는지 이름 붙이기(튜터). 목록에 있으면 concept, 없으면 other. 위 칸들과 같으면 거절 */
export async function nameGap(runId: string, lang: Lang, x: { concept?: string; other?: string; why?: string }) {
  // 처음 칸(막힌 줄 자체)은 이름을 바꾸지 않고, 짚은 빈 칸을 아래 칸으로 연다(11/3 재현: 이름 짐작 하나로 처음 칸까지 닫혀 원래 줄로 안 돌아옴)
  const top0 = openStack(await stuckOf(runId)).at(-1);
  if (top0 && top0.depth === 0 && top0.quote) {
    // why: 학습자가 실제로 막힌 말(11/3 두 번째 재현: "key는 어디서 와?"가 넘어가지 않아 아래 칸이 엉뚱한 방향으로 설명함)
    const r = await goDeeper(runId, lang, { ...x, why: x.why?.trim() || "처음 줄에서 짚은 빈 칸" });
    return r.ok ? { ok: true, text: `${r.text}. 이제 같은 답에서 바로 이 칸을 설명하세요: 학습자가 막힌 말에 닿는 아주 작은 예로 3~6문장, 끝에 직접 답하거나 한 줄 써 볼 작은 확인 하나. "잠깐 볼게요" 같은 예고는 쓰지 않는다. 처음 줄은 이 칸이 풀린 뒤 다시 읽어요.` } : r;
  }
  const b = x.concept ? findBasic(lang, x.concept) : null;
  const gap = b ? { concept: b.id } : x.other?.trim() || x.concept?.trim() ? { other: (x.other?.trim() || x.concept!.trim()).slice(0, 60) } : null;
  if (!gap) return { ok: false as const, text: "concept(기초 칸 id) 또는 other(목록에 없을 때 짧은 이름)를 주세요." };
  let res: { ok: boolean; text: string } = { ok: false, text: "열린 칸이 없어요." };
  let first = false;
  await update<Store>(file(runId), { frames: [] }, (s) => {
    const st = openStack(s); const top = st.at(-1); if (!top) return;
    const dup = st.slice(0, -1).find((f) => sameGap(f, gap));
    if (dup) { res = { ok: false, text: `"${labelOf(dup)}"은(는) 위 칸에서 이미 보는 중이에요. 이 칸은 다른 것으로 이름 붙이거나, 그 칸으로 돌아가세요.` }; return; }
    first = !top.concept && !top.other;
    top.concept = gap.concept; top.other = gap.other;
    res = { ok: true, text: `이 칸: ${labelOf(top)}` };
  });
  if (res.ok && first) await markStuck(gap, lang);
  return res;
}

/** 한 칸 더 아래로(튜터): 설명하다 보니 더 아래가 비어 있을 때 */
export async function goDeeper(runId: string, lang: Lang, x: { concept?: string; other?: string; why: string }) {
  const b = x.concept ? findBasic(lang, x.concept) : null;
  const gap = b ? { concept: b.id } : x.other?.trim() || x.concept?.trim() ? { other: (x.other?.trim() || x.concept!.trim()).slice(0, 60) } : null;
  if (!gap) return { ok: false as const, text: "concept 또는 other로 아래 칸이 무엇인지 주세요." };
  let res: { ok: boolean; text: string; frame?: Frame } = { ok: false, text: "열린 칸이 없어요." };
  await update<Store>(file(runId), { frames: [] }, (s) => {
    const st = openStack(s); const top = st.at(-1); if (!top) return;
    if (st.length >= MAX_DEPTH) { res = { ok: false, text: `더 내려가지 않아요(깊이 ${MAX_DEPTH}). 지금 칸에서 다르게 설명하세요.` }; return; }
    const dup = st.find((f) => sameGap(f, gap));
    if (dup) { res = { ok: false, text: `"${labelOf(dup)}"은(는) 이미 열린 칸이에요(돌고 돌지 않게). 지금 칸에서 이어서 설명하세요.` }; return; }
    const f: Frame = { id: `f${Date.now().toString(36)}${s.frames.length}`, parent: top.id, depth: st.length, at: now(), why: x.why.slice(0, 200), ...gap, status: "open", replies: 0 };
    s.frames.push(f);
    res = { ok: true, text: `아래 칸을 열었어요: ${labelOf(f)}. 이제 같은 답에서 바로 이 칸을 설명하세요(아주 작은 예 3~6문장 + 작은 확인 하나, 예고 없이).`, frame: f };
  });
  if (res.ok) { await markStuck(gap, lang); await onChange(runId); }
  return res;
}

/** 학습자가 지금 칸에서 답했다(풀림 판단의 최소 조건) */
export async function countReply(runId: string) {
  await update<Store>(file(runId), { frames: [] }, (s) => { const top = openStack(s).at(-1); if (top) top.replies++; });
}

/** 지금 칸이 풀렸다. 튜터: 학습자가 이 칸에서 한 번은 답했어야 하고 근거가 있어야 한다. 학습자: [이제 알겠어요] */
export async function resolveTop(runId: string, lang: Lang, by: "tutor" | "learner", evidence: string) {
  let res: { ok: boolean; text: string; frame?: Frame; parent?: Frame } = { ok: false, text: "열린 칸이 없어요." };
  await update<Store>(file(runId), { frames: [] }, (s) => {
    const st = openStack(s); const top = st.at(-1); if (!top) return;
    if (by === "tutor") {
      if (!top.concept && !top.other && !(top.depth === 0 && top.quote)) { res = { ok: false, text: "먼저 stuck_name_gap으로 이 칸이 무엇인지 정하세요." }; return; }
      if (top.replies < 1) { res = { ok: false, text: "학습자가 이 칸에서 아직 답하지 않았어요. 작은 확인 질문을 하고 답을 기다리세요." }; return; }
      if (top.depth === 0 && top.quote && !top.childDone) { res = { ok: false, text: "처음 줄은 아직 닫지 않아요. 비어 있는 칸을 짧은 질문으로 짚어 stuck_name_gap으로 아래 칸을 열고, 풀려서 돌아온 뒤 학습자가 이 줄을 자기 말로 읽으면 닫으세요." }; return; }
      if (evidence.trim().length < 6) { res = { ok: false, text: "evidence에 학습자가 실제로 한 것(답·쓴 코드)을 한 문장으로 적어 주세요." }; return; }
    }
    top.status = "resolved"; top.closedAt = now(); top.by = by; top.result = evidence.trim().slice(0, 200) || "학습자가 이제 알겠다고 함";
    const up = st.at(-2); if (up) up.childDone = true;
    res = { ok: true, text: `풀림: ${labelOf(top)}`, frame: top, parent: st.at(-2) };
  });
  if (res.ok && res.frame && (res.frame.concept || res.frame.other)) await markResolved({ concept: res.frame.concept, other: res.frame.other }, lang, `${by === "tutor" ? "튜터 판단" : "학습자"}: ${res.frame.result}`);
  return res;
}

/** 그만두고 하던 거로: 열린 칸을 모두 닫는다(풀림으로 치지 않는다) */
export async function leaveAll(runId: string) {
  let n = 0;
  await update<Store>(file(runId), { frames: [] }, (s) => { for (const f of s.frames) if (f.status === "open") { f.status = "left"; f.closedAt = now(); n++; } });
  return n;
}

/** 화면: 지금 위치 한 줄(위 → 아래) */
export async function stuckView(runId: string) {
  const st = openStack(await stuckOf(runId));
  return st.length ? { path: st.map((f) => ({ id: f.id, label: labelOf(f), depth: f.depth })), top: st.at(-1)!.id } : null;
}
