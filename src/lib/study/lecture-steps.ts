// 강의 (카드 하나씩, 11/10 사용자 "카드 단위로 순서 잡고 그 사이에 학생 개입 들어오면 집어넣으면 되잖아", "기본 강의 순서는 가로로 진행되게 하고,
// 학생이 개입해서 새로 알려 주는 건 그 박스 밑으로 세로로 달아"). 실험(lecture-first-lab.ts 5차, 6카드 + 질문 2개: 카드마다 첫 글자 3~5초, 약 $0.008)을 제품으로.
// - 순서: 줄기의 기억(카드) 순서. 카드 하나 = 강의 한 걸음(sol low, 스트리밍). 강사는 그 영역의 쪽 전부를 받는다(아래). 다음 카드는 미리 부른다.
// - 카드 사이 질문: 그 카드 밑에 묻고 답(sol low). 다음 카드는 지금까지의 질문·답과 바로 앞 설명을 이어받는다.
// - 그 카드 쪽의 원문 글자와 쪽 그림을 함께 보낸다. 강의가 ⟦그림: 이름표 | 볼 것⟧으로 가리키면 화면이 GET ?fig=로 그 그림을 띄운다.
// - 저장 study-gen/<id>/lecture-steps.json, 쓰는 중인 글은 서버 메모리(GET이 합쳐서 돌려줌). /api/study-map/<id>/lecture?v=2
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { callModel } from "../ai/model.ts";
import { currentTrace, withTrace } from "../ai/trace.ts";
import { LOCAL_CALLER, logAssistCall } from "../assist/model.ts";
import { loadGen } from "./gen/runner.ts";
import { materialMap, type MapCard } from "./material-map.ts";

export const STEP_MODEL = { model: "gpt-6.1-sol", effort: "low" };
// 11/10 사용자 "카드를 주는데 페이지도 같이 주면?" → "해 봐": 한 걸음 = 카드 하나, 그런데 강사는 그 카드가 있는 영역의 쪽 전부(글자 + 그림)와
// 영역의 기억(맡은 쪽 포함)을 받는다. 앞쪽(지시문·자료·목록·영역 쪽)은 같은 영역의 카드·질문이 똑같이 써서 session_id 캐시가 붙는다(영역 단위 실측 74%).
// 카드마다 자기 몫만: 다른 카드 몫은 짚기만, 어느 카드에도 안 속한 쪽 내용은 그 쪽을 쓰는 마지막 카드가 맡는다(코드가 알려 줌).
// 다음 카드는 지금 카드가 끝나면 미리 부르고, 학생이 지금 카드에서 물으면 버렸다가 답 뒤에 다시 부른다.
export const STEP_SYSTEM = `너는 이 강의를 맡은 강사다. 기억 카드 순서대로 학생과 한 카드씩 강의하고 있다.
받는 것: 강의 전체의 영역과 기억 목록, 지금 영역의 쪽들 원문과 그림("[이미지] 이름표"), 지금 영역의 기억(id·이름·역할·요지·식과 조건·맡은 쪽), 지금까지의 수업(앞에서 설명한 카드, 바로 앞 설명, 학생이 묻고 들은 것), 그리고 맨 끝의 [할 일].
카드를 설명할 때:
- 학생은 이 내용을 처음 배운다. 채팅으로 말하듯 설명한다. 바로 앞 설명(또는 학생과 나눈 말)에서 자연스럽게 이어 시작한다. 첫 카드면 이 강의가 풀려는 문제에서 시작한다.
- 지금 카드의 몫을, 그 카드가 맡은 쪽의 원문을 빠뜨리지 않고 한 단계씩 설명한다. 영역의 다른 카드가 맡은 내용은 미리 설명하지 않고 "조금 뒤에 볼게요" 정도로만 짚는다. 이미 설명한 카드의 내용은 다시 풀지 않고 이어서 쓴다.
- 학생이 앞에서 물은 것이 이어지면 그 답을 바탕으로 설명하고, 학생이 몰랐던 것이 여기서 다시 쓰이면 그 자리에서 짚어 준다.
- 식은 $…$(한 줄 식은 $$…$$)로 쓰고, 무엇이 커지면 무엇이 어떻게 되는지 말로 풀어 준다. 원문에 예·값이 있으면 그것으로 보여 준다. 기호는 처음 나올 때 뜻을 말한다.
- 그림을 보며 설명할 자리에 ⟦그림: 이미지 이름표 | 이 그림에서 볼 것⟧ 한 줄(받은 이름표 그대로). 표는 본문에 표로 옮겨 써도 된다.
- 다음 카드 예고나 "질문 있나요?"는 쓰지 않는다(학생이 화면에서 고른다).
- 자료에 없는 사실을 지어내지 않는다. 쉬운 말, "~해요" 체, 용어는 "한국어(영어 원어)".`;
const ASK_RULE = `[할 일] 강의 도중 학생이 물었다. 지금까지의 수업과 이 영역 쪽들의 원문을 바탕으로, 학생이 막힌 곳만 짧고 쉽게 답한다.
학생이 무엇을 잘못 알고 있었는지가 보이면 그것을 바로잡는다. 식은 $…$. 그림이 도움이 되면 ⟦그림: 이미지 이름표 | 볼 것⟧. 카드 설명을 처음부터 다시 하지 않는다. "~해요" 체.`;

