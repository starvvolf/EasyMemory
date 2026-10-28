import { NextResponse } from "next/server";
import { z } from "zod";
import { boundedJson, fail, guard, type RouteContext } from "@/lib/assist/http";
import { createFolder, deleteFolder, deleteKnowledge, getKnowledge, importPoints, itemsByRef, recordByRef, linkKnowledge, memoryEvents, memoryOverview, memorySummary, mergeKnowledge,
  onKnowledgeCreated, recordEvent, reviewQueue, reviewStatus, saveKnowledge, searchKnowledge, setKnowledgeState, tree, unlinkKnowledge, updateFolder, updateKnowledge } from "@/lib/knowledge/store";
import { grade, questionsFor, recognizeQuestion, QUESTION_LABEL, type Question } from "@/lib/knowledge/questions";
import { getSource, listSources, markGoal, GOAL_TEXT, type GoalId, type ReadSource } from "@/lib/knowledge/sources";
import { similarKnowledge } from "@/lib/knowledge/embed";
import { runDedupeEval } from "@/lib/knowledge/dedupe-eval";
import { openDuplicates, resolveDuplicate, runDuplicateCheck } from "@/lib/knowledge/dedupe";
import { scheduleAfterSave } from "@/lib/knowledge/after-save";
import { runClassify } from "@/lib/knowledge/classify";
import { acceptSuggestion, createGoal, deleteGoal, goalItemIds, goalOverview, goalsOfItems, ignoreMaterial, listMaterials, setGoalItem, setGoalSource, syncSubjects,
  updateGoal } from "@/lib/knowledge/goals";
import { askKnowledge, checkClaim, explainSelection, extractFromText, fillMissing } from "@/lib/assist/knowledge-ai";

export const runtime = "nodejs";
// 같은 지식 찾기 3단계: every save that makes new items (PDF, 웹 글, 코드, 직접) is checked a few seconds later.
// After every save that makes new items (PDF, 웹 글, 코드, 직접): 주제 정리, then 같은 지식 찾기, a few seconds later.
onKnowledgeCreated(() => scheduleAfterSave());
const state = z.enum(["met", "unknown", "known"]);
const id = z.string().regex(/^(k|fld)_[a-f0-9]{12}$/);
const goalId = z.string().regex(/^goal_[a-f0-9]{12}$/);
const kind = z.enum(["concept", "procedure", "fact", "formula", "vocab"]);
const goalSource = z.object({ key: z.string().min(1).max(300), kind: z.enum(["pdf", "web", "code", "chat", "manual"]), title: z.string().max(200) });
const sourceRef = z.object({ kind: z.enum(["pdf", "web", "code", "chat", "manual"]), title: z.string().max(200), ref: z.string().max(200).optional(), url: z.string().max(2000).optional(),
  page: z.number().int().optional(), quote: z.string().max(400).optional() });

async function allItems() {
  const { items } = await tree();
  return Promise.all(items.map(async (i) => (await getKnowledge(i.id)).item));
}
/** Goals of a read article, checked against the knowledge they cover. */
async function withGoals(source: ReadSource) {
  const items = await allItems();
  const mine = items.filter((i) => source.knowledgeIds.includes(i.id));
  const chainTitles = new Set(source.chains.flatMap((c) => [c.from, c.to]));
  const chainItems = mine.filter((i) => chainTitles.has(i.title));
  const known = (list: typeof mine) => list.length > 0 && list.every((i) => i.state === "known");
  const termItems = mine.filter((i) => !chainTitles.has(i.title));
  const goals = {
    terms: { ...source.goals.terms, done: source.goals.terms.done || known(termItems.length ? termItems : mine) },
    claim: source.goals.claim,
    chains: { ...source.goals.chains, done: source.goals.chains.done || (chainItems.length > 0 && known(chainItems)) },
    recognize: source.goals.recognize,
  };
  return { ...source, text: undefined, textLength: source.text.length, goals, goalText: GOAL_TEXT,
    items: mine.map((i) => ({ id: i.id, title: i.title, state: i.state, graduated: i.graduated, again: source.againIds.includes(i.id), quote: source.quotes[i.id] ?? "" })) };
}

