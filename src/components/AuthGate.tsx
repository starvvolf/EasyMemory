"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  getRedirectResult,
  onIdTokenChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase-client";

type AuthSession = {
  uid: string;
  email: string;
  canUseAi: boolean;
  mode?: "firebase" | "local-experiment";
};

const AuthSessionContext = createContext<AuthSession | null>(null);

export function useAuthSession(): AuthSession {
  const session = useContext(AuthSessionContext);
  if (!session) {
    throw new Error("AuthGate 안에서만 인증 세션을 사용할 수 있습니다.");
  }
  return session;
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<"loading" | "signed-out" | "ready" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    function initializeFirebase() {
      if (!active) return;
      try {
        const auth = getFirebaseAuth();
        void getRedirectResult(auth).catch((error: unknown) => {
          if (active) {
            setMessage(toSignInMessage(error));
            setStatus("signed-out");
          }
        });

        unsubscribe = onIdTokenChanged(auth, async (user) => {
          if (!active) return;
          if (!user) {
            setSession(null);
            setStatus("signed-out");
            return;
          }

          setStatus("loading");
          try {
            const response = await fetch("/api/auth/session", {
              method: "POST",
              headers: { Authorization: `Bearer ${await user.getIdToken()}` },
            });
            const data = (await response.json()) as Partial<AuthSession> & {
              message?: string;
            };
            if (!response.ok) {
              throw new Error(data.message ?? "로그인 정보를 확인하지 못했습니다.");
            }
            if (!data.uid || !data.email || typeof data.canUseAi !== "boolean") {
              throw new Error("서버가 올바른 인증 정보를 반환하지 않았습니다.");
            }
            if (active) {
              setSession({
                uid: data.uid,
                email: data.email,
                canUseAi: data.canUseAi,
                mode: "firebase",
              });
              setMessage("");
              setStatus("ready");
            }
          } catch (error) {
            if (active) {
              setSession(null);
              setMessage(error instanceof Error ? error.message : "로그인에 실패했습니다.");
              setStatus("error");
            }
          }
        });
      } catch (error) {
        queueMicrotask(() => {
          if (!active) return;
          setMessage(
            error instanceof Error
              ? error.message
              : "Firebase 인증을 초기화하지 못했습니다.",
          );
          setStatus("error");
        });
      }
    }

    void fetch("/api/local-experiment/status", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { active?: boolean } : { active: false })
      .then((mode) => {
        if (!active) return;
        if (mode.active) {
          setSession({ uid: "local-experiment", email: "", canUseAi: true, mode: "local-experiment" });
          setMessage("");
          setStatus("ready");
        } else {
          initializeFirebase();
        }
      })
      .catch(() => initializeFirebase());

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function handleSignIn() {
    setMessage("");
    setStatus("loading");
    try {
      const auth = getFirebaseAuth();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const prefersRedirect =
        window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 768;
      if (prefersRedirect) {
        await signInWithRedirect(auth, provider);
      } else {
        await signInWithPopup(auth, provider);
      }
    } catch (error) {
      setMessage(toSignInMessage(error));
      setStatus("signed-out");
    }
  }

  if (status !== "ready" || !session) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#313338] px-5 text-[#F2F3F5]">
        <section className="w-full max-w-md rounded-lg border border-[#3F4147] bg-[#2B2D31] p-6 shadow-xl">
          <p className="text-xs font-bold uppercase tracking-wider text-[#B5BAC1]">
            Study Forge
          </p>
          <h1 className="mt-2 text-2xl font-black text-white">Google 로그인</h1>
          <p className="mt-3 text-sm leading-6 text-[#B5BAC1]">
            Google 계정으로 로그인하면 앱과 이 브라우저에 저장된 로컬 덱을 사용할 수
            있습니다.
          </p>
          {message ? (
            <p className="mt-4 rounded-md border border-[#ED4245]/50 bg-[#ED4245]/10 p-3 text-sm leading-6 text-[#FFD7D8]">
              {message}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSignIn()}
            disabled={status === "loading"}
            className="mt-5 w-full rounded-md bg-[#5865F2] px-4 py-2.5 font-black text-white hover:bg-[#4752C4] disabled:cursor-wait disabled:bg-[#4E5058]"
          >
            {status === "loading" ? "로그인 확인 중" : "Google로 계속하기"}
          </button>
        </section>
      </main>
    );
  }

  async function handleSignOut() {
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } finally {
      await signOut(getFirebaseAuth());
    }
  }

  return (
    <AuthSessionContext.Provider value={session}>
      {session.mode === "local-experiment" ? (
        <div className="border-b border-[#F0B232]/40 bg-[#F0B232]/15 px-4 py-3 text-center text-sm font-bold text-[#FFF1C2]">
          로컬 실험모드입니다. 이 실행은 Google 계정에 연결되지 않으며 기존 클라우드 데이터 기능은 사용할 수 없습니다.
        </div>
      ) : null}
      {!session.canUseAi ? (
        <div className="border-b border-[#F0B232]/40 bg-[#F0B232]/15 px-4 py-3 text-center text-sm font-bold text-[#FFF1C2]">
          일반 회원은 이 브라우저의 로컬 덱을 학습할 수 있습니다. AI 생성과 사용자별
          분리가 되지 않은 서버 프로젝트 기능은 아직 사용할 수 없습니다.
        </div>
      ) : null}
      <div className="fixed right-4 top-3 z-50 flex items-center gap-3 rounded-md border border-[#3F4147] bg-[#1E1F22]/95 px-3 py-2 text-xs text-[#B5BAC1] shadow-lg backdrop-blur">
        <span className="max-w-48 truncate">{session.mode === "local-experiment" ? "로컬 실험" : session.email}</span>
        <span className="rounded bg-[#383A40] px-1.5 py-0.5 font-bold text-[#DCDDDE]">
          {session.mode === "local-experiment" ? "실험" : session.canUseAi ? "운영자" : "일반 회원"}
        </span>
        {session.mode !== "local-experiment" ? (
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="font-bold text-white hover:underline"
          >
            로그아웃
          </button>
        ) : null}
      </div>
      {children}
    </AuthSessionContext.Provider>
  );
}

function toSignInMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code);
    if (code === "auth/popup-closed-by-user") return "로그인 창이 닫혔습니다. 다시 시도해 주세요.";
    if (code === "auth/popup-blocked") return "브라우저가 로그인 창을 차단했습니다. 팝업을 허용한 뒤 다시 시도해 주세요.";
  }
  return error instanceof Error ? error.message : "Google 로그인에 실패했습니다.";
}
