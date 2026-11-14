"use client";
// Recaller는 내 PC에서만 돈다 (11/15 리팩토링: 예전 Firebase 로그인 길을 뺐다). 서버가 127.0.0.1로 켜졌고
// 이 요청이 그 주소로 왔는지만 확인하고, 아니면 앱으로 열라고 안내한다. AI 계정은 화면 머리의 ChatGPT 칩이 맡는다.
import { useEffect, useState, type ReactNode } from "react";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | "blocked">("loading");
  useEffect(() => {
    let alive = true;
    fetch("/api/local-experiment/status", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ active?: boolean }>)
      .then((d) => { if (alive) setState(d.active ? "ready" : "blocked"); })
      .catch(() => { if (alive) setState("blocked"); });
    return () => { alive = false; };
  }, []);
  if (state === "ready") return <>{children}</>;
  return (
    <main style={{ maxWidth: 560, margin: "15vh auto", padding: "0 16px", fontFamily: "system-ui, sans-serif", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 22 }}>Recaller</h1>
      <p>{state === "loading" ? "준비하는 중…" : "Recaller는 내 PC에서만 열려요. 바탕화면의 Recaller 앱(또는 127.0.0.1:3000)으로 열어 주세요."}</p>
    </main>
  );
}
