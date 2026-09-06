# VS Code 학습 연결 계약 (2026-09-07)

기준 커밋: 854ad291. 확장 전용 변경이며 Firebase, 앱 API, storage.ts, 공용 타입, 루트 패키지/lock, PDF 화면은 수정하지 않는다.

## 파일 책임

- `extension.js`: 기존 제출 명령 + 학습 화면 등록.
- `learning-workspace.js`: VS Code 웹뷰/편집기와 로컬 모델·저장·정리 연결. 메시지는 발신 화면별 허용 목록으로 검증.
- `learning-state.js`: 입력 제한, 로컬 JSON atomic rename/직렬 쓰기, 원문 대화 재개.
- `codex-client.js`: stdio JSON-RPC, managed ChatGPT 로그인, 구독 계정 확인, turn 시작/재개/중지, 조기 완료 이벤트 처리, 실패 시 자동 재전송 금지.
- `example-runner.js`: trusted 어댑터로만 shell:false spawn. 제한/중지/프로세스 트리 종료 실패 처리.
- `execution-contract.js`, `local-runtimes.js`, `function-wrappers.js`, `language-runner.js`: Python/C#/Java 런타임 확인, 호출 규격 확인, 임시 래퍼·명시 소스 실행. 세부 계약과 검증은 [EXECUTION.md](EXECUTION.md).
- `summary.js`: 정리 입력/근거 ID 검증, 성공 cursor, 활성 세션 타이머. 이전 정리를 대화 원문에 섞지 않음.
- `media/*`: CSP가 적용된 웹뷰. 문제/AI 출력을 textContent로 표시하며 HTML·스크립트로 실행하지 않음.
- `test/*`: 합성 fixture만. npm 의존성 없음.

## 로컬 데이터

`ExtensionContext.storageUri/learning/learning.json` (폴더 없는 창은 globalStorageUri fallback):

```text
schemaVersion: 1
activeSessionId
draft?: { sessionId, newProblem, problem }  // 자동 보존 초안, 실행/AI 입력 아님
sessions[]:
  id, createdAt, updatedAt
  problem: title, text, sourceUrl, images[{id,mime,dataUrl}], examples[{id,input,expectedOutput}]
  messages[{id,role,text,status,createdAt,context?,error?}]
  linkedFile?: {path,label,language}
  codeSnapshots[{id,filePath,language,text,createdAt}]
  threadId?
  execution?: {mode,mainClass?,function?,confirmedHash}
  summaryAutoEnabled: false
  summary?: {sections,throughMessageId,updatedAt,automatic}
  summaryError?
```

각 정리 section 항목은 `{text,messageIds,codeIds}`. 모든 근거 ID를 저장한 원문에서 검증한다. 정리 요청 입력은 당시 대화와 최근 코드 스냅샷 10개이며 180,000자 초과 시 조용히 자르지 않고 실패시킨다. 질문에 붙인 코드/실패 문맥은 해당 message에 보존되어 정리 근거로 사용된다. 자동 갱신은 코드 변경만으로 시작하지 않는다.

App Server 전용 `globalStorageUri/managed-codex`에 고정 read-only/ChatGPT-only 설정과 managed 인증을 보존한다. 기존 사용자 CODEX_HOME/config/auth를 읽어 복사하지 않는다. 코칭 작업 cwd는 `globalStorageUri/coach-workspace`로 실제 프로젝트와 분리한다. API 키/대체 provider 환경변수를 전달하지 않는다. 프로토콜 수신 승인 요청은 전부 거부한다. OS 보안 경계와 실제 설치 버전의 동작은 실제 연결 시험에서 추가 확인해야 한다.

현재 로컬 JSON 방식은 단일 VS Code 창의 직렬 쓰기를 전제로 한다. 같은 workspace를 여러 창에서 동시에 편집하는 교차 프로세스 충돌 해결·원문 대용량 보존 정책·암호화·클라우드 동기화는 포함하지 않는다. Firebase 담당에게 session 식별자, 계정 소유권, 원문 append 멱등성, 그림 저장소, 정리 revision/cursor 원자 저장 요구를 먼저 전달했다.

## 검증과 남은 조치

- 모의 App Server: 초기화/managed 로그인 종류/API key 계정 거부/이미지 입력/대화 재개/조기 완료 이벤트/도구 승인 거부/응답 시간 제한.
- 로컬 fixture: 여러 stdin 예제별 비교, stderr/exit code, shell 메타문자 보존, 시간·출력 제한, 중지 후 나머지 미실행.
- 로컬 저장/VS Code API mock: 문제 입력·오염된 링크/이미지 거부·원문 복구·웹뷰 요청 경계.
- 정리: default off, 첫 정리 전 자동 호출 없음, 새 대화만 갱신, 겹침 방지, 재개 baseline, 실패 시 기존 정리 유지, 요청 시점 cursor.
- 합성 브라우저 preview에서 문제와 예제 등록 후 좌측 문제/중앙 코드 자리/하단 결과/우측 대화 배치를 확인. 실제 VS Code WebviewView 배치·클립보드 이미지·계정 연결 E2E와는 구별.
- 설치된 codex-cli 0.101.0에서 `app-server generate-json-schema`를 오프라인 실행해 thread start/resume의 read-only, modelProvider/developerInstructions, turn의 image URL/outputSchema/sandboxPolicy 필드를 확인. 서버/로그인/turn 실호출 아님.
- 실제 연결 시험은 중지 상태. 사용자 승인 후 전용 managed 로그인, 구독 응답, 그림 이해, 새로고침 후 대화 재개, 파일 무수정, 정리 갱신을 합성 자료로 확인해야 한다.
- Python/Java 실제 fixture와 Windows 자손 종료 검증 완료. C#은 SDK 부재로 실제 컴파일/실행은 미완료. 호출 규격 확인·범위와 런타임 설치 필요사항은 EXECUTION.md 참조.
- 변경 범위가 plain JS VS Code 확장이라 별도 번들 빌드 없음. 루트 Next.js는 이 worktree에 의존성이 없으며 무설치 원칙을 유지한다. 주 저장소 기존 eslint 설치/설정을 읽기 전용으로 사용해 확장 린트 실행.

## 공식 계약 근거

- [OpenAI App Server: 초기화, 대화, managed 로그인, 이미지 입력](https://developers.openai.com/codex/app-server)
- [OpenAI 설정: forced_login_method, shell_tool, unified_exec](https://developers.openai.com/codex/config-reference)

현재 공식 문서와 설치된 0.101.0의 차이가 있을 수 있으므로 실제 로그인 시험 없이 호환 완료로 표시하지 않는다.
