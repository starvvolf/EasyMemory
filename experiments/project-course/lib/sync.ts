// 앱 지식 저장소로 보낼 것 (2026-10-30, 사용자: "공부 탭에 프로젝트 추가하고 연결해봐").
// 이 서버는 앱 데이터에 직접 쓰지 않는다. 앱(3000)의 /api/project-course/sync가 여기서 "아직 안 보낸 것"을 받아
// 지식 저장소(saveMany·recordEvent)에 넣고, 넣은 것의 열쇠를 돌려준다(보낸 열쇠는 .data/sync/<run>.json).
// - 코스 개념(기록 후보 records) = 개념(concept). 물어봄·틀림·힌트·맞힘을 그대로 사건으로.
// - 노트의 문법·도구 말 중 학습자가 눌러 보거나 물어본 것만 = 어휘(vocab). 물어본 횟수만큼 "물어봄".
//   튜터 설명에 나오기만 한 말, 프로젝트 이름(router, findPost…)은 안 보낸다(2026-10-30 실제 데이터 확인 뒤).
import path from "node:path";
import type { Course } from "./course.ts";
import { notesOf } from "./notes.ts";
import { DATA, candidates, read, update, type Run } from "./store.ts";
import { recordsOf, type Tab } from "./goal-record.ts";

export type SyncEvent = { key: string; kind: "asked" | "wrong" | "hint" | "correct" | "note"; detail: string; at: string };
export type SyncKind = "concept" | "principle" | "procedure" | "rule" | "method" | "compare" | "vocab";
export type SyncItem = { key: string; title: string; kind: SyncKind; state: "met" | "unknown"; body: string; topicHint: string; events: SyncEvent[] };
/** 목표 정리의 여섯 칸 = 지식 저장소의 여섯 종류(B, store.ts KIND_LABEL) */
const TAB_KIND: Record<Tab, SyncKind> = { 개념: "concept", 원리: "principle", 절차: "procedure", 규칙: "rule", 방법: "method", 비교: "compare" };
export type SyncPayload = { runId: string; source: { kind: "code"; title: string; ref: string }; items: SyncItem[]; sentBefore: number };

type Ledger = { sent: string[]; at?: string };
const ledgerFile = (runId: string) => path.join(DATA, "sync", `${runId}.json`);

const TOPIC: Record<string, string> = { 문법: "프로그래밍 언어/TypeScript/문법", 도구: "프로그래밍 언어/Node.js/도구" };

/** 지금까지 쌓인 것 전부를 앱이 받을 꼴로. 보낸 열쇠는 빼고(sent), 안 보낸 사건이 없고 이미 보낸 지식이면 지식째 뺀다. */
export async function pending(runId: string, course: Course, run?: Run): Promise<SyncPayload> {
  const sent = new Set((await read<Ledger>(ledgerFile(runId), { sent: [] })).sent);
  const byKey = new Map<string, SyncItem>();
  // 대화로 하는 실습(11/6): 목표 정리의 배운 것 · 부족한 점을 보낸다. 출처 이름은 장기 목표, ref는 이 실습 하나("project:" → 앱에서 실습 출처)
  if (run?.codexId || run?.chatId) {
    const goals = await read<{ long?: { text: string } | null }>(path.join(DATA, "goals", `${runId}.json`), {});
    const long = goals.long?.text || "대화로 배우기";
    const source = { kind: "code" as const, title: `실습: ${long}`.slice(0, 120), ref: `project:${runId}` };
    const topicHint = `실습/${long.slice(0, 40)}`;
    const name = (c: string) => c.replace(/\s+/g, " ").trim();
    for (const rec of await recordsOf(runId)) {
      const item = (type: Tab, concept: string, body: string) => {
        const key = `g:${name(concept).toLowerCase()}`;
        const it = byKey.get(key) ?? { key, title: name(concept), kind: TAB_KIND[type] ?? "concept", state: "met" as const, body, topicHint, events: [] };
        byKey.set(key, it);
        return it;
      };
      for (const x of rec.learned) {
        const it = item(x.type, x.concept, x.meaning);
        it.events.push({ key: `g:${rec.at}:L:${it.key}`, kind: "note", detail: `목표 "${rec.goal}" · ${x.how}${x.quote ? ` · 학습자: "${x.quote}"` : ""}`.slice(0, 600), at: rec.to });
      }
      for (const x of rec.gaps ?? []) {
        const it = item(x.type, x.concept, x.right);
        it.state = "unknown"; // 부족했던 것은 "몰랐음"으로 들어가 복습에 먼저 오른다
        if (x.right) it.body = x.right;
        it.events.push({ key: `g:${rec.at}:G:${it.key}`, kind: "wrong", detail: `목표 "${rec.goal}" · 부족: ${x.wrong}${x.quote ? ` · 학습자: "${x.quote}"` : ""}`.slice(0, 600), at: rec.to });
      }
    }
    const items: SyncItem[] = [];
    for (const it of byKey.values()) {
      const events = it.events.filter((e) => !sent.has(e.key));
      if (sent.has(it.key) && !events.length) continue;
      items.push({ ...it, events });
    }
    return { runId, source, items, sentBefore: sent.size };
  }
  const source = { kind: "code" as const, title: `프로젝트 코스: ${course.title}`, ref: `project:${course.id}` }; // 같은 코스를 다시 해도 "다른 자료"가 아니다

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
    // 프로젝트 이름은 안 보낸다. 튜터 설명에 나오기만 한 말도 안 보낸다(노트에만) — 학습자가 눌러 보거나 물어본 말만 어휘로.
    if (t.scope === "프로젝트" || t.asked < 1) continue;
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
