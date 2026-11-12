// 시연 준비 (11/13 사용자 "내일 와서 하면 바로 가능하게, 세팅도 재현 가능하게" — A가 [경계]로 더함).
// 실습 하나의 지금 상태(목표 · 막힌 순간 · 기록 · 작업 폴더)를 틀로 떠 두었다가, 시연 전에 "시연용 실습" 하나를 그 틀로 되돌린다.
// 시연용 실습은 늘 같은 하나(id를 틀에 적어 둠)라 목록이 늘지 않는다. 되돌릴 때마다 대화는 새로 열어(튜터가 앞 리허설을 기억하지 않게)
// 빈 대화로 시작하고, 작업 폴더는 틀의 코드로 통째로 바꾼다. 학습자 메모리 · 학습 기록(사람 단위)도 틀 때 것으로 되돌린다.
//   POST /api/dev/demo/save  { name, run }   지금 실습 run을 틀 name으로
//   POST /api/dev/demo/reset { name }        시연용 실습을 틀로 되돌리고 그 실습을 연다
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DATA, PRACTICE, addRun, getRun, runs, saveRun, setActive, type Run } from "./store.ts";

const DEMO = path.join(DATA, "demo");
const perRun = (id: string) => [
  `goals/${id}.json`, `goals/${id}.ongoing.json`, `goals/${id}.records.json`, `goals/${id}.saves.jsonl`, `goals/${id}.seen.json`, `goals/${id}.timeline.jsonl`,
  `gaps/${id}.json`, `moments/${id}.json`, `shell/${id}.json`, `sync/${id}.json`,
];
const GLOBAL = ["learner-memory.json", "history.jsonl"];
const skip = (p: string) => /[\\/](bin|obj|\.git|node_modules|\.vs)([\\/]|$)/.test(p);
const exists = (p: string) => stat(p).then(() => true, () => false);
type Meta = { name: string; fromRun: string; fromChat?: string; savedAt: string; demoRun?: string };

export async function demoSave(name: string, runId: string) {
  if (!/^[\w-]+$/.test(name)) throw Object.assign(new Error("틀 이름은 영문 · 숫자로"), { status: 400 });
  const run = await getRun(runId);
  const dir = path.join(DEMO, name);
  const old: Meta | null = await readFile(path.join(dir, "meta.json"), "utf8").then((t) => JSON.parse(t), () => null);
  await rm(dir, { recursive: true, force: true });
  for (const rel of perRun(run.id)) {
    const from = path.join(DATA, rel);
    if (await exists(from)) { const to = path.join(dir, "run", rel.replace(run.id, "RUN")); await mkdir(path.dirname(to), { recursive: true }); await cp(from, to); }
  }
  for (const g of GLOBAL) if (await exists(path.join(DATA, g))) { await mkdir(path.join(dir, "global"), { recursive: true }); await cp(path.join(DATA, g), path.join(dir, "global", g)); }
  const ws = run.workspaces.chat;
  if (ws && await exists(ws)) await cp(ws, path.join(dir, "workspace"), { recursive: true, filter: (s) => !skip(s) });
  // 대화 첫머리(처음 한 말 + 튜터 첫 답): 목록 제목이 같고, 튜터도 무엇을 만들려는지 안다
  if (run.chatId) {
    const c = JSON.parse(await readFile(path.join(DATA, "agent-chat", `${run.chatId}.json`), "utf8").catch(() => "null")) as { messages?: Array<{ role?: string }> } | null;
    const ms = c?.messages ?? [], u = ms.findIndex((m) => m.role === "user"), a = ms.findIndex((m, i) => i > u && m.role === "assistant");
    if (u >= 0) await writeFile(path.join(dir, "chat-head.json"), JSON.stringify(ms.slice(0, (a > u ? a : u) + 1), null, 1));
  }
  const meta: Meta = { name, fromRun: run.id, ...(run.chatId ? { fromChat: run.chatId } : {}), savedAt: new Date().toISOString(), ...(old?.demoRun ? { demoRun: old.demoRun } : {}) };
  await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 1));
  return { saved: name, from: run.id, files: (await readdir(path.join(dir, "run"), { recursive: true }).catch(() => [])).length };
}

