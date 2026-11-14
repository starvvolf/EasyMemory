// 학습자 명세 (설계 1번): 기본값(default.json) 하나에 옵션 조각을 겹쳐 사람을 만든다.
//   겹칠 때는 뒤에 쓴 조각이 이긴다 · 숫자는 0~1로 자른다(patience는 1~100 정수) · 항목 이름은 지도의 조각 이름이어야 한다 ·
//   조각끼리 부딪치면(고수 + 문법약함) 실행 전에 알려 준다. 상태 넷: 앎 · 모름 · 잘못 앎(+믿음 → 틀린 조각) · 애매.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Dice } from "./dice.ts";
import { BASE_KEYS, STATES, type BaseKey, type Fragment, type KnowItem, type KnowState, type OptionPatch, type ProblemMap, type Spec, type Traits } from "./types.ts";

export const TRAIT_KEYS: Array<keyof Traits> = ["invent", "switch", "askEarly", "guess", "helpRungs", "copyTutor", "confirm", "patience", "typo", "terse"];
export const LEARN_KEYS = ["perExplain", "perHint", "fromOwnFix", "forgetPerDay"] as const;
export const TRAIT_LABEL: Record<string, string> = { invent: "조합력", switch: "갈아타기", askEarly: "바로 묻기", guess: "찍어서 쓰기", helpRungs: "도움 칸 열기", copyTutor: "튜터 코드 붙여 넣기",
  confirm: "확인 연타", patience: "버티는 횟수", typo: "실수", terse: "말 짧음", perExplain: "설명 한 번에 배움", perHint: "힌트로 배움", fromOwnFix: "혼자 고치며 배움", forgetPerDay: "하루에 잊음" };
export const LAYER_LABEL: Record<string, string> = { "1": "1층 문법", "2": "2층 담기", "3": "3층 한 줄 읽기", "4": "4층 잇기", "5": "5층 원리", "6": "6층 방법 고르기", run: "실행 · 도구" };

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
function merge(a: unknown, b: unknown): unknown {
  if (!isObj(a) || !isObj(b)) return b === undefined ? a : b;
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k === "items" && isObj(v) ? { ...(isObj(a[k]) ? a[k] : {}), ...v } : merge(a[k], v);
  return out;
}
const clamp01 = (n: unknown, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d);

/** 숫자를 범위로 자르고, 모르는 상태 · 층 이름은 버린다. 고친 것은 notes로. */
export function clampSpec(raw: Spec, notes: string[] = []): Spec {
  const t = raw.traits ?? ({} as Traits), l = raw.learning ?? ({} as Spec["learning"]);
  const traits = Object.fromEntries(TRAIT_KEYS.map((k) => {
    if (k === "patience") { const v = Math.round(Number(t.patience)); return [k, Number.isFinite(v) ? Math.min(100, Math.max(1, v)) : 20]; }
    const v = clamp01(t[k], 0.3);
    if (typeof t[k] === "number" && v !== t[k]) notes.push(`${TRAIT_LABEL[k]} ${t[k]} → ${v}`);
    return [k, v];
  })) as Traits;
  const learning = Object.fromEntries(LEARN_KEYS.map((k) => [k, clamp01(l[k], 0.5)])) as Spec["learning"];
  const base: Spec["knows"]["base"] = {};
  for (const [k, v] of Object.entries(raw.knows?.base ?? {})) {
    if (!(BASE_KEYS as readonly string[]).includes(k)) { notes.push(`모르는 층 ${k} 버림`); continue; }
    if (!(STATES as readonly string[]).includes(v as string)) { notes.push(`${k}층의 상태 "${v}" 버림`); continue; }
    base[k as BaseKey] = v as KnowState;
  }
  const items: Record<string, KnowItem> = {};
  for (const [k, v] of Object.entries(raw.knows?.items ?? {})) {
    if (!isObj(v) || !(STATES as readonly string[]).includes(v.state as string)) { notes.push(`${k}의 상태가 없어서 버림`); continue; }
    items[k] = { state: v.state as KnowState, ...(typeof v.belief === "string" && v.belief.trim() ? { belief: v.belief.trim().slice(0, 200) } : {}), ...(typeof v.as === "string" ? { as: v.as } : {}) };
  }
  return { id: String(raw.id || "npc"), seed: Number.isFinite(Number(raw.seed)) ? Math.round(Number(raw.seed)) : 1, name: String(raw.name || raw.id || "NPC"), lang: "python",
    knows: { base, items }, traits, learning, ...(raw.options ? { options: raw.options } : {}) };
}

