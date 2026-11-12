"use client";
// 나의 학습 노트 (2026-11-10 사용자 "학습자 모델 … 한눈에 이해가 되는 … 다시 봤을 때 의미 있게 도움을 받을 수 있는", "뭘 모르는가를 잘 후벼 파야"):
// 기억 탭 › 실습 맨 위. 여러 실습(여러 컴퓨터)에서 모은 아직 모르는 것 · 이제 되는 것 · 내 컴퓨터 환경을 한 장으로.
// 계산은 실습 서버(lib/learner-note.ts)가 부족함 원장에서 코드로 한다. 여기는 보여 주기만.
import { useEffect, useState } from "react";
import { call, errorText, later } from "./api";

type Item = { key: string; name: string; status: string; wrong: string; next: string; goal: string; at: string; dueAt: string | null; places: string[] };
type Note = { online: boolean; unknown?: Item[]; known?: Item[]; env?: Array<{ tool: string; fact: string }>; tendencies?: Array<{ text: string; status: string }> };

// 상태는 쉬운 말로(11/10 사용자 "항상 사람이 바로 이해하기 쉽게")
const LABEL: Record<string, [string, string]> = { "아직 모름": ["아직", "bad"], "다시 틀림": ["다시 틀림", "bad"], "채움, 다시 확인 전": ["다시 확인 남음", "now"], "이제 됨": ["이제 됨", "ok"] };
const dueText = (iso: string | null) => {
  if (!iso) return "";
  const d = Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
  return d <= 0 ? "지금 다시 확인할 때" : `${d}일 뒤 다시 확인`;
};

export default function LearnerNote() {
  const [note, setNote] = useState<Note | null>(null);
  const [all, setAll] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => later(() => { call<Note>("/api/project-course/learner/view").then(setNote).catch((e) => setError(errorText(e))); }), []);
  if (error) return <p className="ws-err">{error}</p>;
  if (!note) return null;
  if (!note.online) return <p className="small muted panel">실습 서버가 꺼져 있어 학습 노트를 못 불러왔어요. 실습 탭을 열면 켜져요.</p>;
  const un = note.unknown ?? [], kn = note.known ?? [], env = note.env ?? [];
  if (!un.length && !kn.length && !env.length) return null;
  const shown = all ? un : un.slice(0, 6);
  return (
    <section className="ln panel">
      <div className="ln-head"><b>나의 학습 노트</b><span className="small muted">여러 실습에서 모은 것</span></div>
      {un.length ? <>
        <p className="ln-label">아직 모르는 것 <b>{un.length}</b></p>
        <ul className="ln-list">{shown.map((i) => {
          const [label, cls] = LABEL[i.status] ?? [i.status, ""];
          const tip = [i.wrong && `어떻게 알고 있었나: ${i.wrong}`, i.next && `다음엔: ${i.next}`, `어디서: ${i.places.join(" / ")}`, dueText(i.dueAt)].filter(Boolean).join("\n");
          return <li key={i.key} title={tip}>
            <span className={`pp-gap ${cls}`}>{label}</span>
            <b>{i.name}</b>
            {i.wrong ? <span className="muted"> — {i.wrong}</span> : null}
            {i.places.length >= 2 ? <span className="ln-rep" title={i.places.join("\n")}>{i.places.length}곳에서</span> : null}
          </li>;
        })}</ul>
        {un.length > shown.length || all ? <button className="linkish small" onClick={() => setAll(!all)}>{all ? "접기" : `${un.length - shown.length}개 더 보기`}</button> : null}
      </> : <p className="ln-label">아직 모르는 것 <b>0</b> <span className="small muted">— 실습에서 드러난 부족함이 다 다시 확인까지 맞았어요</span></p>}
      {kn.length ? <p className="ln-line" title={kn.map((i) => i.name).join(" · ")}><span className="ln-label">이제 되는 것 <b>{kn.length}</b></span> <span className="muted">{kn.map((i) => i.name).join(" · ")}</span></p> : null}
      {env.length ? <p className="ln-line"><span className="ln-label">내 컴퓨터</span> <span className="muted">{env.map((e) => e.fact).join(" · ")}</span></p> : null}
    </section>
  );
}
