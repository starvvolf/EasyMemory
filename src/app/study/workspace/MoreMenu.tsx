"use client";
// ⋯ 더보기: what most study days do not need, out of the way — records and account, the one-page summary, the older
// per-material view, the archive, the workbench, prompt settings, the tablet, and the debate room.
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
          {item("한 장 정리", "과목별로 떠올릴 것 모아 보기", () => go("summary"))}
          {item("자료별 지식 포인트", "예전 지식 화면", () => go("knowledge-legacy"))}
          {item("보관함", "치워 둔 문제 세트", () => go("archive"))}
          <hr />
          {has("promptBtn") ? item("프롬프트 설정", "설명·답변을 어떻게 해 줄지", () => clickById("promptBtn")) : null}
          {has("tabletBtn") ? item("태블릿에서 열기", "같은 와이파이의 태블릿", () => clickById("tabletBtn")) : null}
          {has("fsBtn") ? item("전체화면", "주소창 숨기기", () => clickById("fsBtn")) : null}
          {item("작업대", "모델 흐름 실험", () => go("bench"))}
          {item("토론방", "Claude·Codex와 기획 토론 ↗", () => window.open("/room", "_blank"))}
          <p className="mm-note">이 컴퓨터에서만 돌아가요 (로컬 실험 모드). 기록은 RecallerData에 저장돼요.</p>
        </div>
      ) : null}
    </div>
  );
}
