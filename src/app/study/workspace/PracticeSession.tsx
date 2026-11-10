"use client";
import { useEffect, useRef, useState } from "react";
import { RichInline, RichLines, TeX } from "./Rich";
import { useBridge, type Bridge } from "./bridge";

/* 문제 풀기 (11/11 바닐라 renderSession·renderSessionEnd를 React로). 채점·기록·복습 날짜는 앱(dejipgi-app.js)의 sessionApi가 한다. */
type Block =
  | { kind: "text"; text: string; heading?: boolean } | { kind: "math"; latex: string } | { kind: "table"; rows: string[][]; headerRows: number }
  | { kind: "box"; label: string } | { kind: "blank"; before: string; after: string; own: boolean } | { kind: "image"; page: number; alt: string }
  | { kind: "generated-image"; path: string; alt: string; caption?: string };
type Item = {
  id: string; page: number; format: "choice" | "value" | "order" | "card"; prompt: string; blocks?: Block[]; options?: string[]; optionNotes?: string[]; answer?: number | string;
  accepted?: string[]; steps?: string[]; explanation?: string; quote?: string; quoteVerified?: boolean; termCard?: boolean;
};
type Cur = { pick: number | null; text: string; order: number[]; pool: number[]; optOrder: number[]; verdict: string | null; overridden: boolean; selfJudged: boolean; feedback: string; reporting: boolean; reported: string; key: string };
type Live = {
  done: false; i: number; total: number; phase: "ask" | "judge" | "rate" | "result"; mode: string; overlay: boolean; page: number; reason: [string, string] | null; retry: boolean;
  deck: { id: string; title: string; pastExam: boolean }; item: Item; format: string; objective: string; numeric: boolean; assetUrl(path: string): string; cur: Cur;
  quickFix: { times: number; card: boolean } | null; reportReasons: string[];
};
type Done = {
  done: true; mode: string; page: number; from: string; subject: string; good: number; bad: number; help: number; mid: number; n: number; next: string; todayLeft: number; weakLeft: number; mapBack: boolean;
  fb: { picked: Record<string, string>; said: Record<string, string>; amount: string[]; repeat: string[] } | null;
};
type Api = {
  snapshot(): Live | Done | null;
  pick(oi: number): void; setText(t: string): void; orderAdd(k: number): void; orderRemove(k: number): void; submit(): void; dontKnow(): void; peek(): void; showCard(): void;
  rate(r: "forgot" | "remembered" | "unsure"): void; judge(ok: boolean): void; override(): void; next(): void; asCard(): void; leave(): void; close(): void; source(): void;
  fixAccept(): void; fixCard(): void; fbNarrow(): void; fbEasy(): void; reporting(on: boolean): void; report(r: string): void; sessionFb(key: string, label: string): void;
  toMap(): void; toList(): void; nextPage(): void; backPage(): void; continueToday(): void; records(): void;
};

export default function PracticeSession({ ui, api }: { ui: Bridge; api: Api }) {
  useBridge(ui);
  const s = api.snapshot();
  if (!s) return null;
  return s.done ? <SessionEnd s={s} api={api} /> : <Question s={s} api={api} />;
}

function Stem({ s }: { s: Live }) {
  const it = s.item;
  if (!Array.isArray(it.blocks) || !it.blocks.length) return <p className="qprompt"><RichInline text={it.prompt} /></p>;
  return (
    <div className="qstem">
      {it.blocks.map((b, i) => {
        if (b.kind === "text") return <p key={i} className={b.heading ? "qprompt" : "qbody"}><RichInline text={b.text} /></p>;
        if (b.kind === "math") return <div key={i} className="math qmath"><TeX tex={b.latex} display /></div>;
        if (b.kind === "table") return <div key={i} className="qtable-wrap"><table className="qtable"><tbody>{b.rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => ri < b.headerRows ? <th key={ci}><RichInline text={cell} /></th> : <td key={ci}><RichInline text={cell} /></td>)}</tr>)}</tbody></table></div>;
        if (b.kind === "box") return <div key={i} className="qbox"><RichInline text={b.label} /></div>;
        if (b.kind === "blank") return <p key={i} className="qprompt"><RichInline text={b.before} /><span className={b.own ? "qblank" : "qblank other"}>{b.own ? "빈칸" : "다른 칸"}</span><RichInline text={b.after} /></p>;
        // Source figures are not cropped yet (crop units are undefined); a whole page could give the answer away.
        if (b.kind === "image") return <figure key={i} className="qfig"><div className="qfig-ph">원문 p.{b.page}의 그림</div><figcaption>{b.alt}</figcaption></figure>;
        if (b.kind === "generated-image") return (
          <figure key={i} className="qfig">
            {/* eslint-disable-next-line @next/next/no-img-element -- 앱이 만든 그림 파일 주소 그대로 */}
            <img src={s.assetUrl(b.path)} alt={b.alt} />
            {b.caption ? <figcaption>{b.caption}</figcaption> : null}
          </figure>
        );
        return null;
      })}
    </div>
  );
}