/** 기본값 + 옵션 조각들(앞에서 뒤로, 뒤가 이김) */
export function overlay(base: Spec, patches: OptionPatch[], notes: string[] = []): Spec {
  let spec: unknown = structuredClone(base);
  for (const p of patches) spec = merge(spec, p.patch);
  const out = clampSpec(spec as Spec, notes);
  return { ...out, options: [...(base.options ?? []), ...patches.map((p) => p.id)] };
}

/** 같은 칸을 다르게 정한 조각들, 적어 둔 "부딪침" */
export function conflicts(patches: OptionPatch[]): string[] {
  const out: string[] = [];
  const leaves = (o: unknown, at: string, acc: Map<string, unknown>) => {
    if (isObj(o) && !("state" in o)) { for (const [k, v] of Object.entries(o)) leaves(v, at ? `${at}.${k}` : k, acc); }
    else acc.set(at, isObj(o) ? o.state : o);
    return acc;
  };
  const seen = new Map<string, { id: string; v: unknown }>();
  for (const p of patches) {
    for (const c of p.conflicts ?? []) if (patches.some((q) => q.id === c)) out.push(`"${p.label}"(${p.id})와 "${patches.find((q) => q.id === c)!.label}"(${c})는 같이 쓰면 부딪쳐요.`);
    for (const [k, v] of leaves(p.patch, "", new Map())) {
      const before = seen.get(k);
      if (before && before.id !== p.id && JSON.stringify(before.v) !== JSON.stringify(v)) out.push(`${k}: ${before.id}은 ${JSON.stringify(before.v)}, ${p.id}는 ${JSON.stringify(v)} → 뒤에 쓴 ${p.id}가 이겨요.`);
      seen.set(k, { id: p.id, v });
    }
  }
  return [...new Set(out)];
}