async function handle(request: Request, context: RouteContext) {
  try {
    await guard(request);
    const p = (await context.params).path ?? [];
    const m = request.method;
    const url = new URL(request.url);
    const body = async <T extends z.ZodType>(schema: T): Promise<z.infer<T>> => schema.parse(await boundedJson(request));
    const json = (value: unknown) => NextResponse.json(value);

    if (!p.length && m === "GET") return json(await tree());

    // 목표 (2026-10-28 "4개 축"): 수업·시험, 코테 준비 … — 자료를 넣으면 그 자료의 지식이 따라온다.
    if (p[0] === "goals" && p.length === 1 && m === "GET") return json({ goals: await goalOverview(), itemGoals: await goalsOfItems() });
    if (p[0] === "goals" && p.length === 1 && m === "POST") {
      const b = await body(z.object({ name: z.string().min(1).max(60), date: z.string().max(10).nullable().optional(), note: z.string().max(400).optional(), sources: z.array(goalSource).max(50).optional() }));
      return json({ goal: await createGoal(b) });
    }
    if (p[0] === "goals" && p[1] === "sync" && m === "POST") {
      const b = await body(z.object({ subjects: z.array(z.object({ name: z.string().max(60), exam: z.string().max(10).optional() })).max(50),
        materials: z.array(z.object({ subject: z.string().max(60), title: z.string().max(200) })).max(500) }));
      return json({ goals: await syncSubjects(b.subjects, b.materials) });
    }
    if (p[0] === "goals" && p[1] && p.length === 2) {
      const gid = goalId.parse(p[1]);
      if (m === "PATCH") return json({ goal: await updateGoal(gid, await body(z.object({ name: z.string().max(60).optional(), date: z.string().max(10).nullable().optional(), closed: z.boolean().optional(), note: z.string().max(400).optional() }))) });
      if (m === "DELETE") return json(await deleteGoal(gid));
    }
    if (p[0] === "goals" && p[1] && p[2] === "source" && m === "POST") { const b = await body(goalSource.extend({ on: z.boolean() })); return json({ goal: await setGoalSource(goalId.parse(p[1]), b, b.on) }); }
    if (p[0] === "goals" && p[1] && p[2] === "item" && m === "POST") { const b = await body(z.object({ itemId: id, on: z.boolean() })); return json({ goal: await setGoalItem(goalId.parse(p[1]), b.itemId, b.on) }); }
    if (p[0] === "goals" && p[1] && p[2] === "items" && m === "GET") return json({ ids: await goalItemIds(goalId.parse(p[1])) });
    if (p[0] === "materials" && p.length === 1 && m === "GET") return json({ materials: await listMaterials() });
    if (p[0] === "materials" && p[1] === "accept" && m === "POST") { const b = await body(goalSource); return json({ goal: await acceptSuggestion(b.key, b.title, b.kind) }); }
    if (p[0] === "materials" && p[1] === "ignore" && m === "POST") { const b = await body(z.object({ key: z.string().min(1).max(300) })); return json(await ignoreMaterial(b.key)); }
    // 주제 정리 now (it also runs by itself after saves).
    if (p[0] === "classify" && m === "POST") {
      try { return json(await runClassify()); }
      catch (error) { return NextResponse.json({ message: `주제 정리를 하지 못했어요: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}` }, { status: 503 }); }
    }
    if (p[0] === "search" && m === "GET") return json({ hits: await searchKnowledge(url.searchParams.get("q") ?? "", { limit: Number(url.searchParams.get("limit") ?? 10), folderId: url.searchParams.get("folderId") ?? undefined }) });
    if (p[0] === "memory" && m === "GET") {
      const level = url.searchParams.get("level") ?? "1";
      if (level === "1") return json(await memoryOverview());
      if (level === "2") return json(await memorySummary(url.searchParams.get("topic") ?? ""));
      return json(await memoryEvents({ knowledgeId: url.searchParams.get("knowledgeId") ?? undefined, folderId: url.searchParams.get("folderId") ?? undefined, limit: Number(url.searchParams.get("limit") ?? 30) }));
    }
    if (p[0] === "review" && m === "GET") {
      const folderId = url.searchParams.get("folderId") ?? undefined;
      const ids = url.searchParams.get("goalId") ? await goalItemIds(goalId.parse(url.searchParams.get("goalId"))) : undefined;
      return json({ items: await reviewQueue({ folderId, ids, limit: Number(url.searchParams.get("limit") ?? 20), dueOnly: url.searchParams.get("all") !== "1" }), ...(await reviewStatus({ folderId, ids })) });
    }

    // items
    if (p[0] === "item" && p.length === 1 && m === "POST") {
      const input = await body(z.object({ title: z.string().min(1).max(120), body: z.string().max(4000).optional(), state: state.optional(), folderId: id.nullable().optional(), folder: z.string().max(200).optional(),
        aliases: z.array(z.string().max(120)).max(20).optional(), source: sourceRef.optional(), links: z.array(z.object({ to: z.string().optional(), title: z.string().max(120).optional(), relation: z.string().max(60) })).max(20).optional() }));
      return json(await saveKnowledge(input));
    }
    if (p[0] === "item" && p[1]) {
      const itemId = id.parse(p[1]);
      if (p.length === 2 && m === "GET") return json(await getKnowledge(itemId));
      if (p.length === 2 && m === "PATCH") return json({ item: await updateKnowledge(itemId, await body(z.object({ title: z.string().max(120).optional(), body: z.string().max(4000).optional(),
        aliases: z.array(z.string().max(120)).max(20).optional(), folderId: id.nullable().optional(), kind: kind.optional() }))) });
      if (p.length === 2 && m === "DELETE") return json(await deleteKnowledge(itemId));
      if (p[2] === "state" && m === "POST") return json({ item: await setKnowledgeState(itemId, await body(z.object({ state: state.optional(), graduated: z.boolean().optional() }))) });
      if (p[2] === "event" && m === "POST") {
        const e = await body(z.object({ kind: z.enum(["met", "asked", "wrong", "hint", "correct", "note"]), detail: z.string().max(600).optional(), source: z.object({ kind: sourceRef.shape.kind, title: z.string().max(200), ref: z.string().max(200).optional() }).optional() }));
        return json({ item: await recordEvent(itemId, e.kind, e.detail ?? "", e.source) });
      }
      if (p[2] === "similar" && m === "GET") {
        try { return json(await similarKnowledge({ id: itemId }, { limit: Math.min(Number(url.searchParams.get("limit") ?? 8) || 8, 20) })); }
        catch (error) { return NextResponse.json({ message: `비슷한 지식을 찾는 모델을 불러오지 못했어요: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}` }, { status: 503 }); }
      }
      if (p[2] === "questions" && m === "GET") {
        const pool = await allItems();
        const item = pool.find((x) => x.id === itemId);
        if (!item) return NextResponse.json({ message: "지식을 찾을 수 없어요." }, { status: 404 });
        return json({ questions: questionsFor(item, pool, url.searchParams.get("seed") ?? String(Date.now())) });
      }
    }
    if (p[0] === "merge" && m === "POST") { const b = await body(z.object({ keep: id, drop: id })); return json({ item: await mergeKnowledge(b.keep, b.drop) }); }
    if (p[0] === "link" && m === "POST") { const b = await body(z.object({ from: id, to: id, relation: z.string().max(60) })); return json({ item: await linkKnowledge(b.from, b.to, b.relation) }); }
    if (p[0] === "link" && m === "DELETE") { const b = await body(z.object({ from: id, to: id })); return json({ item: await unlinkKnowledge(b.from, b.to) }); }

    // folders
    if (p[0] === "folder" && p.length === 1 && m === "POST") { const b = await body(z.object({ name: z.string().min(1).max(60), parentId: id.nullable().optional() })); return json({ folder: await createFolder(b.name, b.parentId ?? null) }); }
    if (p[0] === "folder" && p[1] && m === "PATCH") return json({ folder: await updateFolder(id.parse(p[1]), await body(z.object({ name: z.string().max(60).optional(), parentId: id.nullable().optional(), order: z.number().int().min(0).optional(), note: z.string().max(2000).optional() }))) });
    if (p[0] === "folder" && p[1] && m === "DELETE") return json(await deleteFolder(id.parse(p[1])));

    // review session: questions over what is due now (box dates), mixed kinds. Nothing due → no questions, and when
    // the next one comes due; never random items to fill the session.
    if (p[0] === "quiz" && m === "GET") {
      const pool = await allItems();
      const folderId = url.searchParams.get("folderId") ?? undefined;
      const ids = url.searchParams.get("goalId") ? await goalItemIds(goalId.parse(url.searchParams.get("goalId"))) : undefined;
      const count = Math.min(30, Number(url.searchParams.get("count") ?? 10));
      const picked = await reviewQueue({ folderId, ids, limit: count, dueOnly: true });
      const status = await reviewStatus({ folderId, ids });
      const seed = String(Date.now());
      const questions = picked.flatMap((lite, n) => {
        const item = pool.find((x) => x.id === lite.id);
        if (!item) return [];
        const qs = questionsFor(item, pool, seed);
        return [qs[(n + qs.length - 1) % qs.length]];
      });
      return json({ questions, due: status.due, next: status.next });
    }
    if (p[0] === "grade" && m === "POST") {
      const b = await body(z.object({ question: z.object({ id: z.string(), kind: z.enum(["flashcard", "choice", "ox", "blank", "short", "recognize"]), knowledgeId: z.string(), answer: z.string(), accept: z.array(z.string()).optional() }).passthrough(),
        answer: z.string().max(2000), sourceId: z.string().max(40).optional() }));
      const q = b.question as unknown as Question;
      const g = grade(q, b.answer);
      // A flashcard's "answer" is the learner's own call (knew / didnt), not words worth keeping in the record.
      await recordEvent(q.knowledgeId, g.correct ? "correct" : "wrong", `${QUESTION_LABEL[q.kind]}${g.correct || q.kind === "flashcard" ? "" : `: "${b.answer.slice(0, 60)}"`}`).catch(() => undefined);
      if (q.kind === "recognize" && g.correct && b.sourceId) await markGoal(b.sourceId, "recognize", true, "예전 지식을 알아봄").catch(() => undefined);
      return json(g);
    }
    if (p[0] === "related" && m === "GET") return json({ items: await itemsByRef(url.searchParams.getAll("ref").slice(0, 200), url.searchParams.get("prefix") === "1") });
    if (p[0] === "ref-event" && m === "POST") {
      const b = await body(z.object({ refs: z.array(z.string().max(200)).min(1).max(20), kind: z.enum(["met", "asked", "wrong", "hint", "correct", "note"]), detail: z.string().max(600).optional(), material: z.string().max(200).optional(),
        takeBack: z.enum(["correct", "read"]).optional() }));
      return json(await recordByRef(b.refs, b.kind, b.detail ?? "", b.material ? { kind: "pdf", title: b.material } : undefined, b.takeBack));
    }
    if (p[0] === "import" && m === "POST") {
      const b = await body(z.object({ points: z.array(z.object({ ref: z.string().max(200), title: z.string().min(1).max(120), essentials: z.array(z.string().max(600)).max(8), folder: z.string().max(200), material: z.string().max(200), page: z.number().int().optional() })).max(2000) }));
      return json(await importPoints(b.points));
    }

    // read articles
    if (p[0] === "sources" && m === "GET") return json({ sources: await listSources() });
    if (p[0] === "source" && p[1] && p.length === 2 && m === "GET") { const s = await getSource(p[1]); if (!s) return NextResponse.json({ message: "읽은 글을 찾을 수 없어요." }, { status: 404 }); return json({ source: await withGoals(s) }); }
    if (p[0] === "source" && p[1] && p[2] === "goal" && m === "POST") { const b = await body(z.object({ goal: z.enum(["terms", "claim", "chains", "recognize"]), done: z.boolean() })); return json({ source: await markGoal(p[1], b.goal as GoalId, b.done) }); }
    if (p[0] === "source" && p[1] && p[2] === "recognize" && m === "GET") {
      const s = await getSource(p[1]);
      if (!s) return NextResponse.json({ message: "읽은 글을 찾을 수 없어요." }, { status: 404 });
      const pool = await allItems();
      return json({ questions: s.againIds.flatMap((kid) => { const item = pool.find((x) => x.id === kid); return item ? [recognizeQuestion(item, s.quotes[kid] || item.title, pool, s.id)] : []; }) });
    }

    // model calls
    // 중복 의심: open pairs (and a check of anything not checked yet); the learner's answer on one.
    if (p[0] === "dupes" && p.length === 1 && m === "GET") { scheduleAfterSave(); return json({ pairs: await openDuplicates() }); }
    if (p[0] === "dupes" && p[1] === "check" && m === "POST") {
      try { return json(await runDuplicateCheck()); }
      catch (error) { return NextResponse.json({ message: `중복 확인을 하지 못했어요: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}` }, { status: 503 }); }
    }
    if (p[0] === "dupes" && p[1] && m === "POST") {
      const b = await body(z.object({ action: z.enum(["merge", "dismiss"]), keep: id.optional() }));
      return json({ pair: await resolveDuplicate(p[1], b.action, b.keep) });
    }
    // 같은 지식 찾기 시험: 가상 시험지로 3단계를 모델마다 (학습자 지식은 건드리지 않음). 실험용.
    if (p[0] === "dedupe-eval" && m === "POST") {
      const b = await body(z.object({ models: z.array(z.object({ model: z.string().max(60), effort: z.enum(["low", "medium", "high"]).optional() })).min(1).max(6) }));
      return json(await runDedupeEval(b.models));
    }
    // 빈 뜻·다른 이름 채우기 (모델 호출 1번, 최대 40개).
    if (p[0] === "fill" && m === "POST") { const b = await body(z.object({ ids: z.array(id).max(200).optional() })); return json(await fillMissing({ ids: b.ids })); }
    if (p[0] === "extract" && m === "POST") {
      const b = await body(z.object({ kind: z.enum(["web", "lesson"]), title: z.string().min(1).max(300), url: z.string().max(2000).optional(), text: z.string().min(1).max(200000), folder: z.string().max(200).optional() }));
      const r = await extractFromText(b);
      return json({ source: await withGoals(r.source), items: r.items.map((i) => ({ id: i.id, title: i.title, body: i.body, state: i.state, again: i.again, created: i.created, kind: i.kind, quote: i.quote })) });
    }
    if (p[0] === "explain" && m === "POST") {
      const b = await body(z.object({ title: z.string().max(300), url: z.string().max(2000).optional(), text: z.string().max(200000), selection: z.string().min(1).max(4000), question: z.string().max(2000).optional(), folder: z.string().max(200).optional() }));
      return json(await explainSelection(b));
    }
    if (p[0] === "claim" && m === "POST") {
      const b = await body(z.object({ sourceId: z.string().max(40), answer: z.string().min(1).max(1000) }));
      const r = await checkClaim(b.sourceId, b.answer);
      if (r.verdict === "맞음") await markGoal(b.sourceId, "claim", true, b.answer).catch(() => undefined);
      return json(r);
    }
    if (p[0] === "ask" && m === "POST") {
      const b = await body(z.object({ question: z.string().min(1).max(2000), focusIds: z.array(z.string().max(40)).max(6).optional(), context: z.string().max(6000).optional() }));
      return json(await askKnowledge(b.question, b.focusIds, b.context));
    }
    return NextResponse.json({ message: "경로를 찾을 수 없어요." }, { status: 404 });
  } catch (error) { return fail(error); }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
