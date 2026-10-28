# 시장조사·경쟁제품 비교 자료 안내

2026-10-26 정리. 기존 `CD0625/docs/research/`의 시장조사 관련 파일 13개를 이 폴더로 이동했다. 내용은 수정하지 않았으며 이동 전후 SHA256 일치를 확인했다.

## Claude가 읽을 순서

1. [65개 후보 상세 조사](AI_QUESTION_SERVICES_DETAILED_20260911.md): 가장 넓게 조사한 원자료. 개인 학습24·교사/수업14·출제/저작10·한국 시험6·공개 코드5·인접/상태3·범용 AI3, 총65개다. 기능·구조·이용 조건을 비교했다. 전부 직접 사용하거나 품질을 검증한 목록은 아니다.
2. [우선 검증 후보 선별 v2](AI_QUESTION_SERVICES_SHORTLIST_V2_20260911.md): 위 후보에서 무엇을 먼저 확인할지 정리한 후속 판단. 우선 생성 검증22개와 코드 참고3개. v1보다 이 파일을 우선한다. 실제 생성 품질 순위가 아니다.
3. [학습·읽기 서비스 10개 비교](AI_LEARNING_READING_APPS_20261012.md): 학생·교사·독자·연구자 사용 상황과 기능을 비교한다.
4. [10개 제품 사용자 흐름](AI_LEARNING_APPS_USER_FLOWS_20261012.md): 각 제품에 무엇을 넣고, 어떤 순서로 사용하고, 무엇을 얻는지 정리했다. 공식 안내 확인과 실제 사용 실험을 구분해서 읽는다.
5. 아래 비공개 실제 사용 기록: 유니브 AI·NotebookLM·RemNote에 실제 PDF를 넣은 결과와 Recaller 비교. 원문·문항은 이 공개 폴더에 포함하지 않았다.

## 이 폴더의 전체 파일

| 파일 | 내용·용도 |
|---|---|
| `AI_QUESTION_SERVICES_20260911.md` | 초기 개요: 전용 서비스36개·범용 AI3개. 전체65개 목록은 DETAILED를 본다. |
| `AI_QUESTION_SERVICES_DETAILED_20260911.md` | 총65개 상세 조사. 사람이 읽는 본문. |
| `AI_QUESTION_SERVICES_DETAILED_20260911.json` | 같은 조사 계열의 구조화 데이터. |
| `AI_QUESTION_SERVICES_SHORTLIST_20260911.md` | 이전 선별 v1. 변경 전 판단을 보존한 기록. |
| `AI_QUESTION_SERVICES_SHORTLIST_20260911.json` | 선별 v1 구조화 데이터. |
| `AI_QUESTION_SERVICES_SHORTLIST_V2_20260911.md` | 이용 규모와 별도 비교 역할을 반영한 선별 수정안. |
| `AI_QUESTION_SERVICES_SHORTLIST_V2_20260911.json` | 선별 v2 구조화 데이터. |
| `GOOGLE_TRENDS_COMPARISON_20260911.md` | 주요 제품 검색 관심도 조사. 전 세계11묶음·한국2묶음. |
| `GOOGLE_TRENDS_COMPARISON_20260911.json` | 위 조사 계열의 구조화 수치. |
| `GOOGLE_TRENDS_FIVE_COUNTRIES_20260911.md` | Quizlet·NotebookLM·Wooclap·Knowt·Kahoot의 미국·한국·영국·독일·프랑스 비교. |
| `GOOGLE_TRENDS_FIVE_COUNTRIES_20260911.json` | 5개국 비교 구조화 수치. |
| `AI_LEARNING_READING_APPS_20261012.md` | 학습·읽기 서비스10개 기능·사용 목적 비교. |
| `AI_LEARNING_APPS_USER_FLOWS_20261012.md` | 위10개 서비스의 단계별 사용자 흐름. |

JSON과 Markdown은 같은 조사 작업의 산출물이다. 서로 모든 문장이 완전히 일치하는지 이번 정리에서 재검증한 것은 아니다. 먼저 Markdown을 읽고 JSON은 데이터 활용 시 참고한다.

## 실제 사용·결과물 비교: 비공개 위치

로컬 기준 폴더:

`C:/Users/Public/Documents/ESTsoft/CreatorTemp/RecallerData-research/competitor-pdf-20261018/`

| 경로(위 폴더 기준) | 무엇을 볼 때 |
|---|---|
| `결과물_보관목록.md` | 실제 서비스에서 만든 결과와 보관 파일의 전체 안내. 이 파일부터 읽는다. |
| `유니브_Recaller_저장본비교_20261019.md` | 저장된 유니브·Recaller 결과의 상세 비교. |
| `그래픽스04_유니브기본형_흡수방안_20261019.md` | 유니브 기본형의 출제 방식과 Recaller 개선점. |
| `ui-evidence/` | 실제 화면·추출 결과 등의 근거. 세부 위치는 보관목록 참조. |
| `semiconductor-01-07/업로드기록.md` | 반도체1~7주차 통합 자료 업로드 기록. |

더 이전인 9월 실제 사용 비교도 남아 있다:

`C:/Users/jkh01/OneDrive/문서/CD0625/eval/product-comparison-20260911/`

먼저 `README.md`, `comparison-report.md`, `external-content-review.md`, `notebook-studio-review.md`를 본다. Gemini·NotebookLM의 실제 출력과 캡처, Cornell BFS 입력 자료가 포함된 폴더다. 이 자료는 이번 공개 업로드 대상에서 제외했다.

공개 저장소에 이미 있는 엔진 재설계 분석은 [생성 엔진 재설계 연구보고](../연구보고_생성엔진재설계_GPT_20261019.md)를 참고한다. 이것은 시장 전체 조사와 별도다.

클라우드 Claude가 공개 저장소만 읽는 경우 비공개 로컬 경로의 파일은 접근할 수 없다. 실제 문항을 검토하려면 사용자가 별도로 비공개 자료를 제공해야 한다.

## 해석할 때 주의할 점

- 조사일 당시 기록이며 2026-10-26 현재 기능·가격을 재조사한 결과는 아니다.
- 공개 안내 조사, 후보 선별, 실제 사용 실험을 같은 수준의 증거로 보지 않는다.
- 업체 발표 이용자 수와 Google Trends는 생성 품질·학습 효과의 증명이 아니다.
- 실제 비교의 미완료·접근 제한·실패도 각 원문 기록대로 읽는다. 목록에 이름이 있다고 전부 검증 완료한 것은 아니다.
