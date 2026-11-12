import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateDocument } from "../../../../tools/problem-authoring-lab/contract.ts";
import { checkClassify, cleanPageText, mergeAcrossSections, normalizeOutline, sectionPageTexts } from "./checks.ts";
import   { createGen, enqueueGen, studyDocument, readGenCalls, runGen, type RunOptions } from "./runner.ts";
import { authorSchema, classifySchema, designSchema, outlineSchema } from "./schemas.ts";
import type  { Issue } from "./types.ts";

const PAGES = new Map([
  [1, "Breadth-first search visits vertices in order of distance from the start. A queue holds the vertices that are waiting to be visited."],
  [2, "Adding a vertex that was already in the queue has no effect on the result. A boolean array records whether each vertex has been in the queue."],
]);
const caller = { uid: "local-experiment" };
const pages: RunOptions["pages"] = async () => PAGES;

async function withData<T>(fn: () => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "study-gen-"));
  const previous = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { return await fn(); }
  finally {
    if (previous === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}
const base = { sourceId: "src_test", fileName: "bfs.pdf", pageNumbers: [1, 2], provider: "fake" as const };


test("모든 응답 스키마는 strict 구조화 출력 규칙을 지킨다(모든 칸 required, 추가 칸 금지)", () => {
  const visit = (node: unknown, where: string) => {
    if (!node || typeof node !== "object") return;
    const schema = node as { type?: unknown; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown; items?: unknown };
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.includes("object")) {
      assert.deepEqual([...(schema.required ?? [])].sort(), Object.keys(schema.properties ?? {}).sort(), where);
      assert.equal(schema.additionalProperties, false, where);
      for (const [key, value] of Object.entries(schema.properties ?? {})) visit(value, `${where}.${key}`);
    }
    if (schema.items) visit(schema.items, `${where}[]`);
  };
  for (const [name, schema] of Object.entries({ outlineSchema, classifySchema, designSchema, authorSchema })) visit(schema, name);
});

test("목차가 고른 쪽을 덮지 않으면 코드가 앞 항목에 붙이고, 범위 밖 항목은 뺀다", () => {
  const result = normalizeOutline({ sections: [
    { title: "B", pageStart: 4, pageEnd: 5 }, { title: "A", pageStart: 1, pageEnd: 2 }, { title: "밖", pageStart: 9, pageEnd: 9 },
  ] }, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.sections.map((section) => [section.id, section.title, section.pages]), [["s1", "A", [1, 2, 3]], ["s2", "B", [4, 5, 6]]]);
  assert.deepEqual(result.warnings.map((warning) => warning.code).sort(), ["outline-gap", "outline-out-of-range"]);
  assert.equal(normalizeOutline({ sections: [{ title: "밖", pageStart: 9, pageEnd: 9 }] }, [1]).sections.length, 0);
});








test("실제 모델 생성은 호출 확인 없이 대기열에 넣지 않는다", () => withData(async () => {
  const state = await createGen({ ...base, provider: "chatgpt", purpose: "core" });
  await assert.rejects(enqueueGen(state.id, caller, { pages }), /실제 모델 호출 확인/);
  assert.equal((await readGenCalls(state.id)).length, 0);
}));

// Two sections share page 1: the second starts mid-page (the Cornell layout from the 10/12 live run).
const SHARED = new Map([
  [1, "Breadth-first search  Visit nodes in order of distance from u. Use a queue instead of a stack.  Reducing the potential maximum size of the queue  Each edge may add a vertex to the queue."],
  [2, "A boolean array records whether each vertex has been in the queue."],
]);
const sharedOutline = JSON.stringify({ sections: [
  { title: "Breadth-first search", startText: "Breadth-first search", pageStart: 1, pageEnd: 1 },
  { title: "Reducing the potential maximum size of the queue", startText: "Reducing the potential maximum size", pageStart: 1, pageEnd: 2 },
] });

test("한 쪽을 두 목차가 나눠 쓰면 시작 글자 위치에서 잘라 각 목차에 자기 부분만 준다", () => {
  const { sections } = normalizeOutline(JSON.parse(sharedOutline), [1, 2]);
  const first = sectionPageTexts(sections[0], sections, SHARED).texts.get(1)!;
  const second = sectionPageTexts(sections[1], sections, SHARED);
  assert.ok(first.includes("Use a queue instead of a stack.") && !first.includes("Reducing"));
  assert.ok(second.texts.get(1)!.startsWith("Reducing the potential") && !second.texts.get(1)!.includes("Use a queue"));
  assert.equal(second.texts.get(2), SHARED.get(2));
  // A quote from the earlier section no longer passes for the later one.
  const checked = checkClassify({ items: [{ kind: "핵심 지식", content: "x", quote: "Use a queue instead of a stack.", page: 1 }] }, sections[1], second.texts);
  assert.equal(checked.items.length, 0);
  // A start that cannot be found keeps the whole page and says so.
  const lost = sectionPageTexts({ ...sections[1], startText: "nowhere to be found", title: "also missing" }, sections, SHARED);
  assert.ok(lost.texts.get(1)!.includes("Use a queue") && lost.warnings.some((warning) => warning.code === "section-start-not-found"));
});


