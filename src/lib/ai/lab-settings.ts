// 실험실에서 바꾼 모델·강도 (2026-11-06, AI 호출 실험실 "방식 바꾸면 실시간 갱신"): <data>/lab/ai-settings.json.
// 호출 종류(purpose, 예 "code:hint")마다 { model, effort }. 있으면 코드의 기본값과 호출마다 넘긴 값보다 먼저 쓴다.
// 파일은 이 PC에만 둔다(RecallerData .gitignore에 lab/) — 다른 PC의 앱이 실험 설정으로 돌지 않게.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export type LabChoice = { model?: string; effort?: string };
export type LabSettings = { assist: Record<string, LabChoice> };
const file = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "lab", "ai-settings.json");
let cached: { mtime: number; path: string; value: LabSettings } | null = null;

export function labSettings(): LabSettings {
  const f = file();
  try {
    if (!existsSync(f)) return { assist: {} };
    const mtime = statSync(f).mtimeMs;
    if (cached && cached.path === f && cached.mtime === mtime) return cached.value;
    const raw = JSON.parse(readFileSync(f, "utf8")) as Partial<LabSettings>;
    const value: LabSettings = { assist: raw.assist && typeof raw.assist === "object" ? raw.assist : {} };
    cached = { mtime, path: f, value };
    return value;
  } catch { return { assist: {} }; }
}
/** 이 호출 종류에 실험실이 정한 값. 정확히 같은 이름이 먼저, 없으면 "code:train-*" 같은 끝 별표. */
export function labChoice(purpose: string): LabChoice | null {
  const a = labSettings().assist;
  if (a[purpose]) return a[purpose];
  const wild = Object.keys(a).find((k) => k.endsWith("*") && purpose.startsWith(k.slice(0, -1)));
  return wild ? a[wild] : null;
}
export function saveLabChoice(purpose: string, choice: LabChoice | null) {
  if (!/^[\w:*-]{2,60}$/.test(purpose)) throw Object.assign(new Error("호출 이름이 이상해요."), { status: 400 });
  const s = labSettings();
  const next: LabSettings = { assist: { ...s.assist } };
  const clean = choice ? Object.fromEntries(Object.entries(choice).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, String(v).trim()])) as LabChoice : null;
  if (!clean || (!clean.model && !clean.effort)) delete next.assist[purpose]; else next.assist[purpose] = clean;
  mkdirSync(path.dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(next, null, 2));
  cached = null;
  return next;
}
