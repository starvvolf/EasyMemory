// 실습 갈래 상황 재현: 14 흉내 내기 · 13 넣고 돌리기 · 1 잠금 한 줄 쓰기 · 15 명령 모양 · 형식 고르기 · 빈틈 옮기기 (AI 없음, 자바스크립트 · 파이썬을 실제로 돌림)
import assert from "node:assert/strict";
import test from "node:test";
import { checkScene } from "../check.ts";
import { gradeScene } from "../grade.ts";
import { doseOf, firstState, scopeOf } from "../ladder.ts";
import type { Gap, Scene } from "../types.ts";
import { checkCommand, commandBankScene, commandShape, gradeCommand, runCommand, tokenize } from "./command.ts";
import { practiceFormats, projectReady } from "./formats.ts";
import { practiceGapId, toGap, type PracticeGapItem } from "./gaps.ts";
import { gradePracticeScene, makePracticeScene, practiceMaterial, practicePublic } from "./index.ts";
import { lockWriteScene, structureOk } from "./lock.ts";
import { checkTimeline, gradeTimeline, interleavings, makeTimelineScene, serialValue, simulate, timelineOf, CONTEXTS } from "./timeline.ts";
import { checkWhere, gradeWhere, insertGuard, normRange, pickOf, replaceRegion, whereBankScene } from "./where.ts";

const gap = (over: Partial<Gap> = {}): Gap => ({ id: "gap_aaaaaaaaaaaa", branch: "practice", kind: "순서 · 동시성", layer: 5, title: "경쟁 상태", target: "ability", missed: "읽기부터 쓰기까지 한 잠금 안에",
  wrong: "쓰기 줄에만 잠금", wrongVerified: true, kernel: { lang: "javascript", code: "await gate.run(async () => { const left = ammo; ammo = left - n; });", needs: [] }, evidence: [],
  origin: { problemId: "pr_r1", title: "FPS 목표 4", lang: "javascript" }, topic: "concurrency.lock-scope", scope: "piece", dose: { level: 1 }, state: firstState(1, 0), createdAt: "", ...over });

/* ---------- 14 시간 순서 표 ---------- */
test("시간 순서 표: 순서대로 흉내 내기 — 매번 같은 값, 규칙을 어기면 거절", () => {
  const tl = timelineOf(CONTEXTS[0]); // hp 100, A -30, B -20
  assert.equal(serialValue(tl), 50);
  const shown = simulate(tl, tl.shown);
  assert.ok(shown.ok); assert.equal(shown.final, 80, "둘 다 100을 읽고 B가 늦게 씀 → A의 30이 사라짐");
  assert.deepEqual(simulate(tl, ["A1", "A2", "A3", "B1", "B2", "B3"]), { ...simulate(tl, ["A1", "A2", "A3", "B1", "B2", "B3"]) });
  assert.equal((simulate(tl, ["A1", "A2", "A3", "B1", "B2", "B3"]) as { final: number }).final, 50);
  const bad = simulate(tl, ["A2", "A1", "A3", "B1", "B2", "B3"]);
  assert.equal(bad.ok, false); assert.match((bad as { error: string }).error, /순서대로/);
  assert.equal(simulate(tl, ["A1", "A2"]).ok, false);
  assert.equal(interleavings(tl).length, 20);
  const lose = interleavings(tl).filter((o) => { const r = simulate(tl, o); return r.ok && r.final !== 50; });
  assert.ok(lose.length > 0 && lose.length < 20);
});

