"use client";
// 오늘: 두 칸만 (2026-11-06 사용자 "딱 두 가지로, 문제 풀기랑 이어서 하기, 조잡하지 않게"). 문제 풀기를 누르면 무엇을 풀지
// 고르는 목록이 열리고(지식 복습·PDF 문제·틀린 알고리즘·알고리즘 문제·미리 연습), 이어서 하기는 자료·알고리즘·실습마다 마지막 하나(11/9).
// 기한·할 일 칩은 뺐다(일정 탭에서 할 일·기한을 없앰).
// 11/13 사용자 "문제 풀기 갖다 버리고": 기억 복습과 옛 PDF 문제 연습(따로 날짜 계산)을 숫자 하나로 섞어 보여 주던 [문제 풀기] 칸을 뺐다.
// 그 자리에 "오늘 다시 볼 것"(사용자 "그거 한번 넣어봐"): 갈래마다 다시 묻는 방식대로 한 줄씩 — 자료는 날짜 된 기억 카드, 알고리즘은
// 도움 받고 푼 문제 혼자 다시(PS 튜터의 할 일) · 알고리즘 기억, 실습은 다시 확인. 맨 위 "오늘 이것부터"는 코드가 고른 가장 급한 하나
// (몰랐던 자료 카드 > 혼자 다시 풀 문제 > 실습 다시 확인 > 나머지). 날짜와 순서는 기억 저장소의 복습 차례 그대로다.
import { useCallback, useEffect, useState } from "react";
import { call, go, later, type ItemLite, type Question } from "./api";
import { QuestionRun } from "./QuestionCard";

type ProblemLite = { id: string; title: string; status: "new" | "tried" | "wrong" | "solved"; lastAt: string };
type SourceLite = { id: string; title: string; readAt: string; goals: Record<string, { done: boolean }> };
type Studied = { kind: string; title: string; ref: string; n: number; last: string };
type Last = { kind: string; title: string; at: string; open: () => void; note: string };
type Origin = "theory" | "algo" | "lab";
type TutorAction = { number: string; pattern: string; why: string; redo?: boolean };
type Due = { key: string; label: string; count: string; why: string; go: () => void; weight: number };
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m || 1}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
};

