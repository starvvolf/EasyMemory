"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Status = {
  connected: boolean;
  account: null | { type: "apiKey" } | { type: "chatgpt"; email: string; planType: string };
  rateLimits?: {
    rateLimits?: {
      primary?: { usedPercent?: number; windowDurationMins?: number; resetsAt?: number } | null;
      secondary?: { usedPercent?: number; windowDurationMins?: number; resetsAt?: number } | null;
    };
  } | null;
  message?: string;
};

type Model = {
  id: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
};

type ChatMessage = { role: "user" | "assistant"; text: string };

const THREAD_STORAGE_KEY = "study-forge-codex-test-thread";

export default function CodexConnectionPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("medium");
  const [input, setInput] = useState("");
  const [threadId, setThreadId] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (window.localStorage.getItem(THREAD_STORAGE_KEY) ?? ""),
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chatGptAccount =
    status?.account?.type === "chatgpt" ? status.account : null;
  const loggedIn = Boolean(chatGptAccount);

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    void loadModels();
  }, [loggedIn]);

  const selectedModel = useMemo(
    () => models.find((item) => item.id === model),
    [model, models],
  );

  async function refreshStatus() {
    try {
      const response = await fetch("/api/codex/status", { cache: "no-store" });
      const data = (await response.json()) as Status;
      setStatus(data);
      if (!response.ok) setError(data.message ?? "연결 상태를 확인하지 못했습니다.");
      else setError("");
      return data;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "연결 상태를 확인하지 못했습니다.");
      return null;
    }
  }

  async function loadModels() {
    const response = await fetch("/api/codex/models", { cache: "no-store" });
    const data = (await response.json()) as { models?: Model[]; message?: string };
    if (!response.ok || !data.models) {
      setError(data.message ?? "모델을 불러오지 못했습니다.");
      return;
    }
    setModels(data.models);
    const defaultModel = data.models.find((item) => item.isDefault) ?? data.models[0];
    if (defaultModel) {
      setModel((current) => current || defaultModel.id);
      setEffort(defaultModel.defaultReasoningEffort);
    }
  }

  async function startLogin() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/codex/login", { method: "POST" });
      const data = (await response.json()) as { authUrl?: string; message?: string };
      if (!response.ok || !data.authUrl) throw new Error(data.message ?? "로그인을 시작하지 못했습니다.");
      window.open(data.authUrl, "_blank", "noopener,noreferrer");
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        const nextStatus = await refreshStatus();
        if (nextStatus?.account?.type === "chatgpt") break;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로그인을 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setMessages((current) => [...current, { role: "user", text: message }]);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/codex/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          threadId: threadId || undefined,
          model: model || undefined,
          reasoningEffort: effort,
        }),
      });
      const data = (await response.json()) as { text?: string; threadId?: string; message?: string };
      if (!response.ok || !data.text || !data.threadId) {
        throw new Error(data.message ?? "응답을 받지 못했습니다.");
      }
      setThreadId(data.threadId);
      window.localStorage.setItem(THREAD_STORAGE_KEY, data.threadId);
      setMessages((current) => [...current, { role: "assistant", text: data.text ?? "" }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "응답을 받지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function resetConversation() {
    setThreadId("");
    setMessages([]);
    window.localStorage.removeItem(THREAD_STORAGE_KEY);
  }

  const primaryLimit = status?.rateLimits?.rateLimits?.primary;

  return (
    <main className="sf-app min-h-screen bg-[#161616] px-5 py-8 text-[#E8E8E8] sm:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-center justify-between border-b border-[#393D3A] pb-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#969D98]">Study Forge</p>
            <h1 className="mt-2 text-2xl font-black tracking-tight">Codex 연결</h1>
          </div>
          <Link href="/" className="rounded-[9px] border border-[#393939] bg-[#202020] px-4 py-2 text-sm text-[#B5B5B5] hover:bg-[#292929]">
            돌아가기
          </Link>
        </header>

        <section className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-[#303030] bg-[#303030] sm:grid-cols-3">
          <StatusCell label="로컬 App Server" value={status?.connected ? "연결됨" : status ? "연결 안 됨" : "확인 중"} active={Boolean(status?.connected)} />
          <StatusCell label="ChatGPT 계정" value={chatGptAccount ? `${chatGptAccount.planType} · ${chatGptAccount.email}` : "로그인 필요"} active={loggedIn} />
          <StatusCell label="구독 사용량" value={primaryLimit?.usedPercent === undefined ? "확인 전" : `${Math.round(primaryLimit.usedPercent)}% 사용`} active={loggedIn} />
        </section>

        {!loggedIn ? (
          <section className="mt-8 rounded-2xl border border-[#303030] bg-[#1E1E1E] p-6">
            <h2 className="text-base font-black">ChatGPT로 로그인</h2>
            <p className="mt-2 text-sm leading-6 text-[#AEB4AF]">Codex가 공식 로그인 페이지를 열고 인증 정보를 직접 관리합니다.</p>
            <button type="button" onClick={() => void startLogin()} disabled={busy || !status?.connected} className="mt-5 bg-[#ECEEEB] px-5 py-3 text-sm font-black text-[#202321] disabled:opacity-40">
              {busy ? "로그인 확인 중" : "ChatGPT 로그인"}
            </button>
          </section>
        ) : (
          <>
            <section className="mt-8 grid gap-4 rounded-2xl border border-[#303030] bg-[#1E1E1E] p-5 sm:grid-cols-[1fr_180px_auto]">
              <label className="text-xs font-bold text-[#AEB4AF]">
                모델
                <select value={model} onChange={(event) => setModel(event.target.value)} className="mt-2 w-full border border-[#4B514D] bg-[#1E211F] px-3 py-2.5 text-sm text-[#F0F2EF]">
                  {models.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-[#AEB4AF]">
                추론 강도
                <select value={effort} onChange={(event) => setEffort(event.target.value)} className="mt-2 w-full border border-[#4B514D] bg-[#1E211F] px-3 py-2.5 text-sm text-[#F0F2EF]">
                  {(selectedModel?.supportedReasoningEfforts ?? []).map((item) => <option key={item.reasoningEffort} value={item.reasoningEffort}>{item.reasoningEffort}</option>)}
                </select>
              </label>
              <button type="button" onClick={resetConversation} className="self-end border border-[#4B514D] px-4 py-2.5 text-sm font-bold text-[#D8DAD6] hover:bg-white/5">새 대화</button>
            </section>

            <section className="mt-4 flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-[#303030] bg-[#1E1E1E]">
              <div className="flex-1 space-y-4 p-5">
                {messages.length === 0 ? <p className="text-sm text-[#7F8781]">짧은 프롬프트로 연결을 시험하세요.</p> : null}
                {messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-auto max-w-[78%] rounded-2xl rounded-br-sm bg-[#353A36] px-4 py-3 text-sm leading-6" : "max-w-[86%] px-1 py-2 text-sm leading-6 text-[#E3E6E2]"}>
                    {message.text}
                  </div>
                ))}
              </div>
              <form onSubmit={sendMessage} className="border-t border-[#393D3A] p-4">
                <div className="flex gap-3 rounded-2xl border border-[#4B514D] bg-[#1E211F] p-2">
                  <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Codex에 간단한 프롬프트 보내기" className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-[#707770]" />
                  <button disabled={busy || !input.trim()} className="rounded-xl bg-[#ECEEEB] px-4 py-2 text-sm font-black text-[#202321] disabled:opacity-40">{busy ? "응답 중" : "보내기"}</button>
                </div>
              </form>
            </section>
          </>
        )}

        {error ? <p className="mt-4 border border-[#7A4545] bg-[#382727] px-4 py-3 text-sm text-[#F3C3C3]">{error}</p> : null}
      </div>
    </main>
  );
}

function StatusCell({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className="bg-[#242725] p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#8E9690]">{label}</p>
      <p className="mt-2 flex items-center gap-2 text-sm font-bold">
        <span className={`h-2 w-2 rounded-full ${active ? "bg-[#C7D0C9]" : "bg-[#6D736E]"}`} />
        <span className="truncate">{value}</span>
      </p>
    </div>
  );
}