test("시간 순서 표 장면: 검사 · 채점(통과 · 같은 실수 · 규칙 어김은 미확정 · 증거 없으면 같은 실수 안 냄)", () => {
  const s = makeTimelineScene(gap({ state: { ...firstState(1, 0), distance: "near" } }), "sc_000000000101", "x");
  assert.equal(s.check?.ok, true, s.check?.problems.join(" / "));
  const tl = (s.practice as { timeline: ReturnType<typeof timelineOf> }).timeline;
  assert.equal(tl.name, "ammo", "비슷하게 = 그 실습 코드의 이름(ammo) 상황");
  const right = (simulate(tl, tl.shown) as { final: number }).final, serial = serialValue(tl);
  const g = gap();
  assert.equal(gradeTimeline(s, g, JSON.stringify({ final: right, order: tl.shown })).verdict, "pass");
  assert.equal(gradeTimeline(s, g, JSON.stringify({ final: serial, order: tl.shown })).verdict, "same", "하나씩 처리한 값을 씀 = 그때 생각");
  assert.equal(gradeTimeline(s, g, JSON.stringify({ final: right, order: ["A1", "A2", "A3", "B1", "B2", "B3"] })).verdict, "same", "안 사라지는 순서 = 그때 생각");
  assert.equal(gradeTimeline(s, g, JSON.stringify({ final: right, order: ["B2", "A1", "A2", "A3", "B1", "B3"] })).verdict, "unclear");
  assert.equal(gradeTimeline(s, { wrongVerified: false }, JSON.stringify({ final: serial, order: tl.shown })).verdict, "unclear");
  const far = makeTimelineScene(gap({ state: { ...firstState(1, 0), distance: "far" } }), "sc_000000000102", "x");
  assert.notEqual((far.practice as { timeline: { name: string } }).timeline.name, "ammo", "응용 = 다른 상황");
  const pub = practicePublic(s) as { steps: Array<{ id: string }>; shown: unknown[] };
  assert.equal(pub.steps.length, 6); assert.ok(!JSON.stringify(pub).includes(`"final"`));
  assert.equal(checkTimeline({ ...s, practice: { timeline: { ...tl, steps: tl.steps.map((x) => (x.op === "calc" ? { ...x, delta: 0 } : x)) } } }).check?.ok, false, "값이 안 바뀌면 가를 수 없음");
});

/* ---------- 13 어디에 넣을까 ---------- */
test("어디에 넣을까: 넣는 자리 · 범위의 모양", () => {
  const code = "def f():\n    a = x\n    b = a\n    x = b";
  assert.equal(insertGuard(code, { before: "with g:", after: "" }, { from: 2, to: 3 }), "def f():\n    with g:\n        a = x\n        b = a\n    x = b");
  assert.equal(insertGuard("{\n  a();\n}", { before: "lock (o) {", after: "}" }, { from: 2, to: 2 }), "{\n  lock (o) {\n      a();\n  }\n}");
  assert.deepEqual(normRange("a\n\n  }\nb\n// c\n", { from: 2, to: 5 }), { from: 4, to: 4 }, "빈 줄 · 괄호 줄 · 주석 줄은 모양에서 뺌");
});

for (const lang of ["javascript", "python"]) {
  test(`어디에 넣을까(${lang}, 탄약 은행): 돌려서 정답 · 오답 모양, 다른 맞는 방법도 통과, 같은 실수 = 그때 범위`, async () => {
    const s = await checkWhere(whereBankScene(gap({ origin: { problemId: "p", title: "FPS", lang } }), "sc_000000000201")!);
    assert.equal(s.check?.ok, true, s.check?.problems.join(" / "));
    assert.deepEqual(s.inputs.map((x) => x.role), ["basic", "split", "split", "split"]);
    const g = gap();
    const m = (s.practice as { where: { region: { from: number; to: number }; mine: { from: number; to: number }; alsoRight: Array<{ code: string }> } }).where;
    assert.equal((await gradeWhere(s, g, JSON.stringify(m.region))).verdict, "pass");
    assert.equal((await gradeWhere(s, g, JSON.stringify({ from: m.region.to, to: m.region.from }))).verdict, "pass", "거꾸로 골라도 같은 범위");
    // 코드로 고칠 때 학습자는 고를 수 있는 줄 전체(pickOf, 모범 범위보다 넓음)를 바꿔 쓴다
    const pick = pickOf(m as never); const full = replaceRegion((m as unknown as { code: string }).code, m.region, m.alsoRight[0].code).split("\n");
    const delta = full.length - (m as unknown as { code: string }).code.split("\n").length;
    assert.equal((await gradeWhere(s, g, JSON.stringify({ code: full.slice(pick.from - 1, pick.to + delta).join("\n") }))).verdict, "pass", "능력 확인: 다른 맞는 방법(Interlocked 꼴)도 통과");
    assert.ok(pick.from < m.region.from || pick.to > m.region.to, "고를 수 있는 줄이 모범 범위보다 넓다(답이 드러나지 않게)");
    assert.equal((await gradeWhere(s, g, JSON.stringify(m.mine))).verdict, "same");
    assert.equal((await gradeWhere(s, g, JSON.stringify({ from: m.region.from, to: m.region.from }))).verdict, "other", "읽기 줄에만 = 다른 틀린 생각");
    assert.equal((await gradeWhere(s, g, JSON.stringify({ from: 1, to: 2 }))).verdict, "unclear", "고를 수 있는 줄 밖");
    assert.equal((await gradeWhere(s, { wrongVerified: false }, JSON.stringify(m.mine))).verdict, "unclear");
    const form = await checkWhere(whereBankScene(gap({ target: "form", origin: { problemId: "p", title: "FPS", lang } }), "sc_000000000202")!);
    assert.equal((await gradeWhere(form, g, JSON.stringify({ code: m.alsoRight[0].code }))).verdict, "unclear", "표현 확인이면 자리를 골라야 함");
    const pub = practicePublic(s) as Record<string, unknown>;
    assert.ok(!("answer" in pub) && !("mine" in pub) && typeof pub.code === "string");
  });
}