type Ask = { q: string; a: string; status: "writing" | "done" | "failed"; at: string };
type Step = { status: "writing" | "done" | "failed" | "stopped"; text: string; ms?: number; at: string; asks: Ask[]; prefetched?: boolean };
export type LectureSteps = { order: string[]; steps: Record<string, Step> };

const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");
const fileOf = (id: string) => { if (!/^gen_[a-z0-9]{8,64}$/.test(id)) throw Object.assign(new Error("자료를 찾을 수 없어요."), { status: 404 }); return path.join(dataDir(), "study-gen", id, "lecture-steps.json"); };
async function load(id: string): Promise<LectureSteps | null> { try { return JSON.parse(await readFile(fileOf(id), "utf8")) as LectureSteps; } catch { return null; } }
let saving = Promise.resolve();
function save(id: string, l: LectureSteps) { saving = saving.then(async () => { const f = fileOf(id); await mkdir(path.dirname(f), { recursive: true }); await writeFile(`${f}.tmp`, JSON.stringify(l, null, 1)); await rename(`${f}.tmp`, f); }).catch(() => undefined); return saving; }

/** 쓰는 중인 글(서버 메모리) · 끊기. key = `${id}:${cardId}` 또는 `${id}:${cardId}:ask` */
const live = new Map<string, string>();
const aborts = new Map<string, AbortController>();
const lectures = new Map<string, LectureSteps>();

type Img = { page: number; label: string; dataUrl: string };
const imageCache = new Map<string, { at: number; images: Img[] }>();
async function imagesOf(id: string, pages: number[]): Promise<Img[]> {
  const cached = imageCache.get(id) ?? { at: Date.now(), images: [] };
  const need = pages.filter((p) => !cached.images.some((x) => x.page === p) && !(cached as { none?: Set<number> }).none?.has(p));
  if (need.length) {
    const state = await loadGen(id) as unknown as { input: { sourceId: string }; recaller?: { prep?: { pages?: Array<{ page: number; route?: string }> } } } | null;
    const { readRegisteredMcpSourcePdf } = await import("../mcp-source-registry.ts");
    const { renderPageFigures, renderPageImages } = await import("./gen/pages.ts");
    const pdf = state ? await readRegisteredMcpSourcePdf(state.input.sourceId) : null;
    if (pdf) {
      const route = new Map((state!.recaller?.prep?.pages ?? []).map((x) => [x.page, x.route ?? "text"]));
      const figs = await renderPageFigures(pdf, need.filter((p) => route.get(p) === "figures"), 1024).catch(() => new Map<number, Array<{ label: string; dataUrl: string }>>());
      const wholes = await renderPageImages(pdf, need.filter((p) => route.get(p) === "page" || (route.get(p) === "figures" && !figs.get(p)?.length)), 1024).catch(() => new Map<number, string>());
      for (const p of need) { const f = figs.get(p) ?? []; if (f.length) cached.images.push(...f.map((x) => ({ page: p, label: x.label, dataUrl: x.dataUrl }))); else if (wholes.get(p)) cached.images.push({ page: p, label: `원문 p.${p}`, dataUrl: wholes.get(p)! }); }
    }
    const none = (cached as { none?: Set<number> }).none ?? new Set<number>();
    for (const p of need) if (!cached.images.some((x) => x.page === p)) none.add(p);
    (cached as { none?: Set<number> }).none = none;
    imageCache.set(id, cached);
  }
  return cached.images.filter((x) => pages.includes(x.page));
}
const bare = (s: string) => s.replace(/^\[이미지\]\s*/, "").replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, "").toLowerCase();

