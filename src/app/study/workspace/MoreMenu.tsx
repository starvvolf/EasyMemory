"use client";
// ⋯ 더보기: 공부하는 날에는 잘 안 쓰는 것 — 데이터 관리. (11/15 리팩토링: 옛 문제 세트의 학습 기록 · 한 장 정리 · 보관함 · 프롬프트 · 태블릿은 뺐다)
import DataPanel from "./DataPanel";
import { useEffect, useRef, useState } from "react";

export default function MoreMenu() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(false);
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
  return (
    <div className="mm" ref={box}>
      <button className="mm-btn" aria-haspopup="menu" aria-expanded={open} aria-label="더보기" onClick={() => setOpen(!open)}>⋯</button>
      {open ? (
        <div className="mm-card" role="menu">
          {item("데이터 관리", "크기·동기화·보관하고 비우기", () => setData(true))}
          <p className="mm-note">이 컴퓨터에서 돌아가요. 기록은 RecallerData에 저장되고, 앱을 끌 때 올라가요.</p>
        </div>
      ) : null}
      {data ? <DataPanel onClose={() => setData(false)} /> : null}
    </div>
  );
}
