// 강의 (카드 하나씩, 11/10 사용자 "카드 단위로 순서 잡고 그 사이에 학생 개입 들어오면 집어넣으면 되잖아", "기본 강의 순서는 가로로 진행되게 하고,
// 학생이 개입해서 새로 알려 주는 건 그 박스 밑으로 세로로 달아"). 실험(lecture-first-lab.ts 5차, 6카드 + 질문 2개: 카드마다 첫 글자 3~5초, 약 $0.008)을 제품으로.
// - 순서: 자료의 기억(줄기 순서, 곁 기억 뺌). 카드 하나 = 강의 한 걸음(sol low, 스트리밍). 학생이 [다음]을 누를 때 그 카드를 부른다.
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
export const STEP_SYSTEM = `너는 이 강의를 맡은 강사다. 카드 목록 순서대로 학생과 한 카드씩 강의하고 있다. 지금은 카드 하나만 설명한다.
받는 것: 카드 목록(영역별), 지금 카드(이름·요지·식과 조건), 지금까지의 수업(앞에서 설명한 카드, 바로 앞 설명, 학생이 묻고 들은 것), 이 카드 쪽의 원문과 그림("[이미지] 이름표").
- 바로 앞 설명(또는 학생과 나눈 말)에서 자연스럽게 이어 시작한다. 첫 카드면 이 강의가 풀려는 문제에서 시작한다.
- 학생이 앞에서 물은 것이 이 카드와 이어지면 그 답을 바탕으로 설명하고, 학생이 몰랐던 것이 여기서 다시 쓰이면 그 자리에서 짚어 준다.
- 이 카드의 내용만, 학생이 한 번에 소화할 만큼 설명한다. 식은 $…$(한 줄 식은 $$…$$)로 쓰고 무엇이 커지면 무엇이 어떻게 되는지 말로 풀어 준다. 원문에 예·값이 있으면 그것으로 보여 준다.
- 그림을 보며 설명할 자리에 ⟦그림: 이미지 이름표 | 이 그림에서 볼 것⟧ 한 줄(받은 이름표 그대로).
- 다음 카드 예고나 "질문 있나요?"는 쓰지 않는다(학생이 화면에서 고른다).
- 자료에 없는 사실을 지어내지 않는다. 쉬운 말, "~해요" 체, 용어는 "한국어(영어 원어)".`;
export const ASK_SYSTEM = `너는 이 강의를 맡은 강사다. 강의 도중 학생이 물었다. 지금까지의 수업과 이 카드 쪽의 원문을 바탕으로, 학생이 막힌 곳만 짧고 쉽게 답한다.
학생이 무엇을 잘못 알고 있었는지가 보이면 그것을 바로잡는다. 식은 $…$. 그림이 도움이 되면 ⟦그림: 이미지 이름표 | 볼 것⟧. 자료에 없는 사실을 지어내지 않는다. "~해요" 체.`;

type Ask = { q: string; a: string; status: "writing" | "done" | "failed"; at: string };
type Step = { status: "writing" | "done" | "failed" | "stopped"; text: string; ms?: number; at: string; asks: Ask[] };
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
  const sections = map.sections.map((s) => ({ title: s.title, cards: s.cards.filter((c) => !isFlow(c) && c.memo?.role !== "곁") })).filter((s) => s.cards.length);
  const cards = sections.flatMap((s) => s.cards);
  return { map, texts, sections, cards, byId: new Map(cards.map((c) => [c.id, c])) };
}
async function lectureOf(id: string) {
  let l = lectures.get(id) ?? await load(id);
  const { cards } = await context(id);
  if (!l) { l = { order: cards.map((c) => c.id), steps: {} }; await save(id, l); }
  lectures.set(id, l);
  return l;
}
const cardText = (c: MapCard) => [`${c.title} (${c.kind})`, c.memo?.line ? `요지: ${c.memo.line}` : "", ...(c.memo?.facts ?? []).map((f) => `식·조건: ${f}`)].filter(Boolean).join("\n");