async function context(id: string) {
  const state = await loadGen(id);
  const map = state ? materialMap(state, {}) : null;
  if (!state || !map) throw Object.assign(new Error("자료를 찾을 수 없어요."), { status: 404 });
  if (state.status !== "done") throw Object.assign(new Error("자료를 다 만든 뒤에 강의를 들을 수 있어요."), { status: 409 });
  const texts = (state as unknown as { recaller?: { texts?: Record<string, string> } }).recaller?.texts ?? {};
  const isFlow = (c: MapCard) => c.title.startsWith("흐름: ");
  const sections = map.sections.map((s) => { const cards = s.cards.filter((c) => !isFlow(c)); return { id: s.id, title: s.title, cards, pages: [...new Set([...s.pages, ...cards.flatMap((c) => c.pages)])].sort((a, b) => a - b) }; }).filter((s) => s.cards.length);
  const cards = sections.flatMap((s) => s.cards);
  return { map, texts, sections, cards, byId: new Map(cards.map((c) => [c.id, c])), bySection: new Map(sections.map((x) => [x.id, x])) };
}
async function lectureOf(id: string) {
  let l = lectures.get(id) ?? await load(id);
  const { cards } = await context(id);
  const order = cards.map((x) => x.id);
  // 걸음 단위가 바뀌었으면(영역 → 카드) 새로
  if (!l || l.order.join() !== order.join()) { l = { order, steps: {} }; await save(id, l); }
  lectures.set(id, l);
  return l;
}
const cardText = (c: MapCard) => [`[${c.id}] ${c.title} (${c.kind}, ${c.memo?.role ?? (c.core ? "메인" : "바탕")}, p.${c.pages.join(",")})`, c.memo?.line ? `  요지: ${c.memo.line}` : "", ...(c.memo?.facts ?? []).map((f) => `  식·조건: ${f}`)].filter(Boolean).join("\n");

function history(l: LectureSteps, upto: string, titles: Map<string, string>) {
  const idx = l.order.indexOf(upto);
  const before = l.order.slice(0, idx).filter((x) => l.steps[x]?.status === "done");
  const qa = before.concat(l.steps[upto]?.asks?.length ? [upto] : []).flatMap((x) => (l.steps[x]?.asks ?? []).filter((a) => a.status === "done").map((a) => `- (${titles.get(x) ?? x} 뒤) 학생: ${a.q}\n  강사: ${a.a}`));
  const prev = before.at(-1);
  const lastAsk = prev ? l.steps[prev].asks.filter((a) => a.status === "done").at(-1) : undefined;
  return `[지금까지의 수업]\n설명한 카드: ${before.map((x) => titles.get(x) ?? x).join(", ") || "(아직 없음)"}\n${qa.length ? `학생이 묻고 들은 것:\n${qa.join("\n")}\n` : ""}바로 앞 설명:\n${lastAsk ? `${l.steps[prev!].text}\n(이어서 학생이 물었다) ${lastAsk.q}\n(강사) ${lastAsk.a}` : prev ? l.steps[prev].text : "(첫 카드)"}`;
}

