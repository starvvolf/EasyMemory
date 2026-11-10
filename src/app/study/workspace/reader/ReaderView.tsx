"use client";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RichInline } from "../Rich";
import { useBridge, type Bridge } from "../bridge";
import { PendingNote, type Pending } from "../MaterialList";
import ChatWindow, { type ChatApi, type ChatV } from "./ChatWindow";
import NoteCard, { type NoteApi, type NoteV } from "./NoteCard";
import { MdLines } from "./Md";

/* 원문 읽기 (11/11 바닐라 renderReader를 React로). PDF 쪽 그림·글자 층·밑줄은 앱의 그리는 함수(api.draw)가 #pagebox 안에 그린다
   (React는 그 칸의 안을 건드리지 않는다). 나머지(도구 줄·익힐 것·곁 패널·답 카드·크게 보기·아래 줄)는 여기서. */
type GoalX = { text: string; streaming: boolean; canAsk: boolean; err: string; loading: boolean; saved: boolean; hasItems: boolean; custom: boolean };
type Obj = { id: string; num: number; statement: string; active: boolean; open: boolean; gx: GoalX | null; label: string; cls: string; pulse: boolean };
type Side = {
  shown: "ask" | "goals" | "state"; peek: boolean; badge: string[]; pulseState: boolean;
  state: { n: number; notes: number; terms: string[] | null; good: number; total: number; weak: number; due: number; fresh: number; today: { mine: number; left: number; done: number; canGo: boolean } | null };
};
type Snap = {
  decks: Array<{ id: string; title: string }>; deckId: string; title: string; page: number; total: number; key: string; example: boolean; practicing: boolean;
  pdf: string; pdfOn: boolean; wide: boolean; docked: boolean; aspect: number; zoom: boolean; floatable: boolean;
  tools: { terms: boolean | null; trans: boolean | null; termMap: boolean; map: boolean; notes: { count: number; open: boolean } | null };
  making: Pending | null; text: Array<{ text: string; mark?: boolean; num?: number; dim?: boolean; line?: boolean }> | null;
  objs: Obj[]; pendingGoals: boolean; n: number; nxt: number | null; notesHint: boolean; chatOpen: boolean; side: Side | null; paint: string;
  note: NoteV | null; chat: ChatV | null;
} | null;
type Api = NoteApi & {
  snapshot(): Snap; pickDeck(id: string): void; go(n: number): void; terms(): void; trans(): void; termMap(): void; map(): void; notes(): void; zoom(on: boolean): void;
  chat(): void; attach(): void; float(): void; newChat(): void; tab(k: string): void; goal(id: string): void; goalRedo(id: string): void; goalAsk(id: string): void;
  hide(id: string): void; check(id?: string): void; practice(): void; today(): void; quote(t: string): void; gear(k: string): void; draw(): void; fit(): void;
  chatApi: ChatApi;
  toggleGoal(id: string, gid: string): void; confirmGoals(id: string): void; makeQuestions(id: string): void; resume(id: string): void; restart(id: string): void; remove(id: string): void;
};