/* ---------- 1 한 줄 쓰기: 잠금(설계 8번 C# lock 예, 시험은 자바스크립트 · 파이썬) ---------- */
for (const lang of ["javascript", "python"]) {
  test(`잠금 한 줄 쓰기(${lang}): 잠금이 없으면 늘 어긋나는 준비 코드 + 구조 검사`, async () => {
    const g = gap({ kind: "문법", target: "form", origin: { problemId: "p", title: "FPS", lang } });
    const raw = lockWriteScene(g, "sc_000000000301")!;
    const s = await checkScene(raw);
    assert.equal(s.check?.ok, true, s.check?.problems.join(" / "));
    assert.deepEqual(s.inputs.map((x) => x.role), ["basic", "split", "split", "split"]);
    assert.equal(s.wrongs.length, 1, "쓰기에만 잠금도 출력은 그때 생각과 같아 한 묶음(바닥 검사 4)");
    assert.ok(structureOk(s, s.reference)); assert.ok(!structureOk(s, raw.wrongs[0].code)); assert.ok(!structureOk(s, raw.wrongs[1].code), "구조 검사는 쓰기에만 잠금도 가름");
    assert.equal((await gradeScene(s, g, s.reference)).verdict, "pass");
    assert.equal((await gradeScene(s, g, s.template!)).verdict, "same", "잠금 없이 = 그때 생각");
    // 출력은 맞지만 그 표현이 아님(다른 방법) → 실습 쪽 채점은 통과로 치지 않음
    const other = lang === "python" ? "    gate.acquire()\n    cur = count\n    time.sleep(0.02)\n    count = cur + 1\n    gate.release()" : "  await sleep(2);\n  count += 1;";
    // 바닥 채점도 구조 검사를 한다: 출력은 맞지만 그 표현이 아님 → 기록하지 않고 그 표현으로 다시(matched "structure")
    const core = await gradeScene(s, g, other); assert.equal(core.verdict, "unclear"); assert.equal(core.matched, "structure");
    assert.equal((await gradePracticeScene(s, g, other)).verdict, "unclear");
    assert.equal((await gradePracticeScene(s, g, s.reference)).verdict, "pass");
  });
}
test("잠금 한 줄 쓰기(C#): 이 컨테이너엔 dotnet이 없어 구조 검사만 — 모범 답은 맞고 그때 생각은 안 맞음", () => {
  const s = lockWriteScene(gap({ kind: "문법", target: "form", origin: { problemId: "p", title: "FPS", lang: "csharp" } }), "sc_000000000302")!;
  assert.ok(structureOk(s, s.reference)); assert.ok(!structureOk(s, s.template!)); assert.ok(!structureOk(s, s.wrongs[1].code));
  assert.match(`${s.setup}\n${s.reference}\n${s.after}`, /Thread\.Sleep\(20\)[\s\S]*static void Main/);
  assert.equal(lockWriteScene(gap({ kind: "문법", kernel: { lang: "csharp", code: "Console.WriteLine(x)", needs: [] }, title: "출력", topic: "io.print" }), "sc_000000000303"), null, "잠금 빈틈만");
});

