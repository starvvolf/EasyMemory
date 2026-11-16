// 상황 재현 입구 (API · 화면이 부르는 것): 빈틈 뽑기 · 오늘 볼 것 · 다음 장면(섞기 포함) · 미리 실행 · 답 내기 · 왜인지 한 줄 ·
// 그때 내 코드 보기 · 튜터와 다시 보기 · [이건 아는 거였어요] · 실습 빈틈 가져오기 · 기억 저장소에 남기기.
import { cleanError, programOf, runAll, validInput } from "./exec.ts";
import { defaultAsk, extractGaps, recordOf, type Ask } from "./extract.ts";
import { gradeScene, type Graded } from "./grade.ts";
import { dueToday, reflect, MINUTES, SCOPE_MIN } from "./ladder.ts";
import { makeScene } from "./make.ts";
import { practiceGaps, practicePublic, previewPracticeScene } from "./practice/index.ts";
import { WHY_SCHEMA, WHY_SYSTEM } from "./prompts.ts";
import { addAttempt, changeGaps, newId, readAttempts, readGaps, readScene, saveScene, unusedScene } from "./store.ts";
import { PRACTICE_FORMATS, VERDICT_LABEL, type Gap, type Scene, type SceneVerdict } from "./types.ts";

/** 보여 줄 입력: 기본 입력. 그때 생각이 모든 입력에서 틀리는 장면이면 첫 입력 하나. */
const shownInputs = (s: Scene) => { const b = s.inputs.filter((x) => x.role === "basic"); return b.length ? b : s.inputs.slice(0, 1); };
/** 화면에 보낼 장면: 정답 · 오답 모양 · 모범 답은 빼고(풀기 전) */
export function publicScene(s: Scene) {
  const shownCode = s.format === "predict" || s.format === "error" || s.format === "draw" ? s.reference : s.format === "counter" ? s.wrongs.find((w) => w.id === "mine")?.code ?? "" : "";
  return { id: s.id, gapId: s.gapId, format: s.format, lang: s.lang, distance: s.distance, story: s.story, ask: s.ask, setup: s.setup, after: s.after,
    template: s.format === "fix" ? s.origin?.code || s.template || "" : s.template ?? "", code: shownCode,
    inputs: s.format === "predict" || s.format === "error" || s.format === "draw" ? s.inputs.slice(0, 1).map((x) => x.stdin)
      : s.format === "counter" ? [] : s.format === "variant" ? s.inputs.slice(0, 2).map((x) => x.stdin) : shownInputs(s).map((x) => x.stdin),
    failing: s.format === "fix" ? s.inputs.filter((x) => x.role === "split").slice(0, 1).map((x) => x.stdin) : [],
    choices: s.choices?.map((c) => c.text) ?? [], minutes: MINUTES[s.format],
    ...(s.view ? { view: s.view } : {}), ...(s.pieces ? { pieces: s.pieces } : {}), ...(s.errorText ? { errorText: s.errorText } : {}),
    ...(s.draw ? { drawMode: s.draw.mode } : {}), ...(s.variant ? { variant: s.variant } : {}), ...(s.structure ? { structure: s.structure.must.map((m) => m.why) } : {}),
    ...(s.mix ? { mix: s.mix } : {}), ...(PRACTICE_FORMATS.includes(s.format) || s.practice ? { practice: practicePublic(s) } : {}) };
}
export const gapView = (g: Gap) => ({ id: g.id, branch: g.branch, title: g.title, kind: g.kind, layer: g.layer, target: g.target, missed: g.missed, wrong: g.wrong, scope: g.scope, dose: g.dose.level,
  distance: g.state.distance, known: g.state.known, due: g.state.due, passes: g.state.passes, sameMistakes: g.state.sameMistakes, unclear: g.state.unclear,
  origin: g.origin, wrongVerified: g.wrongVerified, doubtful: Boolean(g.doubtful), dismissed: Boolean(g.dismissed), topic: g.topic,
  evidence: g.evidence.length, hasCode: g.evidence.some((e) => e.type === "submission"), ...(g.unit ? { unit: g.unit } : {}) });

