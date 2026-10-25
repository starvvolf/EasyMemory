"use client";
// 토론방 (2026-10-25): a small Discord-like room. The learner writes; Claude, Codex and Gemini answer in turn through
// the CLIs signed in on this computer. Answers come one by one; the page polls while someone is thinking.
import { useCallback, useEffect, useRef, useState } from "react";
import type { BotId, Message, Room } from "@/lib/room/room";
import "./room.css";

type RoomSummary = { id: string; title: string; updatedAt: string; messages: number; working: boolean };
const BOTS: BotId[] = ["claude", "codex", "gemini"];
const NAME: Record<string, string> = { claude: "Claude", codex: "Codex", gemini: "Gemini", user: "나", system: "정리" };
const PLAN: Record<BotId, string> = { claude: "Claude Max", codex: "ChatGPT Plus", gemini: "Google AI Pro" };

async function api<T>(url: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(url, { method: method ?? (body === undefined ? "GET" : "POST"), headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string }).message ?? `요청 실패 (${res.status})`);
  return data as T;
}
const time = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

export default function RoomApp() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [ready, setReady] = useState<Record<BotId, boolean> | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [text, setText] = useState("");
  const [rounds, setRounds] = useState(3);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const listEnd = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const loadList = useCallback(async () => {
    const data = await api<{ rooms: RoomSummary[]; bots: Record<BotId, boolean> }>("/api/room");
    setRooms(data.rooms); setReady(data.bots);
    return data.rooms;
  }, []);
  const open = useCallback(async (id: string) => {
    const { room } = await api<{ room: Room }>(`/api/room/${id}`);
    setRoom(room);
    try { localStorage.setItem("room:last", id); } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    loadList().then((list) => {
      let last = "";
      try { last = localStorage.getItem("room:last") ?? ""; } catch { /* private mode */ }
      const pick = list.find((r) => r.id === last) ?? list[0];
      if (pick) open(pick.id).catch((e) => setError(String(e.message ?? e)));
    }).catch((e) => setError(String(e.message ?? e)));
  }, [loadList, open]);

  // Poll quickly while a bot is thinking, slowly otherwise (another tab may be talking in the same room).
  const busy = Boolean(room?.thinking || room?.pending.length);
  const roomId = room?.id;
  useEffect(() => {
    if (!roomId) return;
    const t = setInterval(() => { open(roomId).catch(() => undefined); }, busy ? 1200 : 5000);
    return () => clearInterval(t);
  }, [roomId, busy, open]);
  useEffect(() => {
    const n = room?.messages.length ?? 0;
    if (n !== lastCount.current) { lastCount.current = n; listEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }
  }, [room?.messages.length, room?.thinking]);

  const act = async (run: () => Promise<unknown>) => {
    setError("");
    try { await run(); if (room) await open(room.id); await loadList(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const newRoom = () => act(async () => {
    const title = window.prompt("토론 주제", "교수님 미팅에서 내세울 주장 하나");
    if (!title) return;
    const { room: made } = await api<{ room: Room }>("/api/room", { title, bots: BOTS.filter((b) => ready?.[b] !== false) });
    await open(made.id);
  });
  const send = () => act(async () => {
    if (!room || !text.trim()) return;
    const line = text; setText("");
    await api(`/api/room/${room.id}/say`, { text: line });
  });
  const toggleBot = (b: BotId) => room && act(() => api(`/api/room/${room.id}`, { bots: room.bots.includes(b) ? room.bots.filter((x) => x !== b) : [...room.bots, b] }, "PATCH"));
  const toggleFiles = () => room && act(() => api(`/api/room/${room.id}`, { readFiles: !room.readFiles }, "PATCH"));
  const exportIt = () => room && act(async () => {
    if (!window.confirm("이 대화를 저장소의 협업/토론 폴더에 저장할까요? (공개 저장소라 학습자료 원문이 들어 있지 않은지 확인해 주세요)")) return;
    const { file } = await api<{ file: string }>(`/api/room/${room.id}/export`, {});
    setNote(`저장했어요: ${file}`);
  });

  return (
    <div className="room">
      <aside className="room-side">
        <div className="room-brand">토론방</div>
        <button className="room-new" onClick={newRoom}>＋ 새 토론</button>
        <nav>
          {rooms.map((r) => (
            <button key={r.id} className={`room-chan${room?.id === r.id ? " on" : ""}`} onClick={() => act(() => open(r.id))} title={r.title}>
              <span className="hash">#</span><span className="name">{r.title}</span>{r.working ? <span className="dot" /> : null}
            </button>
          ))}
        </nav>
        <div className="room-who">
          {BOTS.map((b) => (
            <div key={b} className={`room-member ${ready?.[b] === false ? "off" : ""}`} title={ready?.[b] === false ? `${b} CLI를 찾지 못했어요 (설치·로그인 확인)` : PLAN[b]}>
              <span className={`av av-${b}`}>{NAME[b][0]}</span><span>{NAME[b]}</span><small>{ready?.[b] === false ? "없음" : PLAN[b]}</small>
            </div>
          ))}
        </div>
      </aside>

      <main className="room-main">
        {room ? (
          <>
            <header className="room-head">
              <div className="title"><span className="hash">#</span>{room.title}</div>
              <div className="tools">
                {BOTS.map((b) => (
                  <button key={b} className={`pill ${room.bots.includes(b) ? "on" : ""}`} disabled={ready?.[b] === false} onClick={() => toggleBot(b)}>{NAME[b]}</button>
                ))}
                <button className={`pill ${room.readFiles ? "on" : ""}`} onClick={toggleFiles} title="켜면 저장소 문서·코드를 읽어 근거로 씁니다 (사용량이 늘어요)">파일 읽기</button>
                <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))} aria-label="라운드 수">
                  {[1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n}라운드</option>)}
                </select>
                <button className="go" disabled={!room.bots.length} onClick={() => act(() => api(`/api/room/${room.id}/run`, { rounds }))}>자동 토론</button>
                <button onClick={() => act(() => api(`/api/room/${room.id}/summary`, {}))}>정리</button>
                {busy ? <button className="stop" onClick={() => act(() => api(`/api/room/${room.id}/stop`, {}))}>멈추기</button> : null}
                <button onClick={exportIt} title="협업/토론 폴더에 마크다운으로 저장">저장</button>
              </div>
            </header>

            <section className="room-log">
              {!room.messages.length ? <p className="empty">첫 말을 써 보세요. 모두 한 번씩 답하고, <b>@claude @codex @gemini</b>로 지목하면 그 AI만 답해요. <b>자동 토론</b>은 AI끼리 라운드를 돌아요.</p> : null}
              {room.messages.map((m: Message, i) => {
                const prev = room.messages[i - 1];
                const grouped = prev && prev.from === m.from && Date.parse(m.at) - Date.parse(prev.at) < 120_000;
                return (
                  <div key={m.id} className={`msg ${m.from} ${grouped ? "grouped" : ""} ${m.error ? "err" : ""}`}>
                    {grouped ? <span className="av-space" /> : <span className={`av av-${m.from}`}>{NAME[m.from]?.[0] ?? "?"}</span>}
                    <div className="body">
                      {grouped ? null : <div className="meta"><b>{NAME[m.from] ?? m.from}</b><span>{time(m.at)}</span>{m.ms ? <span>{(m.ms / 1000).toFixed(0)}초</span> : null}</div>}
                      <div className="text">{m.text}</div>
                    </div>
                  </div>
                );
              })}
              {room.thinking ? (
                <div className="msg thinking">
                  <span className={`av av-${room.thinking}`}>{NAME[room.thinking][0]}</span>
                  <div className="body"><div className="meta"><b>{NAME[room.thinking]}</b><span>생각 중</span>{room.pending.length ? <span>다음: {room.pending.slice(0, 4).map((b) => NAME[b]).join(" → ")}{room.pending.length > 4 ? " …" : ""}</span> : null}</div><div className="typing"><i /><i /><i /></div></div>
                </div>
              ) : null}
              <div ref={listEnd} />
            </section>

            <footer className="room-input">
              {error ? <div className="room-error">{error}</div> : null}
              {note ? <div className="room-note" onClick={() => setNote("")}>{note}</div> : null}
              <textarea value={text} rows={2} placeholder={`#${room.title}에 메시지 보내기 — @claude @codex @gemini로 지목`} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
            </footer>
          </>
        ) : (
          <div className="room-empty"><p>토론이 없어요.</p><button className="go" onClick={newRoom}>＋ 새 토론 만들기</button>{error ? <p className="room-error">{error}</p> : null}</div>
        )}
      </main>
    </div>
  );
}