/* ---------- 15 명령 · 설정 한 줄 ---------- */
test("명령 모양: 프로그램 이름 · 옵션 순서 · 별칭 · --a=b · 경로 · cd && 를 맞춰 비교", () => {
  assert.deepEqual(tokenize(`git commit -m "첫 커밋 이에요"`), ["git", "commit", "-m", "첫 커밋 이에요"]);
  const s = (c: string) => commandShape(c);
  assert.equal(s("dotnet run --project Server"), s("dotnet run -p ./Server/"));
  assert.equal(s("dotnet run --project Server"), s("dotnet run --project=Server"));
  assert.equal(s("dotnet run --project Server/Server.csproj"), s("dotnet run --project Server"));
  assert.equal(s("dotnet run -c Release --project Server"), s("dotnet run --project Server --configuration Release"), "옵션 순서 무관");
  assert.notEqual(s("dotnet run"), s("dotnet run --project Server"));
  assert.equal(s("python3 app.py --port 5000"), s("python app.py --port 5000"));
  assert.equal(s("npm i -D eslint"), s("npm install --save-dev eslint"));
  assert.equal(s("ls -la"), s("ls -al"), "붙여 쓴 짧은 옵션은 나눠서");
  assert.equal(s("cd Server && dotnet run"), "@Server dotnet run");
  assert.notEqual(s("node a.js b.js"), s("node b.js a.js"), "위치 인자는 순서가 뜻");
});

test("명령 한 줄 장면(서버만 실행하기 은행): 모양으로 채점", async () => {
  const g = gap({ kind: "실행 · 도구", kernel: { lang: "shell", code: "dotnet run --project Server", needs: [] } });
  const s = await checkCommand(commandBankScene(g, "sc_000000000401")!);
  assert.equal(s.check?.ok, true, s.check?.problems.join(" / "));
  assert.equal((await gradeCommand(s, g, "dotnet run -p Server")).verdict, "pass");
  assert.equal((await gradeCommand(s, g, "cd Server && dotnet run")).verdict, "pass");
  assert.equal((await gradeCommand(s, g, "dotnet run")).verdict, "same");
  assert.equal((await gradeCommand(s, g, "dotnet build Server")).verdict, "other");
  assert.equal((await gradeCommand(s, g, "dotnet test")).verdict, "unclear");
});

test("명령 한 줄: 예제 폴더에서 실제로 돌려(셸 없이) 다른 모양의 맞는 명령도 통과", async () => {
  const files = [{ path: "app.js", text: "const i = process.argv.indexOf('--name'); console.log('hi ' + (i > 0 ? process.argv[i + 1] : process.argv.find((a) => a.startsWith('--name='))?.slice(7) ?? 'nobody'));" }];
  assert.deepEqual(await runCommand("node app.js --name kim", files), { code: 0, out: "hi kim" });
  assert.equal(await runCommand("node app.js; rm -rf /", files), null, "셸 연결은 안 돌림");
  assert.equal(await runCommand("bash -c ls", files), null, "허용 목록 밖");
  const g = gap({ kind: "실행 · 도구" });
  const { commandFromReply } = await import("./command.ts");
  const s = await checkCommand(commandFromReply(g, "sc_000000000402", { story: "", ask: "", explain: "", task: "이름을 kim으로 넘겨 실행", reference: "node app.js --name kim", alsoRight: [],
    mineWhat: "옵션 이름을 빼먹음", mine: "node app.js kim", others: [], files }));
  assert.equal(s.check?.ok, true, s.check?.problems.join(" / "));
  assert.equal((await gradeCommand(s, g, "node ./app.js --name=kim")).verdict, "pass", "모양은 달라도 돌려 보니 같은 출력");
  assert.equal((await gradeCommand(s, g, "node app.js kim")).verdict, "same");
});

