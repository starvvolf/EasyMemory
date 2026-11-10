"use client";
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { RichInline } from "../Rich";
import { useBridge, type Bridge } from "../bridge";
import ChatWindow, { type ChatApi, type ChatV } from "./ChatWindow";
import { MdLines } from "./Md";

/* 화면 위에 떠 있는 것들 (11/11 바닐라 paintPrompts·TermMap.paint·paintDrawer·selPop·떠 있는 Chat을 React로). 앱 맨 위 한 칸에 늘 붙어 있다. */
type PromptsV = {
  tab: string; tabs: Array<{ key: string; label: string; custom: boolean }>; when: string; cur: string; hasDefault: boolean; presets: Array<{ label: string; text: string }>;
  auto: string[]; custom: boolean; redo: boolean; fixed: string; preview: string | null; previewLabel: string;
} | null;
type Term = { en: string; ko: string; parts: string; under: string; def: string; analogy: string; pair: string; page: number | null };
type TermMapV = { title: string; map: { groups: Array<{ name: string; terms: Term[] }>; story: string } | null; sel: string | null; running: boolean; loading: boolean; canMake: boolean; err: string; custom: boolean } | null;
type TocGoal = { kind: "goal"; id: string; text: string; here: boolean; weak: boolean; notes: number; span: string; page: number };
type DrawerV = {
  tab: "notes" | "toc"; count: number; filter: string; filters: Array<{ key: string; label: string }>; weakAt: number; page: number;
  list: Array<{ id: string; quote: string; kind: string; kl: string; kc: string; weak: boolean; marked: boolean; page: number; ago: string; seen: number; lead: string; open: boolean; thread: Array<{ role: string; text: string }> }>;
  toc: { flat: TocGoal[] | null; secs: Array<{ title: string; in: boolean; page: number; span: string; notes: number; weak: boolean; unit: { label: string; held: boolean } | null; heldN: number;
    parts: Array<{ name: string; in: boolean; page: number; span: string; notes: number; weak: boolean; goals: TocGoal[] }> }> } | null;
} | null;
type PeekV = { page: number; total: number; key: string; status: string; aspect: number } | null;
type Snap = { peek: PeekV; prompts: PromptsV; termMap: TermMapV; drawer: DrawerV; sel: { x: number; y: number; below: boolean; actions: Array<{ label: string; key: string; title: string }> } | null; chat: ChatV | null };
type Api = {
  snapshot(): Snap; chatApi: ChatApi; selRun(i: number): void;
  promptsApi: { close(): void; tab(k: string): void; draft(v: string): void; reset(): void; save(): void; saveRedo(): void; preview(): void };
  tm: { close(): void; make(): void; pick(en: string): void; gear(): void; go(page: number): void };
  peek: { close(): void; go(k: number): void; paint(box: HTMLElement): void };
  drawer: { close(): void; tab(k: string): void; filter(k: string): void; go(page: number): void; toc(page: number): void; item(id: string): void; talkGo(id: string): void; talkContinue(id: string): void };
};

export default function ReaderOverlays({ ui, api }: { ui: Bridge; api: Api }) {
  useBridge(ui);
  const s = api.snapshot();
  return (
    <>
      {s.chat ? <ChatWindow c={s.chat} api={api.chatApi} /> : null}
      {s.peek ? <SourcePeekLayer v={s.peek} api={api} /> : null}
      {s.drawer ? <NotesDrawer d={s.drawer} api={api} /> : null}
      {s.termMap ? <TermMapDialog t={s.termMap} api={api} /> : null}
      {s.prompts ? <PromptsDialog p={s.prompts} api={api} /> : null}
      {s.sel && s.sel.actions.length ? (
        <div className={"selpop" + (s.sel.below ? " below" : "")} role="toolbar" aria-label="고른 글" style={{ left: s.sel.x, top: s.sel.y }} onMouseDown={(e) => e.preventDefault()}>
          {s.sel.actions.map((a, i) => <button key={a.label} title={a.title || undefined} onClick={() => api.selRun(i)}>{a.label}{a.key ? <span className="k">{a.key}</span> : null}</button>)}
        </div>
      ) : null}
    </>
  );
}