async function stream(id: string, key: string, purpose: string, system: string, user: string, tail: string, images: Img[], onDone: (text: string, ok: boolean, stopped: boolean) => void) {
  const abort = new AbortController(); aborts.set(key, abort); live.set(key, "");
  const t = Date.now(); let first = 0;
  try {
    const r = await withTrace({ area: "pdf", action: "lecture-step", ref: id }, () => callModel({ purpose, system, user, tail, cacheKey: `recaller-lecture-${id}`, ...STEP_MODEL, caller: LOCAL_CALLER, images: images.map(({ label, dataUrl }) => ({ label, dataUrl })),
      signal: abort.signal, onText: (x) => { if (!first) first = Date.now(); live.set(key, x); } }));
    const u = r.usage;
    logAssistCall({ at: new Date(t).toISOString(), purpose, ...STEP_MODEL, ms: Date.now() - t, ...(first ? { firstTextMs: first - t } : {}), ok: true, inChars: user.length,
      ...(u ? { tokens: { in: u.inputTokens, cached: u.cachedInputTokens, out: u.outputTokens, reasoning: u.reasoningTokens } } : {}), trace: currentTrace() });
    onDone(r.text, true, false);
  } catch { onDone(live.get(key) ?? "", false, abort.signal.aborted); }
  finally { live.delete(key); aborts.delete(key); }
}

const listOf = (sections: Awaited<ReturnType<typeof context>>["sections"]) => sections.map((x, i) => `영역 ${i + 1}. ${x.title}\n${x.cards.map((c) => `- ${c.title}`).join("\n")}`).join("\n");
// 캐시(11/10, session_id): 앞쪽(자료·목록·이 영역의 쪽 원문 + 그림)은 그 영역의 강의와 질문들이 똑같이 쓰고, 바뀌는 것(수업 기록·질문)은 tail로.
async function prefix(id: string, cardId: string) {
  const { map, texts, sections, cards } = await context(id);
  const sec = sections.find((x) => x.cards.some((c) => c.id === cardId));
  const card = cards.find((c) => c.id === cardId);
  if (!sec || !card) throw Object.assign(new Error("그 카드를 찾을 수 없어요."), { status: 404 });
  const user = `[자료] ${map.title}\n\n[영역과 기억 목록]\n${listOf(sections)}\n\n[지금 영역] ${sec.title} (p.${sec.pages.join(",")})\n[지금 영역의 기억]\n${sec.cards.map(cardText).join("\n")}\n\n[원문]\n${sec.pages.map((p) => `[p.${p}]\n${texts[p] ?? ""}`).join("\n\n")}`;
  // 이 카드가 그 쪽을 쓰는 마지막 카드면, 그 쪽의 남은 내용(어느 카드에도 안 속한 것)도 맡는다.
  const lastOf = card.pages.filter((p) => { const users = sec.cards.filter((c) => c.pages.includes(p)); return users.at(-1)?.id === card.id; });
  return { sec, card, user, lastOf, images: await imagesOf(id, sec.pages), titles: new Map(cards.map((x) => [x.id, x.title])) };
}
const stepRule = (card: MapCard, lastOf: number[]) => `[할 일] 지금 카드 [${card.id}] ${card.title} (맡은 쪽 p.${card.pages.join(",")})를 설명한다.${lastOf.length ? ` p.${lastOf.join(", p.")}에서 어느 카드에도 속하지 않은 내용이 있으면 이 카드에서 함께 다룬다.` : ""}`;
export async function stepCard(id: string, cardId: string, opts: { prefetch?: boolean } = {}) {
  const l = await lectureOf(id);
  const had = l.steps[cardId];
  if (had && !opts.prefetch && had.prefetched) { delete had.prefetched; await save(id, l); return; } // 미리 부른 것을 학생이 열었다
  if (had?.status === "writing" || (had?.status === "done" && opts.prefetch)) return;
  const { card, user, images, titles, lastOf } = await prefix(id, cardId);
  l.steps[cardId] = { status: "writing", text: "", at: new Date().toISOString(), asks: had?.asks ?? [], ...(opts.prefetch ? { prefetched: true } : {}) };
  await save(id, l);
  const t = Date.now();
  void stream(id, `${id}:${cardId}`, "map:lecture-step", STEP_SYSTEM, user, `${history(l, cardId, titles)}\n\n${stepRule(card, lastOf)}`, images, (text, ok, stopped) => {
    if (!l.steps[cardId]) return; // 버린 미리 부르기
    l.steps[cardId] = { ...l.steps[cardId], status: ok ? "done" : stopped ? "stopped" : "failed", text, ms: Date.now() - t };
    void save(id, l);
    if (ok) void prefetchNext(id, cardId);
  });
}
async function prefetchNext(id: string, cardId: string) {
  const l = await lectureOf(id);
  const next = l.order[l.order.indexOf(cardId) + 1];
  if (!next || l.steps[next] || l.steps[cardId]?.asks.some((a) => a.status === "writing")) return;
  await stepCard(id, next, { prefetch: true }).catch(() => undefined);
}
export async function askCard(id: string, cardId: string, q: string) {
  const l = await lectureOf(id);
  const step = l.steps[cardId];
  if (!step) throw Object.assign(new Error("설명을 들은 카드에서 물을 수 있어요."), { status: 409 });
  // 미리 부른 다음 카드는 이 질문을 모르니 버린다(답 뒤에 다시 부른다).
  const next = l.order[l.order.indexOf(cardId) + 1];
  if (next && l.steps[next]?.prefetched) { aborts.get(`${id}:${next}`)?.abort(); delete l.steps[next]; }
  const { user, images, titles } = await prefix(id, cardId);
  const ask: Ask = { q: q.slice(0, 1000), a: "", status: "writing", at: new Date().toISOString() };
  const tail = `${history(l, cardId, titles)}\n\n지금 카드의 설명:\n${step.text}\n\n[학생 질문] ${ask.q}\n\n${ASK_RULE}`;
  step.asks.push(ask);
  await save(id, l);
  void stream(id, `${id}:${cardId}:ask`, "map:lecture-ask", STEP_SYSTEM, user, tail, images, (text, ok, stopped) => {
    ask.a = text; ask.status = ok || stopped ? "done" : "failed";
    void save(id, l);
    void prefetchNext(id, cardId);
  });
}

