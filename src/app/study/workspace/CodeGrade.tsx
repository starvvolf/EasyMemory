"use client";
// 문제 등급과 요구 능력 (2026-11-07). 등급은 solved.ac(백준), 요구 능력은 문법 → 심화 6단계 사다리(src/lib/code/grade.ts).
import { useState } from "react";
import { call } from "./api";

export type TierGroup = "unrated" | "bronze" | "silver" | "gold" | "platinum" | "diamond" | "ruby";
export type Grade = { number: string; level: number; tier: string; group: TierGroup; meaning: string; tags: Array<{ key: string; name: string }>; solvers: number; avgTries: number; at: string };
export type Need = { id: string; name: string; what: string; why: Array<"code" | "tag" | "memory" | "basic"> };
export type Needs = { steps: Array<{ step: number; name: string; what: string; needs: Need[] }>; other: string[]; top: number };
type Ladder = Array<{ step: number; name: string; what: string; abilities: Array<{ id: string; name: string; what: string }> }>;

const WHY: Record<Need["why"][number], string> = { basic: "모든 문제", code: "모범 풀이에 쓰임", tag: "solved.ac 분류", memory: "이 문제의 기억" };

export function TierBadge({ tier, group, small }: { tier: string; group: TierGroup; small?: boolean }) {
  return <span className={`cg-tier cg-${group}${small ? " small" : ""}`}>{tier}</span>;
}

export function GradeLine({ grade, boj }: { grade: Grade | null; boj: string | null }) {
  if (!grade) return <p className="small muted">{boj ? `난이도: solved.ac에서 BOJ ${boj}번 등급을 가져오지 못했어요(인터넷 연결을 확인해 주세요).` : "난이도: 백준 문제가 아니라 등급이 없어요. 아래 요구 능력으로 수준을 가늠해 주세요."}</p>;
  return (
    <div className="cg-grade">
      <TierBadge tier={grade.tier} group={grade.group} />
      <div className="stack" style={{ gap: 2, minWidth: 0 }}>
        <span className="small">{grade.meaning}</span>
        <span className="small muted">solved.ac · 푼 사람 {grade.solvers.toLocaleString("ko-KR")}명 · 평균 {grade.avgTries}번 제출{grade.tags.length ? ` · 분류: ${grade.tags.map((t) => t.name).join(", ")}` : ""}</span>
      </div>
    </div>
  );
}

export function NeedsPanel({ needs }: { needs: Needs }) {
  const [all, setAll] = useState<Ladder | null>(null);
  const [open, setOpen] = useState(false);
  const lit = new Map(needs.steps.flatMap((s) => s.needs.map((n) => [n.id, n] as const)));
  const toggle = async () => {
    if (!all) { try { setAll((await call<{ ladder: Ladder }>("/api/code/ladder")).ladder); } catch { return; } }
    setOpen((v) => !v);
  };
  const rows = open && all ? all.map((s) => ({ step: s.step, name: s.name, what: s.what, items: s.abilities.map((a) => ({ ...a, need: lit.get(a.id) })) }))
    : needs.steps.map((s) => ({ step: s.step, name: s.name, what: s.what, items: s.needs.map((n) => ({ id: n.id, name: n.name, what: n.what, need: n })) }));
  return (
    <section className="cg-needs">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="eyebrow">이 문제에 필요한 능력{needs.top ? ` · ${needs.top}단계까지` : ""}</p>
        <button className="linkish small" onClick={() => void toggle()}>{open ? "필요한 것만" : "전체 사다리 보기"}</button>
      </div>
      <ol className="cg-ladder">
        {rows.map((s) => (
          <li key={s.step} className={s.items.some((x) => x.need) ? "on" : ""}>
            <span className="cg-step">{s.step}</span>
            <div className="stack" style={{ gap: 4, minWidth: 0 }}>
              <span className="small"><b>{s.name}</b> <span className="muted">{s.what}</span></span>
              <div className="cg-chips">{s.items.map((a) => (
                <span key={a.id} className={`cg-ab${a.need ? " on" : ""}`} title={`${a.what}${a.need ? ` — ${a.need.why.map((w) => WHY[w]).join(" · ")}` : ""}`}>
                  {a.name}{a.need && !a.need.why.includes("basic") ? <i>{a.need.why.map((w) => w === "code" ? "코드" : w === "tag" ? "분류" : "기억").join("·")}</i> : null}
                </span>))}</div>
            </div>
          </li>
        ))}
      </ol>
      {needs.other.length ? <p className="small muted">사다리에 없는 것: {needs.other.join(", ")}</p> : null}
    </section>
  );
}
