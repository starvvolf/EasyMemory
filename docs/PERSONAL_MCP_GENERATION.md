# 개인 테스트용 MCP 생성 엔진

## 무엇이 달라지는가

현재 Study Forge 앱의 Codex App Server 경로는 그대로 유지합니다. ChatGPT 첨부 PDF를 처리하는 MCP 비교 경로는 다음 구조를 실행합니다.

`원문 목차 추출 → Concept Tree → Learning Design → Assessment & Activity Design → Cards + 검수`

ChatGPT는 각 단계에서 짧은 자연어 목차·트리·블록만 작성합니다. MCP 서버는 이를 파싱해 ID, 부모·자식, 원문 목차 연결, Learning Objective, Knowledge Unit, Assessment Blueprint, 지원 문제 형식과 카드 JSON을 조립하고 검증해 로컬에 저장합니다. MCP 서버 내부에서는 OpenAI API나 Codex App Server를 호출하지 않습니다.

예전 `Analyze → Plan → Prepare → Activity Design → Cards` 경로와 `get_next_stage` 계열 도구는 기존 run을 읽기 위한 호환 기능으로만 남긴다. 새 비교 실행에는 사용하지 않는다.

## ChatGPT 첨부 PDF 비교 경로

기존 Codex App Server는 그대로 유지한다. MCP 기본 경로에서는 ChatGPT 대화에 직접 첨부한 PDF를 ChatGPT가 읽고 최신 Study Forge 계약의 결과를 작성한다.

```text
ChatGPT에 PDF 첨부
  -> start_chatgpt_pdf_run
  -> 원문 목차만 추출
  -> 사용자 원문 목차 선택(선택 사항)
  -> Concept Tree
  -> Learning Design: 트리 묶기·나누기 + 학습목표
  -> Assessment & Activity Design: 문제 설계 + 앱 형식 배정
  -> Cards + 원문 대조 검수
  -> get_chatgpt_pdf_result
  -> 사용자 승인
  -> publish_chatgpt_pdf_run
```

ChatGPT 첨부 PDF의 바이너리나 OpenAI 내부 file ID가 로컬 MCP 서버로 자동 복사되는 구조는 아니다. PDF는 현재 ChatGPT 대화의 모델 입력으로 남고, MCP 서버는 파일명·설정·단계별 구조화 산출물만 받는다. 따라서 실제 추론 주체는 PDF가 첨부된 ChatGPT 모델이며 MCP 서버는 다음만 담당한다.

- 첫 단계의 작은 목차 초안을 앱용 원문 목차 구조로 조립
- 단계 순서와 자연어 블록 형식 검증
- 원문 목차 선택 범위 검증
- Concept Tree의 ID·부모·순서·페이지·원문 목차 연결 조립
- Learning Objective와 Knowledge Unit 연결 조립
- Assessment Blueprint와 현재 앱 문제 형식 연결 조립
- Blueprint와 Card의 1:1 연결 및 문제 형식 검증
- 단계별 소요 시간과 최종 결과 저장
- 사용자 승인 후 기존 Study Forge 덱 가져오기 공간에 발행

최종 카드와 덱은 앱이 현재 사용하는 Zod 스키마와 서버 조립 함수를 재사용한다. 최종 결과에는 `engine: chatgpt-mcp`가 기록되어 기존 결과와 구분된다.

ChatGPT에서는 다음 순서로 사용한다.

1. PDF를 현재 대화에 첨부한다.
2. `start_chatgpt_pdf_run`에 첨부 파일명, 학습목표와 추가 지시를 전달한다. 재호출 가능성이 있으면 같은 `clientRequestId`를 사용해 중복 run 생성을 막는다.
3. 반환된 `stageInput.instructions`와 `outputContract`에 맞춰 첨부 PDF를 직접 읽고 결과를 만든다.
4. `submit_chatgpt_pdf_stage`로 현재 단계 결과를 제출한다.
5. 목차 추출 뒤 선택 범위를 바꾸려면 `configure_chatgpt_pdf_run`을 호출한다. 바꾸지 않으면 전체 말단 목차를 사용한다.
6. 완료될 때까지 반환된 다음 단계를 처리하고 `get_chatgpt_pdf_result`로 카드와 단계별 시간을 검토한다.
7. 사용자가 명시적으로 승인한 뒤에만 `publish_chatgpt_pdf_run`을 호출한다.

