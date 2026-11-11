// PS 튜터: 내가 고른 것 (2026-11-11, 사용자 시뮬레이션에서 정함). 데이터 폴더 code/tutor/profile.json.
//   - 설문: 패턴마다 모름 / 알아요(배운 적 있음) / 잘해요(보면 바로 풀 수 있음). "스택을 안다고 스택 문제를 다 푸는 건 아니다" → 패턴 단위.
//   - 빠른 확인: 알아요·잘해요는 쉬운 것부터 처음 보는 문제 하나씩. 맞히면 그대로, 틀리면 한 칸 내림(잘해요 → 알아요 → 모름).
//   - 분야 집중: 사용자가 고른 패턴(또는 개념)만 배운다. 끝내기 전까지.
// 상태(맞힘·틀림)는 사건 기록(events.jsonl)이 정하고, 여기는 사용자가 고른 것과 확인 결과만 둔다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Level = "none" | "know" | "good";
export type Profile = {
  surveyed: boolean;
  levels: Record<string, Level>;
  /** 빠른 확인: pass 맞힘 / fail 틀려서 한 칸 내림 / skip 나중에 */ checked: Record<string, "pass" | "fail" | "skip">;
  /** 분야 집중: 패턴 id 목록(개념 하나를 고르면 그 아래 패턴들). 비면 추천 순서. */ focus: string[];
  at?: string;
};
const dir = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "code", "tutor");
const file = () => path.join(dir(), "profile.json");
export const EMPTY: Profile = { surveyed: false, levels: {}, checked: {}, focus: [] };

export async function readProfile(): Promise<Profile> {
  try { return { ...EMPTY, ...(JSON.parse(await readFile(file(), "utf8")) as Partial<Profile>) }; } catch { return { ...EMPTY, levels: {}, checked: {}, focus: [] }; }
}
let writing: Promise<unknown> = Promise.resolve();
export function updateProfile(change: (p: Profile) => Profile): Promise<Profile> {
  const run = writing.then(async () => {
    const next = { ...change(await readProfile()), at: new Date().toISOString() };
    await mkdir(dir(), { recursive: true });
    await writeFile(file(), JSON.stringify(next, null, 1), "utf8");
    return next;
  });
  writing = run.catch(() => undefined);
  return run;
}

// 순서와 묶음은 커리큘럼(curriculum.ts, 11/11 "커리큘럼 하나로 합치자")이 정한다. 예전의 다섯 묶음(TIER)은 없앴다.
export { ORDERED } from "./curriculum.ts";

/** 확인까지 반영한 지금 수준: 확인에서 틀리면 한 칸 내림. */
export function levelOf(p: Profile, pattern: string): Level {
  const l = p.levels[pattern] ?? "none";
  if (p.checked[pattern] !== "fail") return l;
  return l === "good" ? "know" : "none";
}
