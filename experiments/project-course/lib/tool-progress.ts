export type ToolProgress = { id: string; tool: string; status: "running" | "completed" | "failed" | "cancelled"; label: string; detail?: string };

export function toolProgress(id: string, tool: string, input: Record<string, unknown>, status: ToolProgress["status"], error?: string): ToolProgress {
  const actions: Record<string, string> = { goal: "학습 목표 조정", focus: "학습 초점 조정", support: "보충 학습 열기", return: "원래 주제로 돌아가기", observe: "학습 관찰 기록" };
  const titles: Record<string, string> = { read: "파일 읽기", glob: "파일 찾기", grep: "코드 검색", run_snippet: "코드 실행", run_command: "터미널 명령", code_nav: "코드 이해(VS Code)", debug_peek: "디버거로 멈춰 보기", get_learning_state: "학습 상태 확인", get_course_material: "코스 자료 확인", adjust_learning: actions[String(input.action)] ?? "학습 상태 조정" };
  const title = titles[tool] ?? tool;
  const suffix = { running: "진행 중", completed: "완료", failed: "실패", cancelled: "중단" }[status];
  const detail = error ?? (tool === "read" ? input.filePath ?? input.path : tool === "glob" || tool === "grep" ? input.pattern : tool === "run_command" ? input.command : tool === "adjust_learning" ? input.text : undefined);
  return { id, tool, status, label: `${title} · ${suffix}`, ...(detail ? { detail: String(detail).slice(0, 300) } : {}) };
}
