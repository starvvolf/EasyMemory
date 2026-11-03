// 코스 생성 (2026-11-03, 사용자 설계안 v0.1 2·3장 · docs/코딩학습에이전트_구현대응.md 3절 6번)
// 학습자 목표 → 큰 목차(AI 1번) → 1단계만 바로 만들고(AI) → 관문을 지나야 씀 → 다음 단계는 학습자가 앞 단계를 하는 동안 뒤에서.
// - 지금 범위: Node.js 내장 http로 만드는 작은 웹 API(설치 없음). 서버 · 라우터 · HTTP 도우미 뼈대는 코드가 넣고, AI는 app.ts와 routes/만 쓴다.
// - 관문(코드): ① 시작 코드는 이번 단계 검사에 실패하고 앞 단계 검사는 통과 ② 완성 코드는 모두 통과 ③ 일부러 틀린 완성(뮤턴트)은 검사가 떨어뜨림
//   ④ 대본이 가리키는 줄(앵커)이 시작 코드에 실제로 있음 ⑤ 돌려 보기 예시가 실제로 돈다. 못 넘으면 오류를 붙여 다시(최대 2번), 그래도 안 되면 솔직히 알린다.
// - 생성 코스의 "만들어 주세요"는 OpenCode 작업 지시(lesson.ts workOrder), 정답 파일은 관문에만 쓴다.
import { promptOf } from "./prompts.ts";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { COURSES, GEN_COURSES, loadCourse, type Check, type Course, type Stage, type Step } from "./course.ts";
import { runChecks } from "./checker.ts";
import { writeWorkspace } from "./stagegen.ts";
import { aiJson, AiUnavailable } from "./ai.ts";
import { runSnippet } from "./tutor-tools.ts";
import { update, read } from "./store.ts";

/* ---------- AI가 돌려주는 모양 ---------- */
export type GenPlan = { title: string; summary: string; scopeNote: string; stages: { title: string; goal: string }[] };
type FileOut = { path: string; content: string };
export type GenStage = {
  title: string; goal: string; intro: string;
  concepts: { id: string; name: string; essentials: string }[];
  startFiles: FileOut[]; solvedFiles: FileOut[];
  fix: { text: string; file: string; anchor: string };
  checks: { title: string; concepts: string[]; steps: { req: string; body: string; status: number; json: string; listHas: string }[] }[];
  mutants: FileOut[];
  needs: { q: string; answer: string; concept: string; snippet: string; file: string; anchor: string }[];
  predict: { q: string; options: string[]; answer: number; why: string };
  tries: { method: string; path: string; body: string }[];
  pair: string[];
  explainQ: string;
};

const str = { type: "string" };
const files = { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: str, content: str } } };
const PLAN_SCHEMA = { type: "object", additionalProperties: false, required: ["title", "summary", "scopeNote", "stages"], properties: {
  title: str, summary: str, scopeNote: str,
  stages: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "goal"], properties: { title: str, goal: str } } } } };
const STAGE_SCHEMA = { type: "object", additionalProperties: false,
  required: ["title", "goal", "intro", "concepts", "startFiles", "solvedFiles", "fix", "checks", "mutants", "needs", "predict", "tries", "pair", "explainQ"],
  properties: {
    title: str, goal: str, intro: str,
    concepts: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "name", "essentials"], properties: { id: str, name: str, essentials: str } } },
    startFiles: files, solvedFiles: files, mutants: files,
    fix: { type: "object", additionalProperties: false, required: ["text", "file", "anchor"], properties: { text: str, file: str, anchor: str } },
    checks: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "concepts", "steps"], properties: { title: str, concepts: { type: "array", items: str },
      steps: { type: "array", items: { type: "object", additionalProperties: false, required: ["req", "body", "status", "json", "listHas"], properties: { req: str, body: str, status: { type: "number" }, json: str, listHas: str } } } } } },
    needs: { type: "array", items: { type: "object", additionalProperties: false, required: ["q", "answer", "concept", "snippet", "file", "anchor"], properties: { q: str, answer: str, concept: str, snippet: str, file: str, anchor: str } } },
    predict: { type: "object", additionalProperties: false, required: ["q", "options", "answer", "why"], properties: { q: str, options: { type: "array", items: str }, answer: { type: "number" }, why: str } },
    tries: { type: "array", items: { type: "object", additionalProperties: false, required: ["method", "path", "body"], properties: { method: str, path: str, body: str } } },
    pair: { type: "array", items: str }, explainQ: str,
  } };

