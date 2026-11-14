// 옵션 조각을 AI로 만들기 (설계 1번 "옵션을 AI로 만들기"): 사람 설명 → AI 1번(terra low, 출력은 조각 JSON 하나) → 코드가 모양 검사
//   (없는 항목 이름은 버리고, 숫자는 범위로 자름) → 사람이 읽게 다시 풀어 보여 줌 → 마음에 들면 options/에 저장.
//   기록에서 만들기("나 닮은 NPC"): 실제 풀이 기록을 주면 그 사람을 닮은 조각. 한꺼번에 만들기: 여러 개 → 서로 너무 비슷한 것은 거름.
import { askJson, S } from "../assist/model.ts";
import { describe, matches, TRAIT_KEYS, LEARN_KEYS } from "./profile.ts";
import { BASE_KEYS, STATES, type OptionPatch, type ProblemMap } from "./types.ts";

const TRAIT_HELP = "invent 조합력 · switch 갈아타기 · askEarly 바로 묻기 · guess 찍어서 쓰기 · helpRungs 도움 칸 열기 · copyTutor 튜터 코드 붙여 넣기 · confirm 확인 연타 · patience 버티는 횟수(1~100) · typo 실수 · terse 말 짧음";
export const MAKE_SYSTEM = `가상 학습자(NPC) 시험에 쓸 "옵션 조각"을 만든다. 사람이 쓴 학습자 설명을 기본 학습자에 겹칠 작은 변경으로 옮긴다. 설명에 없는 것은 바꾸지 않는다.
- base: 층마다 아는 정도. layer는 1(문법) 2(담기) 3(한 줄 읽기) 4(잇기) 5(원리) 6(방법 고르기) run(실행 · 도구) 중 하나, state는 앎 · 모름 · 잘못 앎 · 애매.
- items: 특정 조각(이름은 [조각 이름]에 있는 것만, * 무늬 가능 예: idea.*). 잘못 앎이면 belief에 틀린 믿음 한 문장.
- traits: ${TRAIT_HELP}. 0~1(patience만 횟수).
- learning: perExplain 설명 한 번에 배움 · perHint 힌트로 배움 · fromOwnFix 혼자 고치며 배움 · forgetPerDay 하루에 잊음. 0~1.
- id: 짧은 한국어 이름(붙임표 가능, 띄어쓰기 없음), label: 한 줄 설명, group: 아는 것 · 성격 · 배움 중 가장 가까운 것.`;
export const MAKE_RECORD_SYSTEM = `${MAKE_SYSTEM}
- 이번에는 설명 대신 실제 풀이 기록(대화 · 제출 · 층 검증 표 등)을 준다. 기록에 드러난 것만으로 그 사람을 닮게 만든다: 어디서 막혔나(층) · 얼마나 빨리 묻나 · 힌트를 여나 · 코드를 붙여 넣나 · 몇 번 만에 배웠나.`;
const ONE = S.obj({ id: S.str, label: S.str, group: S.oneOf("아는 것", "성격", "배움"),
  base: S.arr(S.obj({ layer: S.oneOf(...BASE_KEYS), state: S.oneOf(...STATES) })),
  items: S.arr(S.obj({ name: S.str, state: S.oneOf(...STATES), belief: S.str })),
  traits: S.arr(S.obj({ name: S.oneOf(...TRAIT_KEYS), value: { type: "number" } })),
  learning: S.arr(S.obj({ name: S.oneOf(...LEARN_KEYS), value: { type: "number" } })) });
export const MAKE_SCHEMA = ONE;
export const BATCH_SCHEMA = S.obj({ options: S.arr(ONE) });
type Raw = { id: string; label: string; group: string; base: Array<{ layer: string; state: string }>; items: Array<{ name: string; state: string; belief: string }>;
  traits: Array<{ name: string; value: number }>; learning: Array<{ name: string; value: number }> };

/** AI 답 → 옵션 조각. 버린 것 · 자른 것은 notes */
export function checkOption(raw: Raw, map?: ProblemMap): { option: OptionPatch; notes: string[] } {
  const notes: string[] = [];
  const base: Record<string, string> = {};
  for (const b of raw.base ?? []) { if ((BASE_KEYS as readonly string[]).includes(b.layer) && (STATES as readonly string[]).includes(b.state)) base[b.layer] = b.state; else notes.push(`층 ${b.layer}=${b.state} 버림`); }
  const items: Record<string, { state: string; belief?: string }> = {};
  for (const it of raw.items ?? []) {
    if (!(STATES as readonly string[]).includes(it.state)) { notes.push(`${it.name}: 상태 ${it.state} 버림`); continue; }
    if (map && !map.fragments.some((f) => matches(it.name, f.id))) { notes.push(`없는 항목 이름 ${it.name} 버림`); continue; }
    items[it.name] = { state: it.state, ...(it.state === "잘못 앎" && it.belief?.trim() ? { belief: it.belief.trim().slice(0, 200) } : {}) };
  }
  const num = (name: string, v: number) => {
    if (name === "patience") { const n = Math.min(100, Math.max(1, Math.round(Number(v) || 20))); if (n !== v) notes.push(`patience ${v} → ${n}`); return n; }
    const n = Math.min(1, Math.max(0, Number(v) || 0)); if (n !== v) notes.push(`${name} ${v} → ${n}`); return n;
  };
  const traits = Object.fromEntries((raw.traits ?? []).filter((x) => (TRAIT_KEYS as string[]).includes(x.name)).map((x) => [x.name, num(x.name, x.value)]));
  const learning = Object.fromEntries((raw.learning ?? []).filter((x) => (LEARN_KEYS as readonly string[]).includes(x.name)).map((x) => [x.name, num(x.name, x.value)]));
  const id = (raw.id ?? "").replace(/\s+/g, "").replace(/[^\w가-힣-]/g, "").slice(0, 30) || `옵션-${Date.now().toString(36)}`;
  const group = (["아는 것", "성격", "배움"] as const).find((g) => g === raw.group) ?? "성격";
  const patch: OptionPatch["patch"] = {};
  if (Object.keys(base).length || Object.keys(items).length) patch.knows = { ...(Object.keys(base).length ? { base: base as never } : {}), ...(Object.keys(items).length ? { items: items as never } : {}) };
  if (Object.keys(traits).length) patch.traits = traits;
  if (Object.keys(learning).length) patch.learning = learning;
  return { option: { id, label: (raw.label ?? id).slice(0, 80), group, patch }, notes };
}
export const plainWords = (o: OptionPatch) => `${o.id} — ${o.label}: ${describe(o.patch)}`;