const VERDICT = (c: Cur, card: boolean): Record<string, [string, string, string]> => ({
  good: ["good", c.selfJudged ? "맞음으로 표시했어요 (직접 확인)" : c.overridden ? "맞음으로 고쳤어요" : "혼자 맞혔어요", c.overridden ? "자동 채점이 놓친 답을 직접 인정했어요. 기록에 표시해 둡니다." : "다음에는 간격을 늘려 다시 물어볼게요."],
  bad: ["bad", card ? "잘 모른다고 표시했어요" : "이번엔 떠올리지 못했어요", "복습 필요로 표시해 뒀어요. 내일 복습에 다시 나와요."],
  assisted: ["help", "정답을 보고 확인했어요", "혼자 맞힌 기록으로 세지 않아요. 내일 복습에 다시 나와요."],
  "self-good": ["self", "알고 있다고 표시했어요", "자기평가라서 자동 채점보다 약한 근거로 기록돼요."],
  "self-mid": ["self", "헷갈렸다고 표시했어요", "내일 다시 물어볼게요."],
  "read-good": ["read", c.overridden ? "맞음으로 고쳤어요 (읽은 직후)" : "읽은 직후 맞혔어요", "방금 읽은 내용이라 기억 기록으로 세지 않아요. 내일부터 복습에 넣을게요."],
  "read-mid": ["read", "일부만 떠올렸어요 (읽은 직후)", "내일부터 복습에 넣을게요."],
  "read-bad": ["bad", "읽은 직후에도 헷갈렸어요", "아래 ‘원문에서 보기’로 다시 읽어 보세요. 복습 필요로 표시해 뒀어요."],
});

