"use client";
// 총정리 v19 보기(11/12): 풀이 노트(Library)와 총정리 실험실(/lab/review)이 같이 쓴다. 글(마크다운)을 머리글로 잘라
// 학습 총평 · 끝났을 때 상태 · 채울 것(핵심 큰 카드 / 작은 상자) · 자잘하게 막힌 것 · 다시 확인할 것으로 보여 준다. 모양은 library.css의 rv-*.

/** v19(11/12): 글 총정리. 머리글로 잘라 칸으로(받는 중인 글도 그때까지 나온 만큼). 코드 블록 안의 # 줄은 머리글로 보지 않는다. */
type MdTopic = { title: string; size: "big" | "small" | ""; hard: string; lesson: string; sum: string[] };
type MdReview = { summary: string; state: Array<{ k: string; v: string }>; topics: MdTopic[]; small: string[]; check: string[] };
export function parseMdReview(md: string): MdReview {
  const out: MdReview = { summary: "", state: [], topics: [], small: [], check: [] };
  let sec = "", part: "hard" | "lesson" | "sum" = "lesson", fence = false;
  const t = () => out.topics.at(-1);
  const bullet = (line: string) => /^\s*[-•]\s+(.*)$/.exec(line)?.[1];
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*```/.test(line)) fence = !fence;
    if (!fence && !/^\s*```/.test(line)) {
      const h1 = /^#\s+(.+)$/.exec(line);
      if (h1) { const x = h1[1]; sec = /총평/.test(x) ? "summary" : /상태/.test(x) ? "state" : /핵심 학습|리뷰/.test(x) ? "topics" : /자잘/.test(x) ? "small" : /확인/.test(x) ? "check" : sec; continue; }
      const h2 = /^##\s+(?:\d+\.\s*)?(.+)$/.exec(line);
      if (h2 && sec === "topics") { const m = /\[(핵심|작은)\]\s*$/.exec(h2[1]); out.topics.push({ title: h2[1].replace(/\[(핵심|작은)\]\s*$/, "").trim(), size: m ? (m[1] === "핵심" ? "big" : "small") : "", hard: "", lesson: "", sum: [] }); part = "lesson"; continue; }
      const bold = /^\*\*(어려웠던 것|왜 막혔나|제대로 알기|정리)\*\*\s*(.*)$/.exec(line);
      if (bold && sec === "topics" && t()) { part = bold[1] === "제대로 알기" ? "lesson" : bold[1] === "정리" ? "sum" : "hard"; if (bold[2]) { if (part === "sum") t()!.sum.push(bold[2]); else t()![part] += `${bold[2]}\n`; } continue; }
    }
    if (sec === "summary") out.summary += `${line}\n`;
    else if (sec === "state") { const b = bullet(line); if (b) { const m = /^([^:：]{1,20})[:：]\s*(.*)$/.exec(b); out.state.push(m ? { k: m[1].trim(), v: m[2] } : { k: "", v: b }); } }
    else if (sec === "topics" && t()) { if (part === "sum" && !fence) { const b = bullet(line); if (b) t()!.sum.push(b); else if (line.trim()) t()!.sum.push(line.trim()); } else t()![part === "sum" ? "lesson" : part] += `${line}\n`; }
    else if (sec === "small") { const b = bullet(line); if (b) out.small.push(b); }
    else if (sec === "check") { const b = bullet(line); if (b) out.check.push(b); }
  }
  out.summary = out.summary.trim();
  for (const x of out.topics) { x.hard = x.hard.trim(); x.lesson = x.lesson.trim(); }
  return out;
}
export function MdReviewView({ md }: { md: string }) {
  const r = parseMdReview(md);
  const tone = (k: string) => /스스로|혼자/.test(k) ? "ok" : /도움/.test(k) ? "help" : "unk";
  const big = r.topics.filter((x) => x.size === "big").length;
  return <>
    {r.summary ? <div className="rv-intro sit"><div className="rv-introhead"><span className="rv-icon" aria-hidden>i</span>학습 총평</div><RvRich text={r.summary} /></div> : null}
    {r.state.length ? <div className="rv-endstate"><h4 className="rv-sectitle">끝났을 때 상태</h4>
      {r.state.map((x, i) => <div key={i} className={`rv-es ${tone(x.k)}`}><span className="rv-esk">{x.k || "상태"}</span><p><Ic text={x.v} /></p></div>)}</div> : null}
    {r.topics.length ? <div className="rv-story"><h4 className="rv-sectitle">채울 것{` ${r.topics.length}가지`}<span>핵심 {big} · 작은 {r.topics.length - big}</span></h4>
      <div className="rv-topics">{r.topics.map((x, i) => x.size === "small"
        ? <aside key={i} className="rv-weak small rv-topic"><div className="rv-smallhead"><span className="rv-chip">작은 {i + 1}</span><b>{x.title}</b></div>
            {x.hard ? <p className="rv-smallstate"><Ic text={x.hard} /></p> : null}
            {x.lesson ? <RvRich text={x.lesson} /> : null}
            {x.sum.length ? <ul className="rv-sum">{x.sum.map((y, j) => <li key={j}><Ic text={y} /></li>)}</ul> : null}</aside>
        : <article key={i} className="rv-weak big rv-topic">
            <header className="rv-weakhead"><span className="rv-core">핵심 {i + 1}</span><b className="rv-weaktitle">{x.title}</b></header>
            {x.hard ? <div className="rv-state"><span className="rv-lab">어려웠던 것</span><p><Ic text={x.hard} /></p></div> : null}
            {x.lesson ? <div className="rv-lesson"><span className="rv-lab">제대로 알기</span><RvRich text={x.lesson} /></div> : null}
            {x.sum.length ? <div className="rv-sumbox"><span className="rv-lab">정리</span><ul className="rv-sum">{x.sum.map((y, j) => <li key={j}><Ic text={y} /></li>)}</ul></div> : null}
          </article>)}</div></div> : null}
    {r.small.length ? <div className="rv-smalllist"><h4 className="rv-sectitle">자잘하게 막힌 것</h4><ul>{r.small.map((y, j) => <li key={j}><Ic text={y} /></li>)}</ul></div> : null}
    {r.check.length ? <div className="rv-intro nxt"><div className="rv-introhead"><span className="rv-icon" aria-hidden>?</span>다시 확인할 것</div><ul className="rv-sum">{r.check.map((y, j) => <li key={j}><Ic text={y} /></li>)}</ul></div> : null}
  </>;
}

/** 설명 글: 빈 줄로 나뉜 문단 + ``` 코드 블록(받는 중이면 닫히지 않은 블록도 코드로). */
export function RvRich({ text }: { text: string }) {
  const parts = text.split(/```/);
  return <div className="rv-rich">{parts.map((x, i) => i % 2 === 1
    ? <pre key={i} className="rv-pre">{x.replace(/^[\w+-]*\n/, "").replace(/\n$/, "")}</pre>
    : x.split(/\n\s*\n/).map((par) => par.trim()).filter(Boolean).map((par, j) => <p key={`${i}-${j}`}>{par.split("\n").map((l, k) => <span key={k}>{k ? <br /> : null}<Ic text={l} /></span>)}</p>))}</div>;
}
/** `코드`만 고정폭 글자로(나머지는 그대로). */
export function Ic({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/).map((x, i) => (x.startsWith("`") && x.endsWith("`") && x.length > 2 ? <code key={i} className="rv-ic">{x.slice(1, -1)}</code> : <span key={i}>{x}</span>))}</>;
}
