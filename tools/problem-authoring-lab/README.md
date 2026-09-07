# Problem Authoring Lab

격리된 1차 실험이다. 저장된 학습 내용은 그대로 두고, AI가 자유 블록 편집틀로 객관식 2개와 빈칸형 주관식 2개를 학교 시험지처럼 구성한 뒤 실제 렌더와 부분수정 루프를 거칠 수 있는지 확인한다. 제품 생성·렌더·학습 코드는 연결하지 않았다.

## 현재 범위

- 입력: 기존 과학 평가 결과에서 복사한 `learningUnitId`, 목표, 성공 기준, 원문과 출처 4개
- 출력: 자유 배치 블록 문서, 안정 문항·응답·선지 ID, 채점 계약, 정답 전·후 HTML
- 제작 지침: [`skill/problem-authoring/SKILL.md`](skill/problem-authoring/SKILL.md)와 객관식·빈칸형 초기 가설
- 수정: 블록 또는 응답 계약 단위의 `replace`만 허용하며 ID 변경은 거부
- 반복: mock 하네스는 최대 1회 수정한다. 실제 MCP 평가의 모델 호출·턴 상한은 평가 담당이 기록한다.
- 상태 `ready-for-independent-review`는 계약 검사와 mock 검사 완료만 뜻하며 품질 합격을 뜻하지 않는다.

객관식과 빈칸형은 첫 시험 범위일 뿐 닫힌 유형 목록이 아니다. 블록의 새로운 조합도 인출 목표, 명확성, 정답 연결과 실제 화면을 기준으로 평가한다. 참신함 자체는 성공 기준이 아니다.

## MCP 우선 실행 계약

서버 실행:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/problem-authoring-lab/mcp-server.ts
```

MCP 도구 순서:

1. `load_source_packet`: 고정된 4개 원문·목표 입력을 읽는다.
2. `get_authoring_instructions`: 공통 스킬과 객관식·빈칸 제작 지침을 읽는다.
3. AI가 `problem-authoring-v1` 블록 문서를 직접 작성한다.
4. `validate_problem_document`: ID·출처·응답 연결·페이지 경계를 검사한다. 내용을 고치지 않는다.
5. `render_problem_preview`: 정답 전과 정답 공개 HTML을 모두 반환한다.
6. AI가 두 화면을 실제로 확인하고 문제번호, 지문, 보기 상자, 선지, 빈칸, 정렬, 여백, 가독성, 정답 노출을 검사한다.
7. `record_problem_iteration`으로 실제 모델·세션·사용량·도구 호출과 문서·두 렌더·검사·패치를 기록한다.
8. 문제가 있으면 `apply_problem_patch`로 특정 블록/응답만 바꾸고 4~7을 반복한다.

MCP 성공 보고에는 서버 이름, 실제 모델명, 세션/실행 ID, input hash, skill version/hash, 도구 호출 기록, 최초·수정후 문서와 렌더, 검사 이슈, 패치, 수정 횟수, 사용량을 남긴다. 모델명을 확인할 수 없으면 추정하지 말고 `unknown`으로 기록한다. 자체 검사 통과는 독립 품질평가 통과가 아니다.

API 시험은 MCP 결과를 기획팀2가 확인한 뒤 별도로 허가할 때만 시작한다. 현재 API 어댑터와 API 호출은 없다.

현재 열린 Codex Desktop 세션은 새 stdio 서버를 hot-load하지 않는다. 기존 설정을 바꾸지 않고 평가용 새 Codex CLI 세션에만 MCP를 노출하려면 다음과 같이 실행한다. 아래 `PROMPT`에는 위 도구 순서를 따르고 4문항만 만든 뒤 최대 1회 부분수정하라는 평가 프롬프트를 넣는다.

```powershell
$codexExe = 'C:\Users\jkh01\AppData\Local\OpenAI\Codex\bin\8e5b6932251c2c1c\codex.exe'
& $codexExe `
  -c 'mcp_servers.problem_authoring_lab.command="node"' `
  -c 'mcp_servers.problem_authoring_lab.args=["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON","C:\\Users\\jkh01\\.codex\\worktrees\\778b\\CD0625\\tools\\problem-authoring-lab\\mcp-server.ts"]' `
  exec --ephemeral -C 'C:\Users\jkh01\.codex\worktrees\778b\CD0625' PROMPT
```

같은 override로 실행한 `codex ... mcp list`에서 `problem_authoring_lab`가 `enabled`로 인식되는 것을 확인했다. 이 방식은 `~/.codex/config.toml`을 수정하거나 기존 MCP 등록을 덮어쓰지 않는다. 새 CLI 프로세스의 실제 모델·reasoning 설정은 평가 담당이 명시하고 기록해야 한다.

### 현재 호스트에서 확인된 실행 blocker

2026-09-07 확인 결과 PATH의 CLI는 `codex-cli 0.101.0`이지만, Codex 앱에 `C:\Users\jkh01\AppData\Local\OpenAI\Codex\bin\8e5b6932251c2c1c\codex.exe` 버전 `0.153.4`가 이미 설치되어 있다. 평가에는 이 앱 번들 CLI 절대경로를 사용한다. 두 CLI의 `login status`는 모두 `Not logged in`이다.

첫 평가 시도에서는 모델 요청과 CLI 자동 재연결이 발생했지만 Responses transport 오류로 중단됐고, 모델 응답·문항·실제 MCP 도구 호출은 0회였다. 미인증 상태와 transport 오류는 각각 확인된 사실이지만, 인증 전 결과만으로 transport 오류의 원인을 인증으로 확정하지 않는다. 앱 번들 CLI에서 공식 ChatGPT 로그인을 완료한 뒤 연결을 다시 검증해야 한다.

```powershell
& $codexExe --version
& $codexExe login status
```

CLI 업데이트는 현재 재개 조건이 아니다. 로그인은 이 실험이 자동으로 수행하지 않는다. API 키나 토큰을 복사하는 fallback, 다른 모델로의 임의 대체, API 경로 선행도 허용하지 않는다.

## 오프라인 확인

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tools/problem-authoring-lab/problem-authoring-lab.test.ts
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/problem-authoring-lab/run-mock.ts tools/problem-authoring-lab/runs/mock
```

두 번째 명령은 `manifest.json`, iteration별 문서·검사·패치, 정답 전·후 HTML을 만든다. mock 산출물은 도구 동작 확인용이며 AI 제작 품질 증거가 아니다.

## 제품 연결이 필요할 때

제품 쪽 최소 입력은 현재 `LearningUnit/KnowledgeUnit`에서 이미 가진 내용·목표·성공 기준·원문 출처다. 최소 출력은 안정 `questionId/responseId`, 자유 블록 문서, 정답·채점 계약이다. 실제 답안 기록·다시 풀기 연결은 이 1차 실험의 완료 조건이 아니며 공용 타입과 제품 렌더러를 바꾸기 전에 별도 합의가 필요하다.