test("목차가 달라도 떠올릴 것이 같으면 뒤 목표를 앞 목표에 합친다", () => {
  const objective = (id: string, sectionId: string, recall: string) => ({ id, sectionId, statement: "s", cue: "c", recall, kind: "개념" as const, importance: "core" as const, itemNumbers: [1], materialNumbers: [], pages: [1], quotes: ["q"] });
  const sections = [
    { design: { objectives: [objective("s1-o1", "s1", "Use a queue")], warnings: [] as Issue[] } },
    { design: { objectives: [objective("s2-o1", "s2", "use a  QUEUE"), objective("s2-o2", "s2", "boolean array")], warnings: [] as Issue[] } },
  ];
  mergeAcrossSections(sections);
  assert.deepEqual(sections[1].design.objectives.map((item) => item.id), ["s2-o2"]);
  assert.equal(sections[1].design.warnings[0].ref, "s1-o1");
});





test("PDF 글자 층의 깨진 하이픈(㎿)을 하이픈으로 고친다", () => {
  assert.equal(cleanPageText("Composite Two㎿Dimensional Rotations"), "Composite Two-Dimensional Rotations");
  assert.equal(cleanPageText("An   𝑥 ㎿direction shear"), "An   𝑥-direction shear");
});

test("공부 화면용: 목차 문서를 하나로 묶고, 공부 화면에서 만든 실행만 따로 고를 수 있다", () => withData(async () => {
  const state = await createGen({ ...base, purpose: "core", autoConfirm: true, origin: "study" });
  assert.equal(state.input.origin, "study");
  assert.equal((await createGen({ ...base, purpose: "core" })).input.origin, "lab");
  assert.equal(await studyDocument(state.id), null, "no questions yet");
  const done = await runGen(state.id, caller, { pages });
  const deck = (await studyDocument(state.id))!;
  assert.equal(deck.document.questions.length, done.sections.reduce((sum, section) => sum + (section.author?.questionCount ?? 0), 0));
  assert.deepEqual(validateDocument(deck.document).filter((issue) => issue.severity === "error"), []);
  assert.equal(deck.meta.id, state.id);
  assert.equal(deck.meta.title, "bfs · p.1–2");
  assert.match(deck.meta.artifactSha256, /^[a-f0-9]{64}$/);
}));



test("쪽마다 잘린 목차는 코드가 공부 단위(4쪽에 1개 이하)로 묶는다", () => {
  const pages = Array.from({ length: 52 }, (_, index) => index + 1);
  const result = normalizeOutline({ sections: pages.map((page) => ({ title: `슬라이드 ${page}`, pageStart: page, pageEnd: page })) }, pages);
  assert.equal(result.sections.length, 13);
  assert.deepEqual(result.sections.flatMap((section) => section.pages), pages, "every page once, in order");
  assert.deepEqual(result.sections.map((section) => section.id), result.sections.map((_, index) => `s${index + 1}`));
  assert.ok(result.warnings.some((warning) => warning.code === "outline-merged"));
  assert.match(result.sections[0].title, /슬라이드 1/);
  // Small selections keep their sections.
  assert.equal(normalizeOutline({ sections: [{ title: "A", pageStart: 1, pageEnd: 1 }, { title: "B", pageStart: 2, pageEnd: 2 }] }, [1, 2]).sections.length, 2);
});

test("강의 안내(학습목표 목록·수업 순서·평가 비율)만 근거인 목표는 다시 묻지 않고 뺀다", async () => {
  const { checkDesign } = await import("./checks.ts");
  const section = { id: "s1", title: "안내", pages: [5] };
  const items = [{ n: 1, kind: "학습 지시" as const, content: "성적 반영: 시험 70%", quote: "시험(지필고사): 70%", page: 5 },
    { n: 2, kind: "핵심 지식" as const, content: "기업윤리의 정의", quote: "기업윤리란", page: 5 }];
  const draft = (itemNumbers: number[], recall: string) => ({ statement: `${recall}를 말할 수 있다`, cue: "?", recall, kind: "사실" as const, importance: "core" as const, itemNumbers, materialNumbers: [] });
  const checked = checkDesign({ objectives: [draft([1], "시험 70%"), draft([2], "기업윤리의 정의")] }, section, items);
  assert.equal(checked.objectives.length, 1);
  assert.equal(checked.problems.length, 0);
  assert.ok(checked.warnings.some((warning) => warning.code === "course-admin-dropped"));
});


