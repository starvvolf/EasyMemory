// 에이전트 툴 (2026-10-26): the tools an agent AI is given to run the learner's study — memory (3 levels), knowledge,
// materials, questions and grading, code, records, deadlines and schedule, the screen. Judging is always a tool
// (grade, code_judge), never the agent's own call. Served at /api/agent and, for CLI agents, by tools/recaller-agent-mcp.
import { z } from "zod";
import { getKnowledge, linkKnowledge, memoryEvents, memoryOverview, memorySummary, recordEvent, saveKnowledge, searchKnowledge, setKnowledgeState, tree, reviewQueue } from "@/lib/knowledge/store";
import { grade, questionsFor, QUESTION_LABEL, type Question } from "@/lib/knowledge/questions";
import { getSource, listSources } from "@/lib/knowledge/sources";
import { LANGS, runOnce } from "@/lib/code/run";
import { listProblems, publicProblem, readProblem } from "@/lib/code/problems";
import { submitAndRecord } from "@/lib/code/service";
import { makeProblem } from "@/lib/assist/code-ai";
import { addDeadline, addTodo, getTimer, listDeadlines, listTodos, makeSchedule, week } from "@/lib/schedule/store";
import { getView, screenBlocks, showBlock } from "./screen";
import { listMcpSourceCatalog, readMcpSourcePdf } from "@/lib/mcp-source-catalog";
import { extractPdfPageTexts } from "../../../tools/study-forge-mcp/source-evidence.ts";

export type Tool = { name: string; title: string; group: string; description: string; input: z.ZodObject<z.ZodRawShape>; run: (input: never) => Promise<unknown> };
const tool = <S extends z.ZodRawShape>(name: string, group: string, title: string, description: string, shape: S, run: (input: z.infer<z.ZodObject<S>>) => Promise<unknown>): Tool =>
  ({ name, group, title, description, input: z.object(shape), run: run as (input: never) => Promise<unknown> });
const state = z.enum(["met", "unknown", "known"]);
const eventKind = z.enum(["met", "asked", "wrong", "hint", "correct", "note"]);
const lang = z.enum(LANGS);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function allKnowledge() {
  const { items } = await tree();
  return Promise.all(items.map(async (i) => (await getKnowledge(i.id)).item));
}

