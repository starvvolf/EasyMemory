// 장면 실행: 학습자 답(또는 모범 답 · 틀린 생각)을 프로그램으로 엮어 장면의 입력마다 돌린다. 채점기는 알고리즘과 같은 것(code/run.ts).
import { judge, normalizeOutput, type Lang } from "../code/run.ts";
import type { Scene } from "./types.ts";

export type RunOut = { ok: true; out: string } | { ok: false; error: string; kind: "CE" | "RE" | "TLE" | "MISSING" };
const LANGS: Lang[] = ["python", "javascript", "cpp", "csharp"];
export const langOf = (lang: string): Lang => (LANGS as string[]).includes(lang) ? lang as Lang : "python";

/** 빈칸 답: 한 줄에 하나(빈칸이 셋이면 세 줄) */
export const blanksOf = (answer: string) => answer.replace(/\r/g, "").split("\n");
export const BLANK = /_{3,}/g;
export function fillBlanks(template: string, answer: string) {
  const parts = blanksOf(answer);
  let i = 0;
  return template.replace(BLANK, () => parts[i++] ?? "");
}
/** 학습자 자리(answer)를 넣은 프로그램 전체 */
export function programOf(scene: Pick<Scene, "format" | "setup" | "after" | "template" | "reference">, answer: string) {
  switch (scene.format) {
    // 학습자가 코드를 쓰는 형식: 준비 코드 + 학습자 자리 + 뒤 코드(순서 맞추기는 화면이 맞춘 줄을 이어 보냄)
    case "write": case "function": case "order": return `${scene.setup}\n${answer}\n${scene.after}`;
    case "blank": return `${scene.setup}\n${fillBlanks(scene.template ?? "", answer)}\n${scene.after}`;
    // 전체 프로그램을 내는 형식
    case "fix": case "variant": return answer;
    // 보여 주는 코드 그대로(학습자는 값 · 보기 · 입력을 냄)
    case "predict": case "error": case "counter": case "draw": return scene.reference;
    default: return "";
  }
}
/** 실행 결과의 "모양": 출력이면 출력, 오류면 종류(파이썬은 예외 이름까지). 같은 실수를 오류로도 알아보려고. */
export function shapeOf(r: RunOut) {
  if (r.ok) return r.out;
  const name = r.kind === "RE" ? r.error.match(/(?:^|\n)(\w+(?:Error|Exception))\b[^\n]*\s*$/)?.[1] ?? "" : "";
  return `\u0000${r.kind}${name ? `:${name}` : ""}`;
}
/** 문법부터 틀린 모양: 어떤 생각을 했는지 드러나지 않는다(어떤 문법 오류든 같아 보임). */
export const isSyntaxShape = (s: string) => /^\u0000(CE|MISSING|RE:(SyntaxError|IndentationError|TabError))/.test(s);
export const sameOut = (a: string, b: string) => normalizeOutput(a) === normalizeOutput(b);

/** 프로그램 하나를 입력 여럿에 돌린다. 컴파일 · 실행 오류는 그 입력의 결과로. */
export async function runAll(lang: string, code: string, stdins: string[], timeLimitMs = 3000): Promise<RunOut[]> {
  if (!code.trim()) return stdins.map(() => ({ ok: false as const, error: "코드가 비어 있어요.", kind: "RE" as const }));
  const j = await judge(langOf(lang), code, stdins.map((input) => ({ input, output: "" })), { timeLimitMs });
  if (j.verdict === "CE" || j.verdict === "MISSING") return stdins.map(() => ({ ok: false as const, error: j.compile || "컴파일 오류", kind: j.verdict as "CE" | "MISSING" }));
  return stdins.map((_, i) => {
    const r = j.results[i];
    if (!r) return { ok: false as const, error: "실행하지 못했어요.", kind: "RE" as const };
    if (r.verdict === "TLE") return { ok: false as const, error: "시간 초과", kind: "TLE" as const };
    if (r.verdict === "RE" || r.verdict === "MLE") return { ok: false as const, error: r.stderr || "실행 오류", kind: "RE" as const };
    return { ok: true as const, out: normalizeOutput(r.got) };
  });
}
