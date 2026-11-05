"use client";
// 실험실 보기 (11/5 사용자 "품질 체크하기 편하게: 어떤 방법 → 출력 품질, 시간·비용은 따로"): the recaller engine's run as
// four tabs — 결과(요약 줄 아래 카드, 주제별 문항), 방법, 시간·비용, 호출. Reads only what the run already saved.
import { useEffect, useMemo, useState } from "react";
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
  // 목차만 (11/5 사용자 "처음에 유저한테 목차 요약된 걸 보여 주는 게"): the outline as the learner would first see it.
  const [view, setView] = useState<"outline" | "cards" | "all">("all");
  const d = rc.digest ?? {};
  const topics: Array<{ id: string; title: string; pages: number[]; kind?: string }> = d.skeleton?.topics ?? gen.sections.map((s) => ({ id: s.id, title: s.title, pages: s.pages }));
  const chunksOf = (id: string) => Object.values(rc.units[id]?.chunks ?? {});
  const all = topics.flatMap((t) => chunksOf(t.id));
  const cardCount = all.reduce((n, c) => n + (c.cards?.length ?? 0), 0), qCount = all.reduce((n, c) => n + (c.questions?.length ?? 0), 0), heldCount = all.reduce((n, c) => n + (c.held?.length ?? 0), 0);
  return (
    <div className="rv-result">
      <div className="rv-view">{([["outline", "목차만"], ["cards", "카드까지"], ["all", "문제까지"]] as const).map(([k, label]) => (
        <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{label}</button>))}</div>
      {view === "outline" && (
        <div className="rv-outline">
          <h3>{gen.input.fileName} <small>{gen.input.pageNumbers.length}쪽 · 주제 {topics.length}개</small></h3>
          <ol>{topics.map((t) => {
            const s = d.topics?.[t.id];
            const items = s?.body ?? [];
            return (
              <li key={t.id}>
                <div><b>{t.title}</b> <small>p.{t.pages[0]}{t.pages.length > 1 ? `–${t.pages.at(-1)}` : ""}{t.kind ? ` · ${t.kind}` : ""}</small></div>
                <div className="rv-items">{items.map((l) => <span key={l.id}>{l.name}</span>)}</div>
              </li>
            );
          })}</ol>
        </div>
      )}
      {view !== "outline" && <>
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
            {view === "all" && (questions.length || held.length) ? (
              <div className="rv-qs">
                <h4>문항 {questions.length}{held.length ? ` · 보류 ${held.length}` : ""}</h4>
                {questions.map((q, i) => <QuestionBox key={i} q={q} />)}
                {held.map((h, i) => <p key={i} className="rv-held">보류 {cards.find((c) => c.id === h.cardId)?.title ?? h.cardId}: {h.reason}</p>)}
              </div>) : null}
          </section>
        );
      })}
      </>}
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
    ["고친 프롬프트", Object.keys((lab.prompts as Record<string, string> | undefined) ?? {}).join(", ") || "없음 (코드 기본값)"],
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

type EditablePrompt = { name: string; step: string; label: string; text: string; when?: string; fromCall?: { after: string; before?: string } };

/** 실험실 프롬프트 고치기 (11/5): the run's prompts, editable, and each step's whole instructions as they were sent; a new run
 *  with the same input and the edited ones. */
