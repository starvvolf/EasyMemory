# Problem Authoring Lab

격리된 1차 실험이다. 저장된 학습 내용은 그대로 두고, AI가 자유 블록 편집틀로 객관식 2개와 빈칸형 주관식 2개를 학교 시험지처럼 구성한 뒤 실제 렌더와 부분수정 루프를 거칠 수 있는지 확인한다. 제품 생성·렌더·학습 코드는 연결하지 않았다.

## 현재 범위

- 입력: 기존 과학 평가 결과에서 복사한 `learningUnitId`, 목표, 성공 기준, 원문과 출처 4개
- 출력: 자유 배치 블록 문서, 안정 문항·응답·선지 ID, 채점 계약, 정답 전·후 HTML
- 제작 지침: [`skill/problem-authoring/SKILL.md`](skill/problem-authoring/SKILL.md)와 객관식·빈칸형 초기 가설
- 수정: 블록 또는 응답 계약 단위의 `replace`만 허용하며 ID 변경은 거부
- 그림: 원문 그림 `image`와 Python/Matplotlib로 재현한 로컬 SVG `generated-image`를 출처·해시 계약으로 구분
- 반복: mock 하네스는 최대 1회 수정한다. 실제 MCP 평가의 모델 호출·턴 상한은 평가 담당이 기록한다.
- 상태 `ready-for-independent-review`는 계약 검사와 mock 검사 완료만 뜻하며 품질 합격을 뜻하지 않는다.

객관식과 빈칸형은 첫 시험 범위일 뿐 닫힌 유형 목록이 아니다. 블록의 새로운 조합도 인출 목표, 명확성, 정답 연결과 실제 화면을 기준으로 평가한다. 참신함 자체는 성공 기준이 아니다.

## MCP 우선 실행 계약

서버 실행:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/problem-authoring-lab/mcp-server.ts
```

MCP 도구 순서:

1. `load_source_packet`: 고정 fixture 또는 검증된 Learning Design 브리지 패킷을 읽는다.
2. `get_authoring_instructions`: 공통 스킬과 객관식·빈칸 제작 지침을 읽는다.
3. AI가 `problem-authoring-v1` 블록 문서를 직접 작성한다.
4. `validate_problem_document`: ID·출처·응답 연결·페이지 경계를 검사한다. 내용을 고치지 않는다.
5. `render_problem_preview`: 정답 전과 정답 공개 HTML을 모두 반환한다.
6. AI가 두 화면을 실제로 확인하고 문제번호, 지문, 보기 상자, 선지, 빈칸, 정렬, 여백, 가독성, 정답 노출을 검사한다.
7. `record_problem_iteration`으로 실제 모델·세션·사용량·도구 호출과 문서·두 렌더·검사·패치를 기록한다.
8. 문제가 있으면 `apply_problem_patch`로 특정 블록/응답만 바꾸고 4~7을 반복한다.

MCP 성공 보고에는 서버 이름, 실제 모델명, 세션/실행 ID, input hash, skill version/hash, 도구 호출 기록, 최초·수정후 문서와 렌더, 검사 이슈, 패치, 수정 횟수, 사용량을 남긴다. 모델명을 확인할 수 없으면 추정하지 말고 `unknown`으로 기록한다. 자체 검사 통과는 독립 품질평가 통과가 아니다.

API 시험은 MCP 결과를 기획팀2가 확인한 뒤 별도로 허가할 때만 시작한다. 현재 API 어댑터와 API 호출은 없다.

## Analyze → Plan → Learning Design 연결 시험

제품 코드를 바꾸지 않고 현재 생성 엔진의 세 단계 결과를 문제 작성 입력으로 옮기는 결정론적 브리지가 있다. 입력 JSON은 `analyze`, 확정 `plan`, 카드 생성 전 `learningDesignResult`를 함께 담아야 한다. 브리지는 사람이 새 문제 내용을 쓰지 않으며, 목표·지식 단위·평가 설계·원문 출처 관계를 검사하고 그대로 보존한다.

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/problem-authoring-lab/run-learning-design-bridge.ts `
  tools/problem-authoring-lab/fixtures/learning-design-current-engine.json `
  tools/problem-authoring-lab/runs/learning-design-bridge-fixture
```

출력은 `source-packet.json`과 `bridge-report.json`이다. MCP에서는 `load_source_packet({ packetPath: "runs/learning-design-bridge-fixture/source-packet.json" })`처럼 읽는다. 경로는 이 실험의 `runs/<run-id>/source-packet.json`만 허용한다.

브리지는 objective의 target·operation·success criteria, KnowledgeUnit의 content·분류·근거·정확한 원문 필드, AssessmentBlueprint의 given·hidden·expected response·rubric·난이도·필요 역량, 연결된 Plan 목차의 source reference를 전달한다. Analyze·Plan·Learning Design 원본은 SHA-256으로 연결한다. Analyze 표시 메타데이터와 legacy outline point, Plan의 질문/개수 UI 필드, organizedMaterial 표시 문구는 작성 입력에 복제하지 않는다. 다만 지식 단위 coverage와 출처 관계는 변환 전에 검증한다.

