import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const root = await mkdtemp(path.join(tmpdir(), "study-notes-"));
process.env.STUDY_FORGE_DATA_DIR = root;
process.env.STUDY_FORGE_MODEL_PROVIDER = "fake";
after(() => rm(root, { recursive: true, force: true }));

const { ModelError, setFakeModelResponder } = await import("../ai/model.ts");
const { askNote, followUp, listNotes, markNote, phraseKey, readAnswer, saveTalk, WEAK_AFTER } = await import("./notes.ts");
const caller = { uid: "local" };
const SRC = "src_test";

test("같은 자료의 같은 문구는 한 번만 묻고, 다시 고르면 AI 없이 저장된 답을 주며 다시 본 횟수를 올린다", async () => {
  const calls: string[] = [];
  setFakeModelResponder((request) => {
    calls.push(request.purpose);
    assert.match(request.user, /\[고른 글\] frustum/);
    assert.match(request.user, /\[이 쪽 원문 p\.3\]\nthe view volume is a frustum/);
    return "```json\n" + JSON.stringify({ kind: "term", lead: "꼭대기가 잘린 피라미드 모양의 보이는 영역", steps: [], quote: "the view volume is a frustum", extra: null, outsideSource: "절두체라는 번역어" }) + "\n```";
  });
  try {
    const first = await askNote(caller, { sourceId: SRC, page: 3, quote: "frustum", sentence: "the view volume is a frustum", pageText: "the view volume is a frustum", title: "3D Viewing" });
    assert.equal(first.reused, false);
    assert.equal(first.note.status, "answered");
    assert.equal(first.note.answer?.outsideSource, "절두체라는 번역어");
    assert.equal(first.note.usage.calls, 1);

    const again = await askNote(caller, { sourceId: SRC, page: 7, quote: "  Frustum ", pageText: "ignored" });
    assert.equal(again.reused, true);
    assert.equal(again.note.id, first.note.id);
    assert.equal(again.note.seen, 1);
    assert.deepEqual(calls, ["note:ask"], "다시 고르면 AI를 부르지 않는다");
    assert.equal((await listNotes(SRC)).length, 1);
  } finally { setFakeModelResponder(null); }
});

test("모름 표시는 호출 없이 남고, 나중에 물어보면 같은 항목이 답을 얻는다", async () => {
  setFakeModelResponder(() => JSON.stringify({ kind: "procedure", lead: "좌표를 순서대로 바꾼다", steps: [{ step: "월드", why: "한 장면" }, { step: "관측", why: "카메라 기준" }] }));
  try {
    const marked = await markNote({ sourceId: SRC, page: 5, quote: "viewing pipeline" });
    assert.equal(marked.status, "marked");
    assert.equal(marked.answer, null);
    const asked = await askNote(caller, { sourceId: SRC, page: 5, quote: "Viewing  pipeline" });
    assert.equal(asked.reused, false);
    assert.equal(asked.note.id, marked.id);
    assert.equal(asked.note.kind, "procedure");
    assert.equal(asked.note.answer?.steps?.length, 2);
  } finally { setFakeModelResponder(null); }
});

test("이어서 묻기는 카드 항목에 쌓이고, 형식이 틀린 답은 한 번 다시 시킨다", async () => {
  let n = 0;
  setFakeModelResponder((request) => {
    n += 1;
    if (request.purpose === "note:ask") return n === 1 ? "그건 이런 뜻이에요" : JSON.stringify({ kind: "concept", lead: "보이는 범위" });
    assert.match(request.user, /\[새 질문\] 왜 잘라\?/);
    return "보이지 않는 것을 먼저 버려야 계산이 줄어요.";
  });
  try {
    const { note } = await askNote(caller, { sourceId: SRC, page: 3, quote: "view volume" });
    assert.equal(note.answer?.lead, "보이는 범위");
    const followed = await followUp(caller, { sourceId: SRC, noteId: note.id, question: "왜 잘라?" });
    assert.deepEqual(followed.thread.map((turn) => turn.role), ["user", "assistant"]);
    assert.equal(followed.usage.calls, 3);
  } finally { setFakeModelResponder(null); }
});

test("질문 창 대화는 대화 한 번이 항목 하나이고 AI가 제목을 붙인다. 카드에서 이어진 대화는 그 카드에 붙는다", async () => {
  const purposes: string[] = [];
  setFakeModelResponder((request) => { purposes.push(request.purpose); return "“관측 좌표 순서의 이유”."; });
  try {
    const talk = await saveTalk(caller, { sourceId: SRC, page: 3, turns: [{ role: "user", text: "이 순서가 왜 이렇게 돼?", quote: "then to viewing coordinates" }, { role: "assistant", text: "카메라 기준으로 먼저 옮겨야 해요." }] });
    assert.equal(talk.kind, "talk");
    assert.equal(talk.quote, "관측 좌표 순서의 이유");
    const updated = await saveTalk(caller, { sourceId: SRC, page: 3, noteId: talk.id, turns: [...talk.thread, { role: "user", text: "고마워" }, { role: "assistant", text: "네" }] });
    assert.equal(updated.id, talk.id);
    assert.equal(updated.thread.length, 4);
    assert.deepEqual(purposes, ["note:title"], "제목은 처음 한 번만 만든다");

    const card = (await listNotes(SRC)).find((note) => note.quote === "frustum")!;
    const extended = await saveTalk(caller, { sourceId: SRC, page: 3, noteId: card.id, turns: [{ role: "user", text: "near plane은?" }, { role: "assistant", text: "가까운 자르는 면" }] });
    assert.equal(extended.id, card.id);
    assert.equal(extended.kind, "term");
    assert.equal(extended.thread.at(-1)?.text, "가까운 자르는 면");
  } finally { setFakeModelResponder(null); }
});