export default function TodayBoard() {
  const [problems, setProblems] = useState<ProblemLite[]>([]);
  const [sources, setSources] = useState<SourceLite[]>([]);
  const [studied, setStudied] = useState<Studied[]>([]);
  const [due, setDue] = useState<Record<Origin, ItemLite[]> | null>(null);
  const [redo, setRedo] = useState<TutorAction[]>([]);
  const [run, setRun] = useState<{ title: string; questions: Question[] } | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    const [p, s, w, t] = await Promise.allSettled([call<{ problems: ProblemLite[] }>("/api/code/problems"), call<{ sources: SourceLite[] }>("/api/knowledge/sources"),
      call<{ studied?: Studied[] }>("/api/schedule/week"), call<{ actions: TutorAction[] }>("/api/code/tutor")]);
    if (p.status === "fulfilled") setProblems(p.value.problems);
    if (s.status === "fulfilled") setSources(s.value.sources);
    if (w.status === "fulfilled") setStudied(w.value.studied ?? []);
    setRedo(t.status === "fulfilled" ? (t.value.actions ?? []).filter((a) => a.redo) : []);
    const lists = await Promise.all((["theory", "algo", "lab"] as const).map((o) => call<{ items: ItemLite[] }>(`/api/knowledge/review?limit=50&origin=${o}`).then((x) => x.items).catch(() => [] as ItemLite[])));
    setDue({ theory: lists[0], algo: lists[1], lab: lists[2] });
  }, []);
  const quiz = async (title: string, origin: Origin) => {
    setNote("");
    try { const { questions } = await call<{ questions: Question[] }>(`/api/knowledge/quiz?count=10&origin=${origin}`); if (questions.length) setRun({ title, questions }); else setNote("지금 다시 볼 것이 없어요."); }
    catch { setNote("문제를 불러오지 못했어요."); }
  };
  useEffect(() => later(() => void load()), [load]);

  if (run) return <QuestionRun title={run.title} questions={run.questions} onClose={() => { setRun(null); void load(); }} />;

  // 오늘 다시 볼 것: 갈래마다 한 줄(할 게 없는 갈래는 안 보임)
  const unknownOf = (xs: ItemLite[]) => xs.filter((i) => i.state === "unknown").length;
  const rowsDue: Due[] = [];
  if (due?.theory.length) { const u = unknownOf(due.theory); rowsDue.push({ key: "theory", label: "자료", count: `기억 카드 ${due.theory.length}장${u ? ` · 몰랐던 것 ${u}장` : ""}`,
    why: u ? "몰랐던 카드부터 나와요" : "잊을 때가 된 카드예요", go: () => void quiz("자료 기억 다시 보기", "theory"), weight: u ? 4 : 1 }); }
  if (redo.length || due?.algo.length) {
    const r = redo[0];
    rowsDue.push(r ? { key: "algo", label: "알고리즘", count: `혼자 다시 풀 문제 ${redo.length}개`, why: `${r.number}번 · ${r.why}`, go: () => go("code"), weight: 3 }
      : { key: "algo", label: "알고리즘", count: `알고리즘 기억 ${due!.algo.length}개`, why: due!.algo[0]?.title ?? "", go: () => void quiz("알고리즘 기억 다시 보기", "algo"), weight: 1 });
  }
  if (due?.lab.length) rowsDue.push({ key: "lab", label: "실습", count: `다시 확인 ${due.lab.length}개`, why: due.lab[0]?.title ?? "", go: () => void quiz("실습 다시 확인", "lab"), weight: 2 });
  const first = [...rowsDue].sort((a, b) => b.weight - a.weight)[0];

  // 이어서 하기 (11/9 사용자 "자료/알고리즘/실습 세 가지 탭에서 각각 하나씩"): 갈래마다 가장 최근에 한 것 하나.
  const newest = (xs: Array<Last | null>) => xs.filter((x): x is Last => !!x).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  // 11/12 사용자 점검 1번: 자료 id가 없는 예전 기록도 제목으로 그 지도를 바로 연다(목록으로 보내지 않는다).
  const openPdf = (s: Studied) => () => { const gen = /^(gen_[a-z0-9]+)/.exec(s.ref)?.[1]; window.dispatchEvent(new CustomEvent("recaller:map-open", { detail: gen ? { genId: gen } : { title: s.title } })); };
  const lastSource = [...sources].sort((a, b) => b.readAt.localeCompare(a.readAt))[0];
  const lastProblem = [...problems].filter((p) => p.lastAt).sort((a, b) => b.lastAt.localeCompare(a.lastAt))[0];
  const material = newest([
    ...studied.filter((x) => x.kind === "pdf").slice(0, 1).map((x): Last => ({ kind: "pdf", title: x.title, at: x.last, open: openPdf(x), note: "자료 지도 열기" })),
    ...studied.filter((x) => x.kind === "web").slice(0, 1).map((x): Last => { const src = sources.find((y) => y.title === x.title); return { kind: "web", title: x.title, at: x.last, open: () => (src ? go("web", { id: src.id }) : go("practice")), note: "이어서 읽기" }; }),
    lastSource ? { kind: "web", title: lastSource.title, at: lastSource.readAt, open: () => go("web", { id: lastSource.id }), note: "이어서 읽기" } : null,
  ]);
  const algo = newest([
    ...studied.filter((x) => x.kind === "code" && x.ref.startsWith("code:")).slice(0, 1).map((x): Last => ({ kind: "code", title: x.title, at: x.last, open: () => go("code", { id: x.ref.slice(5) }), note: "이어서 풀기" })),
    lastProblem ? { kind: "code", title: lastProblem.title, at: lastProblem.lastAt, open: () => go("code", { id: lastProblem.id }), note: "이어서 풀기" } : null,
  ]);
  const lab = newest(studied.filter((x) => x.kind === "code" && x.ref.startsWith("project:")).slice(0, 1)
    .map((x): Last => ({ kind: "project", title: x.title.replace(/^프로젝트 코스: /, ""), at: x.last, open: () => go("project"), note: "실습 열기" })));
  const rows: Array<{ label: string; last: Last | null; empty: string; to: () => void }> = [
    { label: "자료", last: material, empty: "자료 열기", to: () => go("practice") },
    { label: "알고리즘", last: algo, empty: "알고리즘 열기", to: () => go("code") },
    { label: "실습", last: lab, empty: "실습 열기", to: () => go("project") },
  ];

  return (
    <div className="td-two">
      <section className="td-card">
        <p className="eyebrow">오늘 다시 볼 것</p>
        {!due ? <p className="small muted">불러오는 중…</p> : !rowsDue.length ? <p className="small muted">오늘 다시 볼 건 없어요. 이어서 하던 걸 해 보세요.</p> : <>
          {first ? <button className="td-first" onClick={first.go}><small>오늘 이것부터</small><b>{first.label} · {first.count}</b><span className="small muted">{first.why}</span></button> : null}
          <ul className="td-cont">
            {rowsDue.map((r) => <li key={r.key}>
              <span className="td-cont-k">{r.label}</span>
              <button className="td-cont-b" onClick={r.go}><span className="td-cont-t">{r.count}</span><small className="muted">{r.why}</small></button>
            </li>)}
          </ul>
        </>}
        {note ? <p className="small muted">{note}</p> : null}
      </section>
      <section className="td-card">
        <p className="eyebrow">이어서 하기</p>
        <ul className="td-cont">
          {rows.map((r) => <li key={r.label}>
            <span className="td-cont-k">{r.label}</span>
            {r.last ? <button className="td-cont-b" onClick={r.last.open} title={r.last.note}><span className="td-cont-t">{r.last.title}</span><small className="muted">{ago(r.last.at)} · {r.last.note}</small></button>
              : <button className="td-cont-b" onClick={r.to}><span className="td-cont-t muted">아직 없음</span><small className="muted">{r.empty}</small></button>}
          </li>)}
        </ul>
      </section>
    </div>
  );
}