/** 실습 빈틈을 바닥으로 가져온다(실습 원장의 gap id로 한 번만). 상태 · 날짜는 바닥이 갖는다. 실습 서버가 꺼져 있으면 그냥 넘어간다. */
async function syncPractice() {
  const incoming = await practiceGaps().catch(() => [] as Gap[]);
  if (!incoming.length) return;
  await changeGaps((gaps) => {
    for (const g of incoming) {
      const i = gaps.findIndex((x) => x.branch === "practice" && x.origin.practiceGapId && x.origin.practiceGapId === g.origin.practiceGapId);
      if (i < 0) gaps.push(g);
      // 이미 있으면 내용(말 · 알맹이 · 증거)만 새로, 상태는 그대로
      else gaps[i] = { ...g, id: gaps[i].id, state: gaps[i].state, dose: gaps[i].dose, ...(gaps[i].dismissed ? { dismissed: true } : {}), ...(gaps[i].marks ? { marks: gaps[i].marks } : {}), ...(gaps[i].knowledgeId ? { knowledgeId: gaps[i].knowledgeId } : {}) };
    }
  });
}

export async function today() {
  await syncPractice();
  const gaps = await readGaps();
  const d = dueToday(gaps);
  const part = (b: Gap["branch"]) => { const xs = d.gaps.filter((g) => g.branch === b); return { count: xs.length, minutes: xs.reduce((n, g) => n + SCOPE_MIN[g.scope], 0) }; };
  return { gaps: d.gaps.map(gapView), minutes: d.minutes, more: d.more, waiting: d.waiting, total: gaps.filter((g) => !g.state.known && !g.dismissed).length,
    byBranch: { algo: part("algo"), practice: part("practice") } };
}
export async function gapsOf(problemId: string) {
  return (await readGaps()).filter((g) => g.origin.problemId === problemId).map(gapView);
}
export async function gapsOfRun(runId: string) {
  await syncPractice();
  return (await readGaps()).filter((g) => g.origin.runId === runId).map(gapView);
}

/** 빈틈 → 기억 저장소 항목(설계 6번 "빈틈은 기억 저장소의 항목으로 남고"). 실패해도 빈틈은 남는다. */
async function remember(gaps: Gap[]) {
  const fresh = gaps.filter((g) => !g.knowledgeId);
  if (!fresh.length) return;
  try {
    const { saveMany } = await import("../knowledge/api.ts");
    const saved = await saveMany(fresh.map((g) => ({ title: g.title, body: `${g.missed}${g.wrong ? `\n그때 생각: ${g.wrong}` : ""}`, state: "unknown" as const,
      source: { kind: g.branch === "practice" ? "chat" as const : "code" as const, title: g.origin.title, ref: g.origin.problemId || g.origin.runId || "" },
      ask: `${g.title} — 무엇을 떠올려야 할까요?`, topicHint: g.topic })));
    await changeGaps((all) => { fresh.forEach((g, i) => { const x = all.find((y) => y.id === g.id); if (x && saved[i]) x.knowledgeId = saved[i].item.id; }); });
  } catch (e) { console.warn(`[scene] 기억 저장소에 남기지 못했어요: ${(e as Error).message}`); }
}
async function rememberEvent(gap: Gap, verdict: SceneVerdict, o: { hinted?: boolean }) {
  if (!gap.knowledgeId) return;
  try {
    const { recordEvent, setKnowledgeState } = await import("../knowledge/api.ts");
    const kind = o.hinted ? "hint" : verdict === "pass" ? "correct" : "wrong";
    await recordEvent(gap.knowledgeId, kind, `상황 재현 · ${VERDICT_LABEL[verdict]}`, { kind: gap.branch === "practice" ? "chat" : "code", title: gap.origin.title, ref: gap.origin.problemId || gap.origin.runId || "" });
    if (gap.state.known) await setKnowledgeState(gap.knowledgeId, { state: "known" });
  } catch { /* 기억 기록은 도움이지 필수가 아니다 */ }
}

export async function extract(problemId: string, opts: { ask?: Ask; force?: boolean } = {}) {
  const gaps = await extractGaps(problemId, opts);
  await remember(gaps);
  prefetch(gaps.filter((g) => !g.state.known).map((g) => g.id), opts.ask ? { ask: opts.ask } : {});
  return (await readGaps()).filter((g) => g.origin.problemId === problemId).map(gapView);
}