test("사용량 한도는 그대로 알려서 화면이 안내하게 한다", async () => {
  setFakeModelResponder(() => { throw new ModelError("usage_limit", "limit"); });
  try {
    await assert.rejects(askNote(caller, { sourceId: SRC, page: 2, quote: "clipping window" }), (error: unknown) => error instanceof ModelError && error.code === "usage_limit");
    assert.equal((await listNotes(SRC)).some((note) => note.quote === "clipping window"), false, "실패한 질문은 남기지 않는다");
  } finally { setFakeModelResponder(null); }
});

test("노트의 한도·로그인·일시 오류는 기존 표시와 대화를 보존하고 다시 물을 수 있다", async (t) => {
  for (const code of ["usage_limit", "login_required", "transient"] as const) await t.test(code, async () => {
    const sourceId = `src_note_fault_${code}`;
    const marked = await markNote({ sourceId, page: 1, quote: "BFS" });
    setFakeModelResponder(() => { throw new ModelError(code, "검증용 고장"); });
    try {
      await assert.rejects(askNote(caller, { sourceId, page: 1, quote: "BFS" }),
        (error: unknown) => error instanceof ModelError && error.code === code);
      const kept = (await listNotes(sourceId))[0];
      assert.equal(kept.id, marked.id);
      assert.equal(kept.status, "marked");
      assert.equal(kept.answer, null);
      setFakeModelResponder(() => JSON.stringify({ kind: "term", lead: "가까운 노드부터 방문하는 탐색" }));
      const answered = await askNote(caller, { sourceId, page: 1, quote: "BFS" });
      assert.equal(answered.note.id, marked.id);
      assert.equal(answered.note.status, "answered");
      setFakeModelResponder(() => { throw new ModelError(code, "검증용 고장"); });
      await assert.rejects(followUp(caller, { sourceId, noteId: marked.id, question: "큐는 왜?" }),
        (error: unknown) => error instanceof ModelError && error.code === code);
      const unchanged = (await listNotes(sourceId))[0];
      assert.deepEqual(unchanged.thread, answered.note.thread);
      assert.deepEqual(unchanged.answer, answered.note.answer);
      setFakeModelResponder(() => "선입선출이 방문 순서를 유지한다.");
      const continued = await followUp(caller, { sourceId, noteId: marked.id, question: "큐는 왜?" });
      assert.equal(continued.id, marked.id);
      assert.equal(continued.thread.length, answered.note.thread.length + 2);
      assert.equal((await listNotes(sourceId)).length, 1);
    } finally { setFakeModelResponder(null); }
  });
});

test("별도 런타임의 가짜 모델 오류도 현재 ModelError로 전달하고 알 수 없는 오류는 바꾸지 않는다", async () => {
  const foreign = Object.assign(new Error("검증용 사용량 제한"), { name: "ModelError", code: "usage_limit" });
  assert.equal(foreign instanceof ModelError, false);
  setFakeModelResponder(() => { throw foreign; });
  try {
    await assert.rejects(askNote(caller, { sourceId: "src_foreign_fault", page: 1, quote: "BFS" }),
      (error: unknown) => error instanceof ModelError && error.code === "usage_limit" && error.message === foreign.message);
    const unknown = Object.assign(new Error("검증용 알 수 없는 오류"), { name: "ModelError", code: "other" });
    setFakeModelResponder(() => { throw unknown; });
    await assert.rejects(askNote(caller, { sourceId: "src_foreign_fault", page: 1, quote: "BFS" }),
      (error: unknown) => error === unknown);
  } finally { setFakeModelResponder(null); }
});

test("문구 비교와 답 읽기 규칙", () => {
  assert.equal(phraseKey(" View\n Volume "), phraseKey("view volume"));
  assert.throws(() => readAnswer({ kind: "term" }), /lead/);
  assert.deepEqual(readAnswer({ kind: "odd", lead: " 뜻 ", steps: [{ step: "a", why: 1 }, { nope: true }] }).answer.steps, [{ step: "a", why: "" }]);
  assert.equal(readAnswer({ kind: "odd", lead: "뜻" }).kind, "term");
  assert.equal(WEAK_AFTER, 3);
});
