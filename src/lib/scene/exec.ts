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

/** 오류 문구를 보여 줄 모양으로: 임시 폴더 경로를 지우고 끝의 몇 줄만 */
export function cleanError(text: string) {
  return text.replace(/\r/g, "").replace(/(?:[A-Za-z]:)?[\\/][^\s"']*[\\/](main\.\w+|Main\.\w+|Program\.cs)/g, "$1").trim().split("\n").slice(-8).join("\n");
}

/** 파이썬 리터럴 두 개가 같은 값인가(담기 그리기). 읽지 못하면 null. */
export async function sameLiteral(a: string, b: string): Promise<boolean | null> {
  const prog = "import ast, sys, json\nd = json.loads(sys.stdin.read())\ntry:\n    x = ast.literal_eval(d['a'].strip())\n    y = ast.literal_eval(d['b'].strip())\nexcept Exception:\n    print('BAD'); sys.exit(0)\nprint('SAME' if x == y else 'DIFF')";
  const [r] = await runAll("python", prog, [JSON.stringify({ a, b })]);
  if (!r.ok || r.out === "BAD") return null;
  return r.out === "SAME";
}
/** def ok(v): 판정 함수로 리터럴 하나를 본다(담기 그리기 · 모양). 읽지 못하면 null. */
export async function literalOk(fn: string, literal: string): Promise<boolean | null> {
  const prog = `import ast, sys\n${fn}\ntry:\n    v = ast.literal_eval(sys.stdin.read().strip())\nexcept Exception:\n    print('BAD'); sys.exit(0)\ntry:\n    print('YES' if ok(v) else 'NO')\nexcept Exception:\n    print('NO')`;
  const [r] = await runAll("python", prog, [literal]);
  if (!r.ok || r.out === "BAD") return null;
  return r.out === "YES";
}
/** 반례 만들기 · 변형 문제의 입력 검사: validator가 0으로 끝나면 맞는 입력. 아니면 그 이유(출력) */
export async function validInput(validator: string | undefined, stdin: string): Promise<{ ok: true } | { ok: false; why: string }> {
  if (!stdin.trim()) return { ok: false, why: "입력이 비어 있어요." };
  if (stdin.length > 4000) return { ok: false, why: "입력이 너무 길어요(작게 써 주세요)." };
  if (!validator?.trim()) return { ok: true };
  const [r] = await runAll("python", validator, [stdin]);
  if (r.ok && !r.out.trim()) return { ok: true };
  return { ok: false, why: (r.ok ? r.out : cleanError(r.error)).slice(0, 300) || "입력 형식이 맞지 않아요." };
}
/** 순서 맞추기: 줄(들여쓰기 뺀 것)의 묶음 — 같은 줄들인가 볼 때 */
export const strippedLines = (code: string) => code.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
/** 순서 맞추기 화면에 보일 섞인 줄: 정해진 씨앗으로 섞되 원래 순서와는 다르게 */
export function shuffledPieces(code: string, seed: string) {
  const lines = strippedLines(code);
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => { h = (h * 1103515245 + 12345) >>> 0; return h / 2 ** 32; };
  for (let t = 0; t < 10; t++) {
    const a = [...lines];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    if (a.join("\n") !== lines.join("\n") || lines.length < 2) return a;
  }
  return [...lines].reverse();
}
/** 표현 확인: 정규식이 모두 맞나 */
export function structureOk(structure: { must: Array<{ pattern: string }> } | undefined, code: string) {
  if (!structure?.must.length) return { ok: true, missing: [] as string[] };
  const missing = structure.must.filter((m) => { try { return !new RegExp(m.pattern, "m").test(code); } catch { return false; } }).map((m) => m.pattern);
  return { ok: !missing.length, missing };
}