현재 fixture는 기존 생성 계약 테스트의 데드락 자료를 재사용한 연결 검증용이다. 실제 PDF 품질, 실제 모델 출력, 여섯 문항 품질을 검증하지 않으며 authoring 모델도 호출하지 않는다. 비교 평가 담당은 지정 PDF를 실제 Analyze→Plan→Learning Design 경로로 한 번 실행해 같은 envelope로 저장한 뒤 브리지만 적용해야 한다. 사람 손으로 목표·지식 단위·문항을 중간에 새로 작성한 결과는 이 연결 시험의 증거가 아니다.

평가 담당이 실제 PDF로 세 단계를 한 번만 소유해 실행할 때는 아래 명령을 사용한다. 이 스크립트는 Analyze, 전체 자료 Plan, 현재 Learning Design을 순서대로 호출하고 `engine-artifact.json`, 브리지 패킷, 보고서를 같은 run에 기록한다. authoring 모델은 호출하지 않는다.

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/problem-authoring-lab/run-current-engine-learning-design.ts `
  --pdf <source.pdf> `
  --goal <공통-학습-목표> `
  --run-id <비교-run-id> `
  --model gpt-6-astra `
  --instruction <추가-범위-지시>
```

기본 모델은 `gpt-6-astra`, 추론 강도는 현재 엔진 설정인 `medium`이다. `--model`은 Analyze·Plan·Learning Design 세 단계에 같은 모델을 지정한다. 이 경로는 ChatGPT 구독으로 로그인된 현재 Codex 엔진을 사용하며 API 키를 요구하거나 API fallback을 하지 않는다. 브리지 runner 자체의 추가 재시도는 없고, 현재 엔진 provider가 더 이상 유효하지 않은 연결 스레드를 교체할 수 있는 기존 복구 동작만 유지한다.

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

한 문항 그래프 실험은 `load_source_packet({ packetId: "graph-one" })`로 고정 학습 내용을 읽고 아래 스크립트로 SVG와 재현 메타데이터를 먼저 만든다. 현재 호스트에서는 기존 `avalonbench` Python 환경의 Matplotlib 3.9.4를 사용하며 새 패키지를 설치하지 않는다.

```powershell
& 'C:\Users\jkh01\anaconda3\envs\avalonbench\python.exe' tools/problem-authoring-lab/graph-assets/generate_curve_line_svg.py --spec tools/problem-authoring-lab/fixtures/graph-one-spec.json --output tools/problem-authoring-lab/runs/graph-one-mcp/iteration-0/assets/curve-line-intersections.svg --metadata tools/problem-authoring-lab/runs/graph-one-mcp/iteration-0/assets/curve-line-intersections.meta.json --preview-png tools/problem-authoring-lab/runs/graph-one-mcp/iteration-0/assets/curve-line-intersections.preview.png
```

문서의 `generated-image`는 위 SVG를 `assets/curve-line-intersections.svg`로 참조하고, 메타데이터의 SVG·spec SHA-256과 generator 정보를 그대로 기록한다. SVG 안의 외부 리소스 참조는 허용하지 않는다.

기존 문항 내용과 ID를 그대로 둔 채 렌더러 변경만 비교할 때는 다음 명령을 사용한다. 원본 산출물은 덮어쓰지 않고 별도 디렉터리에 같은 `document.json`과 새 HTML을 저장한다.

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/problem-authoring-lab/rerender-existing.ts <document.json> <output-directory> [renderer-revision]
```

## 글꼴 자산

HTML은 런타임 CDN 없이 로컬 `assets/fonts/pretendard-1.3.9/PretendardVariable.woff2`를 실제 웹폰트로 사용한다. `font-weight: 45 920` 범위를 가진 공식 Pretendard v1.3.9 가변 WOFF2이며, 본문은 400, 보조 위계는 600, 제목은 700을 기본값으로 사용한다. 브라우저가 파일을 읽지 못하는 경우에만 운영체제 한글 sans-serif stack으로 대체된다. 재배포 조건은 같은 디렉터리의 `LICENSE.txt`에 보존했다.

## 제품 연결이 필요할 때

제품 쪽 최소 입력은 현재 `LearningUnit/KnowledgeUnit`에서 이미 가진 내용·목표·성공 기준·원문 출처다. 최소 출력은 안정 `questionId/responseId`, 자유 블록 문서, 정답·채점 계약이다. 실제 답안 기록·다시 풀기 연결은 이 1차 실험의 완료 조건이 아니며 공용 타입과 제품 렌더러를 바꾸기 전에 별도 합의가 필요하다.
