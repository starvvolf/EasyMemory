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
    goals: recs.map((x) => ({ goal: x.goal, status: x.status, summary: x.summary, steps: x.steps, from: x.from, to: x.to,
      cards: (x.cards ?? []).map((c) => ({ name: c.name, situation: c.situation, did: c.did, quote: c.verified ? c.quote : "", learned: c.learned, next: c.next, how: c.how, recheck: c.recheck?.q ?? "" })) })),
    path: note?.path ?? [], moments: ms.moments, chunks,
  };
}
