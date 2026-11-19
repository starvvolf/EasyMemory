// 기억 도서관(2026-11-11 사용자 "기억을 다시 보는 도서관"): 앱의 기억 화면 › 실습이 여기서 읽는다.
// 목록 = 대화 실습 하나에 한 줄, 본문 = 실습 한 판 정리(지나온 목표 · 기억 카드 · 막힌 순간 · 부족했던 것 · 받아 쓴 것).
// 전부 이미 있는 기록을 모아 보여 줄 뿐이다(새로 쌓는 것 없음, AI 없음).
import { runs } from "./store.ts";

type RunLite = { id: string; createdAt?: string; endedAt?: string; chatId?: string; codexId?: string };
const isChat = (r: RunLite) => Boolean(r.chatId || r.codexId);

export async function libraryList() {
  const G = await import("./goals.ts"), GR = await import("./goal-record.ts"), M = await import("./moments.ts"), L = await import("./gaps.ts");
  const all = ((await runs()).runs as RunLite[]).filter(isChat);
  const rows = await Promise.all(all.map(async (r) => {
    const [g, recs, ms, gaps] = await Promise.all([G.goalsOf(r.id).catch(() => null), GR.recordsOf(r.id).catch(() => []), M.momentsOf(r.id).catch(() => []), L.ledgerOf(r.id).catch(() => [])]);
    const title = g?.long?.text || recs[0]?.goal || g?.current?.title || "";
    const cards = recs.reduce((n, x) => n + (x.cards?.length ?? 0), 0);
    const lastAt = [r.endedAt, recs.at(-1)?.to, ms.at(-1)?.openedAt, r.createdAt].filter(Boolean).sort().at(-1) ?? "";
    return { id: r.id, title, createdAt: r.createdAt ?? "", lastAt, ended: Boolean(r.endedAt), goals: recs.length, cards, moments: ms.length, gaps: gaps.length };
  }));
  // 아무 일도 없던 빈 실습(목표 · 기록 하나 없음)은 도서관에 안 꽂는다
  return { runs: rows.filter((x) => x.title || x.goals || x.moments).sort((a, b) => b.lastAt.localeCompare(a.lastAt)) };
}

export async function libraryRun(runId: string) {
  const G = await import("./goals.ts"), GR = await import("./goal-record.ts"), M = await import("./moments.ts"), L = await import("./gaps.ts");
  const [g, recs, ms, note] = await Promise.all([G.goalsOf(runId), GR.recordsOf(runId).catch(() => []), M.momentsView(runId).catch(() => ({ moments: [] })), L.sessionNote(runId).catch(() => null)]);
  const chunks = Object.values(g.chunks ?? {}).filter((c) => c.result || c.debts?.length).map((c) => ({ name: c.name, result: c.result ?? null, debts: c.debts ?? [] }));
  return {
    runId, title: g.long?.text ?? "", map: (g.map ?? []).map((x) => x.title), current: g.current?.title ?? null,
    // 이 실습에서 만든 것(11/12): 학습자가 마지막으로 성공해 돌린 명령과 그 화면(코드가 셸 기록에서)
    demo: await (async () => { const h = (await (await import("./shell.ts")).shellOf(runId).catch(() => ({ history: [] as { by: string; code: number | null; out: string; command: string }[] }))).history;
      const r = [...h].reverse().find((x) => x.by === "learner" && x.code === 0 && x.out.trim()); return r ? { command: r.command.slice(0, 120), out: r.out.trim().split("\n").slice(-10).join("\n").slice(-600) } : null; })(),
    goals: recs.map((x) => ({ goal: x.goal, done: x.done, status: x.status, summary: x.summary, steps: x.steps, from: x.from, to: x.to,
      review: x.review ?? null, cards: (x.cards ?? []).map((c) => ({ name: c.name, situation: c.situation, did: c.did, quote: c.verified ? c.quote : "", learned: c.learned, next: c.next, how: c.how, recheck: c.recheck?.q ?? "" })) })),
    // 실습 정리(교과서식, 11/20): 이 실습에서 저장한 코드 파일의 마지막 모습(핵심 로직을 코드 칸에 고르게)
    code: await finalCode(runId).catch(() => [] as { file: string; text: string }[]),
    path: note?.path ?? [], moments: ms.moments, chunks, ongoing: await GR.ongoingOf(runId).catch(() => null), scenes: await scenesOf(runId, recs.map((x) => ({ goal: x.goal, from: x.from, to: x.to }))),
  };
}

