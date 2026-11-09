// PS 튜터: PS 기억을 복습에서 꺼내 묻기 (2026-11-08, 사용자 "PDF는 문제를 딱 풀 수 있게 해 주는데 얘는 어떻게 확인할 수 있을지").
// 패턴 기억에 "뜻이 뭐였지?"를 묻지 않는다. 패턴은 뜻을 아는 것보다 문제에서 알아보고 쓰는 것이 목적이라서, 코드로 채점되는
// 네 가지로 묻는다(기억 저장소의 문제 형식 그대로 → 복습 화면·채점이 그대로 쓴다):
//   ① 내 실수 다시 보기(객관식): 예전에 틀린 장면(카드의 상황)을 보여 주고 고친 생각을 고른다 — 오류를 고친 직후의 첫 복습
//   ② 알아보기: 처음 보는(또는 가장 오래전에 본) 튜터 문제의 요약만 보고 핵심 패턴을 고른다, 단원 숨김 — 전이·섞어 풀기
//   ③ 설계(객관식): 그 문제에서 꼭 기억해야 하는 상태를 고른다
//   ④ 출력 예측(주관식): 작은 입력의 출력(강의 풀이를 실제로 돌린 값). 답이 한 토큰일 때만(띄어쓰기 무시 채점이 헷갈리지 않게)
// 무엇을 물을지(복습 차례, 마지막으로 배운 뒤 센다): 1번째 ① → 2번째 ② → 그다음 ③·④·②·① 돌아가며. 재료가 없는 종류는 건너뛴다.
import type { Question } from "../../knowledge/api.ts";
import { readLessons } from "./lessons.ts";
import { PATTERNS, patternOf } from "./patterns.ts";
import { ensurePool, readModels, type ProblemModel } from "./problem-model.ts";
import { readEvents } from "./state.ts";

export const isPsItem = (item: { sources?: Array<{ ref?: string }> }) => (item.sources ?? []).some((s) => s.ref?.startsWith("tutor:pattern:"));
const patternOfItem = (item: { sources?: Array<{ ref?: string }> }) => (item.sources ?? []).map((s) => /^tutor:pattern:([a-z0-9-]+)$/.exec(s.ref ?? "")?.[1]).find(Boolean);
function rng(seed: string) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 2 ** 32; }; }
const shuffle = <T,>(xs: T[], r: () => number) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export type PsKind = "mistake" | "recognize" | "design" | "predict";
/** 질문 id: ps:<종류>:<문제 번호>:<패턴>:<seed> — 채점할 때 튜터 기록으로도 남기려고. */
export const psId = (kind: PsKind, number: string, pattern: string, seed: string) => `ps:${kind}:${number}:${pattern}:${seed}`;
export function parsePsId(id: string): { kind: PsKind; number: string; pattern: string } | null {
  const m = /^ps:(mistake|recognize|design|predict):(\d{1,6}):([a-z0-9-]+):/.exec(id);
  return m ? { kind: m[1] as PsKind, number: m[2], pattern: m[3] } : null;
}