function Question({ s, api }: { s: Live; api: Api }) {
  const it = s.item, c = s.cur, locked = s.phase !== "ask";
  // 입력칸 글은 React가 들고(앱이 다시 그려도 한글 조합이 끊기지 않게), 바뀔 때마다 앱에 넘긴다. 문제가 바뀌면 앱 값으로 다시 맞춘다.
  const [text, setText] = useState(c.text);
  const [shownKey, setShownKey] = useState(c.key);
  if (shownKey !== c.key) { setShownKey(c.key); setText(c.text); }
  const focusRef = useRef<HTMLElement | null>(null);
  useEffect(() => { focusRef.current?.focus({ preventScroll: true }); }, [c.key, s.phase]);
  const autofocus = (el: HTMLElement | null) => { focusRef.current = el; };
  const type = (v: string) => { setText(v); api.setText(v); };

  const ready = it.format === "choice" ? c.pick != null : it.format === "value" ? !!text.trim() : it.format === "order" ? c.order.length === (it.steps?.length ?? 0) : true;
  const ansText = it.format === "choice" ? it.options?.[Number(it.answer)] ?? "" : it.format === "value" ? it.accepted?.[0] ?? "" : it.format === "order" ? (it.steps ?? []).map((x, i) => `${i + 1}. ${x}`).join("\n") : String(it.answer ?? "");
  const v = c.verdict ? VERDICT(c, it.format === "card")[c.verdict] : null;
  const slip = it.format === "choice" && c.pick != null && c.pick !== it.answer && it.optionNotes ? it.optionNotes[c.pick] : "";

  return (
    <div>
      <div className="session-top">
        {s.overlay ? <button className="btn ghost small" title="닫고 이 쪽으로 (Esc) · 푼 것까지는 기록돼요" onClick={api.close}>✕ p.{s.page}로</button>
          : <button className="btn ghost small" onClick={api.leave}>그만하기</button>}
        <div className="progress" aria-hidden="true"><i style={{ width: `${(s.i / s.total * 100).toFixed(1)}%` }} /></div>
        <span className="mono num muted">{s.i + 1} / {s.total}</span>
      </div>
      <article className="qcard" aria-live="polite">
        <div className="qhead">
          <span className="chip page">p.{it.page}</span>
          <span className="chip">{s.format}</span>
          {s.mode === "check" ? <span className="chip read">읽은 직후 확인</span> : null}
          {s.mode === "weak" ? <span className="chip bad">약점 다시 풀기</span> : null}
          {s.reason ? <span className={`chip ${s.reason[1]}`}>{s.reason[0]}</span> : null}
          {s.retry ? <span className="chip help">다시 확인</span> : null}
          {s.deck.pastExam ? <span className="chip exam">기출형</span> : null}
          {s.overlay ? null : <span className="chip">{s.deck.title}</span>}
        </div>
        <Stem s={s} />

        {it.format === "choice" ? (
          <div className="options" role="group">
            {c.optOrder.map((oi, pos) => {
              const cls = ["opt"];
              if (locked && oi === it.answer) cls.push("is-correct"); else if (locked && c.pick === oi && oi !== it.answer) cls.push("is-wrong");
              return (
                <button key={oi} className={cls.join(" ")} aria-pressed={c.pick === oi} disabled={locked} onClick={() => api.pick(oi)}>
                  <span className="k">{pos + 1}</span><span><RichInline text={it.options?.[oi] ?? ""} /></span>
                  {locked && it.optionNotes?.[oi] ? <span className="opt-note"><RichInline text={it.optionNotes[oi]} /></span> : null}
                </button>
              );
            })}
          </div>
        ) : it.format === "value" ? (
          <div className="field">
            <label htmlFor="ans" className="muted small" style={{ fontWeight: 400 }}>{s.numeric ? "예: (1,2), 3/4, 75°  · 띄어쓰기와 ·, °, 따옴표 차이는 채점에서 무시해요" : "띄어쓰기·대소문자·따옴표 차이는 채점에서 무시해요"}</label>
            <input className="answer-input" id="ans" type="text" autoComplete="off" spellCheck={false} placeholder="답을 입력하세요" disabled={locked} value={text}
              ref={s.phase === "ask" ? autofocus : undefined} onChange={(e) => type(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); api.submit(); } }} />
          </div>
        ) : it.format === "order" ? (
          <>
            <div className="order-picked" aria-label="고른 순서">
              {!c.order.length ? <span className="small muted">아래 단계를 먼저 오는 것부터 누르세요.</span> : null}
              {c.order.map((si, k) => (
                <button key={si} className="step" disabled={locked} style={locked ? { borderColor: si !== k ? "var(--bad)" : "var(--good)" } : undefined} onClick={() => api.orderRemove(k)}>
                  <b>{k + 1}</b><span>{it.steps?.[si]}</span>
                </button>
              ))}
            </div>
            <div className="order-pool">{c.pool.map((si, k) => <button key={si} className="step" disabled={locked} onClick={() => api.orderAdd(k)}>{it.steps?.[si]}</button>)}</div>
          </>
        ) : s.phase === "ask" ? (
          <textarea className="answer-input" id="ans" placeholder="떠올린 내용을 적어 보세요 (선택). 적지 않고 머릿속으로만 떠올려도 됩니다." value={text} ref={autofocus} onChange={(e) => type(e.target.value)} />
        ) : text.trim() ? (
          <div className="note"><div className="small">내가 적은 답</div><div style={{ whiteSpace: "pre-line", color: "var(--ink)" }}>{text}</div></div>
        ) : null}

        {s.phase === "judge" ? (
          <div className="judge">
            <dl className="reveal">
              <div><dt>내 답</dt><dd style={{ whiteSpace: "pre-line" }}><RichLines text={text} /></dd></div>
              <div><dt>정답</dt><dd style={{ whiteSpace: "pre-line", fontWeight: 600 }}><RichLines text={it.accepted?.[0] ?? ""} /></dd></div>
            </dl>
            <p className="small" style={{ margin: "8px 0 0" }}>자동 채점으로는 판단하지 못했어요. 정답과 같은 뜻인가요?</p>
          </div>
        ) : null}

        {s.phase === "rate" || s.phase === "result" ? (
          <>
            {s.phase === "result" && v ? (
              <div className={`verdict ${v[0]}`}>
                <strong>{v[1]}</strong><span className="small">{v[2]}</span>
                {it.format === "value" && (c.verdict === "bad" || c.verdict === "read-bad") && !c.overridden && !c.selfJudged && text.trim()
                  ? <span><button className="linkish" onClick={api.override}>내 답도 맞아요 (표기만 달라요)</button></span> : null}
              </div>
            ) : null}
            <dl className="reveal">
              {it.format === "card" || s.phase === "result" ? <div><dt>정답</dt><dd style={{ whiteSpace: "pre-line", fontWeight: 600 }}><RichLines text={ansText} /></dd></div> : null}
              {s.phase === "result" ? (
                <>
                  {slip ? <div><dt>이렇게 헷갈렸어요</dt><dd><RichInline text={slip} /></dd></div> : null}
                  {it.explanation ? <div><dt>설명</dt><dd><RichLines text={it.explanation} /></dd></div> : null}
                  {s.objective ? <div><dt>학습목표</dt><dd><RichInline text={s.objective} /></dd></div> : null}
                  <div><dt>원문 근거 · p.{it.page}</dt><dd>
                    <mark className="quote">{it.quote || "기록된 인용 없음"}</mark>
                    {it.quoteVerified === false ? <span className="chip help" style={{ marginLeft: 6 }}>원문과 일치 확인 안 됨</span> : null}
                    <div style={{ marginTop: 8 }}><button className="btn small" onClick={api.source}>{s.overlay ? "원문에서 다시 보기" : "원문에서 보기 →"}</button></div>
                  </dd></div>
                </>
              ) : null}
            </dl>
            {s.phase === "result" ? (
              <>
                {s.quickFix ? (
                  <div className="quickfix">
                    <span className="small">{s.quickFix.card ? `이 문제에서 ‘내 답도 맞아요’가 ${s.quickFix.times}번째예요. 표기가 여러 가지라 떠올리기 카드가 더 맞아 보여요.` : "다음부터 이 답도 정답으로 칠까요?"}</span>
                    <div className="row">
                      <button className="btn small" onClick={api.fixAccept}>정답에 추가</button>
                      {s.quickFix.card ? <button className="btn small primary" onClick={api.fixCard}>카드로 바꾸기</button> : null}
                    </div>
                  </div>
                ) : null}
                {c.feedback ? <p className="small muted">{c.feedback}</p> : (
                  <div className="row itemfb"><span className="small muted">이 문제는</span>
                    <button className="chip-btn" onClick={api.fbNarrow}>너무 지엽적</button>
                    <button className="chip-btn" onClick={api.fbEasy}>너무 쉬움</button>
                  </div>
                )}
                {c.reported ? <p className="small muted"><span className="chip help">신고함 · {c.reported}</span></p>
                  : !c.reporting ? <p><button className="linkish" onClick={() => api.reporting(true)}>이 문제 이상해요</button></p>
                  : <div className="row"><span className="small muted">무엇이 이상한가요?</span>
                      {s.reportReasons.map(r => <button key={r} className="btn small" onClick={() => api.report(r)}>{r}</button>)}
                      <button className="btn small ghost" onClick={() => api.reporting(false)}>취소</button></div>}
              </>
            ) : null}
          </>
        ) : null}

        <div className="actions">
          {s.phase === "ask" ? (
            <>
              {it.format === "card" ? <button className="btn primary" onClick={api.showCard}>답 확인 <span className="kbd">Enter</span></button> : (
                <>
                  <button className="btn primary" id="submitBtn" disabled={!ready} onClick={api.submit}>제출 <span className="kbd">Enter</span></button>
                  <button className="btn" onClick={api.dontKnow}>모르겠어요</button>
                </>
              )}
              <span className="spacer" />
              {it.termCard ? <button className="btn ghost small" title="보기 없이 떠올리는 카드로 풀어요" onClick={api.asCard}>카드로 풀기</button> : null}
              {it.format !== "card" ? <button className="btn ghost small" onClick={api.peek} title="정답을 먼저 보면 이번 풀이는 혼자 맞힌 기록으로 세지 않아요">정답 먼저 보기</button> : null}
            </>
          ) : s.phase === "judge" ? (
            <>
              <span className="small muted">내 답과 정답을 비교해 보세요</span>
              <div className="rate">
                <button className="btn" onClick={() => api.judge(false)}>틀렸어요 <span className="kbd">2</span></button>
                <button className="btn primary" ref={autofocus} onClick={() => api.judge(true)}>맞았어요 <span className="kbd">1</span></button>
              </div>
            </>
          ) : s.phase === "rate" ? (
            <>
              <span className="small muted">떠올린 것과 비교해 보세요</span>
              <div className="rate">
                <button className="btn" onClick={() => api.rate("forgot")}>잘 모름</button>
                <button className="btn primary" onClick={() => api.rate("remembered")}>알고 있음</button>
              </div>
            </>
          ) : (
            <>
              <span className="spacer" />
              <button className="btn primary" ref={autofocus} onClick={api.next}>{s.i + 1 >= s.total ? "결과 보기 " : "다음 "}<span className="kbd">Enter</span></button>
            </>
          )}
        </div>
      </article>
    </div>
  );
}

