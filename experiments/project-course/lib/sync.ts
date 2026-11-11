// 앱 지식 저장소로 보낼 것 (2026-10-30, 사용자: "공부 탭에 프로젝트 추가하고 연결해봐").
// 이 서버는 앱 데이터에 직접 쓰지 않는다. 앱(3000)의 /api/project-course/sync가 여기서 "아직 안 보낸 것"을 받아
// 지식 저장소(saveMany·recordEvent)에 넣고, 넣은 것의 열쇠를 돌려준다(보낸 열쇠는 .data/sync/<run>.json).
// - 대화 실습: 목표 정리의 배운 것 · 부족했던 것 · 부족함 원장의 다시 확인 문항. (예전 정해진 코스의 개념 · 어휘 보내기는 11/11에 뺐다)
import path from "node:path";
import { createHash } from "node:crypto";
import { DATA, read, update, type Run } from "./store.ts";
import { recordsOf, type Tab } from "./goal-record.ts";

export type SyncEvent = { key: string; kind: "asked" | "wrong" | "hint" | "correct" | "note"; detail: string; at: string };
export type SyncKind = "concept" | "principle" | "procedure" | "rule" | "method" | "compare" | "vocab";
/** 틀렸던 코드(11/6): 학습자 저장본에서 코드가 잘라 낸 덩어리 → 기억(지식)의 mistakes */
export type SyncMistake = { file: string; from: number; to: number; code: string; note: string; ref: string; at: string };
/** 다시 확인 문항(11/8 부족함 원장): 부족했던 바로 그 지점을 겨냥한 질문 → 지식의 checks, 앱 복습이 먼저 묻는다 */
export type SyncCheck = { q: string; a: string; note: string; ref: string; at: string };
export type SyncItem = { key: string; title: string; kind: SyncKind; state: "met" | "unknown"; body: string; topicHint: string; events: SyncEvent[]; mistake?: SyncMistake; mistakeKey?: string; check?: SyncCheck; checkKey?: string };
/** 목표 정리의 여섯 칸 = 지식 저장소의 여섯 종류(B, store.ts KIND_LABEL) */
const TAB_KIND: Record<Tab, SyncKind> = { 개념: "concept", 원리: "principle", 절차: "procedure", 규칙: "rule", 방법: "method", 비교: "compare" };
export type SyncPayload = { runId: string; source: { kind: "code"; title: string; ref: string }; items: SyncItem[]; sentBefore: number };

type Ledger = { sent: string[]; at?: string };
const ledgerFile = (runId: string) => path.join(DATA, "sync", `${runId}.json`);


