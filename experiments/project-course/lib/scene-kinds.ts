// 상황 재현 복습(11/15, 설계 docs/상황재현_설계_v2(+gpt).md 1번)의 빈틈 종류. 앱 쪽 src/lib/scene/types.ts GAP_KINDS와 같은 말이어야 한다
// (test/scene.test.ts가 둘을 맞춰 본다). 실습 서버는 앱 코드를 부르지 않으므로 여기 따로 둔다.
export const SCENE_KINDS = ["문법", "자료 담기", "자료 구현", "한 줄 읽기", "알고리즘 고르기", "알고리즘 원리", "알고리즘 구현", "경계 · 예외", "문제 읽기", "실행 · 도구", "오류 읽기", "순서 · 동시성"] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];
/** 알맹이 언어: 앱 채점기 네 언어 + 명령 한 줄(shell) */
export const KERNEL_LANGS = ["csharp", "javascript", "python", "cpp", "shell"] as const;
const squash = (s: string) => s.replace(/[\s·・,]/g, "").toLowerCase();
/** AI가 쓴 종류 글을 목록의 이름으로(띄어쓰기 · 가운뎃점이 달라도). 못 맞추면 null */
export function kindOf(text: string): SceneKind | null {
  const t = squash(String(text ?? ""));
  if (!t) return null;
  return SCENE_KINDS.find((k) => squash(k) === t) ?? SCENE_KINDS.find((k) => t.includes(squash(k))) ?? null;
}
/** 언어 이름 맞추기(cs · c# · js · node · py · bash …) */
export function langOf(text: string): string {
  const t = String(text ?? "").trim().toLowerCase();
  if (/^(c#|cs|csharp|dotnet)$/.test(t)) return "csharp";
  if (/^(js|javascript|node|ts|typescript|mjs)$/.test(t)) return "javascript";
  if (/^(py|python|python3)$/.test(t)) return "python";
  if (/^(c\+\+|cpp|cc)$/.test(t)) return "cpp";
  if (/^(sh|bash|shell|powershell|ps|cmd|terminal|console)$/.test(t)) return "shell";
  return t;
}
/** 파일 이름에서 언어(실습 코드 조각의 언어) */
export function langOfFile(file: string): string {
  const ext = String(file ?? "").toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = { cs: "csharp", js: "javascript", mjs: "javascript", cjs: "javascript", ts: "javascript", tsx: "javascript", jsx: "javascript",
    py: "python", cpp: "cpp", cc: "cpp", h: "cpp", hpp: "cpp", sh: "shell", ps1: "shell" };
  return map[ext] ?? "";
}
