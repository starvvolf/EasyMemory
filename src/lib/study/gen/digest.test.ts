import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGen, readGenCalls, runGen } from "./runner.ts";
import { batchLines, digestOverlaps, digestText, pageList, parseSkeleton, parseTopic, settleSkeleton, topicPages } from "./digest.ts";
import { cardLine } from "./cards.ts";

// Invented public pages (not lecture material).
const pages = new Map([
  [1, "# Back-Face Detection\n- A polygon is a back face if its normal points away from the viewer"],
  [2, "# Depth-Buffer Method\n- A surface is drawn only where its depth is smaller than the stored depth"],
  [3, "# Scan-Line Method\n- Each scan line keeps a list of the edges it crosses"],
]);
async function withData<T>(run: () => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "recaller-digest-"));
  const prior = process.env.STUDY_FORGE_DATA_DIR;
  process.env.STUDY_FORGE_DATA_DIR = dir;
  try { return await run(); } finally {
    if (prior === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = prior;
    await rm(dir, { recursive: true, force: true });
  }
}

test("요약 → 카드 뼈대: lines are read as they come, and every page ends up in exactly one place", () => {
  assert.deepEqual(pageList("3, 5-7, p.9"), [3, 5, 6, 7, 9]);
  const partial = parseSkeleton("개요|1, 14\nt1|개념|데드락의 정의|3,4|t2\nt2|처리|예", false);
  assert.deepEqual(partial.overview, [1, 14]);
  assert.deepEqual(partial.topics.map((t) => t.id), ["t1"], "줄이 끝나기 전의 줄은 아직 읽지 않는다");
  const parsed = parseSkeleton("개요|1\nt1|개념|정의|2,3|t2,t9\nt2|개념|조건|3,5,20|t1\nt3|처리|빈 주제||t1\nt4|처리|예방|6,7,8,9|", true);
  const s = settleSkeleton(parsed, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(s.topics.map((t) => [t.id, t.pages]), [["t1", [2, 3, 4]], ["t2", [5]], ["t4", [6, 7, 8, 9]]]);
  assert.deepEqual(s.topics[0].related, ["t2"], "없는 주제 id는 뺀다");
  assert.equal(new Set(s.topics.map((t) => t.domain)).size, 3, "주제마다 다른 생활 영역");
  assert.ok(s.problems.some((x) => x.includes("p.20")) && s.problems.some((x) => x.includes("p.4")) && s.problems.some((x) => x.includes("t4: 4쪽")), s.problems.join(" / "));
  assert.deepEqual(topicPages(s.topics[1], s.topics), [2, 3, 4, 5]);
});

test("요약 → 카드 주제 글: body lines until <<<EASY>>>, the analogy of each line, 2–3 lines a batch, overlaps across topics", () => {
  const text = ["[t2-b1] 상호 배제: 자원을 한 번에 하나만 씀. (p.5)", "- [t2-b2] **점유 대기**: 가진 채 기다림. (p.5, 6)", "[t1-b1] 남의 줄: 무시. (p.3)", "<<<EASY>>>",
    "한마디로: 네 조건이에요. 왜일까요?", "장면: 교통 장면이에요.", "안 맞는 점: 차는 조금씩 움직여요.", "[t2-b1] 상호 배제: 화장실 한 칸이에요.", "흔한 오해: 하나만 깨면 된다고 생각해요 (p.5).", "마무리: 넷 다예요.",
    "<<<EXTRA>>>", "### 스스로 확인"].join("\n");
  const t = parseTopic("t2", text);
  assert.deepEqual(t.body.map((l) => [l.id, l.name, l.pages]), [["t2-b1", "상호 배제", [5]], ["t2-b2", "점유 대기", [5, 6]]]);
  assert.equal(t.easy?.analogies["t2-b1"], "화장실 한 칸이에요.");
  assert.equal(t.easy?.breaks, "차는 조금씩 움직여요.");
  assert.match(t.easy!.mistake, /하나만 깨면/);
  assert.equal(parseTopic("t2", text.slice(0, text.indexOf("<<<EASY>>>"))).closed, false);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((n) => batchLines(Array.from({ length: n }, (_, i) => i)).map((b) => b.length)), [[1], [2], [3], [2, 2], [3, 2], [3, 3], [3, 2, 2]]);
  const overlaps = digestOverlaps([{ id: "t1.1c1", title: "사이클과 데드락 판정", shape: { form: "rule" } }, { id: "t1.1c2", title: "사이클과 데드락 판정", shape: { form: "rule" } },
    { id: "t6.1c1", title: "사이클과 데드락 판정", shape: { form: "rule" } }], (id) => id.split(".")[0]);
  assert.deepEqual(overlaps.map((o) => [o.a, o.b]), [["t1.1c1", "t6.1c1"], ["t1.1c2", "t6.1c1"]], "같은 주제 안은 후보가 아니다");
  // A term card whose title is its name does not print the name twice (4차 B6).
  assert.equal(cardLine({ id: "c1", kind: "용어", title: "System modeling", weight: "핵심", shape: { form: "term", name: "System modeling", symbol: "", definition: "자원과 프로세스로 본다", neighbors: [] },
    evidence: [{ page: 4, quote: "" }], mistakes: [], links: [], takes: [], gives: [] }), "[용어] System modeling: 자원과 프로세스로 본다");
});

test("lab.digest: skeleton → topics as sections → cards from summary lines, every line covered, notes on every card", () => withData(async () => {
  const io = { pdf: async () => null, pages: async () => pages };
  const start = await createGen({ sourceId: "src_digest_fixture", fileName: "invented.pdf", pageNumbers: [1, 2, 3], purpose: "core", engine: "recaller", provider: "fake", questionsLater: true, lab: { digest: true } });
  const done = await runGen(start.id, { uid: "local-experiment" }, io);
  assert.equal(done.status, "done", done.message);
  const d = done.recaller!.digest!;
  assert.equal(d.skeleton.status, "done");
  assert.deepEqual(done.sections.map((s) => s.id), ["t1", "t2", "t3"]);
  assert.deepEqual(done.sections.map((s) => s.title), ["Back-Face Detection", "Depth-Buffer Method", "Scan-Line Method"]);
  assert.ok(Object.values(d.topics).every((t) => t.status === "done" && t.body.length > 0 && t.easy));
  assert.equal(d.wrap?.status, "done");
  assert.deepEqual(d.checks.uncovered, []);
  assert.deepEqual(d.checks.outsideInput, []);
  assert.deepEqual(d.checks.outsideRange, []);
  const cards = done.sections.flatMap((s) => done.recaller!.units[s.id].cards ?? []);
  assert.ok(cards.length >= 3);
  assert.ok(cards.every((c) => d.notes[c.id]?.covers.length && d.notes[c.id].analogy && d.notes[c.id].mistake), JSON.stringify(d.notes));
  const steps = (await readGenCalls(done.id)).map((c) => c.step);
  assert.equal(steps.filter((s) => s === "rc-skeleton").length, 1);
  assert.equal(steps.filter((s) => s === "rc-topic").length, 3);
  assert.ok(steps.includes("rc-digest-card") && steps.includes("rc-wrap"));
  assert.ok(!steps.includes("rc-organize"), "쪽 정리는 하지 않는다");
  assert.ok(!steps.includes("rc-intent"));
  assert.match(digestText(d), /^가짜 개요[\s\S]*## 가짜 큰 주제[\s\S]*### Back-Face Detection[\s\S]*쉬운 설명[\s\S]*## 핵심 정리/);
}));