이 비교 경로는 별도 OpenAI API 호출이나 Codex App Server 호출을 하지 않는다.

첫 단계에서 ChatGPT가 제출하는 값은 `outlineText` 문자열 하나뿐이다. 파일은 `@file 파일명`, 계층은 `#` 개수, 페이지는 제목 끝의 `[페이지]` 또는 `[시작-끝]`으로 표시한다. ID, 부모 연결, 순서, sourceRefs와 앱이 요구하는 나머지 필드는 MCP 서버가 결정적으로 생성한다. 요약, 핵심 개념, 중요도와 관계 설명은 첫 단계에서 생성하지 않는다.

그다음 세 단계도 각각 `treeText`, `learningDesignText`, `activityDesignText` 문자열 하나만 제출한다. Concept Tree는 들여쓰기된 개념어와 관계·페이지를 쓰고, Learning Design은 `--- LEARNING n ---`, 문제 설계는 `--- DESIGN n ---` 경계로 짧은 한국어 항목을 쓴다. 모델은 앱 ID나 Blueprint JSON을 직접 작성하지 않는다.

Cards 단계도 실제 문제는 `cardsText` 문자열로 제출한다. 각 문제는 `--- CARD n ---`으로 나누고 유형, 질문, 정답, 해설, 근거만 쓴다. 객관식 선택지와 구조·순서 항목만 글머리표를 사용한다. MCP 서버가 blueprint 연결, 앱 ID, 전략, 난이도, 자동채점 필드, 구조 노드와 지원 풀이 방식을 조립한다. 현재 지원 형식은 플래시카드, 일반 빈칸, OX, 객관식, 순서복원, 구조복원이다. 내부 활동은 `structure_recall`로 공유하지만 Assessment 단계에서 `sequence`와 `hierarchy`를 확정해 Cards 단계에 각각 순서복원과 구조복원으로 전달한다.

근거 문구는 해당 Knowledge Unit의 `sourceText`에서 실제로 확인되어야 한다. 형식 오류나 근거 불일치는 카드 번호가 포함된 오류로 거부된다. 첫 Cards 제출의 블록은 임시 초안으로 보존되므로 이후에는 오류가 난 `CARD n` 블록만 같은 번호로 다시 제출할 수 있다. 순환형 순서에서는 시작 상태가 마지막에 다시 등장하는 동일 라벨을 허용하지만 계층 구조의 중복 라벨은 거부한다.

Activity Design 결과에서 한 학습대상의 설계가 모두 proxy 또는 unsupported로 제외되면 MCP가 그 대상의 핵심 원리·판단 절차를 묻는 플래시카드 scaffold 하나로 자동 보정한다. 따라서 지원 불가 설계를 억지로 발행하지 않으면서도 학습대상 전체가 카드 없이 사라지는 것을 막는다.

```text
@file deadlock.pdf
# Chapter 8. Deadlocks [1-14]
## What is deadlock? [3]
## Deadlock Characterization [4-7]
### Four conditions [5]
```

## 실행

프로젝트 폴더에서 다음 명령을 실행합니다.

```powershell
npm.cmd run mcp:study-forge
```

웹앱과 MCP를 서로 다른 폴더에서 실행한다면 두 프로세스에 같은 데이터 경로를 지정해야 합니다.

```powershell
$env:STUDY_FORGE_DATA_DIR="C:\study-forge-data"
npm.cmd run mcp:study-forge
```

MCP는 일반 Node로 실행합니다. `--conditions=react-server` 같은 추가 조건은 붙이지 않습니다.

기본 주소는 다음과 같습니다.

- MCP: `http://127.0.0.1:3210/mcp`
- 상태 확인: `http://127.0.0.1:3210/health`

포트를 바꾸려면 실행 전에 `STUDY_FORGE_MCP_PORT` 환경 변수를 설정합니다.