export default function ReaderView({ ui, api }: { ui: Bridge; api: Api }) {
  useBridge(ui);
  const s = api.snapshot();
  const grid = useRef<HTMLDivElement | null>(null);
  // 쪽 칸의 폭·높이를 화면에 맞추는 것(fitPage)은 그릴 때마다, 쪽 그림은 그릴 것이 바뀔 때만.
  useLayoutEffect(() => { api.fit(); });
  const paint = s ? s.paint : "";
  useEffect(() => { if (paint) requestAnimationFrame(() => api.draw()); }, [paint, api]);
  const [pg, setPg] = useState(""), [pgKey, setPgKey] = useState("");
  if (s && pgKey !== s.key) { setPgKey(s.key); setPg(String(s.page)); }
  if (!s) return <div className="panel">아직 자료가 없어요.</div>;

  const goals = s.objs.length && !(s.wide && s.docked) ? (
    <div className="goals"><span className="lbl">이 쪽에서 익힐 것</span>
      {s.objs.map(o => (
        <Fragment key={o.id}>
          <div className="goalrow">
            <button className="goal" aria-pressed={o.active} aria-expanded={o.open} title="이 목표를 정리해서 보기 (원문에서도 이 부분을 진하게)" onClick={() => api.goal(o.id)}>
              <span className="gnum">{o.num}</span><span><RichInline text={o.statement} /></span>
            </button>
            {s.example ? null : <button className="linkish" title="이 목표의 문제를 연습·복습에서 빼기" onClick={() => api.hide(o.id)}>빼기</button>}
          </div>
          {o.gx ? <GoalNote o={o} api={api} /> : null}
        </Fragment>
      ))}
    </div>
  ) : null;

  const sheet = s.pdfOn ? (
    <div className="sheet">
      <div className="pagebox" id="pagebox" data-key={s.key} style={s.wide ? { aspectRatio: String(s.aspect) } : undefined} data-loading={s.pdf === "loading" ? "원본 PDF를 불러오는 중…" : "쪽을 그리는 중…"} />
      {s.pdf === "ready" ? <button className="zoombtn" aria-label="크게 보기" onClick={() => api.zoom(true)}>크게 보기</button> : null}
    </div>
  ) : (
    <div className="sheet"><div className="paper"><div className="inner"><span className="pn">p.{s.page}</span>
      {s.text ? s.text.map((seg, i) => seg.mark
        ? <mark key={i} className={`quote${seg.line ? " line" : ""}`} style={seg.dim ? { opacity: 0.4 } : undefined}>{seg.num ? <sup className={`qn${seg.line ? " line" : ""}`}>{seg.num}</sup> : null}{seg.text}</mark>
        : <Fragment key={i}>{seg.text}</Fragment>) : <span className="muted">이 쪽은 저장된 텍스트가 없어요.</span>}
    </div></div></div>
  );
  const floatingNote = !!s.note && (s.wide || !s.pdfOn);
  return (
    <div>
      {s.practicing ? <div className="banner" role="status"><span>연습 중이에요. 여기서 본 쪽의 문제는 이번 연습에서 ‘정답 보고 풂’으로 기록돼요.</span><button className="btn small" onClick={api.practice}>연습으로 돌아가기</button></div> : null}
      <div className="rbar">
        <select id="readDeck" aria-label="자료 고르기" value={s.deckId} onChange={(e) => api.pickDeck(e.target.value)}>{s.decks.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
        <span className="grow" />
        {s.tools.terms !== null ? <button className="btn small" aria-pressed={s.tools.terms} title="핵심 용어·개념 목표의 용어를 쪽에 표시" onClick={api.terms}>핵심 용어</button> : null}
        {s.tools.trans !== null ? <button className="btn small" aria-pressed={s.tools.trans} title={s.tools.trans ? "원문(영어)으로 보기" : "쪽을 한국어로 덧씌워 보기 (핵심 용어는 영어 병기)"} onClick={api.trans}>{s.tools.trans ? "번역 켬" : "번역"}</button> : null}
        {s.tools.termMap ? <button className="btn small" title="이 자료의 용어를 한국어 뜻·비유와 함께 묶은 지도와 이야기" onClick={api.termMap}>용어 지도</button> : null}
        {s.tools.map ? <button className="btn small" title="목차와 기억을 한 화면에: 구역마다 알아야 할 것과 내 상태(몰랐음·만남·앎)" onClick={api.map}>자료 지도</button> : null}
        {s.tools.notes ? <button className="btn small" data-notes-toggle="" aria-pressed={s.tools.notes.open} onClick={api.notes}>모르는 것{s.tools.notes.count ? <span className="ncount">{s.tools.notes.count}</span> : null}</button> : null}
        <div className="pager">
          <button className="qbtn" disabled={s.page <= 1} aria-label="이전 쪽" onClick={() => api.go(s.page - 1)}>‹</button>
          <input className="num" id="pgInput" type="number" min={1} max={s.total} aria-label="쪽 번호" value={pg} onChange={(e) => setPg(e.target.value)}
            onBlur={() => { if (Number(pg) !== s.page) api.go(Number(pg)); }} onKeyDown={(e) => { if (e.key === "Enter") api.go(Number(pg)); }} />
          <span className="num">/ {s.total}</span>
          <button className="qbtn" disabled={s.page >= s.total} aria-label="다음 쪽" onClick={() => api.go(s.page + 1)}>›</button>
        </div>
      </div>
      {s.making ? <div style={{ marginBottom: 12 }}><PendingNote p={s.making} api={api} /></div> : null}
      <div ref={grid} className={"rgrid" + (s.note ? (floatingNote ? " noteflt" : " open noteopen") : "")}>
        <section className={"rpage" + (s.wide ? " wide" : "")}>
          {sheet}
          {s.wide && s.docked && s.side && s.chat ? <SidePanel s={s} side={s.side} chat={s.chat} api={api} /> : null}
          {s.wide && !s.docked ? (
            <aside className="rrail">
              {s.floatable ? <button className="btn small" title="질문 창을 쪽 옆에 붙이고 쉬운 설명을 바로 보기" onClick={api.attach}>질문 창 옆에 붙이기</button> : null}
              {goals}
            </aside>
          ) : !s.wide ? goals : null}
          {s.pdf === "error" ? <p className="attach">원본 PDF를 불러오지 못했어요. 원본 등록 상태를 확인해 주세요.</p> : null}
        </section>
        {s.note ? <NoteCard n={s.note} api={api} grid={grid} floating={floatingNote} /> : null}
      </div>
      {s.zoom ? (
        <div className="zoomlayer" role="dialog" aria-label={`원본 ${s.page}쪽 크게 보기`} onClick={(e) => { if (e.target === e.currentTarget) api.zoom(false); }}>
          <div className="zoombar"><span>p.{s.page}</span><button className="qbtn" onClick={() => api.zoom(false)}>닫기 ✕</button></div>
          <div className="pagebox" id="zoombox" data-key={s.key} style={{ width: `min(calc(100vw - 32px), calc((100vh - 90px) * ${s.aspect}))`, aspectRatio: String(s.aspect) }} />
        </div>
      ) : null}
      <div className="ractions">
        <span className="where"><b>p.{s.page}</b>{s.objs.length ? ` · 익힐 것 ${s.objs.length}` : " · 연결된 목표 없음"}
          {s.notesHint ? <span className="nhint"> · 모르는 건 원문을 드래그해 물어보세요</span> : null}</span>
        {s.wide && s.docked ? null : <button className="btn" aria-pressed={s.chatOpen} onClick={api.chat}>{s.chatOpen ? "질문 창 닫기" : "질문하기"}</button>}
        {s.practicing ? <button className="btn primary" onClick={api.practice}>연습으로 돌아가기</button>
          : s.n ? <button className="btn primary" title="읽은 직후 푼 결과는 기억 기록으로 세지 않고, 내일부터 복습에 넣어요." onClick={() => api.check()}>이 쪽 문제 풀기 ({s.n})</button>
          : s.nxt ? <button className="btn" onClick={() => api.go(s.nxt!)}>문제 있는 다음 쪽 · p.{s.nxt} →</button> : null}
      </div>
    </div>
  );
}

function GoalNote({ o, api }: { o: Obj; api: Api }) {
  const g = o.gx!;
  let body;
  if (g.text) body = <div className={`ex-body${g.streaming ? " streaming" : ""}`}><MdLines text={g.text} /></div>;
  else if (!g.canAsk) body = <p className="small muted">질문 답변이 연결되면 목표를 누를 때 정리가 여기 떠요.</p>;
  else if (g.err) body = <p className="check">{g.err}</p>;
  else body = <p className="small muted ex-wait">{g.loading ? "저장된 정리를 불러오는 중…" : "정리하는 중…"}</p>;
  return (
    <div className="gx">
      {body}
      {g.streaming ? null : (
        <div className="gx-foot">
          {g.hasItems ? <button className="chip-btn" onClick={() => api.check(o.id)}>이 목표 문제 풀기</button> : null}
          <button className="chip-btn" onClick={() => api.goalAsk(o.id)}>질문 창에서 더 묻기</button>
          <span className="grow" />
          {g.canAsk && (g.saved || g.err) ? <button className="linkish" title="지금 요청으로 새로 정리해요" onClick={() => api.goalRedo(o.id)}>{g.saved ? "다시 정리" : "다시 시도"}</button> : null}
          <button className={`ex-gear${g.custom ? " on" : ""}`} title="목표 설명 방식 바꾸기" aria-label="목표 설명 설정" onClick={() => api.gear("goal")}>⚙</button>
        </div>
      )}
    </div>
  );
}

function SidePanel({ s, side, chat, api }: { s: NonNullable<Snap>; side: Side; chat: ChatV; api: Api }) {
  const tabs: Array<[Side["shown"], string]> = [["ask", "설명"], ["goals", s.objs.length ? `목표 ${s.objs.length}` : "목표"], ["state", "상태"]];
  const st = side.state, pct = st.total ? Math.round(st.good / st.total * 100) : 0;
  const row = (k: string, v: string, cls?: string) => <div className="strow"><span>{k}</span><b className={"num" + (cls ? " " + cls : "")}>{v}</b></div>;
  return (
    <aside className={"rrail rside" + (side.peek ? " peeking" : "")}>
      <div className="rtabs" role="tablist" aria-label="곁 패널">
        {tabs.map(([k, label]) => <button key={k} role="tab" data-tab={k} className={side.badge.includes(k) && k !== side.shown ? "dot" : undefined} aria-selected={side.shown === k} onClick={() => api.tab(k)}>{label}</button>)}
        <span className="grow" />
        <button className="qbtn" title="새 대화 시작 (지금 대화는 노트에 남아요)" onClick={api.newChat}>새 대화</button>
        <button className="qbtn" title="질문 창을 따로 띄우기" aria-label="질문 창 띄우기" onClick={api.float}>⧉</button>
      </div>
      <div className="rpanes">
        <div className={"rpane" + (side.shown === "ask" ? " on" : "")} data-pane="ask" id="chatDock" role="tabpanel"><ChatWindow c={chat} api={api.chatApi} /></div>
        <div className={"rpane pad" + (side.shown === "goals" ? " on" : "")} data-pane="goals" role="tabpanel">
          {!s.objs.length ? (
            <>
              <p className="small muted">{s.pendingGoals ? "문제를 만드는 중이에요. 이 쪽의 목표가 생기면 여기에 떠요." : "이 쪽에 연결된 학습목표가 없어요."}</p>
              {s.nxt ? <button className="btn small" onClick={() => api.go(s.nxt!)}>목표 있는 다음 쪽 · p.{s.nxt} →</button> : null}
            </>
          ) : (
            <>
              <span className="lbl">이 쪽에서 익힐 것</span>
              {s.objs.map(o => (
                <div key={o.id} className={"pgoal" + (o.pulse ? " pulse" : "")}>
                  <button className="goal" aria-pressed={o.active} aria-expanded={o.open} title="이 목표를 정리해서 보기 (원문에서도 이 부분을 진하게)" onClick={() => api.goal(o.id)}>
                    <span className="gnum">{o.num}</span><span><RichInline text={o.statement} /></span>
                  </button>
                  {o.gx ? <GoalNote o={o} api={api} /> : null}
                  <div className="pgoal-foot"><span className={"chip " + o.cls}>{o.label}</span><span className="grow" />
                    {s.example ? null : <button className="linkish" title="이 목표의 문제를 연습·복습에서 빼기" onClick={() => api.hide(o.id)}>빼기</button>}</div>
                </div>
              ))}
            </>
          )}
        </div>
        <div className={"rpane pad" + (side.shown === "state" ? " on" : "")} data-pane="state" role="tabpanel">
          <div className={"stbox" + (side.pulseState ? " pulse" : "")}><span className="lbl">이 쪽 · p.{s.page}</span>{row("연결된 문제", `${st.n}개`)}{row("모르는 것 노트", `${st.notes}개`, st.notes ? "ask" : "")}</div>
          <div className="stbox"><span className="lbl">이 쪽 핵심 용어</span>
            <div className="pgterms">{st.terms === null ? <span className="small muted">쪽을 그리는 중…</span> : !st.terms.length ? <span className="small muted">이 쪽엔 표시된 핵심 용어가 없어요.</span>
              : st.terms.map(t => <button key={t} className="chip-btn" title="질문 창에 넣기" onClick={() => api.quote(t)}>{t}</button>)}</div></div>
          <div className={"stbox" + (side.pulseState ? " pulse" : "")}><span className="lbl">이 자료</span>
            <div className="stbar" title={`혼자 맞힘 ${st.good} / ${st.total}`}><i style={{ width: `${pct}%` }} /></div>
            {row("혼자 맞힘", `${st.good} / ${st.total}`)}{row("약점", `${st.weak}개`, st.weak ? "bad" : "")}{row("복습 차례", `${st.due}개`)}{row("새 문제", `${st.fresh}개`)}</div>
          {st.today ? (
            <div className="stbox"><span className="lbl">오늘</span>{row("이 자료에서 남은 것", `${st.today.mine}개`)}{row("전체 남은 것", `${st.today.left}개`)}{row("오늘 푼 것", `${st.today.done}개`)}
              {st.today.canGo ? <button className="btn small" style={{ marginTop: 6 }} onClick={api.today}>오늘 할 것 이어서</button> : null}</div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