/** /api/study-map/<id>/lecture?v=2 — GET 강의 상태(쓰는 중 글 포함) · GET ?fig=이름표 그림 · POST {action:"step"|"ask"|"stop"|"reset", card, q} */
export async function lectureStepsApi(request: Request, id: string) {
  const { NextResponse } = await import("next/server");
  const url = new URL(request.url);
  if (request.method === "GET") {
    const fig = url.searchParams.get("fig");
    if (fig) {
      const page = Number(/p\.(\d+)/.exec(fig)?.[1] ?? 0);
      const img = (await imagesOf(id, page ? [page] : [])).find((x) => bare(x.label) === bare(fig)) ?? (await imagesOf(id, page ? [page] : []))[0];
      return NextResponse.json({ dataUrl: img?.dataUrl ?? null });
    }
    const l = await lectureOf(id);
    const { byId } = await context(id);
    const view = l.order.map((cid) => {
      const s = l.steps[cid]; const c = byId.get(cid);
      return { id: cid, title: c?.title ?? cid, role: c?.memo?.role ?? "", cards: [cid], pages: c?.pages ?? [], ...(s && !s.prefetched ? { status: s.status, text: s.status === "writing" ? live.get(`${id}:${cid}`) ?? s.text : s.text,
        asks: s.asks.map((a, i) => ({ ...a, a: a.status === "writing" && i === s.asks.length - 1 ? live.get(`${id}:${cid}:ask`) ?? a.a : a.a })) } : {}), ...(s?.prefetched ? { ready: s.status } : {}) };
    });
    return NextResponse.json({ lecture: { cards: view } });
  }
  const body = await request.json().catch(() => ({})) as { action?: string; card?: string; q?: string };
  if (body.action === "step" && body.card) await stepCard(id, body.card);
  else if (body.action === "ask" && body.card && body.q?.trim()) await askCard(id, body.card, body.q.trim());
  else if (body.action === "stop") { for (const [k, a] of aborts) if (k.startsWith(`${id}:`)) a.abort(); }
  else if (body.action === "reset") { for (const [k, a] of aborts) if (k.startsWith(`${id}:`)) a.abort(); lectures.delete(id); const { cards } = await context(id); const l = { order: cards.map((x) => x.id), steps: {} }; lectures.set(id, l); await save(id, l); }
  else return NextResponse.json({ message: "action은 step·ask·stop·reset" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
