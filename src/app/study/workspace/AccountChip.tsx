"use client";
// ChatGPT 연결 (2026-10-31, 사용자 "타이머 갖다버리고 로그인창 만들어"): a chip in the header where the timer was. It shows
// whether the app can call the model with the learner's ChatGPT account; when not, one press opens the ChatGPT sign-in
// (the same /api/auth/chatgpt/start the 자료 넣기 screen uses). Back from the sign-in, the old screen toasts the outcome.
import { useCallback, useEffect, useRef, useState } from "react";
import { call, errorText, later } from "./api";

type Info = { enabled: boolean; provider: string; model: { ready: boolean; message: string } };

export default function AccountChip() {
  const [info, setInfo] = useState<Info | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => { try { setInfo(await call<Info>("/api/study-executor")); } catch (e) { setNote(errorText(e)); } }, []);
  useEffect(() => { const first = later(() => void load()); const on = () => void load(); window.addEventListener("focus", on);
    return () => { first(); window.removeEventListener("focus", on); }; }, [load]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off); return () => document.removeEventListener("mousedown", off);
  }, [open]);
  // Only the ChatGPT route signs in here (a local Codex or the fake model needs no sign-in).
  if (info && info.provider !== "chatgpt") return null;
  const ready = Boolean(info?.model.ready);
  const connect = async () => {
    setBusy(true); setNote("");
    try { const { url } = await call<{ url: string }>("/api/auth/chatgpt/start", {}); window.location.assign(url); }
    catch (e) { setNote(errorText(e) || "ChatGPT 로그인을 시작하지 못했어요."); setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true); setNote("");
    try { await call("/api/auth/chatgpt/logout", {}); setNote("ChatGPT 연결을 해제했어요."); await load(); }
    catch (e) { setNote(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="wtm" ref={box}>
      <button className={`tablet-btn wtm-chip${ready ? "" : " acc-off"}`} onClick={() => (ready ? setOpen(!open) : void connect())} disabled={busy || !info}
        aria-expanded={open} title={info?.model.message ?? "ChatGPT 연결 확인 중"}>
        <span className="acc-dot" data-on={ready ? "true" : "false"} aria-hidden="true" />
        {!info ? "확인 중" : ready ? "ChatGPT 연결됨" : busy ? "여는 중…" : "ChatGPT 로그인"}
      </button>
      {open || note ? (
        <div className="wtm-card" role="dialog" aria-label="ChatGPT 연결">
          {info ? <p className="small">{info.model.message}</p> : null}
          {note ? <p className="small muted">{note}</p> : null}
          <div className="row" style={{ gap: 6 }}>
            {ready ? <button className="btn small ghost" onClick={() => void disconnect()} disabled={busy}>연결 해제</button>
              : <button className="btn small" onClick={() => void connect()} disabled={busy}>ChatGPT 로그인</button>}
            <button className="btn small ghost" onClick={() => { setOpen(false); setNote(""); }}>닫기</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