export const TOOLS: Tool[] = [
  // 메모리
  tool("memory_overview", "메모리", "메모리 1단계: 전체 흐름", "학습자가 무엇을 얼마나 공부했는지 큰 그림(폴더별 개수와 상태, 최근, 약한 것). 매 대화 처음에 이것만 본다.", {}, () => memoryOverview()),
  tool("memory_summary", "메모리", "메모리 2단계: 주제 요약", "한 주제(폴더 이름·ID 또는 검색어)의 지식마다 상태, 틀림·힌트·물어봄 횟수, 고리.", { topic: z.string().min(1).max(100) }, ({ topic }) => memorySummary(topic)),
  tool("memory_events", "메모리", "메모리 3단계: 직접 겪은 것", "물어본 것, 틀린 것, 힌트 받은 것, 맞힌 것 기록 (최신순). 지식 하나나 폴더 하나로 좁힐 수 있다.",
    { knowledgeId: z.string().max(40).optional(), folderId: z.string().max(40).optional(), kinds: z.array(eventKind).max(6).optional(), limit: z.number().int().min(1).max(100).optional() },
    (input) => memoryEvents(input)),
  // 지식
  tool("knowledge_search", "지식", "지식 찾기", "이미 가진 지식에서 찾기. 글자로 먼저, 없으면 비슷한 이름으로. 후보 몇 개만 돌려준다.", { query: z.string().min(1).max(200), limit: z.number().int().min(1).max(30).optional() },
    ({ query, limit }) => searchKnowledge(query, { limit })),
  tool("knowledge_get", "지식", "지식 하나 보기", "지식 하나의 설명, 이어진 지식, 기록.", { id: z.string().max(40) }, ({ id }) => getKnowledge(id)),
  tool("knowledge_save", "지식", "지식 저장", "지식 저장. 같은 지식이 이미 있으면 새로 만들지 않고 기존 것에 합친다 (merged: true). state: met 만남 / unknown 몰랐음 / known 앎.",
    { title: z.string().min(1).max(120), body: z.string().max(4000).optional(), state: state.optional(), folder: z.string().max(200).optional(),
      links: z.array(z.object({ title: z.string().max(120), relation: z.string().max(60) })).max(10).optional(), sourceTitle: z.string().max(200).optional() },
    ({ sourceTitle, ...input }) => saveKnowledge({ ...input, ...(sourceTitle ? { source: { kind: "chat" as const, title: sourceTitle } } : {}) })),
  tool("knowledge_link", "지식", "지식 잇기", "두 지식 사이에 고리를 잇는다 (from → to, relation은 '그러면' 같은 짧은 말).", { from: z.string().max(40), to: z.string().max(40), relation: z.string().max(60) },
    ({ from, to, relation }) => linkKnowledge(from, to, relation)),
  tool("knowledge_set_state", "지식", "지식 상태 바꾸기", "상태(만남/몰랐음/앎)나 졸업(복습에서 빼기, 기록은 남음)을 바꾼다.", { id: z.string().max(40), state: state.optional(), graduated: z.boolean().optional() },
    ({ id, ...patch }) => setKnowledgeState(id, patch)),
  tool("review_queue", "지식", "복습할 것", "지금 복습 차례인 지식(상자 단계 날짜가 된 것): 몰랐음 먼저, 그다음 졸업 전의 앎(날짜가 이른 순).", { folderId: z.string().max(40).optional(), limit: z.number().int().min(1).max(50).optional() },
    (input) => reviewQueue({ ...input, dueOnly: true })),
  // 자료
  tool("material_list", "자료", "자료 목록", "읽은 웹 글·강의 글, 등록된 PDF, 코드 문제 목록.", {}, async () => ({
    articles: (await listSources()).map((s) => ({ id: s.id, kind: s.kind, title: s.title, url: s.url, readAt: s.readAt, goals: s.goals })),
    pdfs: (await listMcpSourceCatalog().catch(() => [])).map((s) => ({ id: s.id, fileName: s.fileName, pageCount: s.pageCount })),
    problems: (await listProblems()).map((p) => ({ id: p.id, title: p.title, status: p.status, knowledge: p.knowledge })),
  })),
  tool("material_read", "자료", "자료 읽기", "웹·강의 글은 본문 일부(from부터 length자), PDF는 쪽 번호들의 글자.",
    { id: z.string().max(80), from: z.number().int().min(0).optional(), length: z.number().int().min(100).max(20000).optional(), pages: z.array(z.number().int().min(1)).max(10).optional() },
    async ({ id, from = 0, length = 6000, pages }) => {
      if (id.startsWith("src_") && id.length === 20) {
        const s = await getSource(id);
        if (!s) throw new Error("읽은 글을 찾을 수 없어요.");
        return { title: s.title, url: s.url, claim: s.claim, chains: s.chains, text: s.text.slice(from, from + length), total: s.text.length };
      }
      const bytes = await readMcpSourcePdf(id);
      if (!bytes) throw new Error("자료를 찾을 수 없어요.");
      const texts = await extractPdfPageTexts(bytes, pages?.length ? pages : [1]);
      return { pages: [...texts.entries()].map(([page, text]) => ({ page, text: text.slice(0, 8000) })) };
    }),
  tool("current_view", "자료", "지금 보는 것", "학습자가 지금 보고 있는 화면, 드래그한 부분, 열린 문제·지식.", {}, () => getView()),
  // 문제와 채점
  tool("question_make", "문제", "문제 만들기", `지식에서 문제를 만든다 (모델 호출 없음). 종류: ${Object.values(QUESTION_LABEL).join(", ")}. show: true면 화면에 바로 띄운다.`,
    { knowledgeId: z.string().max(40), kind: z.enum(["flashcard", "choice", "ox", "blank"]).optional(), show: z.boolean().optional() },
    async ({ knowledgeId, kind, show }) => {
      const pool = await allKnowledge();
      const item = pool.find((k) => k.id === knowledgeId);
      if (!item) throw new Error("지식을 찾을 수 없어요.");
      const qs = questionsFor(item, pool, String(Date.now()));
      const q = (kind && qs.find((x) => x.kind === kind)) || qs[qs.length - 1];
      if (show) await showBlock({ kind: "question", title: `${q.label}: ${item.title}`, question: q });
      return q;
    }),
  tool("grade", "문제", "채점", "문제와 답을 받아 채점한다 (정답 대조). record: true면 결과를 그 지식 기록에 남긴다 (맞힘/틀림).",
    { question: z.object({ id: z.string(), kind: z.enum(["flashcard", "choice", "ox", "blank", "short", "recognize"]), knowledgeId: z.string(), answer: z.string(), accept: z.array(z.string()).optional() }).passthrough(),
      answer: z.string().max(2000), record: z.boolean().optional() },
    async ({ question, answer, record }) => {
      const g = grade(question as unknown as Question, answer);
      if (record) await recordEvent(question.knowledgeId, g.correct ? "correct" : "wrong", `${QUESTION_LABEL[question.kind]}${g.correct ? "" : `: "${answer.slice(0, 60)}"`}`);
      return g;
    }),
  // 코드
  tool("code_run", "코드", "코드 실행", "코드를 입력과 함께 실행해 출력을 돌려준다 (채점 없음).", { lang, code: z.string().max(100000), input: z.string().max(200000).optional() },
    ({ lang: l, code, input }) => runOnce(l, code, input ?? "")),
  tool("code_judge", "코드", "코드 채점", "문제의 예제(example) 또는 전체 테스트(submit)로 채점. submit은 결과가 지식 기록에 남는다.",
    { problemId: z.string().max(60), lang, code: z.string().max(100000), mode: z.enum(["example", "submit"]), hints: z.number().int().min(0).max(10).optional() },
    async ({ problemId, lang: l, code, mode, hints }) => { const r = await submitAndRecord(problemId, l, code, mode, hints ?? 0); return { verdict: r.verdict, passed: r.passed, total: r.total, shown: r.shown, compile: r.compile }; }),
  tool("code_problem", "코드", "코드 문제 보기", "문제 설명과 예제 (숨은 테스트와 모범 풀이는 빼고).", { problemId: z.string().max(60) }, async ({ problemId }) => publicProblem(await readProblem(problemId))),
  tool("code_problem_make", "코드", "코드 문제 만들기", "주제나 강의 글로 새 문제를 만든다. 테스트는 모범 풀이로 확인된 것만 남는다. kind blank는 빈칸 코드 문제.",
    { topic: z.string().max(300).optional(), lesson: z.string().max(30000).optional(), kind: z.enum(["full", "blank"]), lang: lang.optional() },
    async (input) => publicProblem(await makeProblem(input))),
  // 기록
  tool("result_record", "기록", "결과 남기기", "지식 하나에 일어난 일을 남긴다: correct 맞힘(→앎), wrong 틀림·hint 힌트·asked 물어봄(→몰랐음), note 메모.",
    { knowledgeId: z.string().max(40), kind: eventKind, detail: z.string().max(600).optional() }, ({ knowledgeId, kind, detail }) => recordEvent(knowledgeId, kind, detail ?? "")),
  // 일정
  tool("deadline_ask", "일정", "기한 묻기", "학습자에게 '시험이나 기한이 있나요?'를 화면에 묻는다. 답은 screen_answers로 읽는다.", { about: z.string().max(100) },
    ({ about }) => showBlock({ kind: "ask", title: `${about}: 시험이나 기한이 있나요?`, body: "있으면 날짜를 적어 주세요 (예: 2026-11-03).", choices: ["기한 없음"], ref: "deadline" })),
  tool("deadline_add", "일정", "기한 추가", "기한(시험일 등)을 추가한다. folderId가 있으면 그 폴더 지식을 기준으로 나눈다.",
    { title: z.string().min(1).max(80), date: day, folderId: z.string().max(40).optional(), amount: z.number().int().min(0).max(1000).optional(), unit: z.string().max(10).optional() },
    (input) => addDeadline(input)),
  tool("schedule_make", "일정", "날짜별로 나누기", "기한까지 남은 날에 공부를 나눠 할 일로 만든다. 마지막 날은 전체 훑기와 약한 것 몰아 보기.", { deadlineId: z.string().max(40) }, ({ deadlineId }) => makeSchedule(deadlineId)),
  tool("todo_add", "일정", "할 일 추가", "할 일을 추가한다 (날짜는 선택).", { text: z.string().min(1).max(200), date: day.optional() }, ({ text, date }) => addTodo({ text, date: date ?? null, origin: "agent" })),
  tool("todo_list", "일정", "할 일·기한 보기", "할 일 목록과 기한 목록.", {}, async () => ({ todos: await listTodos(), deadlines: await listDeadlines() })),
  tool("week", "일정", "이번 주 시간표", "이번 주 날짜별 공부 시간, 할 일, 기한.", { start: day.optional() }, ({ start }) => week(start)),
  tool("timer_get", "일정", "타이머 상태", "타이머가 돌고 있는지, 몇 분째인지.", {}, () => getTimer()),
  // 화면
  tool("block_show", "화면", "블록 띄우기", "학습자 화면에 블록을 띄운다: message(알림), knowledge(지식 하나, ref=지식 ID), problem(코드 문제, ref=문제 ID), ask(선택지 있는 질문).",
    { kind: z.enum(["message", "knowledge", "problem", "ask"]), title: z.string().min(1).max(200), body: z.string().max(6000).optional(), ref: z.string().max(120).optional(), choices: z.array(z.string().max(80)).max(8).optional() },
    (input) => showBlock(input)),
  tool("screen_answers", "화면", "화면 답 읽기", "띄운 블록(질문, 기한 묻기)에 학습자가 한 답.", { after: z.string().max(40).optional() },
    async ({ after }) => (await screenBlocks(after)).filter((b) => b.answered).map((b) => ({ id: b.id, title: b.title, answer: b.answer, answeredAt: b.answeredAt, ref: b.ref }))),
];

export function toolList() {
  return TOOLS.map((t) => ({ name: t.name, title: t.title, group: t.group, description: t.description, inputSchema: z.toJSONSchema(t.input) }));
}
export async function callTool(name: string, input: unknown) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`없는 툴이에요: ${name}`);
  return t.run(t.input.parse(input ?? {}) as never);
}