/* ---------- 장면 복기(11/11 사용자 "오답 노트 · 풀이 노트 · 일기장 … 내가 공부하던 장면을 복기할 수 있게") ----------
 * 타임라인 칸(학습자 말 · 버튼 · 저장 · 터미널 + 튜터 답 · 도구)과 저장본 차이를 시간순으로 펼치고, 그때의 현재 목표로 장(章)을 나눈다. 코드만, AI 없음. */
export type SceneEv = { g?: number; at: string; kind: "me" | "tutor" | "button" | "cmd" | "save" | "note"; text: string; tools?: string[]; ok?: boolean; diff?: string[]; file?: string; err?: string };
export type Chapter = { goal: string; from: string; to: string; events: SceneEv[] };
export async function scenesOf(runId: string, recs: { goal: string; from: string; to: string }[]): Promise<Chapter[]> {
  const TL = await import("./timeline.ts"), GR = await import("./goal-record.ts"), M = await import("./moments.ts");
  const [steps, saves, ms] = await Promise.all([TL.stepsOf(runId).catch(() => []), GR.savesOf(runId).catch(() => []), M.momentsOf(runId).catch(() => [])]);
  const chapters: Chapter[] = [];
  let prevGoal = "";
  const chapterFor = (goal: string, at: string) => {
    let c = chapters.at(-1);
    if (!c || c.goal !== goal) { c = { goal, from: at, to: at, events: [] }; chapters.push(c); }
    c.to = at; return c;
  };
  for (const st of steps) {
    // 그 행동을 할 때의 목표 = 바로 앞 칸 뒤의 상태(첫 칸은 자기 상태)
    const goal = prevGoal || st.state?.current?.title || "";
    prevGoal = st.state?.current?.title ?? prevGoal;
    const t = st.trigger, label = t.label ?? "";
    if (/^목표 정리:/.test(label)) continue; // 정리는 장 머리에 따로 붙는다
    const c = chapterFor(goal, st.at);
    if (t.kind === "message") c.events.push({ at: st.at, kind: "me", text: t.text ?? "" });
    else if (t.kind === "save") {
      const f = label.replace(/^저장:\s*/, "");
      const i = saves.findIndex((x) => x.file === f && Math.abs(Date.parse(x.at) - Date.parse(st.at)) < 5000);
      const before = i > 0 ? [...saves.slice(0, i)].reverse().find((x) => x.file === f)?.text ?? "" : "";
      c.events.push({ at: st.at, kind: "save", text: `${f} 저장`, file: f, diff: i >= 0 ? GR.lineDiff(before, saves[i].text).slice(0, 14) : [] });
    } else if (/^터미널:/.test(label)) {
      const code = (st.extra as { exitCode?: number | null } | undefined)?.exitCode;
      const cmd = label.replace(/^터미널:\s*/, ""), ok = typeof code === "number" ? code === 0 : undefined;
      // 실패한 명령의 오류 한 줄은 막힌 순간 장부에 있다(같은 명령, 몇 초 안)
      const m = ok === false ? ms.find((x) => x.command && cmd.startsWith(x.command.slice(0, 60)) && Math.abs(Date.parse(x.openedAt) - Date.parse(st.at)) < 5000) : undefined;
      c.events.push({ at: st.at, kind: "cmd", text: cmd, ok, ...(m?.error ? { err: m.error } : {}) });
    } else if (t.kind === "button") c.events.push({ at: st.at, kind: "button", text: t.text ? `${label} · ${t.text}` : label });
    else c.events.push({ at: st.at, kind: "note", text: label });
    // 큰 바뀜(장기 목표 · 로드맵 · 보충 · 어려움 표시)은 회색 한 줄로: 일지가 "왜 바꿨나"를 읽는 근거
    for (const ch of st.changes ?? []) if (/^(장기 목표|로드맵:|보충 로드맵 생김|보충 끝|보충 다시|어려움 표시|계획 제안)/.test(ch)) c.events.push({ at: st.endAt || st.at, kind: "note", text: ch.slice(0, 200) });
    if (st.reply?.trim() || st.tools?.length) c.events.push({ at: st.endAt || st.at, kind: "tutor", text: (st.reply ?? "").trim().slice(0, 2400), tools: (st.tools ?? []).slice(0, 8) });
  }
  for (const c of chapters) c.events.sort((a, b) => a.at.localeCompare(b.at));
  // 같은 버튼을 연달아 여러 번(다이얼 돌려 보기 등)은 마지막 하나만
  for (const c of chapters) c.events = c.events.filter((e, i, xs) => !(e.kind === "button" && xs[i + 1]?.kind === "button" && xs[i + 1].text.split(" · ")[0] === e.text.split(" · ")[0]));
  // 타임라인이 없던 예전 실습: 목표 정리 시각으로 빈 장이라도
  if (!chapters.length) return recs.map((r) => ({ goal: r.goal, from: r.from, to: r.to, events: [] }));
  // 기록 번호(g): 장면마다 붙는 번호. 장을 건너 이어 센다
  let g = 0;
  const out = chapters.filter((c) => c.events.length);
  for (const c of out) for (const e of c.events) e.g = g++;
  return out;
}

