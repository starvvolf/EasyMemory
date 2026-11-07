// 코드 이해 · 디버거 도구(11/8 결정 8 다음 순서 "VS Code 확장으로 코드 이해 도구와 디버거"):
// 학습자 VS Code의 언어 서버(정의 · 쓰인 곳 · 타입 설명 · 파일 목차 · 빨간 줄)와 디버거(멈춰서 변수 보기)를 확장이 대신 불러 준다.
// VS Code가 그 작업 폴더로 열려 있을 때만 된다. 두 엔진 공통(GOAL_TOOLS 길).
import { askBridge, connected } from "./bridge.ts";

const str = { type: "string" } as const;
export const CODE_TOOL = {
  name: "code_nav",
  description: "학습자 VS Code의 코드 이해 기능(언어 서버)으로 코드를 본다. op: definition(이 이름이 정의된 곳) · references(이 이름이 쓰인 곳) · hover(타입 · 설명) · symbols(파일의 함수 · 클래스 · 변수 목록) · problems(작업 폴더 전체의 빨간 줄 · 경고). definition · references · hover는 file · line(1부터)과 그 줄에 있는 symbol 이름이 필요하다. 이름이 어디서 왔는지 · 어디서 쓰이는지 · 무슨 타입인지 볼 때 grep보다 정확하다. 학습자가 VS Code를 그 폴더로 열어 두었을 때만 된다.",
  properties: { op: { type: "string", enum: ["definition", "references", "hover", "symbols", "problems"] }, file: str, line: { type: "integer" }, symbol: str }, required: ["op"],
} as const;
export const DEBUG_TOOL = {
  name: "debug_peek",
  description: "학습자 VS Code의 디버거로 프로그램을 돌려 file의 line(1부터)에서 멈추고, 그때의 지역 변수 값(과 expr에 적은 식의 값)을 본 뒤 끝낸다. 값이 왜 그렇게 되는지 실제로 확인해야 할 때 쓴다. 학습자 화면에서 디버거가 잠깐 켜진다. 반복문 안에서 n번째로 지날 때 보려면 hit에 n(처음이면 1). JavaScript · TypeScript(node) · Python(VS Code Python 확장이 있을 때). 그 줄에 닿지 않으면 출력만 돌려준다.",
  properties: { file: str, line: { type: "integer" }, hit: { type: "integer" }, expr: { type: "array", items: str } }, required: ["file", "line", "hit", "expr"],
} as const;

const fmt = (v: unknown) => typeof v === "string" ? v : JSON.stringify(v, null, 1);
export async function codeNavTool(runId: string, input: Record<string, unknown>): Promise<string> {
  if (!connected(runId)) return "VS Code가 이 작업 폴더로 연결돼 있지 않아 쓸 수 없어요. read · grep으로 보세요.";
  const op = String(input.op ?? "");
  const r = await askBridge(runId, { op, file: input.file ? String(input.file) : undefined, line: Number(input.line) || undefined, symbol: input.symbol ? String(input.symbol).slice(0, 120) : undefined });
  if (r === null) return "VS Code가 답하지 않았어요(확장이 옛 버전이거나 언어 서버가 아직 준비 중). read · grep으로 보세요.";
  return fmt(r).slice(0, 6000);
}
export async function debugPeekTool(runId: string, input: Record<string, unknown>): Promise<string> {
  if (!connected(runId)) return "VS Code가 이 작업 폴더로 연결돼 있지 않아 디버거를 쓸 수 없어요. run_command로 출력을 보세요.";
  const expr = (Array.isArray(input.expr) ? input.expr : []).map(String).filter(Boolean).slice(0, 8).map((e) => e.slice(0, 200));
  const r = await askBridge(runId, { op: "debug", file: String(input.file ?? ""), line: Number(input.line) || 1, hit: Math.max(1, Math.min(1000, Number(input.hit) || 1)), expr }, 40_000);
  if (r === null) return "디버거가 40초 안에 답하지 않았어요. run_command로 출력을 보세요.";
  return fmt(r).slice(0, 6000);
}
