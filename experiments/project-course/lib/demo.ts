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
  await rm(ws, { recursive: true, force: true });
  if (await exists(path.join(dir, "workspace"))) await cp(path.join(dir, "workspace"), ws, { recursive: true });
  else await mkdir(ws, { recursive: true });
  await chats.setChatWorkspace(chat.id, ws);
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
  await (await import("./learn.ts")).markChatFolder(ws).catch(() => undefined);
  await setActive(run.id);
  return { runId: run.id, chatId: chat.id, workspace: ws };
}

export async function demoList() {
  const names = await readdir(DEMO).catch(() => [] as string[]);
  return { demos: await Promise.all(names.map(async (n) => JSON.parse(await readFile(path.join(DEMO, n, "meta.json"), "utf8").catch(() => "{}")))) };
}
