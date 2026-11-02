// 초보 시나리오 끝까지(설계안 16장 6번, 11/3): 목표 → 코스 생성 → 1단계 → 질문(임시 학습) → 돌아가기 → 틀린 저장 3번 →
// 원인 찾기 제안 → 원인부터 → 고쳐서 통과 → 학습 사건 · 레벨 · 재개 요약 → 2단계(뒤에서 만들어 둠) 시작. 가짜 AI, 실제 서버.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4183;
const B = `http://127.0.0.1:${PORT}`;
const api = async (m: string, p: string, b?: unknown) => {
  const r = await fetch(B + p, { method: m, headers: { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p} ${JSON.stringify(b)} ${r.status} ${JSON.stringify(j)}`);
  return j;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("초보 시나리오: 생성 → 질문 → 막힘 → 원인 찾기 → 통과 → 기록 → 다음 단계", { timeout: 240000 }, async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), "pc-scn-"));
  const srv = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "server/main.ts"], {
    cwd: ROOT, env: { ...process.env, PC_FAKE_AI: "1", PC_DATA_DIR: data, PC_PORT: String(PORT), PC_FLOAT: "0", PC_RECALL: "0" }, stdio: "ignore" });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`${B}/api/status`); break; } catch { await sleep(200); } }

    // 1) 목표 → 코스 생성
    const { id } = await api("POST", "/api/generate", { goal: "이름 부르는 인사 서버를 만들고 싶어요" });
    let st;
    for (let i = 0; i < 200; i++) { st = await api("GET", `/api/generate/${id}`); if (st.ready?.includes(1) || st.phase === "failed") break; await sleep(300); }
    assert.ok(st.ready?.includes(1), st.message);
    const { runId, workspace } = await api("POST", "/api/quickstart", { courseId: id });
    const L = `/api/runs/${runId}/lesson/1`;
    const wait = async () => { let v; for (let i = 0; i < 100 && (v = await api("GET", L)).busy; i++) await sleep(200); return v; };
    let v = await api("GET", L);
    assert.equal(v.steps[0].label, "읽기");
    assert.match(v.messages.at(-1).text, /이걸 하려면 뭐가 필요할까요/);

    // 2) 필요한 것 하나는 "알아요"로 넘기고, 예측까지
    await api("POST", L + "/act", { do: "next" });
    await api("POST", L + "/act", { do: "known" });
    v = await api("GET", L);
    assert.equal(v.steps[v.beat].label, "예측");
    await api("POST", L + "/act", { do: "choice", choice: 1 });

    // 3) 질문 → 임시 학습 → 돌아가기
    await api("POST", L + "/act", { do: "ask", text: "query가 뭐예요?" });
    v = await wait();
    assert.equal(v.session.detours.length, 1);
    assert.ok(v.resumable);
    await api("POST", L + "/act", { do: "resume" });
    v = await api("GET", L);
    assert.equal(v.session.detours.length, 0);
    assert.equal(v.session.activity.type, "verify");

    // 4) 보내 보기 → 고칠 곳 → 고치기(처음이라 "같이 해요"를 먼저 권함)
    await api("POST", L + "/act", { do: "start_dev,try" }); v = await wait();
    assert.equal(v.steps[v.beat].label, "읽기", "보내 본 뒤 고칠 곳 보기로");
    await api("POST", L + "/act", { do: "next" });
    v = await api("GET", L);
    assert.equal(v.steps[v.beat].label, "고치기");
    assert.equal(v.messages.at(-1).actions[0].do, "mode_pair", "L0이면 같이 해요가 먼저");
    await api("POST", L + "/act", { do: "mode_self" });

    // 5) 틀린 저장 3번 → 원인 찾기 제안
    const f = path.join(workspace, "src/routes/hello.ts");
    const start = await readFile(f, "utf8");
    for (let i = 0; i < 3; i++) {
      await writeFile(f, start.replace('sendJson(res, 200, { message: "안녕" });', `sendJson(res, 200, { message: "안녕${i}" });`));
      await sleep(1500); await wait();
      await api("POST", L + "/act", { do: "check" }); await wait();
    }
    v = await api("GET", L);
    const offer = [...v.messages].reverse().find((m: { actions?: { do: string }[] }) => m.actions?.some((a) => a.do === "diagnose"));
    assert.ok(offer, "3번 연속 실패하면 원인 찾기를 먼저 제안");
    await api("POST", L + "/act", { do: "diagnose" }); v = await wait();
    await api("POST", L + "/act", { do: "resume" });

    // 6) 고쳐서 통과
    await writeFile(f, start.replace('  // TODO(1단계): 이름이 없으면 400, 있으면 "안녕, 이름"\n  sendJson(res, 200, { message: "안녕" });', '  if (!name) { sendJson(res, 400, { error: "x" }); return; }\n  sendJson(res, 200, { message: `안녕, ${name}` });'));
    await sleep(1500); await wait();
    await api("POST", L + "/act", { do: "check" }); v = await wait();
    assert.equal(v.steps[v.beat].label, "내 말로", "통과하면 다음 걸음");

    // 7) 학습 사건: 누가 했는지까지
    const ev = (await readFile(path.join(data, "events", `${runId}.jsonl`), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    const kinds = ev.map((e: { type: string; actor: string }) => `${e.type}/${e.actor}`);
    for (const k of ["self_report/user", "verify/user", "question/user", "navigate/user", "confusion/system", "confusion/user", "execution/system", "application/user"]) assert.ok(kinds.includes(k), `사건 ${k}`);

    // 8) 2단계는 뒤에서 만들어 둠 → 시작
    await api("POST", L + "/act", { do: "explain_skip" });
    v = await api("GET", L);
    assert.ok(v.next && v.next.n === 2);
    let started = false;
    for (let i = 0; i < 100 && !started; i++) { try { await api("POST", `/api/runs/${runId}/stage/2/start`, {}); started = true; } catch { await sleep(400); } }
    assert.ok(started, "2단계가 준비되어 시작");
    const v2 = await api("GET", `/api/runs/${runId}/lesson/2`);
    assert.match(v2.title, /방명록/);
  } finally { srv.kill(); }
});