## ChatGPT 연결 전 로컬 검사

전체 오프라인 검사는 다음 한 줄로 실행합니다.

```powershell
npm.cmd run mcp:study-forge:test
```

이 검사는 다음을 확인합니다.

- 기존 도구와 ChatGPT 첨부 PDF 비교 도구가 조회되고 호출되는지
- 웹앱 프로젝트의 여러 PDF를 ID로 선택하고 원본을 복제하지 않는지
- 원본 체크섬과 분석 캐시가 같은 PDF에 연결되는지
- OPIc 고정 자료가 다섯 단계를 끝까지 통과하는지
- 네트워크와 OpenAI API 호출이 없는지
- 잘못된 결과가 저장 전에 거부되는지
- 기존 artifact 파일을 덮어쓰지 않는지
- lineage, 입력 checksum, 원문 checksum이 기록되는지

서버를 실행한 상태에서 브라우저로 `http://127.0.0.1:3210/health`를 열어 `ok: true`도 확인할 수 있습니다. MCP Inspector가 필요하면 다음 명령으로 Streamable HTTP 주소 `http://127.0.0.1:3210/mcp`를 검사합니다.

```powershell
npx @modelcontextprotocol/inspector@latest
```

## 제공 도구

- `list_projects`: 웹앱의 학습 프로젝트 목록 조회
- `get_project`: 프로젝트의 PDF source ID, checksum, 분석 유무 조회
- `list_materials`: 예전 고정 fixture/material을 조회하는 읽기 전용 호환 도구
- `get_next_stage`: 새 run을 시작하거나 기존 run의 다음 단계와 축약 입력 조회
- `submit_next_stage_result`: run ID만 받아 stage, checksum과 lineage를 서버가 계산하고, 검증·저장한 뒤 다음 단계 입력까지 반환
- `get_run_status`: 완료 단계, artifact lineage와 성공·실패 제출 이력 조회
- `get_run_result`: 완료된 카드 본문 조회
- `publish_run_to_deck`: 승인한 완료 run을 Study Forge 덱 가져오기 공간에 발행
- `start_chatgpt_pdf_run`: 현재 ChatGPT 대화에 첨부한 PDF의 비교 run 시작
- `reuse_chatgpt_pdf_analyze_output`: 빈 새 run의 Analyze에 기존 완료 artifact를 해시 검증 후 그대로 채택. 현재 승인된 로컬 PDF 두 개의 단일 파일 Analyze만 지원하며, 새 AI Analyze 실행으로 기록하지 않음
- `configure_chatgpt_pdf_run`: Analyze 뒤 사용할 원문 목차 말단 항목 선택
- `get_chatgpt_pdf_next_stage`: 비교 run의 다음 단계 계약 조회
- `submit_chatgpt_pdf_stage`: ChatGPT가 작성한 현재 단계 결과 검증·저장
- `get_chatgpt_pdf_result`: 최종 설계, 카드와 단계별 시간 조회
- `publish_chatgpt_pdf_run`: 승인한 ChatGPT 비교 결과를 Study Forge 덱으로 발행
- `list_chatgpt_pdf_runs`: 비교 run의 active/completed/published/cancelled 상태 조회
- `cancel_chatgpt_pdf_run`: 미완료 run을 삭제하지 않고 취소 상태로 전환

`start_chatgpt_pdf_run.stopAfterStage`를 지정하면 그 단계가 저장된 뒤 다음 단계의 결과 제출을 받지 않는다. 기본값은 `cards`다. Analyze 출력 재사용은 새 run을 시작한 다음 `reuse_chatgpt_pdf_analyze_output`에 원본 run ID·run 파일 SHA-256·Analyze artifact SHA-256·현재 승인 로컬 PDF SHA-256을 전달한다. MCP는 파일명·페이지 수와 네 해시/자료 조건을 확인하고 새 run의 `stageReuse.analyze`에 출처를 남긴다. 기존 run은 변경하지 않는다. 과거 run에는 PDF 바이트 해시가 자체 보존되지 않았으므로, 현재 고정 파일의 검증을 과거 생성 시점의 PDF 바이트 증명으로 과장하지 않는다. 다른 단계나 입력만 재사용하는 도구는 아직 없다.