type Ask = <T>(purpose: string, system: string, user: string, schema: Record<string, unknown>) => Promise<T>;
const defaultAsk: Ask = (purpose, system, user, schema) => askJson(purpose, system, user, schema, { model: "gpt-6.1-terra", effort: "low" });
const names = (map?: ProblemMap) => map ? `[조각 이름]\n${map.fragments.filter((f) => !f.wrong).map((f) => `${f.id}: ${f.what}`).join("\n")}` : "[조각 이름] (지도 없음: items는 비워 둔다)";
export async function makeOption(text: string, opts: { map?: ProblemMap; ask?: Ask; fromRecord?: boolean } = {}) {
  const raw = await (opts.ask ?? defaultAsk)<Raw>("npc:make", opts.fromRecord ? MAKE_RECORD_SYSTEM : MAKE_SYSTEM, `${names(opts.map)}\n\n[${opts.fromRecord ? "풀이 기록" : "설명"}]\n${text.slice(0, 20000)}`, MAKE_SCHEMA);
  return checkOption(raw, opts.map);
}

/** 두 조각이 얼마나 다른가(숫자 차이 + 다른 상태 수). 작으면 거의 같은 사람. */
export function distance(a: OptionPatch, b: OptionPatch) {
  let d = 0;
  for (const k of [...TRAIT_KEYS, ...LEARN_KEYS]) {
    const scale = k === "patience" ? 40 : 1;
    const va = ((a.patch.traits ?? {}) as Record<string, number>)[k] ?? ((a.patch.learning ?? {}) as Record<string, number>)[k];
    const vb = ((b.patch.traits ?? {}) as Record<string, number>)[k] ?? ((b.patch.learning ?? {}) as Record<string, number>)[k];
    if (va !== undefined || vb !== undefined) d += Math.abs((va ?? 0.5 * scale) - (vb ?? 0.5 * scale)) / scale;
  }
  const keys = new Set([...Object.keys(a.patch.knows?.base ?? {}), ...Object.keys(b.patch.knows?.base ?? {}), ...Object.keys(a.patch.knows?.items ?? {}), ...Object.keys(b.patch.knows?.items ?? {})]);
  for (const k of keys) {
    const sa = (a.patch.knows?.base as Record<string, string> | undefined)?.[k] ?? a.patch.knows?.items?.[k]?.state;
    const sb = (b.patch.knows?.base as Record<string, string> | undefined)?.[k] ?? b.patch.knows?.items?.[k]?.state;
    if (sa !== sb) d += 1;
  }
  return d;
}
/** 서로 너무 비슷한 것(거리 < min)은 뒤의 것을 버린다 */
export function dropNear(list: OptionPatch[], min = 0.6) {
  const kept: OptionPatch[] = [], dropped: Array<{ id: string; like: string; d: number }> = [];
  for (const o of list) { const near = kept.find((k) => distance(k, o) < min); if (near) dropped.push({ id: o.id, like: near.id, d: Number(distance(near, o).toFixed(2)) }); else kept.push(o); }
  return { kept, dropped };
}
export async function makeBatch(text: string, opts: { map?: ProblemMap; ask?: Ask; min?: number } = {}) {
  const raw = await (opts.ask ?? defaultAsk)<{ options: Raw[] }>("npc:make-batch", `${MAKE_SYSTEM}\n- 여러 명을 서로 다르게 만든다(값이 비슷한 사람을 두 번 만들지 않는다). options에 하나씩.`, `${names(opts.map)}\n\n[설명]\n${text.slice(0, 8000)}`, BATCH_SCHEMA);
  const checked = (raw.options ?? []).map((r) => checkOption(r, opts.map));
  const { kept, dropped } = dropNear(checked.map((c) => c.option), opts.min);
  return { kept, dropped, notes: checked.flatMap((c, i) => c.notes.map((n) => `${c.option.id || i}: ${n}`)) };
}