/**
 * 빈틈의 다음 장면: 지금 거리 · 아직 안 푼 장면이 있으면 그것, 없으면 새로 만든다.
 * 응용 섞기(설계 4번): 한 줄 범위 빈틈이 응용 차례이고, 같은 때 응용 차례인 다른 한 줄 빈틈이 있으면 작은 함수 하나에 섞어서(최대 셋).
 */
const pending = new Map<string, string>();
/** 만드는 중인 장면(같은 빈틈 · 거리를 두 번 만들지 않게) · 지금 무엇을 하는지(화면의 "…" 옆 글) */
const inflight = new Map<string, Promise<Scene | null>>();
const stages = new Map<string, { text: string; at: number; started: number }>();
const key = (gapId: string, distance: string) => `${gapId}@${distance}`;
export function progress(gapId: string) {
  const hit = [...stages.entries()].filter(([k]) => k.startsWith(`${gapId}@`)).map(([, v]) => v).sort((a, b) => b.at - a.at)[0];
  return hit ? { text: hit.text, seconds: Math.round((Date.now() - hit.started) / 1000) } : null;
}

/** 장면 하나 만들기(같은 빈틈 · 거리는 한 번만 동시에). 응용 섞기는 고른 거리 없이(추천대로) 들어온 응용일 때만. */
function build(gap: Gap, all: Gap[], opts: { ask?: Ask; mix?: boolean }) {
  const k = key(gap.id, gap.state.distance);
  const had = inflight.get(k);
  if (had) return had;
  const started = Date.now();
  const stage = (text: string) => stages.set(k, { text, at: Date.now(), started });
  const run = (async () => {
    let scene: Scene | null = null;
    if (opts.mix !== false && gap.scope === "line" && gap.state.distance === "far" && gap.branch === "algo") {
      const due = Date.now();
      // 알고리즘 고르기의 응용은 변형 문제라 섞지 않는다
      const mixable = (g: Gap) => g.scope === "line" && g.kind !== "알고리즘 고르기";
      const others = !mixable(gap) ? [] : all.filter((g) => g.id !== gap.id && g.branch === "algo" && mixable(g) && g.state.distance === "far" && !g.state.known && !g.dismissed
        && Date.parse(g.state.due) <= due + 86_400_000 && g.origin.lang === gap.origin.lang).slice(0, 2);
      if (others.length) { stage(`응용: 한 줄 빈틈 ${others.length + 1}개를 작은 함수 하나에 섞는 중`); scene = await makeScene(gap, { ...(opts.ask ? { ask: opts.ask } : {}), mix: [gap, ...others], stage }).catch(() => null); }
    }
    return scene ?? await makeScene(gap, { ...(opts.ask ? { ask: opts.ask } : {}), stage });
  })().finally(() => { inflight.delete(k); stages.delete(k); });
  inflight.set(k, run);
  return run;
}

/**
 * 빈틈의 다음 장면: 지금 거리(추천)의 아직 안 푼 장면이 있으면 그것, 만드는 중이면 그것을 기다리고, 없으면 새로 만든다.
 * distance를 주면 추천 대신 학습자가 고른 거리로(사용자 11/15 "AI 판단은 지금처럼 하되 다른 거 먼저 누르고 싶으면").
 */
export async function next(gapId: string, opts: { ask?: Ask; mix?: boolean; distance?: Gap["state"]["distance"] } = {}) {
  await syncPractice();
  const all = await readGaps();
  const found = all.find((g) => g.id === gapId);
  if (!found) throw new Error("빈틈을 찾을 수 없어요.");
  const chosen = opts.distance && opts.distance !== found.state.distance;
  const gap: Gap = chosen ? { ...found, state: { ...found.state, distance: opts.distance! } } : found;
  const had = pending.get(key(gapId, gap.state.distance));
  const old = (had ? await readScene(had) : null) ?? await unusedScene(gapId, gap.state.distance);
  if (old && old.distance === gap.state.distance) { pending.set(key(gapId, gap.state.distance), old.id); return { gap: gapView(found), scene: publicScene(old), recommended: found.state.distance }; }
  const scene = await build(gap, all, { ...opts, ...(chosen ? { mix: false } : {}) });
  if (!scene) throw new Error("이 빈틈의 장면을 만들지 못했어요. 나중에 다시 해 볼게요.");
  pending.set(key(gapId, gap.state.distance), scene.id);
  return { gap: gapView(found), scene: publicScene(scene), recommended: found.state.distance };
}

