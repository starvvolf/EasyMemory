// PS 튜터: 내가 고른 것 (2026-11-11, 사용자 시뮬레이션에서 정함). 데이터 폴더 code/tutor/profile.json.
//   - 설문: 패턴마다 모름 / 알아요(배운 적 있음) / 잘해요(보면 바로 풀 수 있음). "스택을 안다고 스택 문제를 다 푸는 건 아니다" → 패턴 단위.
//   - 빠른 확인: 알아요·잘해요는 쉬운 것부터 처음 보는 문제 하나씩. 맞히면 그대로, 틀리면 한 칸 내림(잘해요 → 알아요 → 모름).
//   - 분야 집중: 사용자가 고른 패턴(또는 개념)만 배운다. 끝내기 전까지.
// 상태(맞힘·틀림)는 사건 기록(events.jsonl)이 정하고, 여기는 사용자가 고른 것과 확인 결과만 둔다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PATTERNS } from "./patterns.ts";

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

/** 난이도 층(11/11): 앞 층을 알아야 뒤 층을 배우기 쉬운 순서. 같은 층 안은 목록 순서. */
export const TIER: Record<string, 1 | 2 | 3 | 4 | 5> = {
  "count-array": 1, "exist-table": 1, "min-max-init": 1, "fast-io": 1, "sort-key": 1, "counting-sort": 1, "stable-sort": 1, gcd: 1,
  "cursor-list": 2, "stack-match": 2, "stack-mono": 2, "queue-sim": 2, "deque-both": 2, "hash-lookup": 2, "prefix-sum": 2, "merge-two": 2, sieve: 2,
  "grid-dxdy": 3, visited: 3, "bfs-distance": 3, "multi-source": 3, components: 3, "recursion-reduce": 3, "divide-quarter": 3,
  "backtrack-choose": 3, "backtrack-start": 3, "backtrack-prune": 3, bsearch: 3, "two-pointer": 3,
  "dp-1d": 4, "dp-state": 4, "dp-knapsack": 4, lis: 4, "greedy-sort": 4, "param-search": 4, heap: 4, "ordered-set": 4, "graph-adj": 4, "tree-walk": 4,
  "topo-sort": 5, dijkstra: 5, floyd: 5, mst: 5, "union-find": 5,
};
export const TIER_NAME = { 1: "기본 도구", 2: "자료구조", 3: "탐색", 4: "설계", 5: "그래프 심화" } as const;
/** 쉬운 것부터(층, 그다음 목록 순서). */
export const ORDERED = [...PATTERNS].sort((a, b) => (TIER[a.id] ?? 3) - (TIER[b.id] ?? 3) || PATTERNS.indexOf(a) - PATTERNS.indexOf(b));

/** 확인까지 반영한 지금 수준: 확인에서 틀리면 한 칸 내림. */
export function levelOf(p: Profile, pattern: string): Level {
  const l = p.levels[pattern] ?? "none";
  if (p.checked[pattern] !== "fail") return l;
  return l === "good" ? "know" : "none";
}
