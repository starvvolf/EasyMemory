"use client";
// 저장 중 미니 탭(11/11 사용자 "저장하는 과정을 자연스럽게, 저장하는 중이에요 하면서 점점점 움직이는 미니 탭").
// 알고리즘 화면 어디서든 memo(...)로 띄운다. 다른 탭에 가 있어도 보이게 body에 붙인다.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type SheetLite = { end: "solved" | "gaveup" | "paused"; help: number; skeleton?: boolean; stuck?: string; distill: string; gap?: string };
export type Memo = { state: "saving"; text: string } | { state: "done"; text: string } | { state: "hide" };
const EVENT = "recaller:memo";
export const memo = (m: Memo) => { try { window.dispatchEvent(new CustomEvent<Memo>(EVENT, { detail: m })); } catch { /* 서버 쪽 */ } };
const STUCK: Record<string, string> = { read: "문제 이해", choose: "방법 고르기", plan: "계획", code: "코드로 옮기기", edge: "경계·예외" };
/** 한 장을 한 줄로: "기억에 남겼어요 · 도움 2칸 · 막힌 곳: 경계·예외" */
export function sheetLine(s: SheetLite | null, quit = false) {
  if (!s) return "기억에 남겼어요";
  const how = s.end === "paused" ? "하다가 나간 곳까지" : s.end === "gaveup" ? "그만둔 것까지" : s.skeleton ? "뼈대로 맞힘" : s.help ? `도움 ${s.help}칸 받고 맞힘` : "혼자 맞힘";
  return ["기억에 남겼어요", how, s.stuck ? `막힌 곳: ${STUCK[s.stuck] ?? s.stuck}` : "", s.distill === "later" || quit ? "정리는 다음에 켤 때 해요" : ""].filter(Boolean).join(" · ");
}

export default function MemoToast() {
  const [m, setM] = useState<Memo>({ state: "hide" });
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      const next = (e as CustomEvent<Memo>).detail;
      if (t) clearTimeout(t);
      setM(next);
      if (next.state === "done") t = setTimeout(() => setM({ state: "hide" }), 3500);
    };
    window.addEventListener(EVENT, on);
    return () => { window.removeEventListener(EVENT, on); if (t) clearTimeout(t); };
  }, []);
  if (m.state === "hide" || typeof document === "undefined") return null;
  return createPortal(
    <div className={`memo-toast ${m.state}`} role="status" aria-live="polite">
      {m.state === "saving" ? <span className="memo-dots" aria-hidden><i /><i /><i /></span> : <span className="memo-check" aria-hidden>✓</span>}
      <span>{m.text}</span>
    </div>, document.body);
}