/**
 * 미리 만들어 두기(사용자 11/15 "미리 살짝 만들어 놔도 돼?"): 빈틈을 뽑은 뒤 · 확인을 시작할 때, 추천 거리의 장면을 뒤에서 만들어 둔다.
 * 이미 있거나 만드는 중이면 건너뛴다. 동시에 둘까지(AI 호출이 한꺼번에 몰리지 않게). 결과를 기다리지 않는다.
 */
let prefetching = 0;
const prefetchQueue: string[] = [];
export function prefetch(gapIds: string[], opts: { ask?: Ask } = {}) {
  for (const id of gapIds) if (!prefetchQueue.includes(id)) prefetchQueue.push(id);
  const pump = async () => {
    while (prefetching < 2 && prefetchQueue.length) {
      const id = prefetchQueue.shift()!;
      prefetching++;
      void (async () => {
        try {
          const all = await readGaps();
          const gap = all.find((g) => g.id === id);
          if (!gap || gap.state.known || gap.dismissed) return;
          if (await unusedScene(id, gap.state.distance) || inflight.has(key(id, gap.state.distance))) return;
          await build(gap, all, opts);
        } catch (e) { console.warn(`[scene] 미리 만들기 실패: ${(e as Error).message}`); }
        finally { prefetching--; void pump(); }
      })();
    }
  };
  void pump();
  return { queued: prefetchQueue.length + prefetching };
}

/** 미리 실행: 보이는 입력(기본)에서만 돌려 출력을 보여 준다. 채점은 안 함. 반례 만들기는 학습자가 쓴 입력으로 두 코드를 돌리지 않고(답이 됨) 입력 검사만. */
export async function preview(sceneId: string, answer: string) {
  const s = await readScene(sceneId);
  if (s && (s.format === "where" || s.format === "project")) return previewPracticeScene(s, answer);
  if (!s || ["choice", "predict", "error", "draw", "why"].includes(s.format) || PRACTICE_FORMATS.includes(s.format)) throw new Error("실행할 수 없는 장면이에요.");
  if (s.format === "counter") { const v = await validInput(s.validator, answer); return { runs: [{ input: answer, ...(v.ok ? { out: "입력 형식은 맞아요." } : { error: v.why }) }] }; }
  const shown = s.format === "fix" ? s.inputs.filter((x) => x.role === "split").slice(0, 1) : s.format === "variant" ? s.inputs.slice(0, 2) : shownInputs(s);
  const runs = await runAll(s.lang, programOf(s, answer), shown.map((x) => x.stdin));
  return { runs: runs.map((r, i) => ({ input: shown[i].stdin, ...(r.ok ? { out: r.out } : { error: cleanError(r.error) }) })) };
}

