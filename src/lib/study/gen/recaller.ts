// recaller 엔진 (11/15 리팩토링: 앱이 쓰는 길 하나만 남김). 자료 한 편 → 기억 카드.
// ① 전처리(코드): 쪽마다 글자 층 · 그림이 필요한 쪽 표시 · 쪽 제목.
// ② 줄기 계획(rc-stem-plan): 모든 쪽 원문 + 쪽 그림 → 영역(= 주제, state.sections)과 기억(이름 · 모양 · 메인/바탕/곁 · 근거 쪽). 빠진 쪽은 한 번 더.
//    옆에서 학습 목표(rc-q-goals) 한 번 — 자료 지도에 보인다.
// ③ 기억 채우기(rc-stem-fill): 영역 안에서 쪽이 이어지는 기억 묶음마다 한 번, 모두 동시에. 기억 하나 = 카드 한 장(tN.mK). 그림 위치 → 코드가 자른다.
// 문제 만들기 · 심화 · 종합 · 쪽 카드(rc-organize) · 정리 글 같은 예전 갈래는 지웠다(화면에서 닿지 않았다). 옛 실행의 데이터 모양(RecallerState)은 읽기용으로 그대로 둔다.
// PDF가 없어도 된다: 쪽 글만 주면(prepFromTexts) 그림 없이 같은 길로 간다(유튜브 자막 같은 글 자료).
import { createHash } from "node:crypto";
import type { z } from "zod";
import type { ModelRequest } from "../../ai/model.ts";
import { imageSize } from "./image-size.ts";
import { addMore, fillGroups, memoryCardQA, missingPages, parsePlan, settlePlan, STEM_FILL_QA, STEM_MORE_LINES, STEM_PLAN_LINES, stemFakeReply, stemFillQASchema, type StemRole } from "./stem.ts";
import { cleanFigure, type Card, type CardIssue, type PageIntent } from "./cards.ts";
import { RunawayReply } from "./json-reply.ts";
import { pageText, type PrepResult, type PrepRoute, type PrepRouter } from "./prep.ts";
import type { GenStep, GenState, Issue, ObjectiveKind } from "./types.ts";
import { digestFakeReply, digestOverlaps, fallbackTopics, OBJECTIVES_MEMORIES, OBJECTIVES_SYSTEM, objectivesUser, oneUser, parseObjectives, SOURCE_EN, sourceLanguage,
  type DigestLine, type DigestState } from "./digest.ts";

export const formats = ["choice", "ox", "short", "cloze", "flashcard"] as const;
/** 옛 실행의 문제(문제 만들기는 지웠다, 데이터 읽기용) */
export type RcQuestion = { objectiveId: string; sectionId: string; tier: "basic" | "deep"; cardIds: string[]; format: (typeof formats)[number]; goal: string;
  authored: { stem: Array<{ text?: string | null; latex?: string | null }>; answer: Record<string, unknown> }; pages: number[]; quotes: string[]; kind: ObjectiveKind; core: boolean;
  steps?: unknown[]; distractors?: Array<{ option: number; step?: number; mistake: string }>; checks: string[]; hint?: string };
type Chunk = { cards?: Card[]; issues?: CardIssue[];
  /** lab.intent: what each page of the chunk is there to do (쪽 의도), decided before its cards. */
  intents?: Array<{ page: number; intent: PageIntent; continues: number | null }>; questions?: RcQuestion[]; held?: Array<{ cardId: string; reason: string }> };