/* 원문 보기: PDF 한 쪽을 지금 화면 위에. ‹ ›로 넘기고 Esc·바깥 누르기로 닫는다. 쪽 그림은 앱이 그 칸에 그린다. */
function SourcePeekLayer({ v, api }: { v: NonNullable<PeekV>; api: Api }) {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (v.status === "ready" && box.current) api.peek.paint(box.current); }, [v.key, v.status, api]);
  return (
    <div className="zoomlayer peek" role="dialog" aria-label="원문 보기" onClick={(e) => { if (e.target === e.currentTarget) api.peek.close(); }}>
      <div className="zoombar">
        <span className="row">
          <button className="qbtn" aria-label="이전 쪽" disabled={v.page <= 1} onClick={() => api.peek.go(-1)}>‹</button>
          <span className="num">p.{v.page} / {v.total}</span>
          <button className="qbtn" aria-label="다음 쪽" disabled={v.page >= v.total} onClick={() => api.peek.go(1)}>›</button>
        </span>
        <button className="qbtn" onClick={api.peek.close}>닫기 ✕</button>
      </div>
      {v.status === "error" ? <div className="pagebox">원본 PDF를 불러오지 못했어요.</div>
        : <div ref={box} className="pagebox" data-key={v.key} data-loading={v.status === "ready" ? "쪽을 그리는 중…" : "원본 PDF를 불러오는 중…"}
            style={{ width: `min(calc(100vw - 32px), calc((100vh - 90px) * ${v.aspect}))`, aspectRatio: String(v.aspect) }} />}
    </div>
  );
}

function PromptsDialog({ p, api }: { p: NonNullable<PromptsV>; api: Api }) {
  const a = api.promptsApi;
  return (
    <div className="pset-layer" id="promptCard" onClick={(e) => { if (e.target === e.currentTarget) a.close(); }}>
      <aside className="pset" role="dialog" aria-label="프롬프트 설정">
        <div className="row" style={{ justifyContent: "space-between" }}><strong>⚙ 프롬프트 설정</strong><button className="dclose" aria-label="닫기" onClick={a.close}>✕</button></div>
        <div className="dtabs pset-tabs" role="tablist">{p.tabs.map(t => <button key={t.key} role="tab" className="dtab" aria-selected={t.key === p.tab} onClick={() => a.tab(t.key)}>{t.label}{t.custom ? <span className="pset-dot" title="내 요청 사용 중" /> : null}</button>)}</div>
        <p className="small muted">{p.when}</p>
        <div className="field"><label>내 요청 (바꿀 수 있어요)</label>
          <div className="ex-presets">{p.presets.map(x => <button key={x.label} className="chip-btn" aria-pressed={p.cur.trim() === x.text} onClick={() => a.draft(x.text)}>{x.label}</button>)}</div>
          <textarea className="ex-prompt" rows={6} placeholder={p.hasDefault ? "" : "비워 두면 기본 방식으로 답해요. 예: 더 짧게, 예시 먼저"} value={p.cur} onChange={(e) => a.draft(e.target.value)} />
          <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
            {p.custom ? <button className="btn small ghost" onClick={a.reset}>기본으로</button> : null}
            <button className="btn small" onClick={a.save}>저장</button>
            {p.redo ? <button className="btn small primary" onClick={a.saveRedo}>저장하고 이 쪽 다시 설명</button> : null}
          </div>
        </div>
        <div className="field"><label>자동으로 함께 들어가는 것</label><div className="ex-presets">{p.auto.map(t => <span key={t} className="chip">{t}</span>)}</div></div>
        <details><summary className="small">고정 지시 보기 (바꿀 수 없음 · 내 요청보다 우선)</summary><pre className="pset-pre">{p.fixed}</pre></details>
        <details open={!!p.preview} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) a.preview(); }}>
          <summary className="small">{p.previewLabel}</summary><pre className="pset-pre">{p.preview || "만드는 중…"}</pre>
        </details>
      </aside>
    </div>
  );
}

