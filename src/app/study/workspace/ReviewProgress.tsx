"use client";
// 총정리를 만드는 동안 보여 주는 진행 카드 (11/12 사용자 "학습이 끝났어. 그러면 AI 튜터의 리뷰를 제작 중입니다 하면서 … 뭐 하고 있는지 대충 적어서
// 뭔가 하고 있는 것처럼 한 다음에 끝나면 제작되는 건 어떰?"). 단계 글은 지어내지 않고, 받는 중인 글의 머리글에서 뽑는다(지금 어느 칸을 쓰는 중인지).
// 문제 화면(맞힌 직후)과 풀이 노트(만드는 중에 열었을 때)가 같이 쓴다. 서버는 이미 만드는 중인 일에도 붙여 준다(sheets.ts reviewFor).
import { useEffect, useState } from "react";

export type ReviewFactsLite = { end: "solved" | "gaveup" | "paused"; hints: number; skeleton: boolean; asked: number; submits: number; wrong: number; minutes: number };
export type ReviewStream = { state: "loading" | "live" | "done" | "none"; text: string; md: string; review: unknown; facts: ReviewFactsLite | null };

/** 이 문제의 총정리를 받는다(없으면 만들고, 만드는 중이면 이어 받고, 있으면 바로). */
export function useReviewStream(pid: string, enabled = true): ReviewStream {
  const [s, setS] = useState<ReviewStream>({ state: "loading", text: "", md: "", review: null, facts: null });
  useEffect(() => {
    if (!enabled || !pid) return;
    let alive = true;
    const ctl = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/code/problem/${pid}/review?stream=1`, { cache: "no-store", signal: ctl.signal });
        if (!res.ok || !res.body) throw new Error();
        const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl; while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!line.trim() || !alive) continue;
            const o = JSON.parse(line) as { t?: string; done?: boolean; review?: { md?: string } | null; facts?: ReviewFactsLite | null; error?: string };
            if (o.facts !== undefined && !o.done) setS((x) => ({ ...x, facts: o.facts ?? null }));
            if (o.t) setS((x) => ({ ...x, state: "live", text: o.t! }));
            if (o.done) setS((x) => ({ ...x, facts: o.facts ?? x.facts, review: o.review ?? null, md: o.review?.md ?? "", state: o.review ? "done" : "none" }));
            if (o.error) setS((x) => ({ ...x, state: "none" }));
          }
        }
      } catch { if (alive) setS((x) => (x.state === "done" ? x : { ...x, state: "none" })); }
    })();
    return () => { alive = false; ctl.abort(); };
  }, [pid, enabled]);
  return s;
}

type Step = { label: string; state: "done" | "now" | "todo" };
/** 받는 중인 글 → 단계. 코드 블록 안의 # 줄은 머리글이 아니다. */
export function reviewSteps(text: string, asked: number | null): Step[] {
  const h1: string[] = []; const topics: string[] = [];
  let fence = false;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const a = /^#\s+(.+)$/.exec(line); if (a) { h1.push(a[1].trim()); continue; }
    const b = /^##\s+(?:\d+\.\s*)?(.+)$/.exec(line); if (b) topics.push(b[1].replace(/\[(핵심|작은)\]\s*$/, "").trim());
  }
  const seen = (re: RegExp) => h1.some((x) => re.test(x));
  const last = h1.at(-1) ?? "";
  const at = (re: RegExp) => re.test(last);
  const steps: Step[] = [{ label: asked != null ? `대화 ${asked}개와 채점 기록` : "대화와 채점 기록", state: text ? "done" : "now" }];
  const stage = (label: string, re: RegExp, after: RegExp[]) => steps.push({ label, state: !seen(re) ? "todo" : at(re) && !after.some((x) => seen(x)) ? "now" : "done" });
  stage("학습 총평", /총평/, [/상태/, /핵심 학습|리뷰/, /자잘/, /확인/]);
  stage("끝났을 때 상태", /상태/, [/핵심 학습|리뷰/, /자잘/, /확인/]);
  const inTopics = seen(/핵심 학습|리뷰/) && !seen(/자잘/) && !seen(/확인/);
  if (!topics.length) steps.push({ label: "채울 것", state: seen(/핵심 학습|리뷰/) ? "now" : "todo" });
  topics.forEach((t, i) => steps.push({ label: `채울 것 ${i + 1} · ${t}`, state: inTopics && i === topics.length - 1 ? "now" : "done" }));
  if (seen(/자잘/)) stage("자잘하게 막힌 것", /자잘/, [/확인/]);
  stage("다시 확인할 것", /확인/, []);
  return steps;
}

/** 진행 카드. done이면 끝 줄과 버튼 자리(children). */
export function ReviewProgress({ text, asked, done, summary, children }: { text: string; asked: number | null; done?: boolean; summary?: string; children?: React.ReactNode }) {
  const [t0] = useState(() => Date.now());
  const [sec, setSec] = useState(0);
  useEffect(() => { if (done) return; const id = setInterval(() => setSec(Math.round((Date.now() - t0) / 1000)), 1000); return () => clearInterval(id); }, [done, t0]);
  const steps = reviewSteps(text, asked);
  return <div className={`rvp${done ? " done" : ""}`}>
    <div className="rvp-head">
      <span className="rvp-icon" aria-hidden>{done ? "✓" : "🧑‍🏫"}</span>
      <div className="rvp-title"><b>{done ? "AI 튜터의 리뷰가 다 됐어요" : "AI 튜터가 이번 풀이를 리뷰하고 있어요"}</b>
        <span className="rvp-sub">{done ? summary ?? "" : <>보통 1분쯤 걸려요 · {sec}초 <span className="memo-dots"><i /><i /><i /></span></>}</span></div>
    </div>
    {done ? null : <ol className="rvp-steps">{steps.map((s, i) => <li key={i} className={s.state}><span className="rvp-mark" aria-hidden>{s.state === "done" ? "✓" : s.state === "now" ? "" : "○"}</span><span>{s.label}{s.state === "now" ? <em className="rvp-now">{i === 0 ? "읽는 중" : "쓰는 중"}</em> : null}</span></li>)}</ol>}
    {children}
  </div>;
}

/** 다 된 리뷰의 한 줄 요약(주제 수). */
export function reviewSummary(md: string) {
  const big = (md.match(/^##\s.*\[핵심\]\s*$/gm) ?? []).length, all = (md.match(/^##\s/gm) ?? []).length;
  return all ? `채울 것 ${all}가지 · 핵심 ${big} · 작은 ${all - big}` : "";
}

/** 맞힌 직후 문제 화면에 뜨는 카드: 리뷰 진행 → 다 되면 "리뷰 보기"(기억 탭의 이 문제 풀이 노트로). */
export function ReviewAfterSolve({ pid, number, onClose, onOpen }: { pid: string; number?: string; onClose: () => void; onOpen: (key: string) => void }) {
  const st = useReviewStream(pid);
  if (st.state === "none") return null;
  const done = st.state === "done" && Boolean(st.md || st.review);
  return <div className="rvp-float" role="status">
    <button className="rvp-x" onClick={onClose} title="닫기 (리뷰는 계속 만들어져요)" aria-label="닫기">×</button>
    <ReviewProgress text={st.text} asked={st.facts?.asked ?? null} done={done} summary={reviewSummary(st.md)}>
      {done ? <div className="rvp-acts">
        {number ? <button className="btn small primary" onClick={() => onOpen(`ps:${number}`)}>리뷰 보기 →</button> : <span className="small muted">기억 탭의 풀이 노트에서 볼 수 있어요</span>}
      </div> : null}
    </ReviewProgress>
  </div>;
}
