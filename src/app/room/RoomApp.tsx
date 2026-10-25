"use client";
// 토론방 (2026-10-25): the learner talks plans over with Claude, Codex and Gemini, who answer in turn through the CLIs
// signed in on this computer and may hand the word to each other with @name. Color belongs to the voices; the rest of
// the screen stays ink and paper. The page polls the room while someone is thinking.
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { BotId, BotModel, Message, Room, RoomSettings } from "@/lib/room/room";
import "./room.css";

type RoomSummary = { id: string; title: string; updatedAt: string; messages: number; working: boolean };
type Meta = { bots: Record<BotId, boolean>; why: Record<BotId, string>; hints: Record<BotId, string[]>; efforts: Record<BotId, string[]>; tones: Record<string, string>; personas: Record<BotId, string> };
type Preview = { next: string; last: { bot: BotId; prompt: string; at: string } | null };
const BOTS: BotId[] = ["claude", "codex", "gemini"];
const NAME: Record<string, string> = { claude: "Claude", codex: "Codex", gemini: "Gemini", user: "나", system: "정리" };
const MARK: Record<string, string> = { claude: "C", codex: "X", gemini: "G", user: "나", system: "≡" };
const PLAN: Record<BotId, string> = { claude: "Claude Max", codex: "ChatGPT Plus", gemini: "Google AI Pro" };
const DEFAULTS: RoomSettings = { maxChars: 300, delaySec: 2, chain: true, chainMax: 6, models: { claude: { model: "opus", effort: "" }, codex: { model: "gpt-6.1-sol", effort: "medium" }, gemini: { model: "", effort: "" } },
  tone: "편한 동료", speech: "존댓말", personas: { claude: "", codex: "", gemini: "" } };
const settingsOf = (room: Room): RoomSettings => ({ ...DEFAULTS, ...room.settings, models: { ...DEFAULTS.models, ...room.settings?.models }, personas: { ...DEFAULTS.personas, ...room.settings?.personas } });
const metaOf = (data: Meta): Meta => ({ bots: data.bots, why: data.why, hints: data.hints, efforts: data.efforts, tones: data.tones ?? {}, personas: data.personas ?? { claude: "", codex: "", gemini: "" } });