이전의 `get_stage_input`과 `submit_stage_result` 저수준 도구는 MCP 공개 목록에서 제거했습니다. 서비스 내부 함수는 오프라인 검사에 사용하지만 ChatGPT는 ID, stage와 checksum을 직접 복사하지 않습니다.

쓰기 도구는 기존 source나 artifact를 덮어쓰지 않습니다. `publish_run_to_deck`에는 `confirmPublish: true`가 필요합니다. 도구의 실제 효과는 OpenAI 공식 MCP 안내에 맞춰 annotations로 표시하며 모든 쓰기는 로컬 저장소에만 적용합니다.

`get_next_stage`가 반환하는 `stageInput.validationGuidance`에는 다음 정보가 포함됩니다.

- Zod 입력 계약에서 추출한 정확한 enum 허용값
- 단계별 ID, 출처, 부모·자식 연결과 1:1 개수 규칙
- Prepare에서 실제 `apply` 목표를 렌더러 사정 때문에 `recall`로 낮추지 말아야 한다는 규칙
- Activity Design에서 사용하는 현재 렌더러별 capability
- exact, scaffold, proxy, unsupported 판정 규칙과 자동 생성 포함 정책
- Cards에서 앞 단계의 형식, 출처, objective와 blueprint 연결을 유지하는 규칙

Activity Design의 `supportLevel`과 `assessmentLevel`은 제출 문자열을 그대로 신뢰하지 않습니다. 서버가 blueprint와 실제 렌더러 capability로 다시 계산합니다. 따라서 모델은 추천 라벨로 통과를 강제하지 말고 `validationGuidance.activitySupport`를 읽은 뒤 blueprint 자체를 지원 가능한 형태로 설계해야 합니다.

Activity Design은 LearningUnit별 `recommendations`만 제출할 수도 있습니다. objectives, blueprints, support assessments와 정책을 생략하면 기존 생성엔진이 파생하고 같은 검증을 적용합니다. 세부 blueprint를 직접 설계해야 할 때만 전체 계약을 작성합니다.

뒤 단계는 전체 prior artifact를 반복하지 않습니다. Activity Design은 선택된 LearningUnit만 받습니다. Cards는 LearningUnit, recommendation, objective와 blueprint에서 카드 작성에 필요한 값만 합친 `cardTasks`를 받습니다. 실제 12개 LearningUnit Deadlocks run에서 Cards payload는 35.4KB에서 22.7KB로 36% 줄었습니다. 전체 artifact는 서버가 검증과 lineage를 위해 보관합니다.

## 저장 위치와 규칙

- 프로젝트 메타데이터: `$STUDY_FORGE_DATA_DIR/projects.json`
- 원본 PDF: `$STUDY_FORGE_DATA_DIR/sources/<source-id>.pdf`
- 실행 결과: `$STUDY_FORGE_DATA_DIR/mcp/runs/<run-id>/`
- 덱 발행 묶음: `$STUDY_FORGE_DATA_DIR/mcp/published/*.json`
- 예전 material fixture: `tools/study-forge-mcp/data/materials/*.json` (읽기 전용)

각 제출은 고유한 artifact ID로 저장됩니다. 같은 단계를 다시 제출해도 기존 artifact를 덮어쓰지 않습니다. artifact에는 바로 앞 단계 artifact ID, 원문 SHA-256 checksum, 단계 입력 checksum과 결과 checksum이 기록됩니다.

PDF 등록은 웹앱의 프로젝트 자료함이 담당합니다. MCP는 선택한 `projectId + sourceIds`로 canonical 원본을 읽어 페이지별 `[PDF N쪽]` 텍스트를 만들고, 실제 바이트 checksum이 등록값과 같은지 확인합니다. 원본 PDF를 MCP 폴더로 복사하지 않습니다. 이미지 PDF의 OCR은 아직 지원하지 않습니다.

실패한 제출도 run의 `attempts`에 stage, 시각, input checksum과 검증 오류를 남깁니다. 거부된 결과 본문은 artifact로 저장하지 않습니다.