/* ---------- 뼈대(코드가 넣음) ---------- */
const SCAFFOLD = ["package.json", "tsconfig.json", "src/server.ts", "src/router.ts", "src/http.ts"];
export async function scaffold() {
  const out: Record<string, string> = {};
  for (const f of SCAFFOLD) out[f] = (await readFile(path.join(COURSES, "hello-api", "template", f), "utf8")).replace(/hello-api-practice/g, "my-api-practice").replace(/인사 서버/g, "내 서버");
  return out;
}
const OWN = (p: string) => p === "src/app.ts" || /^src\/routes\/[\w-]+\.ts$/.test(p);

export const SYSTEM_PLAN = `너는 코딩 초보를 위한 프로젝트 코스 설계자다. 학습자 목표를 "Node.js 내장 http로 만드는 작은 웹 API"로 만들 수 있는 3~5단계 목차로 바꾼다.
- 단계는 개념이 아니라 구현 목표(예: "할 일 목록 보여 주기", "할 일 추가하기"). 앞 단계 결과 위에 쌓인다.
- 설치가 필요한 기술(DB 서버, 프레임워크, 화면)은 쓰지 않는다. 데이터는 메모리 배열. 범위를 줄였으면 scopeNote에 한 문장으로 솔직히(아니면 빈 글).
- 모든 글은 한국어 해요체(~해요)로, 짧게.`;

export const SYSTEM_STAGE = `너는 코딩 초보를 위한 프로젝트 코스의 한 단계를 만든다. 결과는 코드가 자동 관문으로 검사한다.
[프로젝트 규칙]
- Node.js 내장 http 서버. 뼈대 파일(src/server.ts · src/router.ts · src/http.ts · package.json · tsconfig.json)은 주어진 그대로이고 고치지 않는다.
- 네가 쓰는 파일은 src/app.ts(경로 목록: router.add("GET", "/주소", 처리함수))와 src/routes/*.ts(처리 함수)뿐. import는 상대 경로에 .ts를 붙인다(예: "./routes/todos.ts", "../http.ts", "../router.ts"). 처리 함수 모양: export function 이름({ req, res, params, query }: Ctx) — 답장은 sendJson(res, 상태코드, 값), 본문 읽기는 await readJson(req).
- 설치 없음. 데이터는 모듈 안 배열(메모리).
[이번 단계]
- startFiles: 이 단계를 시작할 때의 app.ts와 routes 파일 전체(앞 단계 완성 코드 + 이번 단계 뼈대). 학습자가 고칠 곳에 "// TODO(N단계): 할 일" 주석을 두고, 그 자리는 틀리거나 비어 있게(단 서버는 켜지고 모든 요청에 답장은 보낸다).
- solvedFiles: TODO를 고친 완성 상태에서 바뀐 파일 전체. 고칠 줄은 1~5줄, 파일 하나(fix.file).
- fix.text: 학습자가 할 일을 한 문장으로(무엇을 하게 만드는지만). 바꿔 넣을 값·상태 코드 숫자·완성 코드는 쓰지 않는다(예: "이름이 없을 때 알맞은 상태 코드로 알려 주게 고쳐요").
- fix.anchor: fix.file의 startFiles 안에 글자 그대로 있는 한 줄 일부(보통 "TODO(N단계)").
- checks 2~3개: 각 단계(steps)는 req("GET /todos" 꼴), body(JSON 글 또는 빈 글), status(기대 상태 코드), json(기대 응답의 일부 JSON 글 또는 빈 글), listHas(응답이 배열일 때 들어 있어야 할 항목의 일부 JSON 글 또는 빈 글). 시작 코드에서는 적어도 하나 실패, 완성 코드에서는 모두 통과. 앞 단계 기능을 깨지 않는다.
- mutants 1~2개: 완성 상태의 fix.file을 흔한 실수로 틀리게 바꾼 전체 파일. 검사가 이걸 떨어뜨려야 한다.
- needs 2~4개: 초보가 아무것도 모른다고 보고 "~하려면 뭐가 필요할까요?"(q)로 묻고, answer는 2~4문장으로 필요한 것 → 이 언어에서 쓰는 함수 이름 → 우리 코드의 그 줄 순서로. snippet은 혼자 돌아가는 JavaScript 3줄 이하 예시(마지막 줄은 값 하나, 없으면 빈 글). file/anchor는 startFiles에 실제로 있는 파일과 그 안에 글자 그대로 있는 한 줄 일부(없으면 둘 다 빈 글).
- predict: 시작 코드에 요청을 보내면 어떻게 될지 묻는 보기 3~4개(answer는 0부터 번호).
- tries: 시작 코드에서 직접 보내 볼 요청 1~3개. pair: 같이 고칠 때 조각 2개(정답 코드는 쓰지 않는다). explainQ: 내 말로 설명할 질문 하나.
- concepts: 이번 단계에서 새로 만나는 개념 2~4개(id는 영어 소문자-하이픈).
- 모든 글은 한국어 해요체(~해요)로, 짧게.`;

