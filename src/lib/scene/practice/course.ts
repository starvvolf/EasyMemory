// 실습 서버(experiments/project-course, 127.0.0.1:4100)를 부르는 곳 하나. 앱의 /api/project-course 입구(route.ts)와 상황 재현의 실습 갈래가 같이 쓴다.
// 로컬 실험 모드에서만 쓰인다(입구가 막음). 꺼져 있으면 offline(e)가 참.
export const COURSE = (process.env.PROJECT_COURSE_URL || "http://127.0.0.1:4100").replace(/\/$/, "");

export async function course<T>(pathname: string, init?: { method?: string; body?: unknown; timeout?: number }): Promise<T> {
  const res = await fetch(`${COURSE}/api/${pathname}`, { method: init?.method ?? "GET", cache: "no-store", signal: AbortSignal.timeout(init?.timeout ?? (init?.method === "POST" ? 20000 : 4000)),
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" }, body: init?.body === undefined ? undefined : JSON.stringify(init.body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string; message?: string }).error ?? (data as { message?: string }).message ?? `프로젝트 코스 서버 오류 (${res.status})`), { status: 502, upstream: res.status });
  return data as T;
}
export const offline = (error: unknown) => error instanceof Error && (error.name === "TimeoutError" || /fetch failed|ECONNREFUSED/i.test(`${error.message} ${(error as { cause?: Error }).cause?.message ?? ""}`));
