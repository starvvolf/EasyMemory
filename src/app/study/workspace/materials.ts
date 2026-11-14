"use client";
// 만드는 중인 자료 (2026-11-15 리팩토링): 예전 앱(dejipgi-app.js)이 이 브라우저에 들고 있던 "만드는 중" 목록 대신,
// 서버의 실행 목록(/api/lab/gen?origin=study)을 그대로 읽는다. 끝나지 않은 실행이 있으면 몇 초마다 다시 읽는다.
import { useSyncExternalStore } from "react";
import { call } from "./api";

export type GenRun = {
  id: string; createdAt: string; status: string; fileName: string; sourceId?: string; pages: number[];
  message?: string; calls?: number; sectionsDone?: number; sectionCount?: number;
};
/** 공부 › 자료 목록에 그릴 "만드는 중" 줄 */
export type Making = { id: string; title: string; status: "running" | "paused" | "failed"; label: string; text: string; canResume: boolean; login: boolean };

const HIDE_KEY = "recaller:hidden-gens";
const hidden = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(HIDE_KEY) || "[]") as string[]); } catch { return new Set(); } };

const state = { runs: [] as GenRun[], loaded: false, error: "", v: 0 };
const subs = new Set<() => void>();
const bump = () => { state.v++; for (const fn of subs) fn(); };
let timer: ReturnType<typeof setTimeout> | null = null;
let loading: Promise<void> | null = null;

const live = (s: string) => s === "queued" || s === "running";
const finished = (s: string) => s === "done";

export function makingOf(run: GenRun): Making {
  const title = run.fileName.replace(/\.pdf$/i, "");
  const msg = run.message ?? "";
  if (run.status === "failed") return { id: run.id, title, status: "failed", label: "실패", text: `기억 정리 실패 · ${msg || "다시 만들어 주세요."}`, canResume: false, login: false };
  if (run.status.startsWith("paused") || run.status === "interrupted" || run.status === "awaiting-confirm") {
    const login = run.status === "paused-login";
    const cap = /호출 수\((\d+)\)/.exec(msg);
    const text = login ? `ChatGPT 로그인이 필요해요 · ${msg}` : cap ? `만들다 멈췄어요. 한 번에 AI를 부를 수 있는 횟수(${cap[1]}번)를 다 썼어요. ‘이어 만들기’를 누르면 멈춘 곳부터 다시 만들어요.` : msg || "잠시 멈췄어요.";
    return { id: run.id, title, status: "paused", label: "잠시 멈춤", text, canResume: true, login };
  }
  const n = run.sectionCount ? ` ${run.sectionsDone ?? 0}/${run.sectionCount}구역` : "";
  return { id: run.id, title, status: "running", label: run.status === "queued" ? "시작 대기" : "기억 정리 중", text: `기억 정리 중${n}${run.calls ? ` · 호출 ${run.calls}번` : ""}`, canResume: false, login: false };
}

export async function refreshMaterials(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const { runs } = await call<{ runs: GenRun[] }>("/api/lab/gen?origin=study");
      state.runs = runs; state.error = "";
    } catch (e) { state.error = e instanceof Error ? e.message : String(e); }
    state.loaded = true; loading = null; bump();
    if (timer) clearTimeout(timer);
    if (state.runs.some((r) => live(r.status))) timer = setTimeout(() => void refreshMaterials(), 4000);
  })();
  return loading;
}

function subscribe(fn: () => void) {
  subs.add(fn);
  if (!state.loaded && !loading) void refreshMaterials();
  return () => { subs.delete(fn); };
}
const version = () => state.v;

/** 지금 만드는 중 · 멈춤 · 실패한 자료(숨긴 것 빼고, 최신이 위) */
export function useMaking(): { making: Making[]; runs: GenRun[]; error: string; loaded: boolean } {
  useSyncExternalStore(subscribe, version, version);
  const hide = hidden();
  const making = state.runs.filter((r) => !finished(r.status) && !hide.has(r.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(makingOf);
  return { making, runs: state.runs, error: state.error, loaded: state.loaded };
}
export const runOf = (genId: string) => state.runs.find((r) => r.id === genId) ?? null;

/** PDF를 등록하고 기억 정리를 시작한다. 돌려주는 값은 새 실행 id. */
export async function startMaterial(o: { file: File; from: number; to: number; note: string; lecture: boolean }): Promise<string> {
  const form = new FormData();
  form.append("pdf", o.file);
  const res = await fetch("/api/mcp-runs/sources", { method: "POST", body: form, cache: "no-store" });
  const reg = await res.json().catch(() => ({})) as { source?: { id: string }; message?: string };
  if (!res.ok || !reg.source) throw new Error(reg.message ?? "PDF를 등록하지 못했어요.");
  const pageNumbers = Array.from({ length: Math.max(1, o.to - o.from + 1) }, (_, i) => o.from + i);
  const { gen } = await call<{ gen: { id: string } }>("/api/lab/gen", {
    sourceId: reg.source.id, fileName: o.file.name, pageNumbers, note: o.note.slice(0, 2000), origin: "study", ...(o.lecture ? { lecture: true } : {}), confirmed: true,
  });
  await refreshMaterials();
  return gen.id;
}

/** 멈춘 실행을 멈춘 곳부터 */
export async function resumeMaterial(genId: string) {
  await call(`/api/lab/gen/${genId}/continue`, { confirmed: true });
  await refreshMaterials();
}

/** 목록에서 숨기기(실행 기록은 그대로 남는다) */
export function hideMaterial(genId: string) {
  const h = hidden(); h.add(genId);
  try { localStorage.setItem(HIDE_KEY, JSON.stringify([...h])); } catch { /* storage off */ }
  bump();
}
