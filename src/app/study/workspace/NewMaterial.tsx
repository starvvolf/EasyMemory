"use client";
// 새 자료 넣기 — 바닐라(dejipgi-app.js renderBuilder)에서 React로 옮긴 첫 화면 (11/11 사용자 "옮기는 게 낫겠네" → "클라우드에서 진행해").
// 하는 일은 그대로: PDF(또는 저장한 웹 글) 고르기 → 쪽 범위·목차에서 고르기 → 메모 → 그림·수식 읽기 · 강의 O/X · 심화 → [기억 정리 시작].
// 시작(엔진 호출 · 자료 목록에 넣기 · 자료 지도 열기)은 앱이 맡는다(onStart). ChatGPT 연결 안내는 앱이 이 화면 위에 그린다.
import { useEffect, useRef, useState, type DragEvent } from "react";

type PdfDoc = {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }> }>;
  getOutline(): Promise<Array<{ title?: string; dest?: unknown; items?: unknown[] }> | null>;
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
};
type Pdfjs = { getDocument(o: { data: Uint8Array; isEvalSupported: boolean }): { promise: Promise<PdfDoc> } };
type Page = { n: number; text: string };
type Section = { title: string; start: number; end: number; level: number; fromOutline: boolean };
export type StartOptions = {
  file: File; from: number; to: number; purpose: string; note: string; readImages: boolean; engine: string;
  autoQuestions: boolean; lecture: boolean; deep: boolean; deepFast: boolean; survey: Record<string, string | undefined>;
  sourceName: string; pageCount: number;
};
type Props = {
  engineReady: boolean;
  /** 엔진 고르기(개발용): 엔진 실험 서버(3002)나 ?engines=1 일 때만 */
  /** 코치가 남긴 다음 자료 메모(예: "너무 지엽적") — 메모 칸의 처음 값 */
  noteSeed?: string;
  loadPdfjs: () => Promise<Pdfjs>;
  onStart: (o: StartOptions, doc: PdfDoc | null) => Promise<void>;
};

/** 목차(책갈피)로, 없으면 쪽마다 첫 줄로 범위 고르기 목록(AI 없이). 바닐라 readSections와 같다. */
async function readSections(doc: PdfDoc, pages: Page[]): Promise<Section[]> {
  const flat: Array<{ title: string; start: number; level: number }> = [];
  try {
    const walk = async (items: Array<{ title?: string; dest?: unknown; items?: unknown[] }> | null | undefined, level: number) => {
      for (const it of items ?? []) {
        let dest = it.dest;
        if (typeof dest === "string") dest = await doc.getDestination(dest);
        if (Array.isArray(dest) && dest[0] !== undefined && dest[0] !== null) {
          const page = typeof dest[0] === "number" ? dest[0] + 1 : (await doc.getPageIndex(dest[0])) + 1;
          if (it.title && it.title.trim()) flat.push({ title: it.title.trim(), start: page, level });
        }
        if (level < 1) await walk(it.items as typeof items, level + 1);
      }
    };
    await walk(await doc.getOutline(), 0);
  } catch { flat.length = 0; }
  const fromOutline = flat.length >= 2;
  const list = fromOutline ? flat.sort((a, b) => a.start - b.start)
    : pages.filter((p) => p.text.trim()).map((p) => ({ title: p.text.split("\n")[0].trim().slice(0, 60), start: p.n, level: 0 }));
  return list.map((sec, i) => {
    const next = list.slice(i + 1).find((x) => x.level <= sec.level);
    return { ...sec, end: Math.max(sec.start, next ? next.start - 1 : pages.length), fromOutline };
  });
}

type WebSource = { id: string; title: string; url?: string; readAt?: string };