function history(l: LectureSteps, upto: string, byId: Map<string, MapCard>) {
  const idx = l.order.indexOf(upto);
  const before = l.order.slice(0, idx).filter((x) => l.steps[x]?.status === "done");
  const qa = before.concat(l.steps[upto]?.asks?.length ? [upto] : []).flatMap((x) => (l.steps[x]?.asks ?? []).filter((a) => a.status === "done").map((a) => `- (${byId.get(x)?.title ?? x} 뒤) 학생: ${a.q}\n  강사: ${a.a}`));
  const prev = before.at(-1);
  const lastAsk = prev ? l.steps[prev].asks.filter((a) => a.status === "done").at(-1) : undefined;
  return `[지금까지의 수업]\n설명한 카드: ${before.map((x) => byId.get(x)?.title ?? x).join(", ") || "(아직 없음)"}\n${qa.length ? `학생이 묻고 들은 것:\n${qa.join("\n")}\n` : ""}바로 앞 설명:\n${lastAsk ? `${l.steps[prev!].text}\n(이어서 학생이 물었다) ${lastAsk.q}\n(강사) ${lastAsk.a}` : prev ? l.steps[prev].text : "(첫 카드)"}`;
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

export async function stepCard(id: string, cardId: string) {
  const l = await lectureOf(id);
  const { map, texts, sections, byId } = await context(id);
  const c = byId.get(cardId);
  if (!c) throw Object.assign(new Error("그 카드를 찾을 수 없어요."), { status: 404 });
  if (l.steps[cardId]?.status === "writing") return;
  const asks = l.steps[cardId]?.asks ?? [];
  l.steps[cardId] = { status: "writing", text: "", at: new Date().toISOString(), asks };
  await save(id, l);
  const list = sections.map((s, i) => `영역 ${i + 1}. ${s.title}\n${s.cards.map((x) => `- ${x.title}`).join("\n")}`).join("\n");
  const images = await imagesOf(id, c.pages);
  // 캐시(11/10): 앞쪽은 카드마다 같게(자료·카드 목록), 바뀌는 것(지금 카드·수업·원문)은 이미지 뒤 tail로.
  const user = `[자료] ${map.title}\n\n[카드 목록]\n${list}`;
  const tail = `[지금 카드]\n${cardText(c)}\n\n${history(l, cardId, byId)}\n\n[원문]\n${c.pages.map((p) => `[p.${p}]\n${texts[p] ?? ""}`).join("\n\n")}`;
  const t = Date.now();
  void stream(id, `${id}:${cardId}`, "map:lecture-step", STEP_SYSTEM, user, tail, images, (text, ok, stopped) => {
    l.steps[cardId] = { ...l.steps[cardId], status: ok ? "done" : stopped ? "stopped" : "failed", text, ms: Date.now() - t };
    void save(id, l);
  });
}
export async function askCard(id: string, cardId: string, q: string) {
  const l = await lectureOf(id);
  const { texts, byId } = await context(id);
  const c = byId.get(cardId); const step = l.steps[cardId];
  if (!c || !step) throw Object.assign(new Error("설명을 들은 카드에서 물을 수 있어요."), { status: 409 });
  const ask: Ask = { q: q.slice(0, 1000), a: "", status: "writing", at: new Date().toISOString() };
  const { map, sections } = await context(id);
  const user = `[자료] ${map.title}\n\n[카드 목록]\n${sections.map((s, i) => `영역 ${i + 1}. ${s.title}\n${s.cards.map((x) => `- ${x.title}`).join("\n")}`).join("\n")}`;
  const tail = `${history(l, cardId, byId)}\n\n[지금 카드] ${cardText(c)}\n이 카드 설명:\n${step.text}\n\n[학생 질문] ${ask.q}\n\n[원문]\n${c.pages.map((p) => `[p.${p}]\n${texts[p] ?? ""}`).join("\n\n")}`;
  step.asks.push(ask);
  await save(id, l);
  const images = await imagesOf(id, c.pages);
  void stream(id, `${id}:${cardId}:ask`, "map:lecture-ask", ASK_SYSTEM, user, tail, images, (text, ok, stopped) => {
    ask.a = text; ask.status = ok || stopped ? "done" : "failed";
    void save(id, l);
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
      return { id: cid, title: c?.title ?? cid, role: c?.memo?.role ?? "", ...(s ? { status: s.status, text: s.status === "writing" ? live.get(`${id}:${cid}`) ?? s.text : s.text,
        asks: s.asks.map((a, i) => ({ ...a, a: a.status === "writing" && i === s.asks.length - 1 ? live.get(`${id}:${cid}:ask`) ?? a.a : a.a })) } : {}) };
    });
    return NextResponse.json({ lecture: { cards: view } });
  }
  const body = await request.json().catch(() => ({})) as { action?: string; card?: string; q?: string };
  if (body.action === "step" && body.card) await stepCard(id, body.card);
  else if (body.action === "ask" && body.card && body.q?.trim()) await askCard(id, body.card, body.q.trim());
  else if (body.action === "stop") { for (const [k, a] of aborts) if (k.startsWith(`${id}:`)) a.abort(); }
  else if (body.action === "reset") { for (const [k, a] of aborts) if (k.startsWith(`${id}:`)) a.abort(); lectures.delete(id); const { cards } = await context(id); const l = { order: cards.map((c) => c.id), steps: {} }; lectures.set(id, l); await save(id, l); }
  else return NextResponse.json({ message: "action은 step·ask·stop·reset" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
