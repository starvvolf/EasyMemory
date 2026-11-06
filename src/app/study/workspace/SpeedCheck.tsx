"use client";
// 속도 체크 (2026-11-06 사용자 "왼쪽 아래 조그맣게, 원래 빨랐을 때보다 어느 정도로 나오는지"): 기준(10/30 실측)과 최근 호출·지금 잰 값을 나란히.
import { useState } from "react";
import { call, errorText } from "./api";

type Row = { model: string; label: string; base: { first: number; speed: number } | null; n: number; first: number | null; speed: number | null; lastAt: string | null };
type Probe = { model: string; ms: number; first: number; out: number; speed: number | null };
const PROBE = [["gpt-6.1-terra", "terra"], ["gpt-6-sol", "sol"], ["gpt-6-luna", "luna"]] as const;

function pct(now: number | null, base: number | undefined, lowerIsBetter = false) {
  if (now === null || !base) return null;
  const r = lowerIsBetter ? base / now : now / base;
  return { r, text: `${Math.round(r * 100)}%`, tone: r >= 0.85 ? "good" : r >= 0.6 ? "help" : "bad" };
}

export default function SpeedCheck() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [probe, setProbe] = useState<Record<string, Probe>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = async () => { setError(""); try { setRows((await call<{ rows: Row[] }>("/api/model-speed")).rows); } catch (e) { setError(errorText(e)); } };
  const measure = async (model: string) => {
    setBusy(model); setError("");
    try { const p = await call<Probe>("/api/model-speed", { model }); setProbe((x) => ({ ...x, [model]: p })); void load(); }
    catch (e) { setError(errorText(e)); } finally { setBusy(""); }
  };
  if (!open) return <button className="spd-open" onClick={() => { setOpen(true); void load(); }} title="모델 속도가 평소보다 느린지 봐요">속도 체크</button>;
  // 잴 수 있는 세 모델은 기록이 없어도 줄을 둔다(기록 없는 모델의 기준은 서버의 SPEED_BASE와 같다).
  const BASE: Record<string, { first: number; speed: number }> = { "gpt-6.1-terra": { first: 3.4, speed: 117 }, "gpt-6-sol": { first: 3.4, speed: 63 }, "gpt-6-luna": { first: 3.4, speed: 125 } };
  const have = (rows ?? []).filter((r) => r.base || r.n >= 3);
  const shown = [...have, ...PROBE.filter(([m]) => !have.some((r) => r.model === m)).map(([m, label]) => ({ model: m, label, base: BASE[m], n: 0, first: null, speed: null, lastAt: null }) as Row)].slice(0, 7);
  return (
    <section className="spd-panel" role="dialog" aria-label="속도 체크">
      <div className="row spd-head"><b>속도 체크</b><span className="cs-gap" /><button className="linkish small" onClick={() => void load()}>새로 보기</button><button className="btn ghost small" onClick={() => setOpen(false)}>닫기</button></div>
      <p className="small muted spd-note">기준은 10/30 실측(빠를 때): 첫 글자 약 3.4초, 출력 초당 terra 117 · sol 63 · luna 125 토큰. 최근은 모델마다 마지막 30번 호출의 가운데 값.</p>
      {error ? <p className="ws-err small">{error}</p> : null}
      {!rows ? <p className="small muted">불러오는 중…</p> : (
        <table className="spd-table num">
          <thead><tr><th>모델</th><th>출력 속도 (토큰/초)</th><th>첫 글자</th><th>지금 재기</th></tr></thead>
          <tbody>{shown.map((r) => {
            const p = probe[r.model];
            const sp = pct(r.speed, r.base?.speed), fp = pct(r.first, r.base?.first, true);
            const psp = p ? pct(p.speed, r.base?.speed) : null;
            const canProbe = PROBE.some(([m]) => m === r.model);
            return (
              <tr key={r.model}>
                <td><b>{r.label}</b><div className="small muted">{r.n ? `최근 ${r.n}번` : "기록 없음"}</div></td>
                <td>{r.speed !== null ? Math.round(r.speed) : "–"}{r.base ? <span className="muted"> / {r.base.speed}</span> : null}{sp ? <span className={`chip ${sp.tone}`}>{sp.text}</span> : null}</td>
                <td>{r.first !== null ? `${r.first.toFixed(1)}초` : "–"}{r.base ? <span className="muted"> / {r.base.first}초</span> : null}{fp ? <span className={`chip ${fp.tone}`}>{fp.text}</span> : null}</td>
                <td>{p ? <span>{p.speed !== null ? `${Math.round(p.speed)} 토큰/초` : "–"} · {p.first.toFixed(1)}초{psp ? <span className={`chip ${psp.tone}`}>{psp.text}</span> : null}</span> : null}
                  {canProbe ? <button className="btn ghost small" disabled={!!busy} onClick={() => void measure(r.model)}>{busy === r.model ? "재는 중…" : p ? "다시" : "재기"}</button> : null}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
      <p className="small muted spd-note">「재기」는 짧은 호출 한 번(출력 약 300토큰)을 써요. 100%에 가까우면 평소만큼 빠른 거예요.</p>
    </section>
  );
}