test("목차는 두 단계: 단원 아래 세부 항목이 쪽을 나눠 갖고, 단원을 묶어도 세부 항목은 남는다", () => {
  const pages = [1, 2, 3, 4, 5, 6];
  const two = normalizeOutline({ sections: [
    { title: "변환", startText: "", pageStart: 1, pageEnd: 6, parts: [{ title: "이동", pageStart: 1 }, { title: "회전", pageStart: 3 }, { title: "확대", pageStart: 5 }] },
  ] }, pages);
  assert.deepEqual(two.sections[0].parts, [{ title: "이동", pages: [1, 2] }, { title: "회전", pages: [3, 4] }, { title: "확대", pages: [5, 6] }]);
  const many = Array.from({ length: 20 }, (_, index) => index + 1);
  const merged = normalizeOutline({ sections: many.map((page) => ({ title: `슬라이드 ${page}`, startText: "", pageStart: page, pageEnd: page, parts: [] })) }, many);
  assert.equal(merged.sections.length, 5);
  assert.deepEqual(merged.sections.flatMap((section) => section.parts!.map((part) => part.title)), many.map((page) => `슬라이드 ${page}`));
});

test("순서 단답(이름을 화살표로 잇기)은 '한 칸 여러 요소'로 떨어뜨리지 않는다", async () => {
  const { inspectQuestion, isOrderAnswer } = await import("./layout.ts");
  const question = (accepted: string[]) => ({
    id: "q", page: { width: 760, height: 300 },
    source: { learningUnitId: "o", objectiveId: "o", sourceId: "a.pdf", sourcePage: 1, sourceRange: "PDF 1쪽", sourceText: "x축 회전 뒤 y축 회전", target: "t", successCriteria: ["c"] },
    blocks: [{ id: "b1", kind: "text" as const, text: "두 회전을 적용하는 순서는?", frame: { x: 0, y: 0, width: 10, height: 10 } },
      { id: "input", kind: "blank" as const, responseId: "r", promptBefore: "순서(→로 구분):", promptAfter: "", frame: { x: 0, y: 0, width: 10, height: 10 } },
      { id: "reveal", kind: "answer-reveal" as const, responseIds: ["r"], frame: { x: 0, y: 0, width: 10, height: 10 } }],
    responses: [{ id: "r", kind: "short-text" as const, acceptedAnswers: accepted, grading: "exact-normalized" as const, explanation: "e" }],
  });
  assert.equal(isOrderAnswer(question(["x축 → y축"])), true);
  assert.ok(!inspectQuestion(question(["x축 → y축"])).errors.some((issue) => issue.code === "composite-short-answer"));
  assert.ok(inspectQuestion(question(["a; b; c"])).errors.some((issue) => issue.code === "composite-short-answer"));
});

test("내용이 있는데 분류 항목이 없는 쪽은 다시 묻는다", () => {
  const section = { id: "s5", title: "투영", pages: [19, 20] };
  const texts = new Map([[19, "Perspective projection: x_p = x * d / z, y_p = y * d / z. The field of view (FOV) determines the angle of the view volume, and the projection plane distance d follows from the FOV and the window height."],
    [20, "Parallel projection keeps lines parallel and is used for engineering drawings and orthographic views of objects."]]);
  const checked = checkClassify({ items: [{ kind: "핵심 지식", content: "평행 투영", quote: "Parallel projection keeps lines parallel", page: 20 }] }, section, texts);
  assert.equal(checked.items.length, 1);
  assert.match(checked.problems.map((problem) => problem.message).join(), /p\.19에 분류 항목이 하나도 없습니다/);
});

test("공부 화면: 구분자 없이 쓴 LaTeX 정답은 수식으로 감싼다", async () => {
  const { showMath } = await import("../from-authoring.ts");
  assert.equal(showMath("\\begin{bmatrix}1&sh_x\\\\0&1\\end{bmatrix}"), "$\\begin{bmatrix}1&sh_x\\\\0&1\\end{bmatrix}$");
  assert.equal(showMath("x' = x\\cos\\theta - y\\sin\\theta\ny' = x\\sin\\theta + y\\cos\\theta"), "$x' = x\\cos\\theta - y\\sin\\theta$\n$y' = x\\sin\\theta + y\\cos\\theta$");
  assert.equal(showMath("행렬은 \\begin{bmatrix}1&0\\end{bmatrix} 이다"), "행렬은 $\\begin{bmatrix}1&0\\end{bmatrix}$ 이다");
  assert.equal(showMath("큐에 들어간 적 없는 정점"), "큐에 들어간 적 없는 정점");
  assert.equal(showMath("$a^{2}$"), "$a^{2}$");
});


