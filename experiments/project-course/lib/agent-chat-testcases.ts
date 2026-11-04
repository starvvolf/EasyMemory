// 가짜 모델의 호출 경로 시험과 사람용 테스트지가 공유하는 목록. 실제 모델의 선택 품질을 대신하지 않는다.
type Call = { name: string; args: Record<string, unknown> };
export type ChatToolCase = { id: string; question: string; calls: Call[]; statuses?: string[]; setup?: "support"; check: string };
export const CHAT_TOOL_CASES: ChatToolCase[] = [
  { id: "T01", question: "실험 폴더의 src/routes/hello.ts를 실제로 읽고 현재 인사 응답 코드를 설명해 줘요.", calls: [{ name: "read", args: { path: "src/routes/hello.ts" } }], check: "실제 파일의 시작 코드가 반환되고, 읽기 완료 뒤 설명" },
  { id: "T02", question: "실험 폴더 src 아래 TypeScript 파일 목록을 파일 찾기 도구로 확인해 줘요.", calls: [{ name: "glob", args: { pattern: "src/**/*.ts" } }], check: "src/app.ts와 routes/hello.ts를 포함한 파일 경로 반환" },
  { id: "T03", question: "src에서 sendJson을 쓰는 위치를 코드 검색 도구로 찾아 줘요.", calls: [{ name: "grep", args: { pattern: "sendJson", path: "src", include: "*.ts" } }], check: "검색 결과에 실제 파일·일치 줄이 있음" },
  { id: "T04", question: "[2,4].map(x => x * 2)를 코드 조각 도구로 실제 실행해 줘요.", calls: [{ name: "run_snippet", args: { code: "[2,4].map(x => x * 2)" } }], check: "실제 출력 [4,8] 및 실행 완료" },
  { id: "T05", question: "내 목표와 지금 초점, 보충 중인 주제, 이해도 관찰을 학습 상태 도구로 조회해 줘요.", calls: [{ name: "get_learning_state", args: {} }], check: "저장된 목표·초점·보충·관찰이 반환됨" },
  { id: "T06", question: "코스 자료 도구로 인사 서버 코스의 목차와 시작 코드를 확인해 줘요.", calls: [{ name: "get_course_material", args: {} }], check: "두 단계 목차와 src/app.ts 시작 코드 반환" },
  { id: "T07", question: "학습 목표를 'HTTP 요청과 응답 이해하기'로 기록해 줘요.", calls: [{ name: "adjust_learning", args: { action: "goal", text: "HTTP 요청과 응답 이해하기" } }], check: "goal 변경, 기존 대화 유지" },
  { id: "T08", question: "지금 초점을 '함수 만들기와 호출'로 바꿔 줘요.", calls: [{ name: "adjust_learning", args: { action: "focus", text: "함수 만들기와 호출" } }], check: "focus 변경, 목표 유지" },
  { id: "T09", question: "지금 하던 건 잠깐 두고 '매개변수'를 보충 학습으로 열어 줘요.", calls: [{ name: "adjust_learning", args: { action: "support", text: "매개변수" } }], check: "보충 스택 한 칸 추가·원래 초점 보존" },
  { id: "T10", setup: "support", question: "매개변수는 함수가 받는 값의 이름이에요. 이 설명을 근거로 현재 보충을 마치고 원래 주제로 돌아가 주세요.", calls: [{ name: "get_learning_state", args: {} }, { name: "adjust_learning", args: { action: "return", text: "매개변수의 역할을 자기 말로 설명함", supportId: "$support", evidenceMessageId: "$message", evidence: "함수가 받는 값의 이름" } }], check: "현재 칸·새 답변·실제 인용 검사 뒤 한 칸 복귀" },
  { id: "T11", question: "함수 선언은 작업을 정의하는 것이고 호출할 때 실행돼요. 이 말을 근거로 이해도 관찰을 남겨 줘요.", calls: [{ name: "adjust_learning", args: { action: "observe", kind: "understood", text: "함수 선언과 호출을 구분함", evidenceMessageId: "$message", evidence: "호출할 때 실행돼요" } }], check: "understood 관찰, verified=false, 메시지 인용 보존" },
  { id: "T12", question: "괄호 안 이름이 뭘 받는지는 아직 헷갈려요. 이 상태를 관찰로 기록해 줘요.", calls: [{ name: "adjust_learning", args: { action: "observe", kind: "confused", text: "매개변수의 역할을 헷갈림", evidenceMessageId: "$message", evidence: "아직 헷갈려요" } }], check: "confused 관찰, 검증된 이해로 올리지 않음" },
  { id: "T13", question: "함수는 선언만 하면 바로 본문이 실행되는 거죠. 이 생각이 틀렸으면 오개념 관찰로 남겨 줘요.", calls: [{ name: "adjust_learning", args: { action: "observe", kind: "misconception", text: "선언하면 본문이 실행된다고 생각함", evidenceMessageId: "$message", evidence: "선언만 하면 바로 본문이 실행" } }], check: "misconception 관찰과 실제 학습자 인용" },
  { id: "T14", question: "파일 찾기로 TypeScript 파일을 확인하고 src/routes/hello.ts를 읽은 뒤, query.get 예시를 조각 실행해서 차례로 설명해 줘요.", calls: [{ name: "glob", args: { pattern: "src/**/*.ts" } }, { name: "read", args: { path: "src/routes/hello.ts" } }, { name: "run_snippet", args: { code: 'new URLSearchParams("name=민수").get("name")' } }], check: "안내 → 작업 3개 각각 상태 → 결과 설명, 사용자 추가 입력 불필요" },
  { id: "T15", question: "안녕!", calls: [], check: "불필요한 도구·학습 상태 변경 없이 응답" },
  { id: "N01", question: "src/routes/not-found.ts 파일을 실제로 읽어 봐요.", calls: [{ name: "read", args: { path: "src/routes/not-found.ts" } }], statuses: ["failed"], check: "읽기 실패 표시, 실행 중 표시 정리" },
  { id: "N02", question: "throw new Error('실행 시험 오류')를 조각 실행해 오류를 확인해 줘요.", calls: [{ name: "run_snippet", args: { code: "throw new Error('실행 시험 오류')" } }], statuses: ["failed"], check: "도구 호출 자체 완료와 코드 실행 실패를 구분해 실패 표시" },
  { id: "N03", question: "내가 말하지 않은 문장을 인용 근거로 이해 관찰에 넣을 수 있는지 검사해 줘요.", calls: [{ name: "adjust_learning", args: { action: "observe", kind: "understood", text: "허위 인용 시험", evidenceMessageId: "$message", evidence: "이 문자열은 학습자 답에 없음 98137" } }], statuses: ["failed"], check: "실제 인용 검사 거절·관찰 미추가" },
  { id: "N04", question: "'함수' 보충을 연 다음 같은 주제를 한 번 더 열어 반복 방지를 검사해 줘요.", calls: [{ name: "adjust_learning", args: { action: "support", text: "함수" } }, { name: "adjust_learning", args: { action: "support", text: "함수" } }], statuses: ["completed", "failed"], check: "중복 거절, 열린 칸은 하나" },
  { id: "N05", setup: "support", question: "없는 보충 칸 id를 보내면 복귀가 거절되는지 검사해 줘요. 함수가 받는 값의 이름이라고 설명했어요.", calls: [{ name: "adjust_learning", args: { action: "return", text: "오래된 칸 시험", supportId: "stale-frame", evidenceMessageId: "$message", evidence: "함수가 받는 값의 이름" } }], statuses: ["failed"], check: "현재 칸 id 검사 거절·보충 유지" },
];

export function fixtureCalls(id: string, userText: string): Call[] {
  const test = CHAT_TOOL_CASES.find((c) => c.id === id);
  if (!test) return [];
  const match = /\[현재 학습 상태\]\n([^\n]+)\n이번 학습자 메시지 id: (\d+)/.exec(userText);
  const state = match ? JSON.parse(match[1]) : { support: [] };
  const message = Number(match?.[2] ?? 0);
  return test.calls.map((call) => ({ name: call.name, args: Object.fromEntries(Object.entries(call.args).map(([key, value]) => [key, value === "$message" ? message : value === "$support" ? state.support.at(-1)?.id ?? "missing" : value])) }));
}
