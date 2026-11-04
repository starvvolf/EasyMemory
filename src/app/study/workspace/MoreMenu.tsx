"use client";
// ⋯ 더보기: what most study days do not need, out of the way — records and account, the one-page summary, the older
// archive, prompt settings, the tablet, and (folded) the developer screens.
import { useEffect, useRef, useState } from "react";
import { go } from "./api";

const clickById = (id: string) => (document.getElementById(id) as HTMLButtonElement | null)?.click();

export default function MoreMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const item = (label: string, hint: string, run: () => void) => (
    <button role="menuitem" className="mm-item" onClick={() => { setOpen(false); run(); }}><span>{label}</span><small>{hint}</small></button>
  );
  const has = (id: string) => typeof document !== "undefined" && Boolean(document.getElementById(id));
  return (
    <div className="mm" ref={box}>
      <button className="mm-btn" aria-haspopup="menu" aria-expanded={open} aria-label="더보기" onClick={() => setOpen(!open)}>⋯</button>
      {open ? (
        <div className="mm-card" role="menu">
          {item("학습 기록", "문제별 기록 (ChatGPT 연결은 위의 버튼)", () => go("records"))}
          {item("한 장 정리", "자료별로 떠올릴 것 모아 보기 · 인쇄", () => go("summary"))}
          {item("보관함", "치워 둔 문제 세트", () => go("archive"))}
          <hr />
          {has("promptBtn") ? item("프롬프트 설정", "설명·답변을 어떻게 해 줄지", () => clickById("promptBtn")) : null}
          {has("tabletBtn") ? item("태블릿에서 열기", "같은 와이파이의 태블릿", () => clickById("tabletBtn")) : null}
          {has("fsBtn") ? item("전체화면", "주소창 숨기기", () => clickById("fsBtn")) : null}
          {/* 2026-11-02 A (점검_UIUX화면연결 17번): 만드는 사람용 화면은 접어 둔다 */}
          <details className="mm-dev"><summary>개발용 화면</summary>
            {/* 2026-11-05 정리: 실험 서버·도구는 lab/·tools/에서 켠다. 여기는 같은 서버 안의 실험 화면만. */}
            {item("엔진 실험실", "PDF 생성 단계별로 보기 ↗", () => window.open("/lab", "_blank"))}
            {item("작업대", "모델 흐름 실험", () => go("bench"))}
            {item("토론방", "Claude·Codex와 기획 토론 ↗", () => window.open("/room", "_blank"))}
          </details>
          <p className="mm-note">이 컴퓨터에서 돌아가요. 기록은 RecallerData에 저장되고, 앱을 끌 때 올라가요.</p>
        </div>
      ) : null}
    </div>
  );
}
