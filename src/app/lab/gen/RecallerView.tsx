"use client";
// 실험실 보기 (11/5 사용자 "품질 체크하기 편하게: 어떤 방법 → 출력 품질, 시간·비용은 따로"): the recaller engine's run as
// four tabs — 결과(요약 줄 아래 카드, 주제별 문항), 방법, 시간·비용, 호출. Reads only what the run already saved.
import { useMemo, useState } from "react";
import type { GenCall, GenState } from "@/lib/study/gen/types";
import { genStepLabel } from "@/lib/study/gen/types";
import { Inline } from "@/app/study/workspace/Rich";

type CallSummary = Omit<GenCall, "system" | "user" | "reply">;
type Obj = Record<string, unknown>;
type Card = { id: string; kind: string; title: string; weight?: string; shape: Obj & { form: string }; evidence?: Array<{ page: number; quote: string }>; mistakes?: string[] };
type Option = { text: string | null; latex?: string | null; note?: string };
type Question = { sectionId: string; format: string; cardIds: string[]; goal: string; hint?: string; pages: number[];
  authored: { stem: Array<{ text?: string | null; latex?: string | null }>; answer: { kind: string; options: Option[] | null; correctIndex: number | null; accepted: string[] | null; before: string | null; after: string | null; explanation: string } } };
type Chunk = { cards?: Card[]; questions?: Question[]; held?: Array<{ cardId: string; reason: string }> };
type Line = { id: string; name: string; text: string; pages: number[] };
type Digest = { skeleton?: { topics: Array<{ id: string; title: string; pages: number[]; kind?: string }> }; topics?: Record<string, { text: string; body: Line[]; easy?: { mistake?: string } }>;
  notes?: Record<string, { covers: string[] }>; objectives?: Array<{ id: string; verb: string; text: string; core: boolean }> };
type Rc = { units: Record<string, { cards?: Card[]; chunks?: Record<string, Chunk> }>; digest?: Digest; lang?: string;
  timing?: Record<string, string | undefined> };

const PRICE: Record<string, [number, number, number]> = { terra: [1, 0.05, 5], sol: [2, 0.1, 10], luna: [0.1, 0.01, 0.5] };
const usd = (c: CallSummary) => {
  const u = c.usage ?? { inputTokens: 0, outputTokens: 0 }; const p = PRICE[(c.model ?? "").match(/terra|sol|luna/)?.[0] ?? "luna"];
  const cached = u.cachedInputTokens ?? 0;
  return (((u.inputTokens ?? 0) - cached) * p[0] + cached * p[1] + (u.outputTokens ?? 0) * p[2]) / 1e6;
};
const money = (x: number) => `$${x.toFixed(3)} (약 ${Math.round(x * 1400).toLocaleString()}원)`;
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
const FORMAT: Record<string, string> = { choice: "객관식", ox: "OX", cloze: "빈칸", flashcard: "서술", short: "단답" };
const FORM: Record<string, string> = { term: "용어", rule: "조건", procedure: "절차", fact: "사실", list: "목록", compare: "비교", formula: "공식", concept: "개념" };
const FIELD: Record<string, string> = { name: "이름", symbol: "기호", definition: "정의", neighbors: "헷갈리는 것", premise: "전제", condition: "조건", result: "결과", boundary: "경계",
  steps: "단계", subject: "대상", value: "내용", items: "항목", targets: "비교 대상", criteria: "기준", expr: "식", vars: "변수", when: "쓰는 때", claim: "주장", reason: "이유", limit: "한계" };

function shapeRows(shape: Obj) {
  return Object.entries(shape).filter(([k, v]) => k !== "form" && v !== "" && v !== null && !(Array.isArray(v) && !v.length)).map(([k, v]) => {
    let text: string;
    if (k === "steps" && Array.isArray(v)) text = v.map((s, i) => `${i + 1}. ${(s as Obj).action}`).join("  ");
    else if (k === "criteria" && Array.isArray(v)) text = v.map((c) => `${(c as Obj).name}: ${((c as Obj).values as string[]).join(" / ")}`).join("  ·  ");
    else if (k === "vars" && Array.isArray(v)) text = v.map((x) => `${(x as Obj).symbol}=${(x as Obj).meaning}`).join(", ");
    else text = Array.isArray(v) ? v.join(", ") : String(v);
    return [FIELD[k] ?? k, text] as const;
  });
}