export async function answer(sceneId: string, input: { answer: string; hinted?: boolean; gaveUp?: boolean }) {
  const s = await readScene(sceneId);
  if (!s) throw new Error("장면을 찾을 수 없어요.");
  const gap0 = (await readGaps()).find((g) => g.id === s.gapId);
  if (!gap0) throw new Error("빈틈을 찾을 수 없어요.");
  const graded: Graded = await gradeScene(s, gap0, input.answer, { gaveUp: input.gaveUp });
  // 반례 · 값이 읽히지 않음: 기록하지 않고 다시 내게 한다
  if (graded.invalid) return { invalid: graded.invalid };
  // 표현 확인에서 다른 방법으로 맞힘: 기록하지 않고 그 표현으로 다시
  if (graded.matched === "structure") return { invalid: graded.note ?? "이번에는 그 표현으로 해 보세요." };
  await addAttempt({ id: newId("at"), at: new Date().toISOString(), sceneId, gapId: s.gapId, distance: s.distance, format: s.format, answer: input.answer.slice(0, 4000), verdict: graded.verdict,
    hinted: Boolean(input.hinted), gaveUp: Boolean(input.gaveUp), ...(graded.outputs ? { outputs: graded.outputs.map((o) => o.slice(0, 300)) } : {}),
    ...(graded.matched ? { matched: graded.matched } : {}), ...(graded.firstDiff ? { firstDiff: { index: graded.firstDiff.index, expected: graded.firstDiff.expected.slice(0, 300), got: graded.firstDiff.got.slice(0, 300) } } : {}) });
  // 미확정 답의 출력 모양을 이 장면에 모아 둔다(은행에서 다시 쓰일 때 "다른 실수"로 알아보게, 설계 한계 3)
  if (graded.verdict === "unclear" && !input.gaveUp && graded.outputs?.length && s.computed && !Object.values(s.computed.shapes).some((sh) => sh.join("\u0001") === graded.outputs!.join("\u0001"))) {
    const id = `seen${Object.keys(s.computed.shapes).filter((k) => k.startsWith("seen")).length + 1}`;
    await saveScene({ ...s, wrongs: [...s.wrongs, { id, what: "학습자가 실제로 낸 다른 답(원인 미확정)", code: input.answer.slice(0, 2000), collected: true }], computed: { ...s.computed, shapes: { ...s.computed.shapes, [id]: graded.outputs } } });
  }
  // 섞은 장면: 통과면 섞인 빈틈 모두 한 칸, 같은 실수면 그 빈틈만, 나머지는 그대로
  const targets = s.mix?.length ? (graded.verdict === "pass" ? s.mix : graded.gapId ? [graded.gapId] : [s.gapId]) : [s.gapId];
  const changed = await changeGaps((gaps) => targets.map((id) => {
    const i = gaps.findIndex((g) => g.id === id);
    if (i < 0) return null;
    // 학습자가 추천과 다른 거리를 골라 풀었으면 그 거리에서 한 칸 움직인다
    const base = id === s.gapId && gaps[i].state.distance !== s.distance ? { ...gaps[i], state: { ...gaps[i].state, distance: s.distance, here: 0 } } : gaps[i];
    gaps[i] = reflect(base, graded.verdict, { hinted: input.hinted, gaveUp: input.gaveUp });
    return gaps[i];
  }).filter((g): g is Gap => Boolean(g)));
  const gap = changed.find((g) => g.id === (graded.gapId ?? s.gapId)) ?? changed[0];
  for (const g of changed) await rememberEvent(g, graded.verdict, input);
  for (const id of targets) for (const d of ["same", "near", "far"]) pending.delete(key(id, d));
  const other = graded.matched && !/^mine/.test(graded.matched) && graded.matched !== "gave-up" ? s.wrongs.find((w) => w.id === graded.matched)?.what : undefined;
  return {
    verdict: graded.verdict, label: VERDICT_LABEL[graded.verdict], gaveUp: Boolean(input.gaveUp), note: graded.note,
    // 무엇을 말해 줄지: 맞는 생각 한 문장 · 알맹이 · 그때 생각 · (미확정이면) 처음 갈린 입력
    explain: s.explain, kernel: gap.kernel.code, wrong: gap.wrong, other, firstDiff: graded.firstDiff, errors: graded.errors?.slice(0, 2),
    answerKey: s.format === "choice" || s.format === "error" ? s.choices?.findIndex((c) => c.thought === "right") : undefined,
    expected: s.format === "predict" || s.format === "draw" ? s.computed?.expected[0] : undefined,
    reference: s.format === "blank" || s.format === "write" || s.format === "function" || s.format === "order" ? s.reference || undefined : s.format === "counter" ? s.inputs.find((x) => x.role === "split")?.stdin : undefined,
    origin: s.distance === "far" ? `이건 ${gap.origin.title}에서 막혔던 그 생각이었어요: ${gap.title}` : undefined,
    mixed: s.mix && s.mix.length > 1 ? changed.map(gapView) : undefined,
    gap: gapView(gap), tutor: gap.state.streak.same >= 2, canWhy: graded.verdict === "pass" && !input.hinted,
  };
}
export async function history(gapId: string) { return (await readAttempts()).filter((a) => a.gapId === gapId); }