function SessionEnd({ s, api }: { s: Done; api: Api }) {
  const check = s.mode === "check";
  const who = s.subject ? `${s.subject} ` : "";
  return (
    <div className="stack">
      <section className="panel stack">
        <p className="eyebrow">연습 끝</p>
        <h2 style={{ fontFamily: "var(--display)", fontSize: 22 }}>{check ? `p.${s.page} 확인 문제 ${s.n}번 풀었어요` : `${s.n}번 풀었어요`}</h2>
        {check ? <p className="small muted">읽은 직후 푼 결과는 기억 기록으로 세지 않아요. 진짜 확인은 내일부터 복습에서 해요.</p> : null}
        <div className="tiles" style={{ margin: 0 }}>
          <div className="tile"><b className="num" style={{ color: "var(--good)" }}>{s.good}</b><span>{check ? "맞힘 (읽은 직후)" : "혼자 맞힘"}</span></div>
          <div className="tile"><b className="num" style={{ color: "var(--bad)" }}>{s.bad}</b><span>못 떠올림</span></div>
          <div className="tile"><b className="num">{s.mid}</b><span>헷갈림</span></div>
          <div className="tile"><b className="num" style={{ color: "var(--help)" }}>{s.help}</b><span>정답 보고 풂</span></div>
        </div>
        <p className="small muted">{s.next ? `다음 복습은 ${s.next}에 차례가 와요.` : ""}</p>
        {s.mode === "today" ? <p className="small">{s.todayLeft ? `오늘 할 것이 ${s.todayLeft}문제 남았어요.` : "오늘 할 것을 모두 마쳤어요."}</p> : null}
        {s.mode === "weak" ? <p className="small">{s.weakLeft ? `${who}약점이 ${s.weakLeft}문제 남았어요. 혼자 맞히면 약점에서 빠져요.` : `${who}약점을 모두 풀었어요.`}</p> : null}
        {s.fb ? <SessionFeedback fb={s.fb} api={api} /> : null}
        {check && s.mapBack ? (
          <div className="row"><button className="btn primary" onClick={api.toMap}>자료 지도로 돌아가기</button><button className="btn" onClick={api.toList}>공부 목록</button></div>
        ) : check ? (
          <div className="row"><button className="btn primary" onClick={api.nextPage}>다음 쪽 읽기</button><button className="btn" onClick={api.backPage}>p.{s.page}로 돌아가기</button></div>
        ) : (
          <div className="row">
            {s.mode === "today" && s.todayLeft ? <button className="btn primary" onClick={api.continueToday}>이어서 하기</button> : null}
            <button className={s.mode === "today" && s.todayLeft ? "btn" : "btn primary"} onClick={api.leave}>{s.from === "home" ? "오늘로" : "처음으로"}</button>
            <button className="btn" onClick={api.records}>기록 보기</button>
          </div>
        )}
      </section>
    </div>
  );
}

function SessionFeedback({ fb, api }: { fb: NonNullable<Done["fb"]>; api: Api }) {
  const group = (key: string, label: string, choices: Array<[string, string]>) => (
    <div className="fbrow">
      <span className="small muted">{label}</span>
      <div className="row">{choices.map(([value, text]) => <button key={value} className="chip-btn" aria-pressed={fb.picked[key] === value} disabled={!!fb.said[key]} onClick={() => api.sessionFb(key, value)}>{text}</button>)}</div>
      {fb.said[key] ? <span className="small good-text">{fb.said[key]}</span> : null}
    </div>
  );
  return (
    <section className="panel stack fb">
      <p><b>이번 풀이 어땠어요?</b><span className="small muted"> 누르면 바로 반영돼요.</span></p>
      {group("amount", "하루 분량", fb.amount.map(x => [x, x]))}
      {group("repeat", "복습 간격", fb.repeat.map(x => [x, x]))}
      {group("content", "내용", [["지엽", "너무 꼼꼼·지엽적"], ["빠짐", "빠진 게 많아요"]])}
    </section>
  );
}
