"use client";
// 토론방 (2026-10-25): the learner talks plans over with Claude, Codex and Gemini, who answer in turn through the CLIs
// signed in on this computer and may hand the word to each other with @name. Color belongs to the voices; the rest of
// the screen stays ink and paper. The page polls the room while someone is thinking.
import { useCallback, useEffect, useRef, useState } from "react";
import type { BotId, BotModel, Message, Room, RoomSettings } from "@/lib/room/room";
import "./room.css";

type RoomSummary = { id: string; title: string; updatedAt: string; messages: number; working: boolean };
type Meta = { bots: Record<BotId, boolean>; why: Record<BotId, string>; hints: Record<BotId, string[]>; efforts: Record<BotId, string[]> };
const BOTS: BotId[] = ["claude", "codex", "gemini"];
const NAME: Record<string, string> = { claude: "Claude", codex: "Codex", gemini: "Gemini", user: "나", system: "정리" };
const MARK: Record<string, string> = { claude: "C", codex: "X", gemini: "G", user: "나", system: "≡" };
const PLAN: Record<BotId, string> = { claude: "Claude Max", codex: "ChatGPT Plus", gemini: "Google AI Pro" };
const DEFAULTS: RoomSettings = { maxChars: 300, delaySec: 2, chain: true, chainMax: 6, models: { claude: { model: "", effort: "" }, codex: { model: "", effort: "" }, gemini: { model: "", effort: "" } } };
const settingsOf = (room: Room): RoomSettings => ({ ...DEFAULTS, ...room.settings, models: { ...DEFAULTS.models, ...room.settings?.models } });

async function api<T>(url: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(url, { method: method ?? (body === undefined ? "GET" : "POST"), headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string }).message ?? `요청이 실패했어요 (${res.status})`);
  return data as T;
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "방금" : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
/** "@Codex" at the end of an AI's line: the hand-off, shown as a small arrow instead of the raw text. */
const handOff = (m: Message) => m.from === "user" || m.from === "system" ? null : (/@(Claude|Codex|Gemini|클로드|코덱스|제미나이)\s*[?？]?\s*$/i.exec(m.text)?.[1] ?? null);

