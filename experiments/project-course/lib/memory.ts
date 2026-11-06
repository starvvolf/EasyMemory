// 학습자 메모리 (2026-11-06 사용자 "GPT에서 메모리 관리하듯이 이 사람이 어느 정도인지 관리하는 거 하나. 옛날 거 안 쓰는 거 다 버리고 학습자 메모리만").
// 실습 전체에 한 사람에 하나(.data/learner-memory.json). 두 종류:
// - 진행 방식: 학습자가 정해 둔 방식(remember_preference, 근거 = 학습자 말 그대로). 예전 preferences.json은 처음 읽을 때 옮긴다.
// - 경향: 목표 정리(goal-record) 호출이 같이 내는 갱신(더하기 · 이어 보임 · 나아짐). 근거는 그 정리의 "부족했던 점"(나아짐은 "배운 것") 이름만 인정.
// 상태는 코드가 정한다: 새로 = 가설, 서로 다른 목표 2곳 이상에서 보이면 = 확인, 나아진 근거가 오면 = 나아짐(다시 보이면 확인으로).
// 학습자가 화면에서 고치거나 지운다. 튜터는 매 차례 맥락([학습자 메모리])과 learner_profile 도구로 읽는다.
import path from "node:path";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { DATA, read, update } from "./store.ts";

export type MemKind = "진행 방식" | "경향";
export type MemStatus = "가설" | "확인" | "나아짐";
export type Evidence = { runId: string; goal: string; name: string; at: string };
export type MemItem = { id: string; kind: MemKind; text: string; status: MemStatus; evidence: Evidence[]; first: string; at: string; history: { at: string; what: string }[]; edited?: boolean };
type Mem = { items: MemItem[]; migrated?: boolean };

const FILE = () => path.join(DATA, "learner-memory.json");
const now = () => new Date().toISOString();
const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
const newId = () => `m${randomBytes(3).toString("hex")}`;
const hist = (it: MemItem, what: string) => { it.history.push({ at: now(), what }); if (it.history.length > 30) it.history.splice(0, it.history.length - 30); };
/** 서로 다른 목표 2곳 이상에서 근거가 나오면 확인 */
const statusOf = (it: MemItem): MemStatus => (new Set(it.evidence.map((e) => `${e.runId}:${e.goal}`)).size >= 2 ? "확인" : "가설");

export async function memoryOf(): Promise<MemItem[]> {
  let m = await read<Mem>(FILE(), { items: [] });
  if (!m.migrated) {
    // 예전 Codex 진행 방식(codex-chat/preferences.json)을 한 번 옮긴다
    const old = path.join(DATA, "codex-chat", "preferences.json");
    const prefs = existsSync(old) ? (await read<{ items: { text: string; quote: string; chatId: string; at: string }[] }>(old, { items: [] })).items : [];
    m = await update<Mem>(FILE(), { items: [] }, (x) => {
      if (x.migrated) return;
      for (const p of prefs) if (!x.items.some((i) => i.kind === "진행 방식" && norm(i.text) === norm(p.text)))
        x.items.push({ id: newId(), kind: "진행 방식", text: p.text, status: "확인", evidence: [{ runId: p.chatId, goal: "", name: p.quote, at: p.at }], first: p.at, at: p.at, history: [{ at: p.at, what: "학습자가 정함" }] });
      x.migrated = true;
    });
  }
  return m.items;
}

/** 튜터 맥락에 넣는 짧은 글. 나아짐은 빼고, 진행 방식 먼저 */
export async function memoryText(withIds = false) {
  const items = await memoryOf();
  const pref = items.filter((i) => i.kind === "진행 방식");
  const tend = items.filter((i) => i.kind === "경향" && i.status !== "나아짐").sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  if (!pref.length && !tend.length) return "";
  const line = (i: MemItem) => `- ${withIds ? `[${i.id}] ` : ""}${i.text}${i.kind === "경향" ? ` (${i.status}, 근거 ${i.evidence.length})` : ""}`;
  return [pref.length ? `[학습자가 정해 둔 진행 방식]\n${pref.map(line).join("\n")}` : "", tend.length ? `[학습자 메모리 — 여러 목표에서 본 경향, 단정 아님]\n${tend.map(line).join("\n")}` : ""].filter(Boolean).join("\n\n");
}
/** 목표 정리 호출에 넣는 지금 메모리(id 포함, 나아짐도 보여 다시 보이는지 판단하게) */
export async function memoryForRecord() {
  const t = (await memoryOf()).filter((i) => i.kind === "경향");
  return t.length ? t.map((i) => `- [${i.id}] ${i.text} (${i.status})`).join("\n") : "(아직 없음)";
}