/** 항목 이름 맞추기: 정확한 이름 또는 * 무늬(idea.* · syntax.py.*). */
const globRe = (k: string) => new RegExp(`^${k.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
export const matches = (key: string, id: string) => (key.includes("*") ? globRe(key).test(id) : key === id);
/** 항목 이름이 지도의 조각과 맞나. 맞는 게 없는 이름 목록. */
export function unknownItems(spec: Spec, map: ProblemMap) {
  return Object.keys(spec.knows.items).filter((k) => !map.fragments.some((f) => matches(k, f.id)));
}
/** 지도에 없는 이름을 버린 명세 */
export function validated(spec: Spec, map: ProblemMap): { spec: Spec; dropped: string[] } {
  const dropped = unknownItems(spec, map);
  if (!dropped.length) return { spec, dropped };
  const items = Object.fromEntries(Object.entries(spec.knows.items).filter(([k]) => !dropped.includes(k)));
  return { spec: { ...spec, knows: { ...spec.knows, items } }, dropped };
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^0-9a-z가-힣]+/).filter((w) => w.length >= 2));
/** 잘못 앎 → 틀린 조각: 적어 둔 as, 아니면 그 조각 자리의 틀린 조각 중 믿음과 낱말이 가장 많이 겹치는 것 */
export function wrongFor(map: ProblemMap, rightId: string, item: KnowItem): Fragment | null {
  if (item.as) { const f = map.fragments.find((x) => x.id === item.as && x.wrong); if (f) return f; }
  const cands = map.fragments.filter((f) => f.wrong && f.right === rightId);
  if (!cands.length) return null;
  if (!item.belief) return cands[0];
  const b = words(item.belief);
  return [...cands].sort((x, y) => [...words(y.what)].filter((w) => b.has(w)).length - [...words(x.what)].filter((w) => b.has(w)).length)[0];
}

export type Holdings = { holds: Set<string>; wrongs: Map<string, string>; vague: Set<string>; states: Record<string, KnowState>; notes: string[] };
/** 이 명세가 이 지도의 조각 중 무엇을 가졌나. 애매는 씨앗 주사위로 한 번(0.5) 정한다. */
export function holdings(spec: Spec, map: ProblemMap, roll: Dice): Holdings {
  const holds = new Set<string>(), wrongs = new Map<string, string>(), vague = new Set<string>(), states: Record<string, KnowState> = {}, notes: string[] = [];
  const itemFor = (id: string) => {
    const keys = Object.keys(spec.knows.items).filter((k) => matches(k, id));
    // 정확한 이름 > 긴 무늬
    keys.sort((a, b) => Number(b === id) - Number(a === id) || b.replace(/\*/g, "").length - a.replace(/\*/g, "").length);
    return keys.length ? spec.knows.items[keys[0]] : null;
  };
  for (const f of map.fragments.filter((x) => !x.wrong)) {
    const item = itemFor(f.id);
    const state: KnowState = item?.state ?? spec.knows.base[String(f.layer) as BaseKey] ?? "앎";
    states[f.id] = state;
    if (state === "앎") holds.add(f.id);
    else if (state === "애매") { vague.add(f.id); if (roll(`vague:${f.id}`) < 0.5) holds.add(f.id); }
    else if (state === "잘못 앎") {
      const w = wrongFor(map, f.id, item ?? { state });
      if (w) { wrongs.set(f.id, w.id); holds.add(w.id); }
      else notes.push(`${f.id}: 잘못 앎인데 지도에 그 틀린 조각이 없어 모름으로 둬요.`);
    }
  }
  // 틀린 조각을 이름으로 직접 쥐여 준 경우(예: "wrong.no-visited": 앎)
  for (const f of map.fragments.filter((x) => x.wrong)) {
    const item = Object.entries(spec.knows.items).find(([k]) => k === f.id)?.[1];
    if (item && item.state !== "모름") { holds.add(f.id); if (f.right) { wrongs.set(f.right, f.id); holds.delete(f.right); states[f.right] = "잘못 앎"; } }
  }
  return { holds, wrongs, vague, states, notes };
}

/** 사람이 읽는 한 줄: "1층(문법) 모름, 바로 묻기 0.9, 복붙 0.8 …" */
export function describe(spec: Spec | OptionPatch["patch"], base?: Spec): string {
  const parts: string[] = [];
  const k = spec.knows ?? {};
  for (const [layer, st] of Object.entries(k.base ?? {})) if (!base || base.knows.base[layer as BaseKey] !== st) parts.push(`${LAYER_LABEL[layer] ?? layer} ${st}`);
  for (const [id, it] of Object.entries(k.items ?? {})) if (it) parts.push(`${id} ${it.state}${it.belief ? `("${it.belief}")` : ""}`);
  for (const [t, v] of Object.entries({ ...(spec.traits ?? {}), ...(spec.learning ?? {}) })) {
    const b = base ? (base.traits as Record<string, number>)[t] ?? (base.learning as Record<string, number>)[t] : undefined;
    if (v !== undefined && v !== b) parts.push(`${TRAIT_LABEL[t] ?? t} ${v}`);
  }
  return parts.join(", ") || "기본값 그대로";
}

/** options/ 폴더의 조각들 */
export async function loadOptions(dir: string): Promise<Record<string, OptionPatch>> {
  const out: Record<string, OptionPatch> = {};
  for (const n of (await readdir(dir).catch(() => [] as string[])).filter((x) => x.endsWith(".json"))) {
    try { const p = JSON.parse(await readFile(path.join(dir, n), "utf8")) as OptionPatch; if (p.id && p.patch) out[p.id] = p; } catch { /* 깨진 파일은 건너뜀 */ }
  }
  return out;
}
export async function loadSpec(file: string): Promise<Spec> { return clampSpec(JSON.parse(await readFile(file, "utf8")) as Spec); }

/** 기본값 + 이름으로 고른 조각들 → 명세. 모르는 조각 이름 · 부딪침 · 고친 숫자를 알려 준다. */
export function buildSpec(base: Spec, options: Record<string, OptionPatch>, names: string[], over: Partial<Pick<Spec, "id" | "name" | "seed">> = {}) {
  const unknown = names.filter((n) => !options[n]);
  const patches = names.filter((n) => options[n]).map((n) => options[n]);
  const notes: string[] = [];
  const spec = overlay({ ...base, ...over }, patches, notes);
  return { spec, unknown, conflicts: conflicts(patches), notes };
}