function TermMapDialog({ t, api }: { t: NonNullable<TermMapV>; api: Api }) {
  const a = api.tm, map = t.map;
  const find = (name: string) => { const n = name.trim().toLowerCase(); for (const g of map?.groups ?? []) for (const x of g.terms) if (x.en.toLowerCase() === n || x.ko.toLowerCase() === n) return x; return null; };
  const node = (x: Term, kids: ReactNode[]) => {
    const on = t.sel === x.en;
    return (
      <li key={x.en} className={"tm-term" + (on ? " on" : "")} data-term={x.en}>
        <button className="tm-name" aria-expanded={on} onClick={() => a.pick(x.en)}><b>{x.en}</b>{x.ko ? <span>{x.ko}</span> : null}</button>
        {on ? (
          <div className="tm-card">
            {x.parts ? <p className="tm-parts">{x.parts}</p> : null}
            {x.def ? <p><span className="tm-k">정의</span><RichInline text={x.def} /></p> : null}
            {x.analogy ? <p className="tm-ana"><span className="tm-k">비유</span><RichInline text={x.analogy} /></p> : null}
            {x.pair ? <p><span className="tm-k">헷갈리는 짝</span><RichInline text={x.pair} /></p> : null}
            {x.page ? <button className="linkish" onClick={() => a.go(x.page!)}>원문 p.{x.page}로 가기</button> : null}
          </div>
        ) : null}
        {kids.length ? <ul className="tm-sub">{kids}</ul> : null}
      </li>
    );
  };
  const tree = (g: { terms: Term[] }) => {
    const names = new Set(g.terms.map(x => x.en));
    const build = (x: Term, seen: Set<string>): ReactNode => node(x, g.terms.filter(c => c.under === x.en && !seen.has(c.en)).map(c => build(c, new Set([...seen, c.en]))));
    return g.terms.filter(x => !x.under || !names.has(x.under) || x.under === x.en).map(x => build(x, new Set([x.en])));
  };
  let body: ReactNode;
  if (t.running) body = <div className="tm-empty"><p className="ex-wait">자료 전체에서 용어를 뽑아 묶고 이야기를 쓰는 중이에요… (자료가 길면 1~2분)</p></div>;
  else if (map) body = (
    <div className="tm-grid">
      <section className="tm-map"><span className="lbl">지도 · 용어 {map.groups.reduce((n, g) => n + g.terms.length, 0)}개</span>
        {map.groups.map(g => <div key={g.name} className="tm-group"><div className="tm-gname">{g.name}</div><ul className="tm-list">{tree(g)}</ul></div>)}</section>
      {map.story ? (
        <section className="tm-story"><span className="lbl">이야기로 한 번에 · 비유가 섞여 있어요</span>
          {map.story.split(/\n+/).filter(Boolean).map((par, i) => (
            <p key={i}>{par.split(/\[\[(.+?)\]\]/g).map((bit, j) => {
              if (j % 2 === 0) return <RichInline key={j} text={bit} />;
              const x = find(bit);
              return x ? <button key={j} className="tm-link" title={x.ko || ""} onClick={() => a.pick(x.en)}>{x.en}</button> : <b key={j}>{bit}</b>;
            })}</p>
          ))}
        </section>
      ) : null}
    </div>
  );
  else if (t.loading) body = <div className="tm-empty"><p className="small muted">저장된 지도를 불러오는 중…</p></div>;
  else if (!t.canMake) body = <div className="tm-empty"><p className="small muted">질문 답변이 연결되면 용어 지도를 만들 수 있어요.</p></div>;
  else body = (
    <div className="tm-empty">
      {t.err ? <p className="check">{t.err}</p> : <p className="small muted">이 자료의 용어를 한국어 뜻·비유와 함께 묶어 지도와 이야기로 만들어요. 자료마다 한 번 만들고 저장해요.</p>}
      <button className="btn primary" onClick={a.make}>용어 지도 만들기</button>
    </div>
  );
  return (
    <div className="pset-layer tm-layer" id="termMap" onClick={(e) => { if (e.target === e.currentTarget) a.close(); }}>
      <aside className="pset tmap" role="dialog" aria-label="용어 지도">
        <div className="row tm-head"><strong>용어 지도 · {t.title}</strong><span className="grow" />
          {map && !t.running ? <button className="linkish" title="지금 요청으로 새로 만들어요" onClick={a.make}>다시 만들기</button> : null}
          <button className={"ex-gear" + (t.custom ? " on" : "")} title="용어 지도 방식 바꾸기 (비유 소재 등)" aria-label="용어 지도 설정" onClick={a.gear}>⚙</button>
          <button className="dclose" aria-label="닫기" onClick={a.close}>✕</button></div>
        {body}
      </aside>
    </div>
  );
}

