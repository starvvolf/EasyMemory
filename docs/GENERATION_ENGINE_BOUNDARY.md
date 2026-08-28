# 생성 엔진과 학습 루프 경계

## 한 문장 책임

- 생성 엔진: PDF·텍스트와 사용자가 확정한 선택을 받아 분석 결과, `LearningUnit`, 카드와 품질 검사 결과를 반환한다.
- 학습 루프: 사용자가 자료를 넣고 결과를 확인·수정·저장한 뒤 실제로 학습하는 흐름을 담당한다.

## 현재 경계

생성 엔진은 서버의 `src/lib/pipeline/**`를 중심으로 한다. `src/app/api/**/route.ts`는 기존 HTTP 주소를 유지하면서 해당 pipeline 모듈의 `POST`만 노출한다.

학습 루프는 `src/app/page.tsx`, 사용자 화면 컴포넌트, `src/lib/storage.ts`, `src/lib/study-*.ts`를 중심으로 한다. 파일 선택, 학습 영역과 문제 방식 확정, 생성 결과 편집, 덱 저장과 학습 세션 진행을 담당한다. 생성 엔진은 이 상태를 직접 소유하거나 저장하지 않는다.

현재 화면의 성공 경로는 다음과 같다.

1. `POST /api/analyze`로 PDF 구조를 분석한다.
2. `POST /api/plan`으로 선택 가능한 학습 영역을 만든다.
3. 사용자가 학습 영역을 확정한다.
4. `POST /api/generate`의 `prepare` 단계로 `LearningUnit`과 `OrganizedMaterial`을 만든다.
5. 사용자가 포함할 학습단위와 문제 만들기 방향을 확인한다.
6. `activity-design` 단계가 LearningUnit마다 문제 설계도 하나를 만든다.
7. 자동 흐름은 AI 추천을 사용하고, 수동 흐름은 사용자가 포함 여부와 문제 방식을 조정한다.
8. `cards` 단계가 포함된 LearningUnit마다 문제 하나를 만들어 반환한다.

## 생성 엔진 담당 파일

- `src/lib/pipeline/analyze.ts`: PDF 입력 검증, PDF별 구조 분석, 분석 응답 검증
- `src/lib/pipeline/plan.ts`: 선택 가능한 학습 영역과 전체 문서 핵심 범위 설계
- `src/lib/pipeline/generate.ts`: 요청 단계 분기, `LearningUnit` 추출·일반화, 검토본 구성, 카드 계약 적용, 카드 생성, Critic, 최종 카드 변환
- `src/app/api/analyze/route.ts`
- `src/app/api/plan/route.ts`
- `src/app/api/generate/route.ts`
- 생성 품질 평가와 generation lab 관련 파일

API Route는 얇은 입구이며 생성 정책을 두지 않는다.

## 학습 루프 담당 파일

- `src/app/page.tsx`
- `src/app/PdfReviewViewer.tsx`
- 사용자 화면 컴포넌트와 스타일
- `src/lib/storage.ts`
- `src/lib/study-session.ts`
- `src/lib/study-selection.ts`
- 학습 흐름 관련 테스트

학습 루프는 생성 엔진의 공개된 요청·응답을 사용하며, 화면에서 부족한 생성 결과를 추측해 채우지 않는다.

## 공용 파일

- `src/lib/types.ts`: 생성 엔진과 학습 루프가 함께 쓰는 데이터 계약
- `src/lib/model-config.ts`: 생성 엔진이 사용하는 모델 설정이지만 다른 실행 도구도 참조할 수 있는 공용 의존성
- `package.json`, `package-lock.json`: 프로젝트 전체 실행 계약

공용 파일은 한쪽 담당자가 임의로 변경하지 않는다. 변경이 필요하면 양쪽 사용 지점을 확인하고 변경 이유와 영향을 먼저 공유한다.

## 기존 API 계약

### `/api/analyze`

- 입력: `multipart/form-data`의 `pdfs` 파일 목록
- 출력: `PdfAnalysisResponse`

### `/api/plan`

- 일반 입력: JSON의 `analysis`, `instruction`
- 일반 출력: `StudyGuidelineDraft`
- 전체 핵심 범위 입력: `multipart/form-data`의 `analysis`, `instruction`, `runMode`, `pdfs`
- 전체 핵심 범위 출력: `WholeDocumentCorePlan`

### `/api/generate`

- 입력 형식: JSON 또는 `multipart/form-data`
- `prepare` 입력: 원문 텍스트 또는 PDF와 사용자가 확정한 선택
- `prepare` 출력: `analysis`, `organizedMaterial`, 빈 `cards`
- `activity-design` 입력: `preparedAnalysis`, `preparedMaterial`, 문제 만들기 방향
- `activity-design` 출력: LearningUnit별 문제 설계와 지원 판단
- `cards` 입력: `preparedAnalysis`, `preparedMaterial`, 필수 `activityDesign`과 확정 선택
- `cards` 출력: `analysis`, `organizedMaterial`, Critic을 거친 `cards`, `baselineTrace`

`full`, `sample`, `/api/recall-design`은 현재 제품 API에서 제거되었다. `src/lib/pipeline/recall.ts`와 옛 카드 계약 함수는 과거 평가 결과를 읽는 실험 도구에서만 사용하며 제품 호출 경로가 아니다.

## 변경 규칙

- 프롬프트, 추출·일반화 판단, 카드 계약과 Critic 정책은 생성 엔진에 둔다.
- API Route에는 재수출 외의 생성 정책을 다시 넣지 않는다.
- 생성 엔진은 화면, 덱 저장, 복습 상태와 학습 세션을 수정하지 않는다.
- 학습 루프는 pipeline 프롬프트와 생성 정책을 직접 수정하지 않는다.
- 기존 API 주소나 데이터 형태 변경은 두 영역 사이의 계약 변경으로 취급한다.
- `src/lib/types.ts`, Zod 스키마와 OpenAI JSON Schema 중 하나를 바꿀 때 나머지 정의와 화면 사용 지점을 함께 확인한다.
- 상대 영역의 변경이 필요하면 직접 수정하지 않고 필요한 입력·출력과 이유를 구체적으로 전달한다.
- 실제 충돌이나 반복 문제가 확인되기 전에는 파일 수를 늘리기 위한 추가 분리를 하지 않는다.
- 카드 외 활동이나 미래 기능을 이번 경계 문서를 이유로 미리 구현하지 않는다.
