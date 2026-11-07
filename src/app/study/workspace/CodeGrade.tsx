"use client";
// 문제 출처 · 난이도 · 요구 능력 (2026-11-07, 11/8 바꿈). 난이도는 AI에게 묻는다(src/lib/assist/code-level.ts):
// "○○에 의하면 …"(AI가 아는 값, 확인 안 함)과 자체 판단(5단계)을 함께. 요구 능력은 문법 → 심화 6단계 사다리(src/lib/code/grade.ts).
import { useState } from "react";
import { call } from "./api";

export type SelfLevel = "입문" | "기초" | "중급" | "상급" | "고급";
export type Level = { known: { site: string; rating: string }; self: { level: SelfLevel; why: string }; abilities: string[]; at: string };
export type Need = { id: string; name: string; what: string; why: Array<"code" | "ai" | "memory" | "basic"> };
export type Needs = { steps: Array<{ step: number; name: string; what: string; needs: Need[] }>; other: string[]; top: number };
type Ladder = Array<{ step: number; name: string; what: string; abilities: Array<{ id: string; name: string; what: string }> }>;

const WHY: Record<Need["why"][number], string> = { basic: "모든 문제", code: "모범 풀이에 쓰임", ai: "AI 판단", memory: "이 문제의 기억" };
const SHORT: Record<Need["why"][number], string> = { basic: "", code: "코드", ai: "AI", memory: "기억" };
const LEVEL_CLASS: Record<SelfLevel, string> = { 입문: "l1", 기초: "l2", 중급: "l3", 상급: "l4", 고급: "l5" };

export function LevelChip({ level }: { level: SelfLevel }) {
  return <span className={`cg-level ${LEVEL_CLASS[level]}`}>{level}</span>;
}

/** 문제 출처와 난이도. level이 없으면 "판단 중"(화면이 POST …/level을 부른다). */
export function LevelBox({ source, level, busy, error }: { source: { title: string; url?: string }; level: Level | null; busy: boolean; error: string }) {
  const host = (() => { try { return source.url ? new URL(source.url).host.replace(/^www\./, "") : ""; } catch { return ""; } })();
  return (
    <div className="cg-box">
      <div className="cg-line"><span className="cg-k">문제</span><span className="small">{source.title}{host ? <span className="muted"> · {host}</span> : null}</span></div>
      <div className="cg-line"><span className="cg-k">난이도</span>{level
        ? (level.known.site ? <span className="small"><b>{level.known.site}</b>에 의하면 <b>{level.known.rating}</b> <span className="muted">(AI가 아는 값이에요. 확인하지 않았어요)</span></span>
          : <span className="small muted">알려진 등급을 찾지 못했어요.</span>)
        : <span className="small muted">{error || (busy ? "AI가 판단하는 중…" : "")}</span>}</div>
      {level ? <div className="cg-line"><span className="cg-k">자체 판단</span><span className="row small" style={{ gap: 6 }}><LevelChip level={level.self.level} /><span>{level.self.why}</span></span></div> : null}
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
                  {a.name}{a.need && !a.need.why.includes("basic") ? <i>{a.need.why.map((w) => SHORT[w]).join("·")}</i> : null}
                </span>))}</div>
            </div>
          </li>
        ))}
      </ol>
      {needs.other.length ? <p className="small muted">사다리에 없는 것: {needs.other.join(", ")}</p> : null}
    </section>
  );
}
