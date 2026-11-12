// PS 튜터: 내가 고른 것. 데이터 폴더 code/tutor/profile.json.
//   - 분야 집중: 사용자가 고른 패턴(또는 개념)만 배운다. 끝내기 전까지.
//   (11/11의 설문 "모름/알아요/잘해요"와 빠른 확인은 11/12 사용자 결정으로 없앴다: "시작하기 전에 점검 필요 없지 않냐… 다 없애고".
//    예전 파일에 남은 surveyed·levels·checked는 읽지 않는다.)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Profile = {
  /** 분야 집중: 패턴 id 목록(개념 하나를 고르면 그 아래 패턴들). 비면 추천 순서. */ focus: string[];
  at?: string;
};
const dir = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "code", "tutor");
const file = () => path.join(dir(), "profile.json");
export const EMPTY: Profile = { focus: [] };

export async function readProfile(): Promise<Profile> {
  try { const raw = JSON.parse(await readFile(file(), "utf8")) as Partial<Profile>; return { focus: Array.isArray(raw.focus) ? raw.focus : [], ...(raw.at ? { at: raw.at } : {}) }; } catch { return { focus: [] }; }
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