function Prompts({ gen, calls, onOpen }: { gen: GenState; calls: CallSummary[]; onOpen: (id: string) => void }) {
  const [list, setList] = useState<EditablePrompt[] | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>(() => ({ ...((gen.input.lab as { prompts?: Record<string, string> } | undefined)?.prompts ?? {}) }));
  const [all, setAll] = useState(false);
  const [real, setReal] = useState(false);
  const [busy, setBusy] = useState("");
  const firstOf = useMemo(() => { const m = new Map<string, number>(); for (const c of calls) if (!m.has(c.step)) m.set(c.step, c.n); return m; }, [calls]);
  useEffect(() => {
    let live = true;
    void fetch("/api/lab/gen/prompts", { cache: "no-store" }).then((r) => r.json()).then((d: { prompts: EditablePrompt[] }) => { if (live) setList(d.prompts); }).catch(() => { if (live) setBusy("프롬프트 목록을 불러오지 못했어요."); });
    // Each step's first call as it was sent: its whole instructions (what the code put together, file parts included).
    void Promise.all([...firstOf.entries()].map(async ([step, n]) => {
      const c = await fetch(`/api/lab/gen/${gen.id}/calls/${n}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null) as { system?: string } | null;
      return [step, c?.system ?? ""] as const;
    })).then((pairs) => { if (live) setSent(Object.fromEntries(pairs)); });
    return () => { live = false; };
  }, [gen.id, firstOf]);
  if (!list) return <p className="rv-sub">{busy || "불러오는 중…"}</p>;
  const lab = (gen.input.lab ?? {}) as Obj;
  const lang = (gen.recaller as { lang?: string } | undefined)?.lang;
  const task = lab.mapCards || lab.conceptLines ? "PLAN_TASK_CONCEPTS" : lab.goalsInPlan ? "PLAN_TASK_GOALS" : "PLAN_TASK";
  const card = lab.mapCards ? "MAP_CARD" : "DIGEST_CARD";
  const picked = (p: EditablePrompt) => (!p.name.startsWith("PLAN_TASK") || p.name === task) && (!/^(MAP|DIGEST)_CARD$/.test(p.name) || p.name === card);
  // A prompt read from a file (정리 기준) takes its text from the run's own call.
  const base = (p: EditablePrompt) => {
    if (!p.fromCall) return p.text;
    const whole = sent[p.step] ?? "";
    const i = whole.indexOf(p.fromCall.after);
    if (i < 0) return "";
    const rest = whole.slice(i + p.fromCall.after.length);
    const j = p.fromCall.before ? rest.indexOf(p.fromCall.before) : -1;
    return j >= 0 ? rest.slice(0, j) : rest;
  };
  const shown = list.filter((p) => all || ((firstOf.has(p.step) || (p.name === "SOURCE_EN" && lang === "en")) && picked(p)));
  const steps = [...new Set(shown.map((p) => p.step))];
  const changed = Object.fromEntries(Object.entries(edits).filter(([name, text]) => { const d = list.find((p) => p.name === name); return d && text.trim() && text !== base(d); }));
  const rerun = async () => {
    setBusy("새 실행을 만드는 중…");
    try {
      const { questionsLater: _later, ...input } = gen.input as typeof gen.input & { questionsLater?: boolean };
      void _later;
      const body = { ...input, origin: "lab", lab: { ...(gen.input.lab ?? {}), prompts: changed }, confirmed: real };
      const r = await fetch("/api/lab/gen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || "새 실행을 만들지 못했어요.");
      setBusy(""); onOpen(d.gen.id);
    } catch (e) { setBusy(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="rv-prompts">
      <p className="rv-sub">단계마다 실제로 들어간 전체 지시문과, 그중 고칠 수 있는 조각이에요. 고친 내용은 새 실행에만 쓰이고 코드·앱 기본값은 그대로예요.</p>
      <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />이 실행에 안 쓰인 프롬프트도 보기</label>
      {steps.map((step) => (
        <section key={step} className="rv-step">
          <h4>{genStepLabel[step as keyof typeof genStepLabel] ?? step} <code>{step}</code></h4>
          {sent[step] ? <details className="rv-sent"><summary>실제로 들어간 전체 지시문 ({sent[step].length.toLocaleString()}자)</summary><pre>{sent[step]}</pre></details> : null}
          {shown.filter((p) => p.step === step).map((p) => {
            const d = base(p);
            const value = edits[p.name] ?? d;
            const dirty = value !== d;
            return (
              <details key={p.name} className={`rv-prompt${dirty ? " dirty" : ""}`} open={dirty}>
                <summary><b>{p.label}</b> <code>{p.name}</code>{p.when ? <small>{p.when}</small> : null}{dirty && <span className="rv-badge">고침</span>}</summary>
                {p.fromCall && !d ? <p className="rv-sub">이 실행의 호출에서 찾지 못했어요.</p> : (
                  <textarea value={value} rows={Math.min(24, Math.max(6, value.split("\n").length + 1))} onChange={(e) => setEdits({ ...edits, [p.name]: e.target.value })} spellCheck={false} />)}
                {dirty && <button onClick={() => { const next = { ...edits }; delete next[p.name]; setEdits(next); }}>기본으로</button>}
              </details>
            );
          })}
        </section>
      ))}
      <div className="rv-rerun">
        <span>고친 프롬프트 {Object.keys(changed).length}개</span>
        <label className="check warn"><input type="checkbox" checked={real} onChange={(e) => setReal(e.target.checked)} />실제 모델을 호출합니다(비용 듦)</label>
        <button className="primary" disabled={!Object.keys(changed).length || (gen.input.provider !== "fake" && !real) || busy === "새 실행을 만드는 중…"} onClick={() => void rerun()}>고친 프롬프트로 다시 돌리기</button>
        {busy && <span className="rv-warn">{busy}</span>}
      </div>
    </div>
  );
}

export function RecallerView({ gen, calls, onOpenCall, onOpen }: { gen: GenState; calls: CallSummary[]; onOpenCall: (n: number) => void; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<"result" | "method" | "time" | "prompts" | "calls">("result");
  const rc = useMemo(() => (gen.recaller ?? { units: {} }) as unknown as Rc, [gen.recaller]);
  const edited = Object.keys((gen.input.lab as { prompts?: Record<string, string> } | undefined)?.prompts ?? {}).length;
  const tabs = [["result", "결과 품질"], ["method", "방법"], ["time", "시간·비용"], ["prompts", edited ? `프롬프트 (고침 ${edited})` : "프롬프트"], ["calls", `호출 ${calls.length}`]] as const;
  return (
    <div className="rv">
      <nav className="rv-tabs">{tabs.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}</nav>
      {tab === "result" && <Result gen={gen} rc={rc} />}
      {tab === "method" && <Method gen={gen} calls={calls} rc={rc} />}
      {tab === "time" && <TimeCost gen={gen} calls={calls} rc={rc} />}
      {tab === "prompts" && <Prompts gen={gen} calls={calls} onOpen={onOpen} />}
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