export type MemOps = { add: { text: string; evidence: string[] }[]; update: { id: string; text: string; evidence: string[] }[]; improved: { id: string; evidence: string[] }[] };
/** 목표 정리의 메모리 갱신을 코드 검사 뒤 반영. gaps / learned: 그 정리에서 나온 이름 */
export async function applyMemory(runId: string, goal: string, ops: Partial<MemOps> | undefined, gaps: string[], learned: string[]) {
  const G = new Map(gaps.map((g) => [norm(g), g])), L = new Map(learned.map((g) => [norm(g), g]));
  const ev = (names: string[] | undefined, pool: Map<string, string>) => [...new Set((names ?? []).map((n) => pool.get(norm(String(n)))).filter((x): x is string => !!x))].map((name) => ({ runId, goal, name, at: now() }));
  const done: string[] = [], dropped: string[] = [];
  await memoryOf();
  await update<Mem>(FILE(), { items: [] }, (m) => {
    for (const u of ops?.update ?? []) {
      const it = m.items.find((i) => i.id === u.id && i.kind === "경향"); const e = ev(u.evidence, G);
      if (!it || !e.length) { dropped.push(`이어 보임 ${u.id}: 근거 없음`); continue; }
      it.evidence.push(...e); if (it.evidence.length > 20) it.evidence.splice(0, it.evidence.length - 20);
      // 학습자가 고친 글은 모델이 덮어쓰지 않는다
      if (u.text?.trim() && !it.edited) it.text = u.text.trim().slice(0, 200);
      const before = it.status; it.status = statusOf(it); it.at = now();
      hist(it, `"${goal}"에서 또 보임(${e.map((x) => x.name).join(", ")})${before !== it.status ? ` → ${it.status}` : ""}`);
      done.push(`이어 보임 ${it.id}`);
    }
    for (const a of ops?.add ?? []) {
      const text = String(a.text ?? "").trim().slice(0, 200), e = ev(a.evidence, G);
      if (!text || !e.length) { dropped.push(`더하기 "${text}": 근거 없음`); continue; }
      const it: MemItem = { id: newId(), kind: "경향", text, status: "가설", evidence: e, first: now(), at: now(), history: [] };
      hist(it, `"${goal}"에서 처음 봄(${e.map((x) => x.name).join(", ")})`);
      m.items.push(it); done.push(`더하기 ${it.id}`);
    }
    for (const p of ops?.improved ?? []) {
      const it = m.items.find((i) => i.id === p.id && i.kind === "경향"); const e = ev(p.evidence, L);
      if (!it || !e.length) { dropped.push(`나아짐 ${p.id}: 근거 없음`); continue; }
      if ((ops?.update ?? []).some((u) => u.id === p.id)) { dropped.push(`나아짐 ${p.id}: 같은 목표에서 또 보임`); continue; }
      it.status = "나아짐"; it.at = now(); hist(it, `"${goal}"에서 나아짐(${e.map((x) => x.name).join(", ")})`); done.push(`나아짐 ${it.id}`);
    }
  });
  return { done, dropped };
}

/** 학습자가 손으로: 고치기 · 지우기 · 진행 방식 더하기 */
export async function editMemory(id: string, b: Record<string, unknown>) {
  await memoryOf();
  await update<Mem>(FILE(), { items: [] }, (m) => {
    const i = m.items.findIndex((x) => x.id === id);
    if (i < 0) throw Object.assign(new Error("없는 항목이에요."), { status: 404 });
    if (b.delete) { m.items.splice(i, 1); return; }
    const text = String(b.text ?? "").trim().slice(0, 200);
    if (text) { m.items[i].text = text; m.items[i].edited = true; m.items[i].at = now(); hist(m.items[i], "학습자가 고침"); }
  });
  return { items: await memoryOf() };
}
export async function addPreference(text: string, quote: string, chatId: string) {
  await memoryOf();
  await update<Mem>(FILE(), { items: [] }, (m) => {
    const same = m.items.find((i) => i.kind === "진행 방식" && norm(i.text) === norm(text));
    if (same) { same.evidence.push({ runId: chatId, goal: "", name: quote, at: now() }); same.at = now(); return; }
    m.items.push({ id: newId(), kind: "진행 방식", text, status: "확인", evidence: [{ runId: chatId, goal: "", name: quote, at: now() }], first: now(), at: now(), history: [{ at: now(), what: "학습자가 정함" }] });
  });
}