/** A section: its chunks (two pages each) and, gathered from them in page order, its cards and questions. */
type Unit = Chunk & { status: "waiting" | "organizing" | "authoring" | "ready" | "failed"; chunks?: Record<string, Chunk>; error?: string };
export type RecallerState = {
  version: 1; pdfHash?: string;
  prep?: { version: string; pages: Array<{ page: number; title: string; route: PrepRoute; score: number; reasons: string[] }> };
  /** Final page text every step reads: the cleaned text layer, the model's reading for picture pages. */
  texts: Record<string, string>;
  /** The material's language (sourceLanguage), decided once its page texts are known. */
  lang?: "en" | "ko";
  read: { pages: number[]; done: number[]; failed: number[] };
  units: Record<string, Unit>;
  groups?: Array<{ id: string; cardIds: string[]; idea: string }>;
  deep: Record<string, { status: "waiting" | "making" | "ready" | "held"; tries: number; problems: string[]; question?: RcQuestion; parts?: RcQuestion[] }>;
  /** Cards left without a question because an earlier card already holds the same knowledge (card id → that card). */
  dups?: Record<string, string>;
  warnings: Issue[];
  /** 연구 1 3번(나), 실험: the whole-material pass over the cards — a specific name, the earlier card it repeats, a topic. Cards are not changed. */
  /** lab.intentPass: every page's intent and gist from the first short pass, and how long it took. */
  intents?: { ms: number; kind?: string; pages: Array<{ page: number; intent: PageIntent; continues: number | null; gist: string }> };
  /** lab.digest (요약 → 카드, 10/31): the summary written first and what each card took from it. */
  digest?: DigestState;
  consolidated?: { ms: number; error?: string; cards: Array<{ id: string; title: string; sameAs: string | null; topic: string; weight?: "핵심" | "보조"; links?: Array<{ to: string; why: string }> }>;
    /** what each topic is there to say (one line) */ topicNotes?: Record<string, string>;
    /** ideas the material uses again and again across its topics (10/30: "옮기고 → 변환 → 되돌리기") */ principles?: Array<{ title: string; line: string; cardIds: string[] }> };
  timing: { startedAt: string; prepMs?: number; firstPublishedAt?: string; basicDoneAt?: string; completedAt?: string;
    /** 연구 1: when each page's reading and cards were done (the first pass over the material). */
    readAt?: Record<string, string>; organizedAt?: Record<string, string>; skimDoneAt?: string;
    /** every page's cards are in (자료 전체 정리 starts here) */ cardsDoneAt?: string; /** 그림 자르기(11/8): 처음부터 끝까지, 카드가 다 나온 뒤 더 기다린 시간 */ figuresMs?: number; figuresWaitMs?: number };
  guides?: Record<string, string>;
};

export type RecallerAsk = <T>(step: GenStep, sectionId: string | null, attempt: number, system: string, user: string, parser: z.ZodType<T>,
  extra?: { images?: NonNullable<ModelRequest["images"]>; maxChars?: number; cacheKey?: string }) => Promise<T>;
export type RecallerContext = {
  state: GenState; pdf: Uint8Array | null;
  ask: RecallerAsk;
  /** A plain-text reply. */
  askText: (step: GenStep, page: number | null, attempt: number, system: string, user: string, images: NonNullable<ModelRequest["images"]>) => Promise<string>;
  prepare: (pdf: Uint8Array | null, pages: number[], router?: PrepRouter) => Promise<PrepResult>;
  emphasis: (pages: number[]) => Promise<Map<number, string[]>>;
  pageImages: (pages: number[]) => Promise<Map<number, string>>;
  pageFigures: (pages: number[]) => Promise<Map<number, Array<{ label: string; dataUrl: string }>>>;
  save: () => Promise<void>;
  /** 카드에 붙는 그림 파일 저장 */
  saveFigure?: (name: string, jpeg: Buffer) => Promise<void>;
};

