# 작업지시 07: ChatGPT 계정으로 생성 (자동 실행기)

- **근거**: `docs/DECISIONS.md`의 "2026-09-30 · ChatGPT 계정으로 생성"
- **브랜치**: `claude/local-state-20260928` (PR starvvolf/EasyMemory#1)
- **목표**: 사용자가 "ChatGPT로 로그인"한 뒤 되짚기에서 **읽기 시작**을 누르면, 사람이 GPT 대화에 말을 걸지 않아도 앱이 5단계와 출제 기록까지 끝낸다. 사용량은 그 사용자의 ChatGPT 플랜에서 나간다.
- **지켜야 할 것**
  - **실제 모델 호출은 사용자 확인 뒤에만 한다.** 개발과 확인은 가짜 모델 공급자로 한다.
  - 토큰은 서버에만 둔다. 화면·로그·실행 기록·저장소에 남기지 않는다.
  - 되짚기 화면(`src/app/study/`)은 Claude가 맡는다. 화면에 필요한 값·상태는 아래 "화면과의 약속"으로 넘긴다.
  - 공용 계약을 바꾸면 결정 기록에 남긴다.

## 0. 먼저 확인할 것 (공식 문서)
확인 결과를 결과보고 맨 앞에 적는다. 확인 전에는 1~4번을 가짜 공급자로만 진행한다.
- Sign in with ChatGPT의 **오픈소스 흐름 등록 방법**: 클라이언트 등록, 돌아올 주소(redirect), 로컬(127.0.0.1) 허용 여부, 범위(scope)
- **"자격 있는 Responses API 요청"의 조건**: 쓸 수 있는 모델(지금 `gpt-6-sol`/`astra`/`luna`), 추론 강도, 구조화 출력(JSON Schema) 지원 여부
- **PDF 파일 첨부 가능 여부.** 안 되면 쪽별 추출 글자를 보낸다. 원문 인용 검사가 글자 기준이라 이쪽이 맞을 수도 있다.
- 한도 초과·토큰 만료 때 돌아오는 오류의 모양
- 참고: [Sign in with ChatGPT](https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt), [Using your ChatGPT plan in other apps](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites), [Authentication](https://learn.chatgpt.com/docs/auth)

## 1. 모델 호출 함수 하나
- 지금 앱 안 생성 엔진(`src/lib/pipeline/*`)은 모두 `callCodexJson()`(`src/lib/ai/codex-provider.ts`)을 거친다. 이 함수의 입력(시스템 지시문, 사용자 입력, 결과 JSON 형식, 첨부 PDF, 모델, 추론 강도)은 이미 API 호출과 같은 모양이다.
- 같은 모양의 `callModelJson()`/`callModelText()`를 만들고 속만 **공급자**로 바꾼다.

  | 공급자 | 용도 |
  |---|---|
  | `chatgpt` (기본) | 사용자 OAuth 토큰으로 Responses API. 지시문→instructions, 입력·파일→input, JSON 형식→구조화 출력 |
  | `codex` | 지금 방식(로컬 Codex 스레드). 대안으로 유지 |
  | `fake` | 테스트. 단계별 고정 응답을 돌려준다. 비용 없이 전체 흐름을 자동 확인한다 |
- **호출자 정보를 함께 받는다.** 누구의 토큰으로 부를지 알아야 한다. 지금 Codex 방식은 PC에 로그인된 계정 하나를 모두가 쓴다.
- **스레드 기억에 기대지 않는다.** Codex는 같은 대화방에 이어 말해서 앞 단계 내용을 암묵적으로 기억할 수 있다. API는 매번 새로 시작하므로 필요한 앞 단계 결과를 입력에 넣는다. MCP 경로의 `getNextStage`는 이미 단계 입력을 전부 담아 준다.
- 오류를 나눠 돌려준다: `login_required`(토큰 없음·갱신 실패), `usage_limit`(플랜·앱 주간 한도), `transient`(재시도 가능), `invalid_output`(형식 불일치)

## 2. 로그인과 토큰
- 서버에 OAuth 시작·콜백 경로를 만든다. 콜백에서 받은 토큰을 사용자별로 서버 저장소에 둔다.
  - 로컬: `.study-forge-data/` 아래, 파일 권한 제한
  - 배포: Firebase 등 서버 저장소, 암호화
- 만료 전에 갱신한다. 실패하면 `login_required`로 돌려준다.
- 로그아웃하면 토큰을 지운다.
- 로컬 실험 모드에서도 동작해야 한다(지금 되짚기 사용 환경).

## 3. 자동 실행기 (MCP 대화 AI 자리)
- 대기 요청을 가져가서(claim) 사람 없이 끝까지 돌린다.
  1. 5단계: `tools/study-forge-mcp/chatgpt-parity.ts`의 `startRun` → `getNextStage` → `callModel` → `submitStage` 반복. 검사 실패 시 같은 단계 1회 재시도
  2. 요청 진행 기록: 기존 progress/finish API와 같은 기록 형식(모델, 시작·끝 시각, 입출력 해시, 재사용 출처)
  3. 출제: 브리지로 패킷 만들기 → `callModel`로 문제 문서 작성 → `validateDocument` + `inspectQuality` → 오류가 있으면 해당 블록만 1회 수정 → `record_problem_iteration`과 같은 기록
- `abilities`, `selectedObjectiveIds`(다시 만들기), `reuse`는 지금 요청 계약 그대로 따른다.
- 실행은 버튼 요청 안이 아니라 서버 뒤에서 한다. 로컬은 Next 서버 안에서 한 번에 하나씩 처리해도 된다.
- **안전장치**
  - 자료당 호출 수 상한(예: 5단계 + 출제 + 재시도 합계). 넘으면 멈추고 실패로 기록한다.
  - `usage_limit`이면 요청을 **"한도 대기"**로 두고 멈춘다. 실패로 처리하지 않는다. 사용자가 다시 시작하면 멈춘 단계부터 잇는다.
  - 호출마다 모델·토큰 사용량(돌려받는 경우)을 실행 기록에 남긴다.
- MCP 대화 경로는 그대로 둔다. 같은 요청을 두 실행자가 동시에 가져가지 않게 기존 claim 규칙을 쓴다.

## 4. 화면과의 약속 (Claude가 화면에서 쓸 것)
- `GET` 로그인 상태: `{ signedIn, email?, plan? }`, 로그인 시작 URL, 로그아웃
- 요청 상태에 `"usage-limit"`(한도 대기)와 사람이 읽을 안내 문구 추가
- 자동 실행기가 켜져 있는지: 켜져 있으면 화면이 "담당 AI 대화에서 처리해 주세요" 대신 "AI가 만드는 중"을 보여 준다.
- 다시 시작(한도 대기·실패 요청을 멈춘 단계부터 잇기)

## 완료 기준
- [ ] 0번 확인 결과(자격 조건, 모델, PDF 첨부, 오류 모양, 등록 방법)
- [ ] 가짜 공급자로 "읽기 시작 → 5단계 → 출제 기록 → 화면 준비됨"이 사람 개입 없이 이어지는 자동 테스트. 다시 만들기와 한도 대기 → 다시 시작 포함
- [ ] 토큰이 로그·기록·응답에 나오지 않는다는 확인(테스트 또는 검사)
- [ ] `npm run lint`, `npm run build`, 관련 `node --test` 결과
- [ ] 실제 호출 1회는 **사용자 확인 뒤** 한다. 걸린 시간과 사용량을 적는다.