export default function RoomApp() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [text, setText] = useState("");
  const [rounds, setRounds] = useState(2);
  const [drawer, setDrawer] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [making, setMaking] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seen = useRef(0);

  const loadList = useCallback(async () => {
    const data = await api<{ rooms: RoomSummary[] } & Meta>("/api/room");
    setRooms(data.rooms); setMeta({ bots: data.bots, why: data.why, hints: data.hints, efforts: data.efforts });
    return data.rooms;
  }, []);
  const open = useCallback(async (id: string) => {
    const { room: next } = await api<{ room: Room }>(`/api/room/${id}`);
    setRoom(next);
    try { localStorage.setItem("room:last", id); } catch { /* storage off */ }
  }, []);
  useEffect(() => {
    loadList().then((list) => {
      let last = "";
      try { last = localStorage.getItem("room:last") ?? ""; } catch { /* storage off */ }
      const pick = list.find((r) => r.id === last) ?? list[0];
      if (pick) return open(pick.id); setMaking(true);
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [loadList, open]);

  const busy = Boolean(room?.thinking || room?.pending.length);
  const roomId = room?.id;
  useEffect(() => {
    if (!roomId) return;
    const t = setInterval(() => { open(roomId).catch(() => undefined); }, busy ? 1000 : 5000);
    return () => clearInterval(t);
  }, [roomId, busy, open]);
  useEffect(() => {
    const n = (room?.messages.length ?? 0) + (room?.thinking ? 1 : 0);
    if (n !== seen.current) { seen.current = n; endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }
  }, [room?.messages.length, room?.thinking]);

  const act = async (run: () => Promise<unknown>) => {
    setError("");
    try { await run(); if (room) await open(room.id); await loadList(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const create = () => act(async () => {
    if (!newTitle.trim()) return;
    const { room: made } = await api<{ room: Room }>("/api/room", { title: newTitle, bots: BOTS.filter((b) => meta?.bots[b] !== false) });
    setNewTitle(""); setMaking(false);
    await open(made.id);
  });
  const send = () => act(async () => {
    if (!room || !text.trim()) return;
    const line = text; setText("");
    await api(`/api/room/${room.id}/say`, { text: line });
  });
  const patch = (body: unknown) => room && act(() => api(`/api/room/${room.id}`, body, "PATCH"));
  const setRule = (change: Partial<RoomSettings>) => patch({ settings: change });
  const setModel = (bot: BotId, change: Partial<BotModel>) => patch({ settings: { models: { [bot]: change } } });
  const mention = (bot: BotId) => { setText((t) => `${t.trimEnd()}${t.trim() ? " " : ""}@${NAME[bot]} `); inputRef.current?.focus(); };
  const exportIt = () => room && act(async () => {
    if (!window.confirm("이 대화를 저장소의 협업/토론 폴더에 저장할까요? 공개 저장소라서, 학습자료 원문이 들어 있지 않은지 먼저 확인해 주세요.")) return;
    const { file } = await api<{ file: string }>(`/api/room/${room.id}/export`, {});
    setNote(`${file}에 저장했어요.`);
  });

  const s = room ? settingsOf(room) : DEFAULTS;
  return (
    <div className={`room ${drawer ? "with-drawer" : ""}`}>
      <aside className="rail">
        <div className="rail-head"><span className="mark">토론방</span><button className="ghost" onClick={() => setMaking(true)} aria-label="새 토론">새 토론</button></div>
        {making ? (
          <form className="rail-new" onSubmit={(e) => { e.preventDefault(); create(); }}>
            <input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="무엇을 정할까요?" maxLength={120} />
            <div className="row"><button type="submit" className="ink" disabled={!newTitle.trim()}>만들기</button>{rooms.length ? <button type="button" className="ghost" onClick={() => setMaking(false)}>취소</button> : null}</div>
          </form>
        ) : null}
        <nav className="rail-list">
          {rooms.map((r) => (
            <button key={r.id} className={`rail-item ${room?.id === r.id ? "on" : ""}`} onClick={() => act(() => open(r.id))}>
              <span className="t">{r.title}</span>
              <span className="m">{r.working ? <i className="live" aria-label="대화 중" /> : null}{r.messages ? `${r.messages}마디 · ` : ""}{ago(r.updatedAt)}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="stage">
        {room ? (
          <>
            <header className="stage-head">
              <h1>{room.title}</h1>
              <div className="seats">
                {BOTS.map((b) => {
                  const missing = meta?.bots[b] === false;
                  const on = room.bots.includes(b) && !missing;
                  const label = s.models[b].model || "기본 모델";
                  return (
                    <button key={b} className={`seat seat-${b} ${on ? "on" : "off"} ${room.thinking === b ? "speaking" : ""}`} disabled={missing}
                      title={missing ? `${NAME[b]} CLI를 찾지 못했어요: ${meta?.why[b] || "설치와 로그인을 확인해 주세요"}` : on ? "눌러서 이 토론에서 빼기" : "눌러서 이 토론에 넣기"}
                      onClick={() => patch({ bots: on ? room.bots.filter((x) => x !== b) : [...room.bots, b] })}>
                      <span className="face">{MARK[b]}</span>
                      <span className="who"><b>{NAME[b]}</b><small>{missing ? "찾지 못함" : on ? `${label}${s.models[b].effort ? ` · ${s.models[b].effort}` : ""}` : "빠짐"}</small></span>
                    </button>
                  );
                })}
                <button className={`ghost gear ${drawer ? "on" : ""}`} onClick={() => setDrawer(!drawer)} aria-expanded={drawer}>설정</button>
              </div>
            </header>

            <section className="log" aria-live="polite">
              {!room.messages.length && !room.thinking ? (
                <div className="intro">
                  <p>첫 말을 쓰면 들어와 있는 AI가 차례로 답해요.</p>
                  <p><b>@Codex</b>처럼 이름을 부르면 그 AI만 답하고, AI끼리도 서로 불러 가며 이어서 말해요. <b>자동 토론</b>은 정한 라운드만큼 돌아가며 말해요.</p>
                </div>
              ) : null}
              {room.messages.map((m, i) => {
                const prev = room.messages[i - 1];
                const grouped = Boolean(prev && prev.from === m.from && Date.parse(m.at) - Date.parse(prev.at) < 90_000);
                const to = handOff(m);
                return (
                  <article key={m.id} className={`line from-${m.from} ${grouped ? "grouped" : ""} ${m.error ? "failed" : ""}`}>
                    <span className="face" aria-hidden>{grouped ? "" : MARK[m.from]}</span>
                    <div className="say">
                      {grouped ? null : <header><b>{NAME[m.from] ?? m.from}</b>{m.model ? <span>{m.model}</span> : null}<time>{clock(m.at)}</time>{m.ms ? <span>{Math.round(m.ms / 1000)}초</span> : null}</header>}
                      <p>{to ? m.text.replace(/@\S+\s*[?？]?\s*$/, "").trimEnd() : m.text}</p>
                      {to ? <span className={`pass to-${to.toLowerCase().replace("클로드", "claude").replace("코덱스", "codex").replace("제미나이", "gemini")}`}>{to}에게 넘김</span> : null}
                    </div>
                  </article>
                );
              })}
              {room.thinking ? (
                <article className={`line from-${room.thinking} pending`}>
                  <span className="face" aria-hidden>{MARK[room.thinking]}</span>
                  <div className="say"><header><b>{NAME[room.thinking]}</b><span>생각하는 중</span>{room.pending.length ? <span>다음 {room.pending.slice(0, 3).map((b) => NAME[b]).join(", ")}</span> : null}</header><p className="dots"><i /><i /><i /></p></div>
                </article>
              ) : null}
              <div ref={endRef} />
            </section>

            <footer className="composer">
              {error ? <p className="flash bad" onClick={() => setError("")}>{error}</p> : null}
              {note ? <p className="flash ok" onClick={() => setNote("")}>{note}</p> : null}
              <div className="box">
                <textarea ref={inputRef} value={text} rows={2} placeholder="생각을 쓰거나 질문하세요. Enter로 보내고 Shift+Enter로 줄을 바꿔요."
                  onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
                <div className="bar">
                  <div className="calls">{room.bots.filter((b) => meta?.bots[b] !== false).map((b) => <button key={b} className={`call call-${b}`} onClick={() => mention(b)}>@{NAME[b]}</button>)}</div>
                  <div className="acts">
                    {busy ? <button className="stop" onClick={() => act(() => api(`/api/room/${room.id}/stop`, {}))}>멈추기</button> : (
                      <>
                        <label className="rounds"><select value={rounds} onChange={(e) => setRounds(Number(e.target.value))} aria-label="라운드">{[1, 2, 3, 4, 6].map((n) => <option key={n} value={n}>{n}라운드</option>)}</select></label>
                        <button className="ghost" disabled={!room.bots.length} onClick={() => act(() => api(`/api/room/${room.id}/run`, { rounds }))}>자동 토론</button>
                        <button className="ghost" disabled={!room.messages.length} onClick={() => act(() => api(`/api/room/${room.id}/summary`, {}))}>정리</button>
                      </>
                    )}
                    <button className="ink" disabled={!text.trim()} onClick={send}>보내기</button>
                  </div>
                </div>
              </div>
            </footer>
          </>
        ) : (
          <div className="blank"><p>왼쪽에서 새 토론을 만들어 주세요.</p>{error ? <p className="flash bad">{error}</p> : null}</div>
        )}
      </main>

      {room && drawer ? (
        <aside className="drawer" aria-label="설정">
          <div className="drawer-head"><b>설정</b><button className="ghost" onClick={() => setDrawer(false)}>닫기</button></div>
          <section>
            <h2>모델</h2>
            {BOTS.map((b) => (
              <div key={b} className={`model model-${b}`}>
                <label htmlFor={`m-${b}`}><span className="face">{MARK[b]}</span>{NAME[b]}<small>{PLAN[b]}</small></label>
                <input id={`m-${b}`} list={`hint-${b}`} defaultValue={s.models[b].model} key={`${room.id}-${b}-${s.models[b].model}`} placeholder="비우면 CLI 기본값"
                  onBlur={(e) => { if (e.target.value.trim() !== s.models[b].model) setModel(b, { model: e.target.value.trim() }); }} />
                <datalist id={`hint-${b}`}>{(meta?.hints[b] ?? []).map((h) => <option key={h} value={h} />)}</datalist>
                {(meta?.efforts[b] ?? []).length ? (
                  <select value={s.models[b].effort} onChange={(e) => setModel(b, { effort: e.target.value })} aria-label={`${NAME[b]} 추론 강도`}>
                    <option value="">추론 강도: 기본</option>{meta!.efforts[b].map((x) => <option key={x} value={x}>추론 강도: {x}</option>)}
                  </select>
                ) : null}
              </div>
            ))}
            <p className="hint">모델 이름은 각 CLI가 받는 이름 그대로 써요. 바꾸면 다음 차례부터 적용돼요.</p>
          </section>
          <section>
            <h2>대화 규칙</h2>
            <label className="range">한 번에 말하는 길이 <b>{s.maxChars}자</b>
              <input type="range" min={80} max={1000} step={20} defaultValue={s.maxChars} key={`len-${room.id}-${s.maxChars}`} onPointerUp={(e) => setRule({ maxChars: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => setRule({ maxChars: Number((e.target as HTMLInputElement).value) })} />
            </label>
            <label className="range">AI 사이 쉬는 시간 <b>{s.delaySec}초</b>
              <input type="range" min={0} max={10} step={1} defaultValue={s.delaySec} key={`gap-${room.id}-${s.delaySec}`} onPointerUp={(e) => setRule({ delaySec: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => setRule({ delaySec: Number((e.target as HTMLInputElement).value) })} />
            </label>
            <label className="switch"><input type="checkbox" checked={s.chain} onChange={(e) => setRule({ chain: e.target.checked })} />AI끼리 서로 불러서 이어 말하기</label>
            {s.chain ? (
              <label className="range">내 말 하나에 이어지는 최대 횟수 <b>{s.chainMax}번</b>
                <input type="range" min={1} max={12} step={1} defaultValue={s.chainMax} key={`chain-${room.id}-${s.chainMax}`} onPointerUp={(e) => setRule({ chainMax: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => setRule({ chainMax: Number((e.target as HTMLInputElement).value) })} />
              </label>
            ) : null}
            <label className="switch"><input type="checkbox" checked={room.readFiles} onChange={(e) => patch({ readFiles: e.target.checked })} />저장소 문서·코드를 읽고 근거로 쓰기<small>사용량이 늘어요</small></label>
          </section>
          <section>
            <h2>기록</h2>
            <button className="ghost wide" disabled={!room.messages.length} onClick={exportIt}>협업/토론 폴더에 저장</button>
            <p className="hint">토론은 RecallerData에만 남아요. 저장을 누를 때만 저장소로 옮겨요.</p>
          </section>
        </aside>
      ) : null}
    </div>
  );
}