const INLINE_READ = "그림·식이 필요한 쪽은 따로 옮겨 쓰지 않고 이미지를 첨부했다(라벨에 쪽 번호). 이미지에서 읽은 지식도 카드로 만들고, 그 근거의 quote는 빈 문자열로 둔다. 원문 글자는 글자 층(source)이 기준이다. 식의 아래첨자는 x_0, V_{pz}처럼 _로 쓰고 유니코드 아래첨자 글자(ₓ, ᵤ)는 쓰지 않는다.";
/** 멈춤(로그인 · 사용량 · 호출 상한)은 실행을 멈추게 두고, 다른 실패는 그 단계만 건너뛴다. */
const pausesRun = (error: unknown) => { const status = (error as { status?: string } | null)?.status; return typeof status === "string" && status.startsWith("paused-") && status !== "paused-invalid"; };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function runRecaller(ctx: RecallerContext) {
  const { state, save } = ctx;
  const input = state.input;
  const lab = input.lab ?? {};
  const data = (state.recaller ??= { version: 1, texts: {}, read: { pages: [], done: [], failed: [] }, units: {}, deep: {}, warnings: [], timing: { startedAt: new Date().toISOString() } });
  data.pdfHash ??= ctx.pdf?.length ? createHash("sha256").update(ctx.pdf).digest("hex") : `pages:${input.sourceId}`;
  // 영어 자료: 학습자에게 쓰는 호출마다 SOURCE_EN을 붙인다.
  const langOf = () => data.lang ?? (Object.keys(data.texts).length ? (data.lang = sourceLanguage(Object.values(data.texts))) : undefined);
  const withLang = (system: string) => langOf() === "en" ? `${system}\n${SOURCE_EN}` : system;
  const ask: RecallerAsk = (step, sectionId, attempt, system, ...rest) => ctx.ask(step, sectionId, attempt, withLang(system), ...rest);
  const askText: RecallerContext["askText"] = (step, page, attempt, system, ...rest) => ctx.askText(step, page, attempt, withLang(system), ...rest);

  // ① 전처리: 코드만, 고른 쪽을 한 번.
  if (!data.prep) {
    const t0 = Date.now();
    const prep = await ctx.prepare(ctx.pdf, input.pageNumbers, lab.router);
    const emphasis = await ctx.emphasis(input.pageNumbers).catch(() => new Map<number, string[]>());
    data.prep = { version: prep.version, pages: prep.pages.map(({ page, title, route, score, reasons }) => ({ page, title, route, score, reasons })) };
    for (const p of prep.pages) data.texts[p.page] = pageText(p) + (emphasis.get(p.page)?.length ? `\n[색 강조] ${emphasis.get(p.page)!.join(" · ")}` : "");
    data.read.pages = prep.pages.filter((p) => p.route === "page" || p.route === "figures").map((p) => p.page);
    state.sections = prep.sections.map((s) => ({ id: s.id, title: s.title, pages: s.pages, design: { objectives: [], warnings: [] } }));
    for (const s of state.sections) data.units[s.id] ??= { status: "waiting" };
    data.timing.prepMs = Date.now() - t0;
    state.phase = "author";
    await save();
  }
  const routeOf = (page: number) => data.prep!.pages.find((p) => p.page === page)?.route ?? "layer";
  // 그림이 필요한 쪽에 붙일 것: 그림 영역(figures) 또는 쪽 전체(page). 글만 있는 자료(PDF 없음)는 빈 배열.
  const imagesOf = async (pages: number[]) => {
    if (!ctx.pdf) return [];
    const figs = await ctx.pageFigures(pages.filter((p) => routeOf(p) === "figures")).catch(() => new Map<number, Array<{ label: string; dataUrl: string }>>());
    const wholes = await ctx.pageImages(pages.filter((p) => routeOf(p) === "page" || (routeOf(p) === "figures" && !figs.get(p)?.length))).catch(() => new Map<number, string>());
    const images: NonNullable<ModelRequest["images"]> = [];
    for (const p of pages) {
      const f = figs.get(p) ?? [];
      if (f.length) images.push(...f.map((x) => ({ label: `p.${p} ${x.label}`, dataUrl: x.dataUrl })));
      else if (wholes.get(p)) images.push({ label: `원문 p.${p}`, dataUrl: wholes.get(p)! });
    }
    return images;
  };

  // ② 줄기 계획
  const t0 = Date.now();
  const d: DigestState = (data.digest ??= { startedAt: new Date(t0).toISOString(), skeleton: { status: "writing", text: "", overview: [], topics: [], problems: [] }, topics: {}, notes: {},
    checks: { outsideInput: [], outsideRange: [], uncovered: [], overlaps: [], uncited: [] }, timing: {} });
  let goals: Promise<void> = Promise.resolve();
  if (d.skeleton.status !== "done") {
    d.skeleton = { status: "writing", text: "", overview: [], topics: [], problems: [] };
    try {
      await stemPlan(d);
      goals = learningGoals(d);
    } catch (error) {
      if (pausesRun(error)) throw error;
      d.skeleton.error = message(error);
      d.skeleton.topics = [];
    }
    if (!d.skeleton.topics.length) {
      d.skeleton.topics = fallbackTopics(state.sections, Number.parseInt(data.pdfHash.slice(0, 6), 16) || 0);
      d.skeleton.problems.push("줄기를 받지 못해 전처리 구역으로 나눴어요.");
    }
    d.skeleton.status = "done";
    d.skeleton.ms = d.timing.skeletonMs = Date.now() - t0;
  }
  const topics = d.skeleton.topics;
  if (!d.sectioned) {
    state.sections = topics.map((t) => ({ id: t.id, title: t.title, pages: t.pages, design: { objectives: [], warnings: [] } }));
    data.units = Object.fromEntries(state.sections.map((s) => [s.id, { status: "waiting" as const }]));
    d.sectioned = true;
  }
  // 영역마다 기억 줄(목차 항목): 기억 하나가 줄 하나, 줄 하나가 카드 한 장.
  for (const t of topics) {
    if (d.topics[t.id]?.status === "done") continue;
    const items = (d.concepts ?? []).filter((c) => c.topic === t.id);
    const lines: DigestLine[] = (items.length ? items : [{ id: `${t.id}-c1`, topic: t.id, name: t.title, pages: t.pages }]).map((c, k) => ({
      id: `${t.id}-b${k + 1}`, topic: t.id, name: c.name, text: `${c.name}을(를) 배운다. (p.${(c.pages.length ? c.pages : t.pages).join(", ")})`,
      pages: c.pages.length ? c.pages : t.pages, concepts: [c.id] }));
    const span = t.pages.length > 1 ? `p.${t.pages[0]}–${t.pages.at(-1)}` : `p.${t.pages[0]}`;
    d.topics[t.id] = { status: "done", text: `${t.title} (${span}): ${lines.map((l) => l.name).join(", ")}`, body: lines, given: t.pages, ms: Date.now() - t0 };
  }
  await save();

  // ③ 기억 채우기: 영역 모두 동시에, 영역 안은 묶음마다 동시에.
  const figureJob = lab.figures && ctx.pdf && ctx.saveFigure ? (await import("./figures.ts")).figureCropper(ctx.pdf, input.pageNumbers, ctx.saveFigure) : null;
  const work = state.sections.map(async (section) => {
    const unit = data.units[section.id];
    if (unit.status === "ready") return;
    unit.status = "organizing"; await save();
    try {
      const chunk = ((unit.chunks ??= {})[0] ??= {});
      if (!chunk.cards) {
        const meta = d.stem?.memories ?? {};
        const mems = (d.topics[section.id]?.body ?? []).map((line) => { const m = meta[line.concepts?.[0] ?? ""]; return { line, pages: line.pages, kind: m?.kind ?? "개념", role: (m?.role ?? "메인") as StemRole }; });
        chunk.cards = (await Promise.all(fillGroups(mems).map((g) => fill(section, g)))).flat();
        chunk.issues = []; chunk.questions = [];
      }
      unit.cards = chunk.cards; unit.questions = []; unit.issues = chunk.issues ?? [];
      const at = new Date().toISOString();
      for (const p of section.pages) (data.timing.organizedAt ??= {})[p] ??= at;
      void figureJob?.add(chunk.cards);
      unit.status = "ready"; await save();
    } catch (error) { unit.status = "failed"; unit.error = message(error); await save(); throw error; }
  });
  const settled = await Promise.allSettled(work);
  const stop = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  if (stop) throw stop.reason;
  data.timing.cardsDoneAt ??= new Date().toISOString();
  const all = state.sections.flatMap((s) => data.units[s.id]?.cards ?? []);
  d.timing.cardsMs ??= Date.now() - t0;
  // 다른 영역의 같은 이름 카드: 뒤 카드에 영역 이름을 붙여 같은 이름이 두 번 보이지 않게.
  d.checks.overlaps = digestOverlaps(all, (id) => id.split(".")[0]);
  for (const o of d.checks.overlaps) {
    const card = all.find((c) => c.id === o.b), topic = state.sections.find((s) => s.id === o.b.split(".")[0]);
    if (card && topic && o.why === "같은 제목" && !card.title.includes(" · ")) card.title = `${card.title} · ${topic.title}`;
  }
  if (figureJob) {
    try { const r = await figureJob.finish(); data.timing.figuresMs = r.ms; data.timing.figuresWaitMs = Date.now() - Date.parse(data.timing.cardsDoneAt); }
    catch (error) { data.warnings.push({ severity: "warning", code: "rc-figures", message: `그림을 붙이지 못했어요: ${message(error)}`.slice(0, 300) }); }
  }
  await goals;
  d.timing.doneMs = Date.now() - t0;
  data.timing.skimDoneAt ??= new Date().toISOString();
  data.timing.completedAt = new Date().toISOString();
  state.status = "done"; state.phase = "done"; state.message = "";
  await save();

  // ── 단계들 ──
  async function stemPlan(d: DigestState) {
    const s0 = Date.now();
    const user = oneUser(input.fileName, input.pageNumbers.map((page) => ({ page, text: data.texts[page] ?? "" })));
    const askPlan = async (attempt: number, system: string, u: string, pages: number[]) => parsePlan(await askText("rc-stem-plan", null, attempt, system, u, await imagesOf(pages)));
    let plan = settlePlan(await askPlan(1, STEM_PLAN_LINES, user, input.pageNumbers), input.pageNumbers);
    // 줄이 하나도 없으면 한 번 더, 그래도 없으면 멈춘다.
    if (!plan.areas.length || !plan.memories.length) plan = settlePlan(await askPlan(3, STEM_PLAN_LINES, user, input.pageNumbers), input.pageNumbers);
    if (!plan.areas.length || !plan.memories.length) throw new Error("줄기 계획에서 영역·기억 줄을 읽지 못했어요.");
    const miss = missingPages(plan, input.pageNumbers);
    if (miss.length) {
      try {
        const more = await askPlan(2, `${STEM_PLAN_LINES}\n\n${STEM_MORE_LINES}`,
          `[이미 있는 기억]\n${plan.memories.map((m) => m.name).join("\n")}\n\n[영역]\n${plan.areas.map((a, i) => `${i + 1} ${a.name}`).join("\n")}\n\n${oneUser(input.fileName, miss.map((page) => ({ page, text: data.texts[page] ?? "" })))}`, miss);
        plan = addMore(plan, more, input.pageNumbers);
      } catch (error) { if (pausesRun(error)) throw error; }
    }
    // 쪽이 빈 기억은 앞 기억의 쪽을 빌린다(근거 쪽이 있어야 채울 수 있다).
    plan.memories.forEach((m, i) => { if (!m.pages.length) m.pages = [...(plan.memories[i - 1]?.pages ?? plan.memories[i + 1]?.pages ?? [input.pageNumbers[0]])].slice(-1); });
    const used = plan.areas.map((_, i) => i + 1).filter((a) => plan.memories.some((m) => m.area === a));
    const topicId = new Map(used.map((a, k) => [a, `t${k + 1}`]));
    d.skeleton.topics = used.map((a) => { const pages = [...new Set(plan.memories.filter((m) => m.area === a).flatMap((m) => m.pages))].sort((x, y) => x - y);
      return { id: topicId.get(a)!, group: plan.areas[a - 1].name, title: plan.areas[a - 1].name, pages, related: [], domain: "", kind: "개념" }; });
    const counts = new Map<string, number>();
    d.concepts = plan.memories.map((m) => { const topic = topicId.get(m.area)!; const k = (counts.get(topic) ?? 0) + 1; counts.set(topic, k); return { id: `${topic}-c${k}`, topic, name: m.name, pages: m.pages }; });
    d.conceptSource = "AI";
    d.skeleton.text = d.skeleton.topics.map((t) => `${t.id} | ${t.title} | ${t.pages.join(",")}`).join("\n");
    d.stem = { questions: Object.fromEntries(used.map((a) => [topicId.get(a)!, plan.areas[a - 1].question])),
      memories: Object.fromEntries(plan.memories.map((m, i) => [d.concepts![i].id, { kind: m.kind, role: m.role }])), missing: missingPages(plan, input.pageNumbers), ms: Date.now() - s0 };
    await save();
  }
  // 학습 목표: 줄기와 쪽 글로 한 번(기억 id가 걸린다). 실패해도 카드에는 영향 없음.
  async function learningGoals(d: DigestState) {
    if (d.objectives || !d.skeleton.topics.length) return;
    const topicsNow = d.skeleton.topics;
    const mems = (d.concepts ?? []).map((c) => ({ id: c.id.replace("-c", ".m"), topic: c.topic, name: c.name }));
    try {
      const reply = await askText("rc-q-goals", null, 1, `${OBJECTIVES_SYSTEM}${mems.length ? `\n${OBJECTIVES_MEMORIES}` : ""}`,
        objectivesUser(input.fileName, topicsNow, input.pageNumbers.map((page) => ({ page, text: data.texts[page] ?? "" })), mems), []);
      d.timing.goalsMs = Date.now() - t0;
      d.objectives = parseObjectives(reply).map((g) => {
        const memories = (g.memories ?? []).filter((id) => mems.some((m) => m.id === id));
        const { memories: _given, ...rest } = g; void _given;
        return { ...rest, topics: g.topics.filter((id) => topicsNow.some((t) => t.id === id)), ...(memories.length ? { memories } : {}) };
      });
    } catch (error) {
      if (pausesRun(error)) throw error;
      data.warnings.push({ severity: "warning", code: "rc-q-goals", message: `학습 목표를 받지 못했어요: ${message(error)}` });
    }
  }
  // 기억 채우기 한 묶음: 그 쪽 원문 + 쪽 그림. 답이 없던 기억은 한 번 더, 그래도 없으면 이름만이라도 카드로.
  async function fill(section: GenState["sections"][number], group: Array<{ line: DigestLine; pages: number[]; kind: string; role: StemRole }>): Promise<Card[]> {
    const pages = [...new Set(group.flatMap((m) => m.pages))].filter((p) => input.pageNumbers.includes(p)).sort((a, b) => a - b);
    const images = await imagesOf(pages);
    const sizes = new Map(images.flatMap((im) => { const m = /^원문 p\.(\d+)$/.exec(im.label); const dim = m ? imageSize(im.dataUrl) : undefined; return m && dim ? [[Number(m[1]), dim] as const] : []; }));
    const flat = (x: string) => x.normalize("NFKC").replace(/\s+/g, "");
    const idOf = (m: { line: DigestLine }, n: number) => `${section.id}.m${m.line.id.split("-b")[1] ?? n}`;
    const out: Card[] = [];
    let left = group;
    for (let attempt = 1; attempt <= 2 && left.length; attempt++) {
      const user = `[자료] ${input.fileName}\n영역: ${section.title}${d.stem?.questions[section.id] ? ` — ${d.stem.questions[section.id]}` : ""}\n\n[기억 계획] (id|역할|모양|이름|쪽)\n${left.map((m) => `${m.line.id}|${m.role}|${m.kind}|${m.line.name}|p.${m.pages.join(",")}`).join("\n")}\n\n${pages.map((p) => `[p.${p}]\n${(data.texts[p] ?? "").trim() || "(글자 없음)"}`).join("\n\n")}`;
      let reply: z.infer<typeof stemFillQASchema>;
      try {
        reply = await ask("rc-stem-fill", section.id, attempt, `${STEM_FILL_QA}${images.length ? `\n${INLINE_READ}` : ""}`, user, stemFillQASchema,
          { maxChars: 3000 * left.length + 4000, ...(images.length ? { images } : {}), cacheKey: `recaller-stemfillqa-${(data.pdfHash ?? state.id).slice(0, 16)}` });
      } catch (error) { if (error instanceof RunawayReply) continue; throw error; }
      const done = new Set<string>();
      for (const f of reply.memories) {
        const m = left.find((x) => x.line.id === f.memory);
        if (!m || done.has(m.line.id)) continue;
        done.add(m.line.id);
        const id = idOf(m, out.length + 1);
        const card = memoryCardQA(id, m.role, f, pages);
        // 글자 층에 없는 인용은 그림에서 읽은 것으로 본다(빈 인용으로).
        card.evidence = card.evidence.map((e) => e.quote && !flat(data.texts[e.page] ?? "").includes(flat(e.quote)) ? { ...e, quote: "" } : e);
        // 그림 여러 장: 첫 장은 figure, 나머지는 moreFigures. 같은 쪽 · 같은 상자는 하나로.
        const figs = lab.figures ? f.figures.map((x) => cleanFigure(x, pages, (n) => sizes.get(n))).filter((x): x is NonNullable<typeof x> => Boolean(x))
          .filter((x, i, list) => list.findIndex((y) => y.page === x.page && y.box.every((v, k) => Math.abs(v - x.box[k]) < 4)) === i).slice(0, 3) : [];
        out.push({ ...card, ...(figs[0] ? { figure: figs[0] } : {}), ...(figs.length > 1 ? { moreFigures: figs.slice(1) } : {}) });
        d.notes[id] = { topic: section.id, covers: [m.line.id] };
      }
      left = left.filter((x) => !done.has(x.line.id));
    }
    for (const m of left) {
      const id = idOf(m, out.length + 1);
      out.push({ id, kind: "개념", title: m.line.name, weight: m.role === "메인" ? "핵심" : "보조", shape: { form: "concept", claim: m.line.name, reason: "", limit: "" },
        evidence: [{ page: m.pages[0] ?? section.pages[0], quote: "" }], mistakes: [], links: [], takes: [], gives: [], memo: { question: "", line: "", facts: [], role: m.role } });
      d.notes[id] = { topic: section.id, covers: [m.line.id] };
      d.checks.uncovered.push(m.line.id);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }
}

/** 가짜 모델(테스트): 줄기 계획 · 기억 채우기 · 학습 목표 */
export function recallerFakeReply(step: GenStep, user: string): string {
  return stemFakeReply(step, user) ?? digestFakeReply(step, user) ?? "";
}
