"use client";
// 오늘: 이어서 하기 한 칸 (11/13 사용자 "오늘 다시 볼 것 그냥 빼라. 이어서 하기만 냅둬. 안 쓰는 거 계속 연결돼 있어").
// 11/6 [문제 풀기] + [이어서 하기] → 11/13 [문제 풀기] 뺌, "오늘 다시 볼 것"을 넣었다가 같은 날 뺐다(예전 기억 · 옛 문제 묶음이 섞여 나옴).
// 이어서 하기는 자료·알고리즘·실습마다 가장 최근에 한 것 하나(11/9).
import { useCallback, useEffect, useState } from "react";
import { call, go, later } from "./api";
import { enterProject } from "./MaterialList";

type ProblemLite = { id: string; title: string; status: "new" | "tried" | "wrong" | "solved"; lastAt: string };
type SourceLite = { id: string; title: string; readAt: string; goals: Record<string, { done: boolean }> };
type Studied = { kind: string; title: string; ref: string; n: number; last: string };
type Last = { kind: string; title: string; at: string; open: () => void; note: string };
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m || 1}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
};

export default function TodayBoard() {
  const [problems, setProblems] = useState<ProblemLite[]>([]);
  const [sources, setSources] = useState<SourceLite[]>([]);
  const [studied, setStudied] = useState<Studied[]>([]);
  const load = useCallback(async () => {
    const [p, s, w] = await Promise.allSettled([call<{ problems: ProblemLite[] }>("/api/code/problems"), call<{ sources: SourceLite[] }>("/api/knowledge/sources"),
      call<{ studied?: Studied[] }>("/api/schedule/week")]);
    if (p.status === "fulfilled") setProblems(p.value.problems);
    if (s.status === "fulfilled") setSources(s.value.sources);
    if (w.status === "fulfilled") setStudied(w.value.studied ?? []);
  }, []);
  useEffect(() => later(() => void load()), [load]);
  useEffect(() => { const on = (e: Event) => { if ((e as CustomEvent<string>).detail === "home") void load(); }; window.addEventListener("recaller:shown", on); return () => window.removeEventListener("recaller:shown", on); }, [load]);

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
    // 그 실습의 편집기 · 튜터로 바로(11/13: 실습 목록 화면에 멈추던 것)
    .map((x): Last => ({ kind: "project", title: x.title.replace(/^(프로젝트 코스|실습): /, ""), at: x.last, open: () => enterProject(x.ref.slice("project:".length)), note: "실습 열기" })));
  const rows: Array<{ label: string; last: Last | null; empty: string; to: () => void }> = [
    { label: "자료", last: material, empty: "자료 열기", to: () => go("practice") },
    { label: "알고리즘", last: algo, empty: "알고리즘 열기", to: () => go("code") },
    { label: "실습", last: lab, empty: "실습 열기", to: () => go("project") },
  ];

  return (
    <div className="td-two">
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