/** Light markdown, as chat apps show it: paragraphs, - lists, **bold** and `code`. Built as elements, never as HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b>
      : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>);
}
function Rich({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return <>{blocks.map((block, i) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
      const ordered = /^\s*\d/.test(lines[0]);
      const items = lines.map((l, k) => <li key={k}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>);
      return ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
    }
    return <p key={i}>{lines.map((l, k) => <Fragment key={k}>{k ? <br /> : null}{inline(l)}</Fragment>)}</p>;
  })}</>;
}

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
  const [preview, setPreview] = useState<{ bot: BotId; data: Preview } | null>(null);
  const [renaming, setRenaming] = useState(false);
  // The room shown now, kept in a ref too: an action that switches rooms must reload the new one, not the one its
  // closure saw (opening a new room used to jump back to the old one).
  const current = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seen = useRef(0);

  const loadList = useCallback(async () => {
    const data = await api<{ rooms: RoomSummary[] } & Meta>("/api/room");
    setRooms(data.rooms); setMeta(metaOf(data));
    return data.rooms;
  }, []);
  const open = useCallback(async (id: string) => {
    if (current.current !== id) { setPreview(null); setRenaming(false); }
    current.current = id;
    const { room: next } = await api<{ room: Room }>(`/api/room/${id}`);
    if (current.current !== id) return;
    setRoom(next);
    try { localStorage.setItem("room:last", id); } catch { /* storage off */ }
  }, []);
  // First load: state is set only in the request's callbacks, not in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let alive = true;
    api<{ rooms: RoomSummary[] } & Meta>("/api/room").then(async (data) => {
      if (!alive) return;
      setRooms(data.rooms); setMeta(metaOf(data));
      let last = "";
      try { last = localStorage.getItem("room:last") ?? ""; } catch { /* storage off */ }
      const pick = data.rooms.find((r) => r.id === last) ?? data.rooms[0];
      if (pick) await open(pick.id); else setMaking(true);
    }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [open]);

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
    try { await run(); if (current.current) await open(current.current).catch(() => undefined); await loadList(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
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
  const showPrompt = (bot: BotId) => room && act(async () => setPreview({ bot, data: await api<Preview>(`/api/room/${room.id}/prompt?bot=${bot}`) }));
  const clearIt = () => room && act(async () => { if (window.confirm("이 방의 대화를 모두 지울까요? 설정과 메모는 남아요.")) await api(`/api/room/${room.id}/clear`, {}); });
  const resetIt = () => room && act(async () => { if (window.confirm("이 방의 설정(모델·말투·성격·규칙)을 기본값으로 되돌릴까요?")) await api(`/api/room/${room.id}`, { resetSettings: true }, "PATCH"); });
  const deleteIt = () => room && act(async () => {
    if (!window.confirm(`"${room.title}" 방을 지울까요? 대화가 모두 사라져요.`)) return;
    await api(`/api/room/${room.id}`, undefined, "DELETE");
    current.current = null; setRoom(null); setDrawer(false);
    const list = await loadList();
    if (list[0]) await open(list[0].id); else setMaking(true);
  });
  const shownBots = BOTS.filter((b) => meta?.bots[b] !== false || room?.bots.includes(b));
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
              {renaming ? (
                <form onSubmit={(e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem("t") as HTMLInputElement).value; setRenaming(false); if (v.trim() && v !== room.title) patch({ title: v }); }}>
                  <input name="t" className="rename" autoFocus defaultValue={room.title} maxLength={120} onBlur={(e) => e.currentTarget.form?.requestSubmit()} />
                </form>
              ) : <h1 title="눌러서 이름 바꾸기" onClick={() => setRenaming(true)}>{room.title}</h1>}
              <div className="seats">
                {shownBots.map((b) => {
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
                      <div className="text"><Rich text={to ? m.text.replace(/@\S+\s*[?？]?\s*$/, "").trimEnd() : m.text} /></div>
                      {to ? <span className={`pass to-${to.toLowerCase().replace("클로드", "claude").replace("코덱스", "codex").replace("제미나이", "gemini")}`}>{to}에게 넘김</span> : null}
                    </div>
                  </article>
                );
              })}
              {room.thinking ? (
                <article className={`line from-${room.thinking} pending`}>
                  <span className="face" aria-hidden>{MARK[room.thinking]}</span>
                  <div className="say"><header><b>{NAME[room.thinking]}</b><span>생각하는 중</span>{room.pending.length ? <span>다음 {room.pending.slice(0, 3).map((b) => NAME[b]).join(", ")}</span> : null}</header><div className="dots"><i /><i /><i /></div></div>
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
            {shownBots.map((b) => (
              <div key={b} className={`model model-${b}`}>
                <label htmlFor={`m-${b}`}><span className="face">{MARK[b]}</span>{NAME[b]}<small>{PLAN[b]}</small></label>
                <input id={`m-${b}`} list={`hint-${b}`} defaultValue={s.models[b].model} key={`${room.id}-${b}-${s.models[b].model}`} placeholder={b === "gemini" ? "비우면 기본값 (이름 목록: agy models)" : "비우면 CLI 기본값"}
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
            <h2>말투와 성격</h2>
            <label className="field">말투
              <select value={meta?.tones[s.tone] ? s.tone : "직접"} onChange={(e) => { if (e.target.value !== "직접") setRule({ tone: e.target.value }); else setRule({ tone: "" }); }}>
                {Object.keys(meta?.tones ?? {}).map((t) => <option key={t} value={t}>{t}</option>)}<option value="직접">직접 쓰기</option>
              </select>
            </label>
            {meta?.tones[s.tone] ? <p className="hint">{meta.tones[s.tone]}</p> : (
              <textarea className="area" rows={2} defaultValue={s.tone} key={`tone-${room.id}-${s.tone}`} placeholder="예: 스타트업 공동창업자처럼, 짧고 단호하게" onBlur={(e) => { if (e.target.value !== s.tone) setRule({ tone: e.target.value.trim() }); }} />
            )}
            <div className="seg" role="radiogroup" aria-label="높임말">
              {(["존댓말", "반말"] as const).map((v) => <button key={v} role="radio" aria-checked={s.speech === v} className={s.speech === v ? "on" : ""} onClick={() => setRule({ speech: v })}>{v}</button>)}
            </div>
            {shownBots.map((b) => (
              <label key={b} className={`field model-${b}`}><span><span className="face">{MARK[b]}</span>{NAME[b]}의 성격</span>
                <textarea className="area" rows={3} defaultValue={s.personas[b]} key={`p-${room.id}-${b}-${s.personas[b]}`} placeholder={meta?.personas[b] ?? ""}
                  onBlur={(e) => { if (e.target.value.trim() !== s.personas[b]) patch({ settings: { personas: { [b]: e.target.value.trim() } } }); }} />
              </label>
            ))}
            <p className="hint">비워 두면 흐린 글씨의 기본 성격을 써요.</p>
          </section>
          <section>
            <h2>이 방에서 알고 있을 것</h2>
            <textarea className="area" rows={4} defaultValue={room.memo ?? ""} key={`memo-${room.id}-${room.memo ?? ""}`} placeholder="예: 교수님 미팅은 10/30. 발표 주장은 '검증'. 계산 과목 위주."
              onBlur={(e) => { if (e.target.value !== (room.memo ?? "")) patch({ memo: e.target.value }); }} />
            <p className="hint">다른 곳에서 정한 것, 마감, 조건을 적어 두면 매 차례 함께 전해요. AI들은 각자의 앱 메모리를 보지 못해요.</p>
          </section>
          <section>
            <h2>프롬프트 보기</h2>
            <div className="row">{room.bots.map((b) => <button key={b} className={`ghost call-${b}`} onClick={() => showPrompt(b)}>{NAME[b]}에게 가는 것</button>)}</div>
            {preview ? (
              <div className="prompt">
                <div className="prompt-head"><b>{NAME[preview.bot]}의 다음 차례</b><button className="ghost" onClick={() => setPreview(null)}>닫기</button></div>
                <pre>{preview.data.next}</pre>
                {preview.data.last ? <><div className="prompt-head"><b>마지막으로 보낸 것 ({NAME[preview.data.last.bot]}, {clock(preview.data.last.at)})</b></div><pre>{preview.data.last.prompt}</pre></> : null}
              </div>
            ) : <p className="hint">AI가 매 차례 받는 글 전체예요. 규칙, 말투, 메모, 최근 대화가 이 순서로 들어가요.</p>}
          </section>
          <section>
            <h2>방 관리</h2>
            <button className="ghost wide" disabled={!room.messages.length} onClick={exportIt}>협업/토론 폴더에 저장</button>
            <button className="ghost wide" disabled={!room.messages.length} onClick={clearIt}>대화 비우기</button>
            <button className="ghost wide" onClick={resetIt}>설정을 기본값으로</button>
            <button className="ghost wide danger" onClick={deleteIt}>방 지우기</button>
            <p className="hint">토론은 RecallerData에만 남아요. 저장을 누를 때만 저장소로 옮겨요.</p>
          </section>
        </aside>
      ) : null}
    </div>
  );
}