/** 왜인지 한 줄(형식 12): 통과한 뒤 덧붙이는 선택 질문. 질문은 코드가 만들고(AI 0번), 채점은 AI 1번(실습 "다시 확인"과 같은 방식). 사다리는 안 바꾼다. */
export async function whyQuestion(sceneId: string) {
  const s = await readScene(sceneId);
  if (!s) throw new Error("장면을 찾을 수 없어요.");
  const gap = (await readGaps()).find((g) => g.id === s.gapId)!;
  return { question: `방금 장면에서 ${gap.missed.replace(/[.。]$/, "")}${/다$/.test(gap.missed.replace(/[.。]$/, "")) ? "" : "다"}. 왜 그래야 하는지 한두 문장으로 써 보세요.` };
}
export async function why(sceneId: string, text: string, opts: { ask?: Ask } = {}) {
  const s = await readScene(sceneId);
  if (!s) throw new Error("장면을 찾을 수 없어요.");
  const gap = (await readGaps()).find((g) => g.id === s.gapId)!;
  const { question } = await whyQuestion(sceneId);
  const ask = opts.ask ?? ((p, sys, u, sch) => defaultAsk(p, sys, u, sch));
  const r = await ask<{ ok: boolean; same: boolean; note: string }>("scene:why", WHY_SYSTEM, `[질문] ${question}\n[맞는 생각] ${gap.missed}\n[예전에 했던 틀린 생각] ${gap.wrong || "(없음)"}\n[학습자의 답] ${text.slice(0, 1000)}`, WHY_SCHEMA);
  const verdict: SceneVerdict = r.ok ? "pass" : r.same && gap.wrongVerified ? "same" : "unclear";
  await addAttempt({ id: newId("at"), at: new Date().toISOString(), sceneId, gapId: s.gapId, distance: s.distance, format: "why", answer: text.slice(0, 2000), verdict, hinted: false, gaveUp: false });
  return { verdict, label: VERDICT_LABEL[verdict], note: r.note };
}

/** [그때 내 코드 보기]: 증거가 가리킨 제출 코드(그 줄 표시) · 그때 한 말 */
export async function thenView(gapId: string) {
  const gap = (await readGaps()).find((g) => g.id === gapId);
  if (!gap) throw new Error("빈틈을 찾을 수 없어요.");
  if (gap.branch === "practice") return { title: gap.origin.title, subs: [], talk: gap.evidence.flatMap((e) => (e.type === "talk" ? [{ at: e.at, quote: e.quote ?? "" }] : [])), file: gap.origin.file ?? "" };
  const rec = await recordOf(gap.origin.problemId);
  const subs = gap.evidence.flatMap((e) => {
    if (e.type !== "submission") return [];
    const s = rec.subs.find((x) => x.id === e.id);
    return s ? [{ id: s.id, at: s.at, verdict: s.verdict, lang: s.lang, code: s.code, lines: e.lines ?? null }] : [];
  });
  const talk = gap.evidence.flatMap((e) => (e.type === "talk" ? [{ at: e.at, quote: e.quote ?? rec.talk.find((t) => t.at === e.at)?.q ?? "" }] : []));
  return { title: rec.title, subs, talk };
}

/** [튜터와 다시 보기]: 그 문제를 튜터와 다시 열 주소와, 튜터에게 먼저 건넬 말 */
export async function tutorLink(gapId: string) {
  const gap = (await readGaps()).find((g) => g.id === gapId);
  if (!gap) throw new Error("빈틈을 찾을 수 없어요.");
  const ask = `예전에 "${gap.title}"에서 막혔어요(그때: ${gap.wrong || "떠올리지 못함"}). 복습에서 또 같은 실수를 했어요. ${gap.missed.replace(/[.。]$/, "")} — 이게 왜 그런지 같이 다시 봐 주세요.`;
  if (gap.branch === "practice") return { kind: "practice" as const, runId: gap.origin.runId ?? "", ask };
  return { kind: "algo" as const, problemId: gap.origin.problemId, ask };
}

/** [이건 아는 거였어요]: 뽑기가 틀렸을 수 있는 빈틈을 복습에서 뺀다(설계 한계 1). 되돌릴 수 있다. */
export async function mark(gapId: string, kind: "known" | "doubt" | "undo", note = "") {
  const gap = await changeGaps((gaps) => {
    const g = gaps.find((x) => x.id === gapId);
    if (!g) throw new Error("빈틈을 찾을 수 없어요.");
    g.marks = [...(g.marks ?? []), ...(kind === "undo" ? [] : [{ at: new Date().toISOString(), kind, ...(note ? { note: note.slice(0, 200) } : {}) }])];
    if (kind === "known") g.dismissed = true;
    if (kind === "doubt") g.doubtful = true;
    if (kind === "undo") { delete g.dismissed; delete g.doubtful; }
    return g;
  });
  return gapView(gap);
}