function CardBox({ card }: { card: Card }) {
  return (
    <details className="rv-card">
      <summary><span className={`rv-form f-${card.shape.form}`}>{FORM[card.shape.form] ?? card.shape.form}</span> {card.title}</summary>
      <dl>{shapeRows(card.shape).map(([k, v]) => <div key={k}><dt>{k}</dt><dd><Inline text={v} /></dd></div>)}</dl>
      {card.mistakes?.length ? <p className="rv-sub">흔한 오답: {card.mistakes.join(" / ")}</p> : null}
      {card.evidence?.map((e, i) => <q key={i} className="rv-quote">p.{e.page} {e.quote}</q>)}
    </details>
  );
}

function QuestionBox({ q }: { q: Question }) {
  const a = q.authored.answer;
  const stem = q.authored.stem.map((b) => b.text ?? b.latex ?? "").join(" ");
  return (
    <div className="rv-q">
      <div className="rv-qhead"><span className="rv-badge">{FORMAT[q.format] ?? q.format}</span> <b><Inline text={stem} /></b> <small>p.{q.pages.join(",")}</small></div>
      {a.before !== null && a.after !== null && <p><Inline text={a.before} /> <span className="rv-blank">{a.accepted?.[0] ?? "____"}</span> <Inline text={a.after} /> {a.accepted && a.accepted.length > 1 && <small className="rv-sub">인정: {a.accepted.join(" / ")}</small>}</p>}
      {a.options && <ol className="rv-opts">{a.options.map((o, i) => (
        <li key={i} className={i === a.correctIndex ? "right" : ""}><span>{i === a.correctIndex ? "✓ " : ""}<Inline text={o.text ?? (o.latex ? `$${o.latex}$` : "")} /></span>{o.note && <small><Inline text={o.note} /></small>}</li>
      ))}</ol>}
      {q.format === "flashcard" && a.accepted?.[0] && <p className="rv-sub">모범 답: <Inline text={a.accepted[0]} /></p>}
      <p className="rv-sub">해설: <Inline text={a.explanation} /></p>
      {q.hint && <p className="rv-sub">힌트: {q.hint}</p>}
      {q.goal && <p className="rv-sub">목표: {q.goal}</p>}
    </div>
  );
}

function Result({ gen, rc }: { gen: GenState; rc: Rc }) {
  const d = rc.digest ?? {};
  const topics: Array<{ id: string; title: string; pages: number[]; kind?: string }> = d.skeleton?.topics ?? gen.sections.map((s) => ({ id: s.id, title: s.title, pages: s.pages }));
  const chunksOf = (id: string) => Object.values(rc.units[id]?.chunks ?? {});
  const all = topics.flatMap((t) => chunksOf(t.id));
  const cardCount = all.reduce((n, c) => n + (c.cards?.length ?? 0), 0), qCount = all.reduce((n, c) => n + (c.questions?.length ?? 0), 0), heldCount = all.reduce((n, c) => n + (c.held?.length ?? 0), 0);
  return (
    <div className="rv-result">
      <div className="rv-stats"><span>주제 <b>{topics.length}</b></span><span>카드 <b>{cardCount}</b></span><span>문항 <b>{qCount}</b></span><span>보류 <b>{heldCount}</b></span></div>
      {d.objectives?.length ? (
        <details className="rv-box"><summary>학습 목표 {d.objectives.length}개</summary>
          <ol>{d.objectives.map((o) => <li key={o.id}><span className="rv-badge">{o.verb}</span> {o.text}{o.core ? "" : <small className="rv-sub"> (보조)</small>}</li>)}</ol>
        </details>) : null}
      {topics.map((t) => {
        const s = d.topics?.[t.id];
        const cards = chunksOf(t.id).flatMap((c) => c.cards ?? []);
        const questions = chunksOf(t.id).flatMap((c) => c.questions ?? []);
        const held = chunksOf(t.id).flatMap((c) => c.held ?? []);
        const lines = s?.body ?? [];
        const under = (lineId: string) => cards.filter((c) => d.notes?.[c.id]?.covers?.includes(lineId));
        const loose = cards.filter((c) => !lines.some((l) => d.notes?.[c.id]?.covers?.includes(l.id)));
        const mapLine = s?.text && /배운다\.$/.test(s.text.trim()) ? s.text : null;
        return (
          <section key={t.id} className="rv-topic">
            <h3>{t.title} <small>p.{t.pages[0]}{t.pages.length > 1 ? `–${t.pages.at(-1)}` : ""}{t.kind ? ` · ${t.kind}` : ""}</small></h3>
            {mapLine && <p className="rv-map">{mapLine}</p>}
            <ul className="rv-lines">{lines.map((l) => (
              <li key={l.id}>
                <div className="rv-line">{mapLine ? <b>{l.name}</b> : <><b>{l.name}</b>: {l.text}</>}</div>
                <div className="rv-cards">{under(l.id).map((c) => <CardBox key={c.id} card={c} />)}{!under(l.id).length && <span className="rv-warn">카드 없음</span>}</div>
              </li>
            ))}</ul>
            {loose.length ? <div className="rv-cards"><span className="rv-sub">줄에 안 붙은 카드</span>{loose.map((c) => <CardBox key={c.id} card={c} />)}</div> : null}
            {s?.easy?.mistake && <p className="rv-sub">흔한 오해: {s.easy.mistake}</p>}
            {questions.length || held.length ? (
              <div className="rv-qs">
                <h4>문항 {questions.length}{held.length ? ` · 보류 ${held.length}` : ""}</h4>
                {questions.map((q, i) => <QuestionBox key={i} q={q} />)}
                {held.map((h, i) => <p key={i} className="rv-held">보류 {cards.find((c) => c.id === h.cardId)?.title ?? h.cardId}: {h.reason}</p>)}
              </div>) : null}
          </section>
        );
      })}
    </div>
  );
}