## 가장 짧은 사용 흐름

웹앱 프로젝트에 등록한 PDF를 쓰는 기존 5단계 경로는 ChatGPT에 다음처럼 요청합니다.

```text
이 PDF로 운영체제 시험 대비 문제를 만들어줘.
Study Forge 다섯 단계를 완료하고 최종 카드를 보여줘.
내가 승인하기 전에는 덱으로 발행하지 마.
```

ChatGPT는 다음 순서로 실행합니다.

1. `list_projects`와 `get_project`로 프로젝트 및 PDF를 고릅니다.
2. `get_next_stage`에 `projectId`, `sourceIds`, 학습 목표와 카드 모드를 주어 run과 Analyze 입력을 받습니다.
3. 결과를 작성해 `submit_next_stage_result`에 제출합니다.
4. 함께 반환된 다음 단계 입력으로 Plan부터 Cards까지 반복합니다.
5. `get_run_result`로 최종 카드를 보여줍니다.
6. 사용자가 승인한 경우에만 `publish_run_to_deck`을 호출합니다.
7. Study Forge 웹 화면을 새로고침하면 발행된 덱이 기존 IndexedDB에 한 번만 들어오고 학습할 수 있습니다.

현재 ChatGPT 대화에 PDF를 직접 첨부해 새 MCP 경로로 처리하려면 다음처럼 요청합니다.

```text
첨부한 PDF를 start_chatgpt_pdf_run으로 처리해줘.
Analyze → Concept Tree → Learning Design → Assessment & Activity Design → Cards 순서로 끝까지 진행하고,
각 단계는 반환된 계약에 맞춰 submit_chatgpt_pdf_stage로 저장해.
최종 결과와 단계별 시간을 보여주고 내가 승인하기 전에는 발행하지 마.
```

## 사용자가 ChatGPT에서 해야 할 일

이미 ChatGPT 데스크톱 앱의 MCP 목록에 `studyforge`가 보인다면 연결 설정을 새로 만들 필요는 없습니다.

도구가 바뀐 뒤에는 다음 한 번만 수행합니다.

1. 실행 중인 옛 MCP 서버를 종료하고 `npm.cmd run mcp:study-forge`로 다시 실행합니다.
2. ChatGPT의 MCP 서버 설정에서 `studyforge`의 도구를 새로고침하거나 다시 연결합니다.
3. 새로고침 메뉴가 없다면 기존 `studyforge` 연결을 제거한 뒤 같은 `http://127.0.0.1:3210/mcp` 주소로 다시 추가합니다.
4. 새 대화에서 `studyforge`를 켜고 `get_next_stage`, `start_chatgpt_pdf_run`, `get_chatgpt_pdf_result`가 보이는지 확인합니다.

ChatGPT는 승인된 MCP 도구 목록의 스냅샷을 유지할 수 있으므로 새 채팅만 여는 것으로 도구 변경이 반영되지 않을 수 있습니다. 계정이나 앱 버전에 따라 메뉴 이름은 달라질 수 있습니다. 최신 연결 방식은 [OpenAI의 Developer mode와 MCP 안내](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-apps-in-chatgpt-beta)를 확인합니다.

## 아직 지원하지 않는 것

- 텍스트가 없는 이미지 PDF의 OCR 등록
- 이미지로만 된 PDF의 MCP 텍스트 추출/OCR
- 계정별 인증, 여러 사용자 동시 사용, 서버 동기화
- 기존 제품 생성 흐름을 MCP로 자동 전환하는 기능
- 공개 배포와 Plugin 심사
- 서술형·말하기 `apply` 응답의 자동 의미·발음 채점. 현재는 먼저 답한 뒤 뒷면과 비교하는 자기채점 scaffold입니다.

현재 범위는 개인 로컬 실험용입니다. 생성엔진은 IndexedDB를 직접 수정하지 않습니다. 승인된 덱 묶음을 만들면 학습 화면이 기존 `Deck` 계약으로 가져가는 방식으로 두 영역의 경계를 지킵니다.