/* ---------- 고르기 · 빈틈 옮기기 ---------- */
test("형식 고르기(설계 4번 실습 줄): 순서 · 동시성 → 14 · 13, 응용 확인은 준비됐을 때만 16, 똑같이는 17부터", () => {
  assert.deepEqual(practiceFormats(gap()), ["timeline", "where", "why"]);
  assert.deepEqual(practiceFormats(gap({ kind: "실행 · 도구" })), ["command", "write", "error", "why"]);
  assert.deepEqual(practiceFormats(gap({ kind: "문법" })), ["write", "blank", "why"]);
  const same = gap({ state: { ...firstState(3, 0), distance: "same" }, origin: { problemId: "p", title: "t", lang: "javascript", runId: "r1", practiceGapId: "G1-abcd", file: "fire.js" } });
  assert.equal(practiceFormats(same)[0], "origin");
  const far = gap({ state: { ...firstState(1, 0), distance: "far", passes: 2 } });
  assert.equal(practiceFormats(far, { siblings: [] })[0], "project");
  assert.equal(projectReady(far, { projectTried: true }), false, "한 번만");
  assert.equal(projectReady(far, { siblings: [gap({ id: "gap_bbbbbbbbbbbb" })] }), false, "같은 주제의 다른 빈틈이 아직 통과 전");
  assert.equal(projectReady(gap({ state: { ...firstState(1, 0), distance: "near", passes: 2 } })), false);
});

test("실습 원장 칸 → 바닥의 빈틈: id는 늘 같고, 범위 · 세기는 바닥 규칙", async () => {
  const item: PracticeGapItem = { runId: "r1", id: "G1-abcd", goal: { id: "g1", title: "탄약 줄이기", done: "동시에 쏴도 맞다" }, title: "경쟁 상태", kind: "순서 · 동시성", target: "ability", topic: "concurrency.lock-scope",
    missed: "한 잠금 안에", wrong: "쓰기에만", wrongCode: "ammo = left - n;", wrongVerified: true, lang: "csharp", kernel: { lang: "csharp", code: "lock (g) { }", needs: [], check: "shape" },
    code: { file: "Fire.cs", from: 3, to: 5, save: "S2" }, evidence: [{ at: "t", from: "판정", text: "쓰기에만 잠금" }],
    signals: { wrongTries: 2, asked: 0, helpRung: 0, tutorCode: false, gaveUp: false, repeated: false }, recheck: true, status: "열림", at: "2026-11-15T00:00:00Z", enriched: true };
  const g = toGap(item, 0);
  assert.equal(g.id, practiceGapId("r1", "G1-abcd")); assert.match(g.id, /^gap_[a-f0-9]{12}$/);
  assert.equal(g.branch, "practice"); assert.equal(g.scope, scopeOf("순서 · 동시성", item.signals)); assert.equal(g.dose.level, doseOf(item.signals));
  assert.equal(g.origin.lang, "csharp"); assert.equal(g.origin.practiceGapId, "G1-abcd"); assert.equal(g.origin.file, "Fire.cs");
  assert.equal(toGap({ ...item, kernel: { ...item.kernel, check: "failed" } }).kernel.code, "", "알맹이 문법이 틀리면 보이지 않음");
  // 실습 서버가 없을 때(이 시험): 재료는 빈틈의 글로
  const m = await practiceMaterial(gap());
  assert.equal(m.title, "FPS 목표 4"); assert.match(m.statement, /읽기부터 쓰기까지/);
});

test("makePracticeScene: AI가 안 되면 은행으로 물러남(어디에 넣을까 · 명령), 못 만들면 null", async () => {
  const noAi = async () => { throw new Error("AI 없음"); };
  const w = await makePracticeScene(gap(), "where", { ask: noAi });
  assert.equal(w?.format, "where"); assert.equal(w?.check?.ok, true); assert.equal(w?.madeBy, "bank");
  const t = await makePracticeScene(gap(), "timeline");
  assert.equal(t?.format, "timeline");
  assert.equal(await makePracticeScene(gap({ origin: { problemId: "p", title: "t", lang: "cpp" } }), "where", { ask: noAi }), null, "은행에 없는 언어");
  assert.equal(await makePracticeScene(gap(), "project"), null, "응용 확인 준비 전");
  assert.equal(await makePracticeScene(gap(), "origin"), null, "저장본 위치 없음");
  const lock = await makePracticeScene(gap({ kind: "문법", target: "form" }), "write");
  assert.equal(lock?.madeBy, "bank"); assert.ok(lock?.structure?.must.length);
  const s: Scene | null = await makePracticeScene(gap({ kind: "실행 · 도구", kernel: { lang: "shell", code: "dotnet run --project Server", needs: [] } }), "command", { ask: noAi });
  assert.equal(s?.format, "command");
});