function NotesDrawer({ d, api }: { d: NonNullable<DrawerV>; api: Api }) {
  const a = api.drawer, list = useRef<HTMLDivElement | null>(null);
  // 목차를 열면 지금 쪽이 가운데 오게
  useEffect(() => { if (d.tab === "toc") list.current?.querySelector(".here")?.scrollIntoView({ block: "center" }); }, [d.tab]);
  const head = (
    <div className="dh">
      <div className="dtabs" role="tablist" aria-label="모르는 것">
        <button role="tab" className="dtab" aria-selected={d.tab === "notes"} onClick={() => a.tab("notes")}>노트{d.count ? " " + d.count : ""}</button>
        <button role="tab" className="dtab" aria-selected={d.tab === "toc"} onClick={() => a.tab("toc")}>목차</button>
      </div>
      <span className="grow" /><button className="dclose" title="닫기 (Esc)" aria-label="모르는 것 닫기" onClick={a.close}>✕</button>
    </div>
  );
  const marks = (n: number, weak: boolean) => <span className="tmarks">{weak ? <span className="tweak">틀림</span> : null}{n ? <span className="tdot" title={`모르는 것 ${n}개`}>{n}</span> : null}</span>;
  const goal = (g: TocGoal) => (
    <button key={g.id} className={"trow goal-row" + (g.here ? " here" : "") + (g.weak ? " weak" : "")} onClick={() => a.toc(g.page)}>
      <span className="tt"><RichInline text={g.text} /></span>{marks(g.notes, g.weak)}<span className="tp">{g.span}</span>
    </button>
  );
  if (d.tab === "toc" && d.toc) {
    const t = d.toc;
    return (
      <aside className="notesdrawer" id="notesDrawer" role="dialog" aria-label="목차" data-tab="toc">
        {head}
        <div className="dlist toc" ref={list}>
          {t.flat ? (t.flat.length ? t.flat.map(goal) : <p className="small muted" style={{ padding: 8 }}>아직 목차가 없어요. 문제를 만들면 목표별 목차가 생겨요.</p>)
            : t.secs.map((sec, i) => (
              <section key={i} className="tsec">
                <button className={"trow sec" + (sec.in ? " in" : "")} onClick={() => a.toc(sec.page)}>
                  <span className="tt">{sec.title}</span>
                  {sec.unit ? <span className={`chip${sec.unit.held ? " bad" : " acc"}`}>{sec.unit.label}</span> : null}
                  {sec.heldN ? <span className="chip" title="관문 검사를 통과하지 못해 빼 둔 문제">보류 {sec.heldN}</span> : null}
                  {marks(sec.notes, sec.weak)}<span className="tp">{sec.span}</span>
                </button>
                {sec.parts.map((p, j) => !p.name ? <Fragment key={j}>{p.goals.map(goal)}</Fragment> : (
                  <div key={j} className="tpart">
                    <button className={"trow part" + (p.in ? " in" : "")} onClick={() => a.toc(p.page)}><span className="tt">{p.name}</span>{marks(p.notes, p.weak)}<span className="tp">{p.span}</span></button>
                    {p.goals.map(goal)}
                  </div>
                ))}
              </section>
            ))}
        </div>
        <div className="dfoot small muted"><span className="tdot" /> 모르는 것 노트 수 · <span className="tweak">틀림</span> 약점 목표 · 누르면 그 쪽으로 가요</div>
      </aside>
    );
  }
  return (
    <aside className="notesdrawer" id="notesDrawer" role="dialog" aria-label="모르는 것 노트" data-tab="notes">
      {head}
      <div className="dfilters">{d.filters.map(f => <button key={f.key} className="chip-btn" aria-pressed={d.filter === f.key} onClick={() => a.filter(f.key)}>{f.label}</button>)}</div>
      <div className="dlist" ref={list}>
        {d.list.length ? d.list.map(n => n.open ? (
          <div key={n.id} className="nitem open">
            <button className="nitem-head" aria-expanded="true" onClick={() => a.item(n.id)}>
              <div className="t"><span className="q">{n.quote}</span><span className={`nk ${n.kc}`}>{n.kl}</span></div>
              <div className="m"><span>p.{n.page}</span><span>{n.ago}</span></div>
            </button>
            <div className="ntalk">
              {n.thread.map((t, i) => <div key={i} className={"ntalk-turn " + t.role}><span className="ntalk-who">{t.role === "user" ? "나" : "답"}</span><div className="ntalk-text">{t.role === "assistant" ? <MdLines text={t.text} /> : t.text}</div></div>)}
              <div className="row" style={{ gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
                <button className="btn small ghost" onClick={() => a.talkGo(n.id)}>p.{n.page}로 가기</button>
                <button className="btn small" onClick={() => a.talkContinue(n.id)}>질문 창에서 이어가기</button>
              </div>
            </div>
          </div>
        ) : (
          <button key={n.id} className="nitem" onClick={() => a.item(n.id)}>
            <div className="t"><span className="q">{n.quote}</span>{n.weak ? <span className="nk k-weak">약점</span> : null}<span className={`nk ${n.kc}`}>{n.marked ? "모름" : n.kl}</span></div>
            <div className="s">{n.marked ? "아직 안 물어봤어요 · 누르면 물어봐요" : n.kind === "talk" ? `질문 · ${n.lead}` : n.lead}</div>
            <div className="m"><span>p.{n.page}</span><span>{n.ago}</span><span>다시 본 횟수 {n.seen}</span></div>
          </button>
        )) : <p className="small muted" style={{ padding: 8 }}>{d.count ? "해당하는 항목이 없어요." : "원문을 드래그해 모르는 것을 물어보면 여기에 쌓여요."}</p>}
      </div>
      <div className="dfoot small muted">같은 것을 {d.weakAt}번 이상 다시 보면 약점으로 표시해요.</div>
    </aside>
  );
}
