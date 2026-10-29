// 앱 지식 저장소로 보낼 것 (2026-10-30, 사용자: "공부 탭에 프로젝트 추가하고 연결해봐").
// 이 서버는 앱 데이터에 직접 쓰지 않는다. 앱(3000)의 /api/project-course/sync가 여기서 "아직 안 보낸 것"을 받아
// 지식 저장소(saveMany·recordEvent)에 넣고, 넣은 것의 열쇠를 돌려준다(보낸 열쇠는 .data/sync/<run>.json).
// - 코스 개념(기록 후보 records) = 개념(concept). 물어봄·틀림·힌트·맞힘을 그대로 사건으로.
// - 노트의 문법·도구 말 = 어휘(vocab). 물어본 횟수만큼 "물어봄". 프로젝트 이름(router, findPost…)은 안 보낸다.
import path from "node:path";
import type { Course } from "./course.ts";
import { notesOf } from "./notes.ts";
import { DATA, candidates, read, update } from "./store.ts";

export type SyncEvent = { key: string; kind: "asked" | "wrong" | "hint" | "correct" | "note"; detail: string; at: string };
export type SyncItem = { key: string; title: string; kind: "concept" | "vocab"; state: "met" | "unknown"; body: string; topicHint: string; events: SyncEvent[] };
export type SyncPayload = { runId: string; source: { kind: "code"; title: string; ref: string }; items: SyncItem[]; sentBefore: number };

type Ledger = { sent: string[]; at?: string };
const ledgerFile = (runId: string) => path.join(DATA, "sync", `${runId}.json`);

const TOPIC: Record<string, string> = { 문법: "프로그래밍 언어/TypeScript/문법", 도구: "프로그래밍 언어/Node.js/도구" };

/** 지금까지 쌓인 것 전부를 앱이 받을 꼴로. 보낸 열쇠는 빼고(sent), 안 보낸 사건이 없고 이미 보낸 지식이면 지식째 뺀다. */
export async function pending(runId: string, course: Course): Promise<SyncPayload> {
  const sent = new Set((await read<Ledger>(ledgerFile(runId), { sent: [] })).sent);
  const source = { kind: "code" as const, title: `프로젝트 코스: ${course.title}`, ref: `project:${runId}` };
  const byKey = new Map<string, SyncItem>();

  for (const r of await candidates(runId)) {
    const k = course.knowledge.find((x) => x.id === r.knowledgeId);
    const key = `k:${r.knowledgeId}`;
    const item = byKey.get(key) ?? { key, title: r.knowledgeName, kind: r.knowledgeKind === "vocab" ? "vocab" as const : "concept" as const, state: "met" as const,
      body: k?.essentials ?? "", topicHint: r.topic ?? (r.knowledgeKind === "vocab" ? TOPIC.문법 : "개발/백엔드/HTTP 서버"), events: [] };
    byKey.set(key, item);
    if (r.kind === "met") continue; // 저장할 때 "처음 만남"이 남는다
    item.events.push({ key: `r:${r.at}:${r.knowledgeId}:${r.kind}`, kind: r.kind, detail: `${r.stage}단계 · ${r.detail}`.slice(0, 600), at: r.at });
  }

  const notes = await notesOf(runId);
  for (const t of Object.values(notes.terms)) {
    if (t.scope === "프로젝트") continue;
    const key = `t:${t.name}`;
    if (byKey.has(key)) continue;
    const where = t.files[0] ? `${t.files[0]}에서` : "코드에서";
    byKey.set(key, { key, title: t.name, kind: "vocab", state: t.asked > 0 ? "unknown" : "met", body: t.meaning ?? "", topicHint: TOPIC[t.scope] ?? TOPIC.문법,
      events: Array.from({ length: Math.min(t.asked, 10) }, (_, i) => ({ key: `t:${t.name}:asked:${i + 1}`, kind: "asked" as const, detail: `${where} 물어봄`, at: t.lastAt })) });
  }

  const items: SyncItem[] = [];
  for (const it of byKey.values()) {
    const events = it.events.filter((e) => !sent.has(e.key));
    if (sent.has(it.key) && !events.length) continue;
    items.push({ ...it, events });
  }
  return { runId, source, items, sentBefore: sent.size };
}

/** 앱이 넣은 것의 열쇠를 적어 둔다. 다음 번에는 다시 보내지 않는다. */
export async function markSent(runId: string, keys: string[]) {
  const clean = keys.filter((k) => typeof k === "string" && k.length <= 300).slice(0, 5000);
  const out = await update<Ledger>(ledgerFile(runId), { sent: [] }, (l) => {
    const set = new Set(l.sent);
    for (const k of clean) set.add(k);
    l.sent = [...set];
    l.at = new Date().toISOString();
  });
  return { ok: true, total: out.sent.length };
}