/** 이 실습 작업 폴더의 소스 파일 지금 모습(11/20: 저장 기록에는 편집기 밖에서 고친 파일이 빠져 결제 서버 실습의 핵심 코드가 없었다).
 * 저장 기록에 있는 파일을 먼저, 그다음 작업 폴더의 다른 소스 파일을 최근에 고친 순으로. 빌드 · 패키지 폴더는 건너뛴다.
 * 8개 · 파일당 200줄 · 합쳐 24,000자까지. 코드만, AI 없음. */
const SRC = /\.(java|kt|cs|py|js|jsx|ts|tsx|go|rs|c|cc|cpp|h|hpp|rb|php|swift|sql)$/i;
const SKIP_DIR = new Set(["node_modules", ".git", "build", "target", "bin", "obj", "out", "dist", ".gradle", ".idea", ".vscode", "__pycache__", ".venv", "venv", ".next", "postgres-data"]);
export async function finalCode(runId: string) {
  const { readFile, readdir, stat } = await import("node:fs/promises"), path = await import("node:path");
  const ws = await (await import("./goals.ts")).runWorkspace(runId);
  if (!ws) return [];
  const root = path.resolve(ws);
  const found: { rel: string; mtime: number }[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > 8 || found.length > 400) return;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory()) { if (!SKIP_DIR.has(e.name) && !e.name.startsWith(".")) await walk(path.join(dir, e.name), depth + 1); continue; }
      if (!e.isFile() || !SRC.test(e.name) || /\.test\.|Test\.java$|\.d\.ts$/.test(e.name)) continue;
      const abs = path.join(dir, e.name);
      const st = await stat(abs).catch(() => null);
      if (st && st.size < 200_000) found.push({ rel: path.relative(root, abs).split(path.sep).join("/"), mtime: st.mtimeMs });
    }
  };
  await walk(root, 0);
  const saved = (await (await import("./goal-record.ts")).savesOf(runId).catch(() => [])).map((x) => x.file.replace(/\\/g, "/"));
  const rank = (r: string) => (saved.includes(r) ? 1 : 0);
  found.sort((a, b) => rank(b.rel) - rank(a.rel) || b.mtime - a.mtime);
  const out: { file: string; text: string }[] = [];
  let size = 0;
  for (const f of found) {
    if (out.length >= 8) break;
    const text = await readFile(path.join(root, f.rel), "utf8").catch(() => null);
    if (text == null || !text.trim()) continue;
    const t = text.split(/\r?\n/).slice(0, 200).join("\n");
    if (size + t.length > 24_000) continue;
    size += t.length; out.push({ file: f.rel, text: t });
  }
  return out;
}
