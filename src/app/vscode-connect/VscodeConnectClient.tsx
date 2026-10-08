"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useAuthSession } from "@/components/AuthGate";
import { authenticatedFetch } from "@/lib/firebase-client";

export default function VscodeConnectClient() {
  const session = useAuthSession();
  const router = useRouter();
  const params = useSearchParams();
  const callbackUri = params.get("callbackUri") ?? "";
  const state = params.get("state") ?? "";
  const challenge = params.get("challenge") ?? "";
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  const complete = Boolean(callbackUri && state && challenge);

  async function connect() {
    setStatus("working");
    setMessage("");
    try {
      const response = await authenticatedFetch("/api/auth/vscode-link/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callbackUri, state, challenge }),
      });
      const data = (await response.json()) as { callbackUri?: string; message?: string };
      if (!response.ok || !data.callbackUri) {
        throw new Error(data.message ?? "계정 연결을 시작하지 못했습니다.");
      }
      window.location.assign(data.callbackUri);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "계정 연결에 실패했습니다.");
      setStatus("error");
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#313338] px-5 text-[#F2F3F5]">
      <section className="w-full max-w-lg rounded-lg border border-[#3F4147] bg-[#2B2D31] p-6 shadow-xl">
        <p className="text-xs font-bold uppercase tracking-wider text-[#B5BAC1]">Study Forge</p>
        <h1 className="mt-2 text-2xl font-black text-white">VS Code 계정 연결</h1>
        <p className="mt-3 text-sm leading-6 text-[#B5BAC1]">
          VS Code에서 학습 기록과 학습자 메모리를 이 계정에 저장하도록 연결합니다.
          AI 생성 권한은 공유되지 않습니다.
        </p>
        <div className="mt-5 rounded-md border border-[#3F4147] bg-[#1E1F22] p-4 text-sm">
          <span className="text-[#B5BAC1]">연결할 계정</span>
          <p className="mt-1 font-bold text-white">{session.email}</p>
        </div>
        {!complete ? (
          <p className="mt-4 rounded-md border border-[#ED4245]/50 bg-[#ED4245]/10 p-3 text-sm text-[#FFD7D8]">
            VS Code 연결 정보가 빠졌습니다. 확장에서 다시 연결해 주세요.
          </p>
        ) : null}
        {message ? (
          <p className="mt-4 rounded-md border border-[#ED4245]/50 bg-[#ED4245]/10 p-3 text-sm text-[#FFD7D8]">{message}</p>
        ) : null}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => void connect()}
            disabled={!complete || status === "working"}
            className="flex-1 rounded-md bg-[#5865F2] px-4 py-2.5 font-black text-white hover:bg-[#4752C4] disabled:cursor-not-allowed disabled:bg-[#4E5058]"
          >
            {status === "working" ? "연결 중" : "이 계정 연결"}
          </button>
          <button
            type="button"
            onClick={() => { window.close(); if (!window.closed) router.push("/"); }}
            className="rounded-md border border-[#4E5058] px-4 py-2.5 font-bold text-[#DCDDDE] hover:bg-[#383A40]"
          >
            취소
          </button>
        </div>
      </section>
    </main>
  );
}