export async function demoReset(name: string) {
  const dir = path.join(DEMO, name);
  const meta: Meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8").catch(() => { throw Object.assign(new Error(`시연 틀 "${name}"이 없어요.`), { status: 404 }); }));
  const chats = await import("./agent-chat.ts");
  // 새 대화(빈 대화) + 시연용 작업 폴더(틀 코드로 통째로)
  const chat = await chats.newChat({ course: null });
  const ws = path.join(PRACTICE, `demo-${name}`);
  // 폴더 자체는 두고 안만 비운다(편집기 · 터미널이 그 폴더를 열고 있으면 폴더 지우기가 막힌다, 11/13 EBUSY)
  await mkdir(ws, { recursive: true });
  for (const e of await readdir(ws)) await rm(path.join(ws, e), { recursive: true, force: true }).catch(() => undefined);
  if (await exists(path.join(dir, "workspace"))) await cp(path.join(dir, "workspace"), ws, { recursive: true, force: true });
  await chats.setChatWorkspace(chat.id, ws);
  const head = JSON.parse(await readFile(path.join(dir, "chat-head.json"), "utf8").catch(() => "[]")) as unknown[];
  if (head.length) {
    const cf = path.join(DATA, "agent-chat", `${chat.id}.json`);
    const c = JSON.parse(await readFile(cf, "utf8")) as { messages: unknown[] };
    c.messages = head; await writeFile(cf, JSON.stringify(c, null, 1));
  }
  { // 시연: 튜터는 파일을 고치지 않는다(학습자가 직접) — "고쳐도 될까요?" 물음이 매번 뜨지 않게 정해 둔다
    const cf = path.join(DATA, "agent-chat", `${chat.id}.json`);
    const c = JSON.parse(await readFile(cf, "utf8")) as { edit?: "allow" | "deny" };
    c.edit = "deny"; await writeFile(cf, JSON.stringify(c, null, 1));
  }
  await rm(chat.workspace, { recursive: true, force: true }).catch(() => undefined); // newChat이 만든 빈 폴더
  const now = new Date().toISOString();
  let run: Run | undefined = meta.demoRun ? (await runs()).runs.find((r) => r.id === meta.demoRun) : undefined;
  if (run) {
    run = await saveRun(run.id, (r) => { r.chatId = chat.id; r.workspaces = { chat: ws }; delete (r as { endedAt?: string }).endedAt; r.createdAt = now; });
  } else {
    const base = await getRun(meta.fromRun).catch(() => null);
    run = { id: randomBytes(5).toString("hex"), courseId: "chat", createdAt: now, plan: base?.plan ?? { start: 1, stages: [1], quick: [], transfer: false, reasons: ["대화로 배우기"], notes: [], minutes: 0 },
      current: 1, workspaces: { chat: ws }, stages: {}, free: true, chatId: chat.id } as Run;
    await addRun(run);
    meta.demoRun = run.id;
    await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 1));
  }
  // 실습 한 판 파일: 틀에 있는 것은 틀대로(원래 실습 id · 대화 id는 시연용 것으로 바꿈), 없는 것은 지움
  const swap = (t: string) => { let s = t.split(meta.fromRun).join(run!.id); if (meta.fromChat) s = s.split(meta.fromChat).join(chat.id); return s; };
  for (const rel of perRun(run.id)) {
    const to = path.join(DATA, rel), from = path.join(dir, "run", rel.replace(run.id, "RUN"));
    if (await exists(from)) { await mkdir(path.dirname(to), { recursive: true }); await writeFile(to, swap(await readFile(from, "utf8"))); }
    else await rm(to, { force: true });
  }
  for (const g of GLOBAL) { const from = path.join(dir, "global", g); if (await exists(from)) await writeFile(path.join(DATA, g), await readFile(from)); }
  // 지금 목표를 "방금 시작한" 상태로: 틀 시각 뒤에 쌓인 것(그 목표를 하던 흔적)은 빼고, 목표 시작 시각을 지금으로.
  // 그래야 목표 정리 · 막힌 순간이 이번 시연에서 한 것만 본다.
  const goalsFile = path.join(DATA, `goals/${run.id}.json`);
  const g = JSON.parse(await readFile(goalsFile, "utf8").catch(() => "null")) as { current?: { at?: string; understood?: boolean; applied?: boolean } } | null;
  const cut = g?.current?.at;
  if (g?.current && cut) {
    const later = (at?: string) => Boolean(at && at > cut);
    for (const rel of [`goals/${run.id}.timeline.jsonl`, `goals/${run.id}.saves.jsonl`]) {
      const f = path.join(DATA, rel);
      if (!(await exists(f))) continue;
      const lines = (await readFile(f, "utf8")).split("\n").filter((l) => { if (!l.trim()) return false; try { const x = JSON.parse(l) as { at?: string }; return !later(x.at); } catch { return true; } });
      await writeFile(f, lines.length ? lines.join("\n") + "\n" : "");
    }
    const mf = path.join(DATA, `moments/${run.id}.json`);
    if (await exists(mf)) {
      const m = JSON.parse(await readFile(mf, "utf8")) as { moments?: Array<{ openedAt?: string }> };
      if (Array.isArray(m.moments)) { m.moments = m.moments.filter((x) => !later(x.openedAt)); await writeFile(mf, JSON.stringify(m, null, 1)); }
    }
    const hf = path.join(DATA, "history.jsonl"); // 사람 단위 기록에서도 그 목표를 하던 흔적(원래 실습의 것)은 뺀다
    if (await exists(hf)) {
      const keep = (await readFile(hf, "utf8")).split("\n").filter((l) => { if (!l.trim()) return false; if (!l.includes(meta.fromRun)) return true; try { return !later((JSON.parse(l) as { at?: string }).at); } catch { return true; } });
      await writeFile(hf, keep.length ? keep.join("\n") + "\n" : "");
    }
    await rm(path.join(DATA, `goals/${run.id}.ongoing.json`), { force: true });
    g.current.at = now; g.current.understood = false; g.current.applied = false;
    await writeFile(goalsFile, JSON.stringify(g, null, 1));
  }
  await (await import("./learn.ts")).markChatFolder(ws).catch(() => undefined);
  await setActive(run.id);
  return { runId: run.id, chatId: chat.id, workspace: ws };
}

export async function demoList() {
  const names = await readdir(DEMO).catch(() => [] as string[]);
  return { demos: await Promise.all(names.map(async (n) => JSON.parse(await readFile(path.join(DEMO, n, "meta.json"), "utf8").catch(() => "{}")))) };
}