/** 지금까지 쌓인 것 전부를 앱이 받을 꼴로. 보낸 열쇠는 빼고(sent), 안 보낸 사건이 없고 이미 보낸 지식이면 지식째 뺀다. */
export async function pending(runId: string, run?: Run): Promise<SyncPayload> {
  const sent = new Set((await read<Ledger>(ledgerFile(runId), { sent: [] })).sent);
  const byKey = new Map<string, SyncItem>();
  // 대화로 하는 실습(11/6): 목표 정리의 배운 것 · 부족한 점을 보낸다. 출처 이름은 장기 목표, ref는 이 실습 하나("project:" → 앱에서 실습 출처)
  if (run?.codexId || run?.chatId) {
    const goals = await read<{ long?: { text: string } | null }>(path.join(DATA, "goals", `${runId}.json`), {});
    const long = goals.long?.text || "대화로 배우기";
    const source = { kind: "code" as const, title: `실습: ${long}`.slice(0, 120), ref: `project:${runId}` };
    const topicHint = `실습/${long.slice(0, 40)}`;
    const name = (c: string) => c.replace(/\s+/g, " ").trim();
    const item = (type: Tab, concept: string, body: string): SyncItem => {
      const key = `g:${name(concept).toLowerCase()}`;
      const it = byKey.get(key) ?? { key, title: name(concept), kind: TAB_KIND[type] ?? "concept", state: "met" as const, body, topicHint, events: [] };
      byKey.set(key, it);
      return it;
    };
    // 실습 기억 카드(11/10)는 카드 꼴 그대로 본문에: 상황 · 내가 한 것 · 알게 된 것 · 다음엔
    const cardBody = (c: { situation: string; did: string; learned: string; next: string; how: string }, goal: string) =>
      [`알게 된 것: ${c.learned}`, c.next ? `다음엔: ${c.next}` : "", `상황: ${goal}${c.situation ? ` — ${c.situation}` : ""}`, c.did ? `내가 한 것: ${c.did} (${c.how})` : ""].filter(Boolean).join("\n");
    for (const rec of await recordsOf(runId)) {
      for (const x of rec.learned) {
        const it = item(x.type, x.concept, x.card ? cardBody(x.card, rec.goal) : x.meaning);
        if (x.card) it.body = cardBody(x.card, rec.goal);
        if (!it.events.some((e) => e.key === `g:${rec.at}:L:${it.key}`)) it.events.push({ key: `g:${rec.at}:L:${it.key}`, kind: "note", detail: `목표 "${rec.goal}" · ${x.how}${x.quote ? ` · 학습자: "${x.quote}"` : ""}`.slice(0, 600), at: rec.to });
      }
      for (const x of rec.gaps ?? []) {
        const it = item(x.type, x.concept, x.right);
        it.state = "unknown"; // 부족했던 것은 "몰랐음"으로 들어가 복습에 먼저 오른다
        if (x.right && !it.body.startsWith("알게 된 것:")) it.body = x.right;
        if (x.code) { it.mistake = { file: x.code.file, from: x.code.from, to: x.code.to, code: x.code.code, note: x.wrong, ref: `project:${runId}`, at: rec.to }; it.mistakeKey = `g:${rec.at}:C:${it.key}`; }
        it.events.push({ key: `g:${rec.at}:G:${it.key}`, kind: "wrong", detail: `목표 "${rec.goal}" · 부족: ${x.wrong}${x.quote ? ` · 학습자: "${x.quote}"` : ""}`.slice(0, 600), at: rec.to });
      }
    }
    // 부족함 원장(11/8): 이름이 붙은 부족함마다 다시 확인 문항, 세션 안에서 채운 근거(메모), 실습에서 다시 확인한 결과(맞힘 · 틀림)
    const ledger = (await (await import("./gaps.ts")).ledgerOf(runId)).filter((g) => g.type && g.concept && !g.mergedInto); // 묶인 칸은 첫 칸이 대신(검토 11/8)
    // 다시 확인까지 맞힌 지식은 "몰랐음"으로 다시 보내지 않는다(검토 11/8: 다음 동기화에서 앎 → 몰랐음으로 내려갈 수 있던 것)
    const passed = new Set(ledger.filter((g) => g.status === "다시 확인 맞음").map((g) => `g:${name(g.concept).toLowerCase()}`));
    const stillOpen = new Set(ledger.filter((g) => g.status !== "다시 확인 맞음").map((g) => `g:${name(g.concept).toLowerCase()}`));
    for (const g of ledger) {
      const it = item(g.type as Tab, g.concept, g.right);
      // 문항이 바뀌면 열쇠도 바뀌어 새 문항이 간다(검토 11/8)
      if (g.recheck) { it.check = { q: g.recheck.q, a: g.recheck.a, note: g.wrong, ref: `project:${runId}`, at: g.at }; it.checkKey = `gap:${g.id}:check:${createHash("sha1").update(g.recheck.q).digest("hex").slice(0, 8)}`; }
      if (g.filledAt) it.events.push({ key: `gap:${g.id}:fill`, kind: "note", detail: `실습에서 채움 확인(목표 "${g.goal.title}"): ${g.fillEvidence ?? ""}${g.remedy.length ? ` · 처방: ${g.remedy.map((r) => r.text).join(" / ")}` : ""}`.slice(0, 600), at: g.filledAt });
      for (const c of g.checks) if (c.answer) it.events.push({ key: `gap:${g.id}:chk:${c.at}`, kind: c.verdict === "correct" ? "correct" : "wrong", detail: `실습에서 다시 확인: ${c.note}${c.answer ? ` · 답: "${c.answer.slice(0, 200)}"` : ""}`.slice(0, 600), at: c.at });
    }
    for (const k of passed) { const it = byKey.get(k); if (it && !stillOpen.has(k)) it.state = "met"; }
    const items: SyncItem[] = [];
    for (const it of byKey.values()) {
      const events = it.events.filter((e) => !sent.has(e.key));
      const mistake = it.mistakeKey && !sent.has(it.mistakeKey) ? it.mistake : undefined;
      const check = it.checkKey && !sent.has(it.checkKey) ? it.check : undefined;
      if (sent.has(it.key) && !events.length && !mistake && !check) continue;
      const { mistake: _m, mistakeKey, check: _c, checkKey, ...rest } = it;
      items.push({ ...rest, events, ...(mistake ? { mistake, mistakeKey } : {}), ...(check ? { check, checkKey } : {}) });
    }
    return { runId, source, items, sentBefore: sent.size };
  }
  return { runId, source: { kind: "code", title: "실습", ref: `project:${runId}` }, items: [], sentBefore: sent.size }; // 예전 코스 실습: 보낼 것 없음
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