/* ---------- 단계 → 코스 데이터 ---------- */
const parseJson = (t: string) => { if (!t.trim()) return undefined; try { return JSON.parse(t); } catch { return undefined; } };
/** AI가 단계 이름 앞에 "1단계:"를 붙여 오면 뗀다(맥락에 "1단계 1단계:"가 되던 것, 11/3) */
const bare = (t: string) => String(t ?? "").replace(/^\s*\d+\s*단계\s*[:.·-]?\s*/, "");

export function toChecks(n: number, g: GenStage): Check[] {
  return g.checks.map((c, i) => ({
    id: `s${n}-${i + 1}`, stage: n, template: "gen", kind: "normal", target: true, title: c.title, knowledge: c.concepts.filter((k) => g.concepts.some((x) => x.id === k)),
    where: { file: g.fix.file, anchor: g.fix.anchor },
    steps: c.steps.map((st): Step => {
      const expect: NonNullable<Step["expect"]> = { status: st.status };
      const j = parseJson(st.json); if (j && typeof j === "object" && !Array.isArray(j)) expect.json = j;
      const l = parseJson(st.listHas); if (l && typeof l === "object") expect.some = l;
      const body = parseJson(st.body);
      return { req: st.req.trim(), ...(body !== undefined ? { body } : {}), expect };
    }),
  }));
}
export function toStage(n: number, g: GenStage): Stage {
  return {
    n, template: "gen", title: bare(g.title), goal: g.goal, parts: [], knowledge: g.concepts.map((c) => c.id), intro: g.intro,
    predict: [{ id: "p1", q: g.predict.q, options: g.predict.options, answer: Math.max(0, Math.min(g.predict.options.length - 1, Math.round(g.predict.answer))), why: g.predict.why, knowledge: g.concepts.map((c) => c.id).slice(0, 2) }],
    observe: { text: g.intro, checks: g.checks.map((_, i) => `s${n}-${i + 1}`) },
    fix: { text: g.fix.text, files: [g.fix.file] },
    explain: { q: g.explainQ, knowledge: g.concepts.map((c) => c.id).slice(0, 1) },
    hints: { "1": g.pair[0] ?? g.fix.text, "2": g.pair[1] ?? g.fix.text },
    try: g.tries.map((t, i) => ({ label: `요청 ${i + 1}`, method: t.method.toUpperCase(), path: t.path, ...(parseJson(t.body) !== undefined ? { body: parseJson(t.body) } : {}) })),
  };
}
const NUM = ["①", "②", "③", "④", "⑤"];
/** 튜터의 수업 메모: 이 단계에서 꺼낼 것(질문 · 알려 줄 것 · 우리 코드 위치). 화면에 그대로 나가지 않는다 */
export function talkMemo(g: GenStage) {
  const items = g.needs.map((x, i) => `${i + 1}. ${x.q}\n   알려 줄 것: ${x.answer}${x.file && x.anchor ? `\n   우리 코드: [[${x.file}#${x.anchor}]]` : ""}`).join("\n");
  return `[수업 메모 — 이 단계에서 대화로 꺼낼 것] 목표: ${g.goal}\n${items}\n\n이 메모를 보고 ChatGPT에서 가르치듯 자연스럽게 이끈다: 한 번에 하나씩, 먼저 짧게 묻거나 보여 주고 학습자 반응을 본 뒤 다음으로. 학습자가 이미 알면 넘어가고, 모르면 쉬운 말과 작은 예로. 우리 코드의 그 줄은 [[파일#찾을 글]]로 짚는다. 예측 문제의 답과 고칠 줄의 완성 코드는 말하지 않는다. 지금은 1번부터 시작한다(인사·목표 다시 말하기 없이). 다 꺼냈으면 "[다 봤어요, 다음]을 누르면 결과를 예측해 봐요"라고 한 줄 붙인다.`;
}
/** 대본(수업 계획서): "이걸 하려면 뭐가 필요할까요?" → 필요한 것 하나씩 → 예측 → 보내 보기 → 고치기 → 내 말로 → 정리 */
export function toLesson(n: number, g: GenStage) {
  const tries = g.tries.map((t) => ({ method: t.method.toUpperCase(), path: t.path, ...(parseJson(t.body) !== undefined ? { body: parseJson(t.body) } : {}) }));
  const link = (f: string, a: string) => (f && a ? `\n\n[[${f}#${a}]]` : "");
  const beats: Record<string, unknown>[] = [
    { id: "goal", kind: "say", text: `오늘 만들 건 이거예요.\n\n**${g.goal}**\n\n이걸 하려면 뭐가 필요할까요? 하나씩 같이 꺼내 볼게요.`, actions: [{ label: "좋아요, 하나씩 봐요", do: "next" }], now: "오늘 만들 것 보기" },
    // 11/3 사용자 "자연스럽게 gpt chat이랑 얘기하는 것처럼": 필요한 것들은 대본 칸이 아니라 튜터의 수업 메모로 — 튜터가 대화로 하나씩 꺼낸다
    { id: "talk", kind: "say", text: "", talk: talkMemo(g), actions: [{ label: "다 봤어요, 다음", do: "next" }], now: "튜터와 하나씩 꺼내 보기" },
    { id: "predict", kind: "predict", predict: "p1", text: g.predict.q, after: [{ label: "직접 보내 보기", do: "start_dev,try", tries }], now: "결과를 예측해 본 뒤, 직접 보내 보기" },
    { id: "why", kind: "say", text: `${g.intro}${link(g.fix.file, g.fix.anchor)}`, open: { file: g.fix.file, anchor: g.fix.anchor, note: "여기를 고쳐요" }, actions: [{ label: "알겠어요, 고치러 가요", do: "next" }], now: "고칠 곳 보기" },
    { id: "fix", kind: "fix", text: `${g.fix.text}${link(g.fix.file, g.fix.anchor)}\n\n어떻게 할지 골라 주세요.`, open: { file: g.fix.file, anchor: g.fix.anchor, note: "여기를 채워요" }, pair: g.pair.slice(0, 3), now: g.fix.text.slice(0, 60) },
    { id: "explain", kind: "explain", text: `**내 말로** 한 문장만 적어 볼까요?\n\n**${g.explainQ}** 채점하지 않아요.`, now: "내 말로 한 문장 (안 해도 돼요)" },
    { id: "wrap", kind: "say", text: `${n}단계 끝! 오늘 꺼낸 것:\n\n${g.needs.map((x, i) => `${i + 1}. ${x.q.replace(/\?$/, "")} → ${g.concepts.find((c) => c.id === x.concept)?.name ?? x.concept}`).join("\n")}`, clearFocus: true, actions: [{ label: "다음 단계로", do: "next_stage" }], now: "정리를 보고 다음 단계로" },
  ];
  return { stage: n, title: bare(g.title), passText: `${g.goal} 이제 돼요.`, teach: g.concepts.map((c) => `${c.name}: ${c.essentials}`).slice(0, 4),
    tutorNotes: "코딩을 처음 하는 사람이다. '이걸 하려면 뭐가 필요할까요?'로 묻고, 필요한 것 → 이 언어의 함수 → 우리 코드의 그 줄 순서로 짧게 답한다. 코드 한 줄을 보여 줄 때는 조각마다 무엇인지, 어디 있는지 [[파일#찾을 글]]로 짚는다. 정답 줄을 먼저 주지 않는다.", beats };
}

/* ---------- 관문 ---------- */
let gatePort = 4196;
export async function gate(course: Course, n: number, start: Record<string, string>, solved: Record<string, string>, mutants: Record<string, string>[], lesson: ReturnType<typeof toLesson>) {
  const errors: string[] = [];
  // ④ 앵커
  for (const b of lesson.beats as { open?: { file: string; anchor: string }; text?: string }[]) {
    if (b.open && !(start[b.open.file] ?? "").includes(b.open.anchor)) errors.push(`대본이 가리키는 "${b.open.anchor}"가 시작 코드 ${b.open.file}에 없어요.`);
    for (const m of String(b.text ?? "").matchAll(/\[\[([^\]#]+)#([^\]]+)\]\]/g)) if (!(start[m[1]] ?? "").includes(m[2])) errors.push(`대본 링크 ${m[1]}#${m[2]}가 시작 코드에 없어요.`);
  }
  for (const f of Object.keys({ ...start, ...solved })) if (!SCAFFOLD.includes(f) && !OWN(f)) errors.push(`쓸 수 없는 파일이에요: ${f} (src/app.ts, src/routes/*.ts만)`);
  if (errors.length) return errors;
  const dir = await mkdtemp(path.join(os.tmpdir(), "pc-gate-"));
  const port = gatePort++ > 4199 ? (gatePort = 4196) : gatePort;
  const run = async (files: Record<string, string>) => { await writeWorkspace(dir, new Map(Object.entries(files))); return runChecks({ course, stage: n, ws: dir, port }); };
  try {
    // ① 시작: 이번 단계 검사 중 하나 이상 실패, 앞 단계는 통과
    const r1 = await run(start);
    if (!r1.started) errors.push(`시작 코드로 서버가 켜지지 않아요: ${r1.logs.slice(-3).join(" / ")}`);
    else {
      const mine = r1.results.filter((r) => !r.regression);
      if (mine.every((r) => r.ok)) errors.push("시작 코드가 이번 단계 검사를 이미 다 통과해요(고칠 게 없음).");
      for (const r of r1.results.filter((x) => x.regression && !x.ok)) errors.push(`시작 코드가 앞 단계 검사 "${r.title}"를 깨요: ${r.failure?.expected} / ${r.failure?.actual}`);
    }
    // ② 완성: 모두 통과
    const r2 = await run(solved);
    if (!r2.started) errors.push(`완성 코드로 서버가 켜지지 않아요: ${r2.logs.slice(-3).join(" / ")}`);
    for (const r of r2.results.filter((x) => !x.ok)) errors.push(`완성 코드가 검사 "${r.title}"에 실패해요: 요청 ${r.failure?.request} · 기대 ${r.failure?.expected} · 실제 ${r.failure?.actual}`);
    // ③ 뮤턴트: 검사가 떨어뜨려야
    for (const [i, m] of mutants.entries()) {
      const r3 = await run({ ...solved, ...m });
      if (r3.started && r3.results.every((r) => r.ok)) errors.push(`틀린 완성 ${i + 1}번을 검사가 못 잡아요. 검사를 더 엄격하게(응답 내용까지) 해 주세요.`);
    }
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  // ⑤ 돌려 보기 예시
  for (const b of lesson.beats as { text?: string }[]) {
    const m = /```js\n([\s\S]*?)\n```/.exec(String(b.text ?? ""));
    if (m) { const r = await runSnippet(m[1], 3000); if (!r.ok) errors.push(`돌려 보기 예시가 오류를 내요: ${r.output.slice(0, 120)}`); }
  }
  return errors;
}

/* ---------- 생성 작업 ---------- */
export type GenStatus = { id: string; goal: string; phase: "plan" | "stage" | "ready" | "failed"; stage: number; message: string; attempts: number; errors: string[]; ready: number[]; at: string };
const statusFile = (id: string) => path.join(GEN_COURSES, id, "gen.json");
export const genStatus = (id: string) => read<GenStatus | null>(statusFile(id), null);
const setStatus = (id: string, fn: (s: GenStatus) => void) => update<GenStatus>(statusFile(id), { id, goal: "", phase: "plan", stage: 0, message: "", attempts: 0, errors: [], ready: [], at: "" }, (s) => { fn(s); s.at = new Date().toISOString(); });
const running = new Map<string, Promise<void>>();

function newCourse(id: string, goal: string, plan: GenPlan): Course {
  return { id, title: plan.title, summary: plan.summary, stack: "Node.js(22.13 이상) · TypeScript(빌드 없이 실행) · VS Code", audience: "코딩을 처음 하는 사람",
    templates: { gen: { dir: "" } }, auth: {}, knowledge: [], parts: [], stages: [], checks: [], intake: { diagnose: [] },
    generated: { goal, outline: plan.stages.slice(0, 5).map((s, i) => ({ n: i + 1, title: s.title, goal: s.goal })) } };
}
const saveCourse = async (c: Course) => { await mkdir(path.join(GEN_COURSES, c.id), { recursive: true }); await writeFile(path.join(GEN_COURSES, c.id, "course.json"), JSON.stringify(c, null, 1)); };
const ownFiles = (all: Record<string, string>) => Object.entries(all).filter(([p]) => OWN(p)).map(([p, c]) => `--- ${p}\n${c}`).join("\n\n");

/** 목표로 코스를 시작한다: 목차 → 1단계(관문까지). 끝나기 전에 돌아온다 */
export async function startGeneration(goal: string) {
  const id = `gen-${randomBytes(4).toString("hex")}`;
  await setStatus(id, (s) => { s.goal = goal.slice(0, 300); s.phase = "plan"; s.message = "목차를 짜는 중이에요"; });
  const job = (async () => {
    try {
      const plan = await aiJson<GenPlan>("gen-plan", promptOf("genPlan", SYSTEM_PLAN), `[학습자 목표] ${goal}`, PLAN_SCHEMA, true);
      if (!plan.stages?.length) throw new Error("목차가 비었어요.");
      await saveCourse(newCourse(id, goal, plan));
      await setStatus(id, (s) => { s.message = plan.scopeNote ? `목차 완성 · ${plan.scopeNote}` : "목차 완성"; });
      await generateStage(id, 1);
    } catch (e) {
      await setStatus(id, (s) => { s.phase = "failed"; s.message = e instanceof AiUnavailable ? e.message : `만들지 못했어요: ${(e as Error).message}`; });
    }
  })();
  running.set(`${id}:1`, job);
  void job.finally(() => running.delete(`${id}:1`));
  return id;
}

/** 단계 하나를 만든다(이미 있거나 만드는 중이면 그대로). 관문을 못 넘으면 오류를 붙여 다시, 최대 3번 */
export async function generateStage(id: string, n: number): Promise<void> {
  const course = await loadCourse(id);
  if (course.stages.some((s) => s.n === n)) return;
  const out = course.generated?.outline.find((o) => o.n === n);
  if (!out) return;
  const prevSolved = n === 1 ? await scaffold() : JSON.parse(await readFile(path.join(GEN_COURSES, id, "stages", `${n - 1}.json`), "utf8")).solved as Record<string, string>;
  let feedback = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    await setStatus(id, (s) => { s.phase = "stage"; s.stage = n; s.attempts = attempt; s.message = attempt === 1 ? `${n}단계를 만드는 중이에요` : `${n}단계를 고쳐서 다시 만드는 중이에요(${attempt}번째)`; });
    const user = [
      `[학습자 목표] ${course.generated!.goal}`,
      `[코스] ${course.title} — ${course.summary}`,
      `[전체 목차] ${course.generated!.outline.map((o) => `${o.n}. ${o.title}`).join(" / ")}`,
      `[이번 단계] ${n}단계: ${out.title} — ${out.goal}`,
      `[뼈대 파일]\n${SCAFFOLD.filter((f) => f.startsWith("src/")).map((f) => `--- ${f}\n${prevSolved[f]}`).join("\n\n")}`,
      n === 1 ? "[앞 단계 완성 코드] 없음(첫 단계: src/app.ts와 routes를 새로 만든다)" : `[앞 단계 완성 코드]\n${ownFiles(prevSolved)}`,
      feedback ? `[지난번 관문에서 걸린 것 — 꼭 고칠 것]\n${feedback}` : "",
    ].filter(Boolean).join("\n\n");
    let g: GenStage;
    try { g = await aiJson<GenStage>("gen-stage", promptOf("genStage", SYSTEM_STAGE), user, STAGE_SCHEMA, true); }
    catch (e) { await setStatus(id, (s) => { s.phase = "failed"; s.message = e instanceof AiUnavailable ? e.message : `만들지 못했어요: ${(e as Error).message}`; }); return; }
    const start = { ...prevSolved, ...Object.fromEntries(g.startFiles.map((f) => [f.path, f.content])) };
    const solved = { ...start, ...Object.fromEntries(g.solvedFiles.map((f) => [f.path, f.content])) };
    const mutants = g.mutants.map((m) => ({ [m.path]: m.content }));
    const draft: Course = { ...course, stages: [...course.stages, toStage(n, g)], checks: [...course.checks, ...toChecks(n, g)],
      knowledge: [...course.knowledge, ...g.concepts.filter((c) => !course.knowledge.some((k) => k.id === c.id))] };
    const lesson = toLesson(n, g);
    const errors = await gate(draft, n, start, solved, mutants, lesson);
    if (!errors.length) {
      await mkdir(path.join(GEN_COURSES, id, "stages"), { recursive: true });
      await mkdir(path.join(GEN_COURSES, id, "lessons"), { recursive: true });
      await writeFile(path.join(GEN_COURSES, id, "stages", `${n}.json`), JSON.stringify({ start, solved }, null, 1));
      await writeFile(path.join(GEN_COURSES, id, "lessons", `${n}.json`), JSON.stringify(lesson, null, 1));
      const fresh = await loadCourse(id); // 다른 단계가 그새 붙었을 수 있다
      await saveCourse({ ...fresh, stages: [...fresh.stages.filter((s) => s.n !== n), draft.stages.at(-1)!].sort((a, b) => a.n - b.n),
        checks: [...fresh.checks.filter((c) => c.stage !== n), ...toChecks(n, g)], knowledge: draft.knowledge });
      await setStatus(id, (s) => { s.phase = "ready"; s.ready = [...new Set([...s.ready, n])].sort(); s.errors = []; s.message = `${n}단계 준비 완료`; });
      return;
    }
    feedback = errors.slice(0, 8).map((e) => `- ${e}`).join("\n");
    await setStatus(id, (s) => { s.errors = errors.slice(0, 8); });
  }
  await setStatus(id, (s) => { s.phase = "failed"; s.message = `${n}단계가 자동 관문을 세 번 넘지 못했어요. 목표를 조금 더 작게 적어 다시 해 볼까요?`; });
}

/** 학습자가 n단계를 시작하면 n+1단계를 뒤에서 만든다 */
export function prepareNext(id: string, n: number) {
  const key = `${id}:${n + 1}`;
  if (running.has(key)) return;
  const job = generateStage(id, n + 1).catch(() => {});
  running.set(key, job);
  void job.finally(() => running.delete(key));
}
export const isRunning = (id: string, n: number) => running.has(`${id}:${n}`);