export default function NewMaterial({ engineReady, noteSeed, loadPdfjs, onStart }: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [note, setNote] = useState(noteSeed ?? "");
  const [readImages, setReadImages] = useState(true);
  const [lecture, setLecture] = useState(false);
  const [deep, setDeep] = useState(false);
  const [deepFast, setDeepFast] = useState(false);
  // 11/12 A 정리: 엔진은 Recaller 하나(예전 엔진 v2·v3·v5·alpha 고르기와 설문은 지움)
  const engine = "recaller";
  const survey: Record<string, string | undefined> = {};
  const [webOpen, setWebOpen] = useState(false);
  const [webList, setWebList] = useState<WebSource[] | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pdfjs = useRef<Pdfjs | null>(null);

  const readPdf = async (f: File) => {
    setBusy(true); setError(""); setStatus("PDF를 읽는 중…");
    try {
      pdfjs.current ??= await loadPdfjs();
      const d = await pdfjs.current.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false }).promise;
      const list: Page[] = [];
      for (let n = 1; n <= d.numPages; n++) {
        const tc = await (await d.getPage(n)).getTextContent();
        let text = "";
        for (const it of tc.items) { if (typeof it.str !== "string") continue; text += it.str; text += it.hasEOL ? "\n" : " "; }
        list.push({ n, text: text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() });
        if (n % 5 === 0) setStatus(`PDF를 읽는 중… ${n}/${d.numPages}쪽`);
      }
      setPages(list); setFile(f); setDoc(d); setFrom(1); setTo(list.length); setPicked([]);
      setSections(await readSections(d, list));
    } catch { setError("PDF를 읽지 못했어요. 암호가 걸렸거나 손상된 파일일 수 있어요."); }
    finally { setBusy(false); setStatus(""); }
  };

  // 저장한 웹 글 → PDF로 인쇄해 받아 PDF처럼 읽는다(바닐라와 같은 /api/study-map/web-sources).
  const openWeb = async () => {
    const next = !webOpen; setWebOpen(next); if (!next) return;
    setWebList(null);
    try { const r = await fetch("/api/study-map/web-sources", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.message || "웹 글 목록을 불러오지 못했어요."); setWebList(j.sources || []); }
    catch (e) { setWebList([]); setError((e as Error).message || String(e)); }
  };
  const pickWeb = async (x: WebSource) => {
    setBusy(true); setError(""); setStatus(`‘${x.title}’을 PDF로 바꾸는 중…`);
    try {
      const r = await fetch("/api/study-map/web-sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: x.id }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || "PDF로 바꾸지 못했어요."); }
      const name = decodeURIComponent(r.headers.get("x-file-name") || "웹 글.pdf");
      setWebOpen(false); setBusy(false); setStatus("");
      await readPdf(new File([await r.blob()], name, { type: "application/pdf" }));
    } catch (e) { setBusy(false); setStatus(""); setError((e as Error).message || String(e)); }
  };

  const applyPicked = (list: number[]) => {
    setPicked(list);
    const chosen = list.map((i) => sections[i]).filter(Boolean);
    if (chosen.length) { setFrom(Math.min(...chosen.map((x) => x.start))); setTo(Math.max(...chosen.map((x) => x.end))); }
    else { setFrom(1); setTo(pages.length); }
  };
  const setRange = (a: number, b: number) => {
    setPicked([]);
    const f = Math.max(1, Math.min(a || 1, pages.length)); setFrom(f);
    setTo(Math.max(f, Math.min(b || pages.length, pages.length)));
  };

  const start = async () => {
    if (busy || !engineReady || !file) return;
    setBusy(true); setError(""); setStatus("PDF를 등록하고 기억 정리를 시작하는 중…");
    try {
      await onStart({ file, from, to, purpose: "core", note: note.trim(), readImages, engine, autoQuestions: false, lecture: engine === "recaller" && lecture, deep: engine === "recaller" && deep, deepFast: deep && deepFast, survey, sourceName: file.name, pageCount: pages.length }, doc);
    } catch (e) { setBusy(false); setStatus(""); setError((e as Error)?.message || "요청을 올리지 못했어요."); }
  };

  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f && /pdf$/i.test(f.name)) void readPdf(f); };
  const step = pages.length ? 2 : 1;
  const empty = pages.filter((p) => !p.text.trim()).length;
  const span = to - from + 1;
  // 엔진(pages.ts)과 같은 규칙: 글자가 모자란 쪽은 그림으로 읽는다(쪽당 약 20초, 3개씩).
  const thin = pages.filter((p) => p.n >= from && p.n <= to && (p.text.match(/[\p{L}\p{N}]/gu) || []).length < 600).length;
  useEffect(() => { if (input.current) input.current.value = ""; }, [file]);

  return <div className="stack">
    <ol className="steps">
      <li data-on={step === 1 ? "true" : "false"} data-done={step > 1 ? "true" : "false"}>자료 올리기</li>
      <li data-on={step === 2 ? "true" : "false"}>방향 정하기</li>
      <li data-on="false">기억 정리 시작</li>
    </ol>
    {!engineReady ? <div className="note warn">이 화면에서는 생성 요청을 보낼 수 없어요. 로컬 실험 모드에서 열어 주세요.</div> : null}
    {error ? <div className="note err" role="alert">{error}</div> : null}
    {status ? <div className="note" role="status">{status}</div> : null}

    <section className="panel stack">
      <div className="drop" data-over={over ? "true" : "false"} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <strong>{pages.length ? `${file?.name} · ${pages.length}쪽` : "PDF를 끌어다 놓거나 자료를 골라 주세요"}</strong>
        <span className="small muted">기억할 것을 뽑아 자료 지도로 보여 줘요. 문제는 지도에서 원할 때 만들어요.</span>
        <button className="btn" disabled={busy} onClick={() => engineReady ? void openWeb() : input.current?.click()}>{pages.length ? "다른 자료 고르기" : "자료 고르기"}</button>
        <input ref={input} type="file" accept="application/pdf" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) { setWebOpen(false); void readPdf(f); } }} />
        {webOpen ? <div className="stack" style={{ gap: 6, width: "100%", textAlign: "left" }}>
          <button className="chip-btn" style={{ cursor: "pointer", textAlign: "left" }} onClick={() => input.current?.click()}>📄 이 컴퓨터의 PDF 파일</button>
          <span className="small muted">저장한 웹 글</span>
          {webList === null ? <p className="small muted">웹 글 목록을 불러오는 중…</p>
            : !webList.length ? <p className="small muted">저장한 웹 글이 없어요. 크롬 확장 프로그램으로 글을 읽으면 여기 생겨요.</p>
            : <div className="stack" style={{ gap: 4, maxHeight: 220, overflow: "auto", width: "100%" }}>{webList.map((x) =>
              <button key={x.id} className="chip-btn" style={{ textAlign: "left" }} disabled={busy} title={x.url} onClick={() => void pickWeb(x)}>
                <span>{x.title}</span><span className="small muted"> · {(x.readAt || "").slice(5, 10).replace("-", "/")}</span></button>)}</div>}
        </div> : null}
      </div>
    </section>

    {pages.length ? <section className="panel stack">
      <div><p className="eyebrow">방향 정하기</p><h2 style={{ fontSize: 18, marginTop: 2 }}>어떻게 공부할지 알려 주세요</h2>
        {empty && !readImages ? <p className="small muted">글자가 없는 쪽 {empty}개는 그림·스캔이라, 아래 ‘그림·수식도 읽기’를 켜야 기억에 들어가요.</p> : null}</div>
      <div className="field"><label>1. 범위</label>
        <div className="row"><span className="small muted">시작 쪽</span>
          <input type="number" min={1} max={pages.length} style={{ width: 90 }} value={from} onChange={(e) => setRange(Number(e.target.value), to)} />
          <span className="small muted">끝 쪽</span>
          <input type="number" min={1} max={pages.length} style={{ width: 90 }} value={to} onChange={(e) => setRange(from, Number(e.target.value))} />
          <button className="btn small ghost" disabled={busy} onClick={() => applyPicked([])}>전체</button></div>
        {sections.length ? <details open={picked.length ? true : undefined}>
          <summary className="small">{sections[0].fromOutline ? "목차" : "쪽 제목"}에서 고르기{picked.length ? ` · ${picked.length}개 선택` : ""}</summary>
          <div className="sections">{sections.map((sec, i) => <button key={i} className="chip-btn" style={sec.level ? { marginLeft: 14 } : undefined} aria-pressed={picked.includes(i) ? "true" : "false"} disabled={busy}
            onClick={() => applyPicked(picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i])}>
            <span className="num small">{sec.start === sec.end ? `p.${sec.start} ` : `p.${sec.start}–${sec.end} `}</span>{sec.title}</button>)}</div>
          <p className="small muted">여러 개를 고르면 처음부터 끝까지 이어진 범위로 만들어요.</p>
        </details> : null}
        {span > 60 ? <p className="small muted">{span}쪽은 오래 걸려요. 한 주차·한 장씩 나눠 만들면 먼저 끝난 것부터 공부할 수 있어요.</p> : null}
      </div>
      <div className="field"><label htmlFor="note">2. 메모 (선택)</label>
        <textarea id="note" rows={2} placeholder="예: 중간고사 범위, 공식은 직접 써 볼 수 있게, 영어 용어는 원문 그대로" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {thin ? <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={readImages} disabled={busy} onChange={(e) => setReadImages(e.target.checked)} />
        <span><b>그림·수식도 읽기</b><span className="muted"> · 글자가 적은 {thin}쪽을 그림으로 읽어요 (약 {Math.max(1, Math.ceil(thin * 20 / 3 / 60))}분 더). 행렬·도표·그림 속 글자가 기억에 들어가요.</span></span></label> : null}
      {engine === "recaller" ? <div className="field"><label>강의도 준비할까요?</label>
        <div className="chat-sugs">{([[true, "O · 강의 들으며 공부"], [false, "X · 기억 카드만"]] as const).map(([on, label]) =>
          <button key={label} className="chip-btn" aria-pressed={lecture === on ? "true" : "false"} disabled={busy} onClick={() => setLecture(on)}>{label}</button>)}</div>
        <p className="small muted">{lecture ? "자료를 다 만들면 강사가 첫 영역부터 설명을 써 둬요. 다음 영역은 읽는 동안 이어서 써요." : "아는 내용이면 카드만 보고, 강의는 나중에 자료 지도의 [강의] 탭에서 언제든 들을 수 있어요."}</p></div> : null}
      {engine === "recaller" ? <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={deep} disabled={busy} onChange={(e) => setDeep(e.target.checked)} />
        <span><b>심화 문제도 만들기</b><span className="muted"> · 개념 여러 개를 엮은 응용 문제와 단계별 풀이 (1~2분 더). 계산·절차가 있는 과목에 맞아요.</span></span></label> : null}
      {engine === "recaller" && deep ? <label className="row small" style={{ gap: 8, cursor: "pointer", marginLeft: 24 }}>
        <input type="checkbox" checked={deepFast} disabled={busy} onChange={(e) => setDeepFast(e.target.checked)} />
        <span><b>심화 빠르게</b><span className="muted"> · 초안 두 개를 동시에 써서 먼저 통과한 것을 써요. 사용량이 두 배예요.</span></span></label> : null}
      <div className="row">
        <button className="btn primary" id="startBtn" disabled={busy || !engineReady} onClick={() => void start()}>기억 정리 시작</button>
        <span className="small muted">바로 자료 지도로 넘어가요. 기억이 정리되는 대로 채워지고, 문제는 지도에서 원할 때 만들어요.</span>
      </div>
    </section> : null}
  </div>;
}
