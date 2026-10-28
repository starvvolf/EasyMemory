# 작업지시 07: ChatGPT 계정으로 생성 (자동 실행기)

- **근거**: `docs/DECISIONS.md`의 "2026-09-30 · ChatGPT 계정으로 생성"
- **브랜치**: `claude/local-state-20260928` (PR starvvolf/EasyMemory#1)
- **목표**: 사용자가 "ChatGPT로 로그인"한 뒤 되짚기에서 **읽기 시작**을 누르면, 사람이 GPT 대화에 말을 걸지 않아도 앱이 5단계와 출제 기록까지 끝낸다. 사용량은 그 사용자의 ChatGPT 플랜에서 나간다.
- **나눠 맡기**: Claude가 호출 층, 자동 실행기, 화면, 가짜 모델 테스트를 먼저 끝냈다(아래 "Claude가 끝낸 것"). **GPT는 "GPT가 할 것"만 하면 된다.** 핵심은 `chatgpt` 공급자 한 곳을 채우는 것이다.
- **지켜야 할 것**
  - **실제 모델 호출은 사용자 확인 뒤에만 한다.** 개발과 확인은 가짜 공급자로 한다.
  - 토큰은 서버에만 둔다. 화면·로그·실행 기록·저장소에 남기지 않는다.
  - 되짚기 화면(`src/app/study/`)은 Claude가 맡는다. 화면이 더 필요하면 결과보고에 적는다.
  - 공용 계약을 바꾸면 결정 기록에 남긴다.

## Claude가 끝낸 것

| 파일 | 내용 |
|---|---|
| `src/lib/ai/model.ts` | `callModel({purpose, system, user, json, model, effort, caller})` 하나로 부른다. 공급자는 `STUDY_FORGE_MODEL_PROVIDER` 값으로 고른다: `chatgpt`(기본, **지금은 빈 틀**), `codex`(로컬 Codex, 호출마다 새 스레드), `fake`(테스트). 오류 코드는 `login_required`, `usage_limit`, `transient`, `invalid_output`, `not_configured` |
| `src/lib/study/auto-executor.ts` | 자동 실행기다. 요청 claim → 5단계(`startRun`/`getNextStage`/`callModel`/`submitStage`, 검사 실패 시 오류를 붙여 1회 재시도) → 요청 진행 기록 → 출제 패킷 → 출제 → 검사 → 오류가 있으면 1회 수정 → `record_problem_iteration`과 같은 기록 순서로 돈다. 다시 만들기(reuse)는 학습 설계까지 모델 호출 없이 복사한다. 호출 수 상한은 14회다 |
| `src/app/api/study-executor/route.ts` | `GET ?id=` → `{enabled, provider, model:{ready,message}, executor}`, `POST {requestId}` → 대기열에 넣거나 멈춘 요청을 이어서 시작한다. 로컬 실험 모드 전용이고, `STUDY_FORGE_AUTO_EXECUTOR=1`일 때만 켜진다 |
| 공용 로직 추출 | `tools/study-forge-mcp/authoring-packet.ts`(`prepareAuthoringPacket`), `tools/problem-authoring-lab/authoring-io.ts`(지침 읽기, 검사, 반복 기록), `ChatGptParityService.stageRecord`. MCP 도구도 같은 함수를 쓴다 |
| 화면 | 요청을 만들면 자동으로 시작한다. 상태를 보여 준다: 대기 → 만드는 중 n/6 → 검사 중 → 준비됨. "잠시 멈춤"(한도, 로그인 필요, 서버 재시작)이면 **다시 시작** 버튼이 나온다. 자동 실행기가 꺼져 있으면 기존 MCP 대화 안내 그대로다 |
| `next.config.ts` | 서버에서 PDF 글자를 읽도록 `serverExternalPackages: ["pdfjs-dist"]`를 넣었다. 빌드 때 경고가 나오지만 무해하다. 화면 쪽 pdf.js 워커 import가 외부화 대상에서 빠진다는 경고다 |
| 테스트 | `src/lib/study/auto-executor.test.ts`: 가짜 모델로 한도 멈춤 → 다시 시작 → 5단계 → 정답 새는 문서 → 1회 수정 → 기록까지 확인한다. 다시 만들기(3단계 재사용), 요청·실행 검증 통과(`executionRequestStatus: completed`), 서버 재시작 시 "interrupted" 표시, claim 토큰 비노출도 확인한다 |

### 상태 파일
- 위치는 `.study-forge-data/study-executor/<requestId>.json`이다.
- status 값은 `queued | running | paused-usage-limit | paused-login | interrupted | failed | done`이다.
- claim 토큰은 이 파일에만 있고 API 응답에서는 뺀다.

### 입력 방식 (지금 구현)
- 모델에는 **쪽별 추출 글자**를 보낸다. 5단계 중 analyze, learning-design, cards 단계에만 보낸다. 쪽당 3,500자, 합계 60,000자까지다. PDF 파일 자체는 첨부하지 않는다.
- 원문 인용 검사가 글자 기준이라 이 방식으로 시작했다. 공식 문서에서 PDF 첨부가 된다고 확인되면 GPT가 판단해 바꿔도 된다.
- 출제 지시문은 SKILL.md, 방법 참고 문서, 문서 JSON 형식 요약으로 이루어진다. 형식 요약은 `AUTHORING_FORMAT`에 있다. abilities에 따라 방법 참고 문서를 고른다.

## GPT가 할 것

### 0. 공식 문서 확인
확인 결과를 결과보고 맨 앞에 적는다.
- Sign in with ChatGPT의 **오픈소스 흐름 등록 방법**: 클라이언트 등록, 돌아올 주소(redirect), 로컬(127.0.0.1) 허용 여부, 범위(scope)
- **"자격 있는 Responses API 요청"의 조건**: 쓸 수 있는 모델(지금 `gpt-6-sol`/`astra`/`luna`), 추론 강도, 구조화 출력 지원 여부
- PDF 파일 첨부 가능 여부
- 한도 초과·토큰 만료 때 돌아오는 오류의 모양
- 참고: [Sign in with ChatGPT](https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt), [Using your ChatGPT plan in other apps](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites), [Authentication](https://learn.chatgpt.com/docs/auth)

### 1. 로그인과 토큰
- 서버에 OAuth 시작·콜백 경로를 만든다. 토큰은 사용자별로 서버에 둔다.
  - 로컬: `.study-forge-data/` 아래에 두고 파일 권한을 `0o600`으로 제한한다.
  - 배포: 서버 저장소에 암호화해 둔다.
- 만료 전에 갱신한다. 실패하면 `ModelError("login_required")`를 던진다.
- 로그아웃하면 토큰을 지운다.
- 경로를 새로 만들면 `src/lib/local-experiment-mode.ts`의 `isLocalExperimentApiPath`에 추가해야 로컬 실험 모드에서 열린다.

### 2. `chatgpt` 공급자 채우기 (`src/lib/ai/model.ts`의 `chatgptBackend`)
- `status(caller)`: 로그인했으면 `{ready: true, message, account:{email, plan}}`를 돌려준다. 안 했으면 `ready: false`에 로그인 안내 문구를 담는다. 화면은 `ready`와 `message`만 쓴다.
- `call(request)`: 호출자(`caller.uid`)의 토큰으로 Responses API를 부른다.
  - `system`은 instructions로, `user`는 input으로 보낸다.
  - `json: true`면 JSON 응답을 요청한다.
  - `{text, model, usage}`를 돌려준다. JSON 파싱은 `callModel`이 한다.
- 오류는 다음처럼 매핑한다.
  - 한도 초과 → `usage_limit`: 실행기가 "잠시 멈춤"으로 두고 실패 처리하지 않는다.
  - 토큰 없음·만료 → `login_required`
  - 그 밖의 오류 → `transient`
- 매 호출은 독립이다. 앞 단계 결과는 실행기가 입력에 넣어 준다.

### 3. 확인
- 화면에 "로그인" 버튼이 필요하면 로그인 시작 URL과 로그아웃 경로를 결과보고에 적는다. 버튼은 Claude가 단다.
- **실제 호출 1회는 사용자 확인 뒤에** 한다. 짧은 범위(1~2쪽)로 `STUDY_FORGE_AUTO_EXECUTOR=1`을 켜고 읽기 시작부터 준비됨까지 돌린다. 걸린 시간, 호출 수, 사용량을 적는다. 실패하면 멈춘 단계와 오류 코드를 적는다.

## 완료 기준
- [ ] 0번 확인 결과(자격 조건, 모델, PDF 첨부, 오류 모양, 등록 방법)
- [ ] 로그인 → `GET /api/study-executor`의 `model.ready`가 true로 바뀐다
- [ ] 토큰이 로그·기록·응답에 나오지 않는다는 확인(테스트 또는 검사)
- [ ] `npm run lint`, `npm run build`, `node --test src/lib/study/*.test.ts`
- [ ] 사용자 확인 뒤 실제 호출 1회 결과

## 실행 방법 (로컬)
```
STUDY_FORGE_LOCAL_EXPERIMENT=1 STUDY_FORGE_LOCAL_EXPERIMENT_BIND=127.0.0.1 \
STUDY_FORGE_AUTO_EXECUTOR=1 STUDY_FORGE_MODEL_PROVIDER=chatgpt npm run dev -- -H 127.0.0.1
```
- 로컬 Codex로 대신 돌리려면 `STUDY_FORGE_MODEL_PROVIDER=codex`로 바꾼다. 이 경우에도 실제 호출이므로 사용자 확인이 필요하다.
- 가짜 모델 테스트는 `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test src/lib/study/auto-executor.test.ts`로 돌린다.

## 후속 (Claude, 2026-09-30)
- 되짚기 **자료 만들기** 화면에 연결 줄을 달았다. 연결 전에는 "ChatGPT 연결" 버튼이, 연결 뒤에는 "연결 해제" 버튼이 보인다. "잠시 멈춤" 안내에도 연결 버튼이 붙는다. 로그인을 마치고 `/study?chatgpt=…`로 돌아오면 결과를 알려 준다.
- `Study Forge 로컬 열기.cmd`로 실행하면(`scripts/run-local-experiment.mjs`) 자동 실행기와 `chatgpt` 공급자가 기본으로 켜진다. 끄려면 `STUDY_FORGE_AUTO_EXECUTOR=0`으로 설정한다.
- 토큰 암호화 키가 없으면 실행 파일이 만들어 둔다. 키는 사용자 홈의 `.study-forge/chatgpt-token-key`에 둔다. 토큰이 있는 프로젝트 폴더와는 다른 곳이다.