function Method({ gen, calls, rc }: { gen: GenState; calls: CallSummary[]; rc: Rc }) {
  const lab = (gen.input.lab ?? {}) as Obj;
  const steps = [...new Map(calls.map((c) => [c.step, `${c.model} ${c.effort}`])).entries()];
  const how = [
    ["자료", `${gen.input.fileName} · ${gen.input.pageNumbers.length}쪽 (p.${gen.input.pageNumbers[0]}–${gen.input.pageNumbers.at(-1)})${rc.lang === "en" ? " · 영어 자료(한국어(영어)로 씀)" : ""}`],
    ["정리 방식", lab.mapCards ? `목차 → 바로 카드 (${lab.mapUnit === "page" ? "쪽 단위" : "주제 단위"}, 주제 요약 없음)`
      : lab.conceptLines ? "목차·개념 줄 → 주제 요약 → 카드" : lab.digest ? (lab.digestStyle === "plan" ? "목차 → 주제 요약 → 카드" : "뼈대 → 주제 요약 → 카드") : "쪽 단위 정리"],
    ["원문 목차", lab.mapCards || lab.conceptLines ? (lab.mapUnit === "page" ? "쪽마다 한 항목" : lab.noSourceOutline ? "AI가 짬" : "책갈피·쪽 제목이 있으면 그대로") : "AI가 짬"],
    ["퀴즈", lab.quiz === "luna" ? `luna ${lab.quizCount ? `${lab.quizCount}문항` : "카드마다"}` : "없음"],
  ];
  return (
    <div className="rv-method">
      <dl className="rv-kv">{how.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <h4>단계별 모델</h4>
      <table className="rv-table"><tbody>{steps.map(([s, m]) => <tr key={s}><td>{genStepLabel[s] ?? s}</td><td><code>{s}</code></td><td>{m}</td></tr>)}</tbody></table>
      <details><summary>실험 옵션 전체</summary><pre>{JSON.stringify(lab, null, 2)}</pre></details>
    </div>
  );
}

function TimeCost({ gen, calls, rc }: { gen: GenState; calls: CallSummary[]; rc: Rc }) {
  const t1 = calls.length ? Math.min(...calls.map((c) => Date.parse(c.startedAt))) : Date.parse(gen.createdAt);
  const end = calls.length ? Math.max(...calls.map((c) => Date.parse(c.startedAt) + c.ms)) : t1;
  const total = calls.reduce((a, c) => a + usd(c), 0);
  const quiz = calls.filter((c) => /^rc-q-|^rc-check/.test(c.step)).reduce((a, c) => a + usd(c), 0);
  const tm = rc.timing ?? {};
  const at = (x?: string) => x ? sec(Date.parse(x) - t1) : "–";
  const plan = calls.find((c) => c.step === "rc-digest-plan");
  const marks = [["목차 끝", plan ? sec(Date.parse(plan.startedAt) + plan.ms - t1) : "–"], ["카드 완료", at(tm.cardsDoneAt)], ["첫 문제", at(tm.firstPublishedAt)], ["전체 완료", at(tm.completedAt)]];
  const by = new Map<string, { n: number; model: string; input: number; cached: number; output: number; usd: number; first: number; last: number }>();
  for (const c of calls) {
    const b = by.get(c.step) ?? { n: 0, model: `${c.model} ${c.effort}`, input: 0, cached: 0, output: 0, usd: 0, first: Infinity, last: 0 };
    b.n++; b.input += c.usage?.inputTokens ?? 0; b.cached += c.usage?.cachedInputTokens ?? 0; b.output += c.usage?.outputTokens ?? 0; b.usd += usd(c);
    b.first = Math.min(b.first, Date.parse(c.startedAt) - t1); b.last = Math.max(b.last, Date.parse(c.startedAt) + c.ms - t1); by.set(c.step, b);
  }
  const span = Math.max(end - t1, 1);
  return (
    <div className="rv-time">
      <div className="rv-stats"><span>전체 비용 <b>{money(total)}</b></span><span>퀴즈 <b>{money(quiz)}</b></span><span>카드까지 <b>{money(total - quiz)}</b></span>
        <span>대기 <b>{sec(Math.max(0, t1 - Date.parse(gen.createdAt)))}</b></span></div>
      <div className="rv-stats">{marks.map(([k, v]) => <span key={k}>{k} <b>{v}</b></span>)}</div>
      <p className="rv-sub">시각은 첫 AI 호출 시작부터. 비용은 1M 토큰당 단가(terra $1/$0.05/$5, sol $2/$0.1/$10, luna $0.1/$0.01/$0.5)로 계산한 참고값.</p>
      <table className="rv-table"><thead><tr><th>단계</th><th>모델</th><th>호출</th><th>입력(캐시)</th><th>출력</th><th>비용</th><th>구간</th></tr></thead>
        <tbody>{[...by.entries()].sort((a, b) => a[1].first - b[1].first).map(([s, b]) => (
          <tr key={s}><td>{genStepLabel[s as keyof typeof genStepLabel] ?? s}</td><td>{b.model}</td><td>{b.n}</td><td>{b.input.toLocaleString()} ({b.cached.toLocaleString()})</td><td>{b.output.toLocaleString()}</td><td>${b.usd.toFixed(4)}</td>
            <td className="rv-barcell"><div className="rv-bar" style={{ left: `${(b.first / span) * 100}%`, width: `${Math.max(1, ((b.last - b.first) / span) * 100)}%` }} /><small>{sec(b.first)}–{sec(b.last)}</small></td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function RecallerView({ gen, calls, onOpenCall }: { gen: GenState; calls: CallSummary[]; onOpenCall: (n: number) => void }) {
  const [tab, setTab] = useState<"result" | "method" | "time" | "calls">("result");
  const rc = useMemo(() => (gen.recaller ?? { units: {} }) as unknown as Rc, [gen.recaller]);
  const tabs = [["result", "결과 품질"], ["method", "방법"], ["time", "시간·비용"], ["calls", `호출 ${calls.length}`]] as const;
  return (
    <div className="rv">
      <nav className="rv-tabs">{tabs.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}</nav>
      {tab === "result" && <Result gen={gen} rc={rc} />}
      {tab === "method" && <Method gen={gen} calls={calls} rc={rc} />}
      {tab === "time" && <TimeCost gen={gen} calls={calls} rc={rc} />}
      {tab === "calls" && (
        <table className="rv-table click"><thead><tr><th>#</th><th>단계</th><th>주제</th><th>모델</th><th>시간</th><th>입력/출력</th><th>비용</th></tr></thead>
          <tbody>{calls.map((c) => (
            <tr key={c.n} onClick={() => onOpenCall(c.n)} className={c.ok ? "" : "bad"}><td>{c.n}</td><td>{genStepLabel[c.step] ?? c.step}</td><td>{c.sectionId ?? ""}</td><td>{c.model} {c.effort}</td>
              <td>{sec(c.ms)}</td><td>{(c.usage?.inputTokens ?? 0).toLocaleString()} / {(c.usage?.outputTokens ?? 0).toLocaleString()}</td><td>${usd(c).toFixed(4)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