/** 이 패턴의 기억에 물을 수 있는 질문들(앞이 이번 차례에 물을 것). 재료가 없으면 빈 목록(→ 원래 질문으로). */
export async function psQuestions(item: { id: string; title: string; sources?: Array<{ ref?: string }>; review?: { repetitions: number } | null }, seed: string): Promise<Question[]> {
  const pid = patternOfItem(item);
  const pattern = pid ? patternOf(pid) : undefined;
  if (!pid || !pattern) return [];
  const r = rng(`${item.id}:${seed}`);
  const [models, lessons, events] = await Promise.all([readModels(), readLessons(), readEvents()]);
  const pool = Object.values(models).filter((m) => m.patterns.includes(pid));
  const lastSeen = (m: ProblemModel) => events.filter((e) => e.number === m.number).at(-1)?.at ?? "";
  const fresh = [...pool].sort((a, b) => lastSeen(a).localeCompare(lastSeen(b)) || a.number.localeCompare(b.number));
  const out: Partial<Record<PsKind, Question>> = {};
  // 처음 보는 문제가 없으면 하나 더 만들어 둔다(11/10, 다음 복습부터 쓰임. 뒤에서, 앱 서버 안에서만).
  if (fresh[0] && lastSeen(fresh[0])) void ensurePool(pid, pool.length + 1).catch(() => undefined);

  const mine = lessons.filter((l) => l.pattern === pid && l.fix).at(-1);
  if (mine) {
    // 보기의 모양이 정답만 다르면 모양으로 찍힌다(11/8 가상 학습자 점검): 드릴은 그 문제의 접근들, 설계는 그 문제의 상태 후보,
    // 그 밖(예측·구현·AI 힌트)은 같은 모양의 문장(다른 카드의 고친 생각, 다른 패턴의 뜻) 중에서 고른다.
    const mm = models[mine.number];
    const best = mm?.approaches.find((a) => a.verdict === "best");
    const ask = `예전에 이런 일이 있었어요.\n${mine.situation}`;
    const explain = [mine.gap && `그때 잘못 생각한 것: ${mine.gap}`, `고친 생각: ${mine.fix}`, mine.cue && `다음에 떠올릴 신호: ${mine.cue}`].filter(Boolean).join(" · ");
    const base = { id: psId("mistake", mine.number, pid, seed), kind: "choice" as const, label: "내 실수 다시 보기", knowledgeId: item.id, explain };
    if (mine.kind === "drill" && mm && best && mm.approaches.length >= 3) out.mistake = { ...base, prompt: `${ask}\n다시 고른다면 이 문제에 맞는 접근은?`, context: mm.summary, options: shuffle(mm.approaches.map((a) => a.name), r), answer: best.name };
    else if (mine.kind === "design" && mm?.state.right && mm.state.wrong.length === 2) out.mistake = { ...base, prompt: `${ask}\n다시 설계한다면 꼭 기억할 상태는?`, context: mm.summary, options: shuffle([mm.state.right, ...mm.state.wrong], r), answer: mm.state.right };
    else {
      const plain = (t: string) => !/^「/.test(t);
      const others = [...new Set([...lessons.filter((l) => l.pattern !== pid && l.fix).map((l) => l.fix), ...PATTERNS.filter((p) => p.id !== pid).map((p) => p.what)])].filter((f) => f !== mine.fix && plain(f));
      const picks = shuffle(others, r).slice(0, 3);
      if (picks.length >= 2 && plain(mine.fix)) out.mistake = { ...base, prompt: `${ask}\n그때 놓친 것을 바로잡은 생각은?`, options: shuffle([mine.fix, ...picks], r), answer: mine.fix };
    }
  }
  const m = fresh[0];
  if (m) {
    const not = new Set(m.patterns);
    const near = PATTERNS.filter((p) => !not.has(p.id) && p.chapters.some((c) => pattern.chapters.includes(c)));
    const far = PATTERNS.filter((p) => !not.has(p.id) && !near.includes(p));
    const picks = [...shuffle(near, r), ...shuffle(far, r)].slice(0, 3).map((p) => p.name); // 헷갈리기 쉬운 같은 단원 패턴부터
    out.recognize = { id: psId("recognize", m.number, pid, seed), kind: "recognize", label: "알아보기", knowledgeId: item.id,
      prompt: "처음 보는 문제예요. 이 문제를 푸는 데 핵심인 패턴은? (단원은 숨겼어요)", context: m.summary, options: shuffle([pattern.name, ...picks], r), answer: pattern.name,
      explain: `BOJ ${m.number} ${m.title} — 신호: ${m.signals.join(" · ")}${m.approaches.find((a) => a.verdict === "best") ? ` · 의도된 풀이: ${m.approaches.find((a) => a.verdict === "best")!.name}` : ""}` };
    if (m.state.right && m.state.wrong.length === 2) out.design = { id: psId("design", m.number, pid, seed), kind: "choice", label: "설계", knowledgeId: item.id,
      prompt: "이 문제를 풀 때 꼭 기억해야 하는 상태는?", context: m.summary, options: shuffle([m.state.right, ...m.state.wrong], r), answer: m.state.right,
      explain: `바꾸는 법: ${m.update}` };
    const p = pool.find((x) => x.predict && !/\s/.test(x.predict.answer.trim()));
    if (p?.predict) out.predict = { id: psId("predict", p.number, pid, seed), kind: "short", label: "출력 예측", knowledgeId: item.id,
      prompt: `${p.predict.question}\n입력:\n${p.predict.input}`, context: p.summary, answer: p.predict.answer.trim(),
      explain: `BOJ ${p.number} ${p.title} — ${p.walkthrough.choose}` };
  }
  // 차례는 기억 저장소의 반복 수가 아니라(튜터에서 틀린 것도 1번으로 세진다) 마지막으로 배운 뒤 몇 번 복습했는지로 정한다:
  // 새로 몰랐던 게 생기면 다시 ① 내 실수부터(가상 학습자 실험에서 찾은 것, 11/8).
  const since = mine?.at ?? "";
  const reps = events.filter((e) => e.patterns.includes(pid) && e.at > since && e.detail?.startsWith("기억 복습(")).length;
  const order: PsKind[] = reps === 0 ? ["mistake", "recognize", "design", "predict"] : reps === 1 ? ["recognize", "mistake", "design", "predict"]
    : (["design", "predict", "recognize", "mistake"] as PsKind[]).map((_, i, a) => a[(i + reps) % a.length]);
  return order.map((k) => out[k]).filter((q): q is Question => Boolean(q));
}
