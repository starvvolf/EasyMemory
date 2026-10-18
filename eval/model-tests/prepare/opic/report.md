# OPIc Prepare 모델 하향 실험 보고서

## 2026-08-17 재시험

- Terra medium Prepare 성공: `model-test-prepare-terra-opic-r1.json`
- 10개 선택 leaf를 같은 10개 LearningUnit ID로 보존했다.
- 패턴 1~7의 고정 영어 표현, 변수 자리, 원문 근거가 유지됐다.
- operation 차이: 문법 규칙 `apply→recall`, about/that 핵심어 `discriminate→apply`; 나머지 8개는 동일하다.
- Sol: 9,806 tokens / $0.148080
- Terra: 9,301 tokens / $0.053172
- 판정: 범위와 패턴 보존은 통과. 실제 문제 품질 확인 전 프로덕션 전환은 보류한다.

아래 내용은 크레딧 부족 전의 최초 실패 기록이다.

## 결론

**판정: 실행 실패로 비교 불가. `gpt-5.6-terra` medium을 Prepare에 채택할 근거가 없다.**

후보 실행 명령은 외부 모델 호출 전에 보안 검토에서 거부되었다. PDF에서 추출된 학습 자료와 frozen Plan을 외부 모델로 보내고 결과 파일을 쓰는 작업에 명시적 승인이 필요하다는 사유였다. 프로세스가 시작되지 않아 OpenAI API 요청은 전송되지 않았고 후보 artifact도 생성되지 않았다. 실패 시 반복 호출하지 말라는 지시에 따라 재시도하지 않았다.

- 시도한 label: `model-test-prepare-terra-opic-r1`
- 후보 Prepare 설정: `gpt-5.6-terra`, reasoning `medium`
- 실제 API 호출 수: 0회 (실행 승인 단계에서 차단)
- 후보 artifact: 없음
- Activity/Cards 후속 실행: 미실행
- 공용 프로덕션 코드 및 `scripts/**`: 변경 없음

## 고정 입력

- PDF: `eval/local/sources/67d462c4e63ecc9e4ab5efbbbcd67b28c42c1d5281756e10f77a9dd63d979629.pdf`
- PDF SHA-256: `67d462c4e63ecc9e4ab5efbbbcd67b28c42c1d5281756e10f77a9dd63d979629`
- frozen Plan 재사용 artifact: `eval/local/plan-prepare-v1/opic-current-outline-attempt-1.json`
- Prepare 기준선: `eval/local/plan-prepare-v1/opic-evidence-only-attempt-1.json`
- 최종문제 기준선: `eval/local/current-app-prepared-smoke/opic-evidence-only-attempt-1-2026-08-16T185222205Z.json`

## 토큰 및 비용 비교

| 단계 | 모델 | reasoning | 입력 토큰 | 출력 토큰 | reasoning 토큰 | 총 토큰 | 추정 비용 |
|---|---|---:|---:|---:|---:|---:|---:|
| 기준 Prepare | gpt-5.6-sol | medium | 5,844 | 3,962 | 500 | 9,806 | $0.148080 |
| 후보 Prepare | gpt-5.6-terra | medium | 미실행 | 미실행 | 미실행 | 미실행 | $0 |
| 기준 Activity Design | gpt-5.6-terra | medium | 3,118 | 4,385 | 828 | 7,503 | $0.058856 |
| 기준 Cards | gpt-5.6-terra | medium | 5,423 | 1,379 | 123 | 6,802 | $0.027394 |

기준 최종문제의 Activity/Cards 합계는 14,305 토큰, $0.086250이다. 기준 전체 파이프라인(Prepare + Activity/Cards)의 기록 비용 합계는 $0.234330이다. 후보는 API가 호출되지 않았으므로 실제 절감률을 계산할 수 없다.

## Prepare 기준선: 10개 LearningUnit

| ID | operation | target | 원문 근거 |
|---|---|---|---|
| `strategy-flow` | `reconstruct` | 배경·구체적 설명 → 알게 된 계기 → 인물에 대한 생각의 순서로 전개 구조 재현 | 이름·나이 등 배경 및 구체적 설명 / 어떻게 알게 되었는지 / 마무리 생각 |
| `strategy-grammar` | `apply` | he/she에 맞는 3인칭 단수 동사 사용 | 주어는 대부분 3인칭 단수이므로 주어·동사 수일치에 주의 |
| `strategy-keywords` | `discriminate` | about과 that 뒤의 의미 단위를 핵심어로 식별 | about과 that 뒤 keyword에 집중 |
| `pattern-1` | `apply` | 새 인물의 정체와 이름을 패턴 1에 적용 | `I’d like to talk about [인물]. His/Her name is [이름].` |
| `pattern-2` | `apply` | 새 인물의 이름과 대략적인 나이를 패턴 2에 적용 | `He/She is [이름] and he/she is about [나이] years old.` |
| `pattern-3` | `apply` | 새 인물의 외모 정보를 패턴 3에 적용 | `To talk about his/her appearance, he/she is [겉모습 묘사].` |
| `pattern-4` | `apply` | 특히 좋아하는 구체적 이유를 패턴 4에 적용 | `I especially like him/her because [구체적인 특징].` |
| `pattern-5` | `apply` | 처음 알게 된 시점·상황을 패턴 5에 적용 | `I first got to know him/her when [알게 된 때].` |
| `pattern-6` | `apply` | 첫 만남 이후 형성된 관계를 패턴 6에 적용 | `Since then, he/she has become [관계].` |
| `pattern-7` | `apply` | 인물에 대한 최종 평가를 패턴 7에 적용 | `I think he/she is [내 생각].` |

기준선은 frozen Plan의 10개 선택 leaf ID를 같은 10개 LearningUnit ID로 유지했다. 각 unit의 operation, target, `sourceText`, `sourcePage`, `sourceRange`가 모두 존재한다. 후보가 없으므로 후보의 **10 IDs 유지**, **operation/target 보존**, **패턴 원문 및 source evidence 손실 0** 여부는 모두 미평가다.

## 최종 10문제 기준선

1. `strategy-flow` — 인물 묘사 답변의 세 단계를 원래 순서대로 배치.
2. `strategy-grammar` — 남성 사촌을 주어로 “주말마다 지역 도서관에서 자원봉사를 한다”를 영작. 정답: `He volunteers at a local library every weekend.`
3. `strategy-keywords` — 핵심 의미 단위 앞에서 집중해야 할 두 단어 회상. 정답: `about`, `that`.
4. `pattern-1` — 여성 직장 동료 Jisoo 소개. 정답: `I’d like to talk about my female coworker. Her name is Jisoo.`
5. `pattern-2` — 여성 Yuna, 약 28세 소개. 정답: `She is Yuna and she is about 28 years old.`
6. `pattern-3` — 키가 크고 곱슬머리인 남성 묘사. 정답: `To talk about his appearance, he is tall and has curly hair.`
7. `pattern-4` — 어려울 때 잘 들어 주고 격려하는 여성 친구를 좋아하는 이유 표현. 정답: `I especially like her because she always listens to me and encourages me when I have a hard time.`
8. `pattern-5` — 대학 첫 수업 같은 조에서 남성 친구를 알게 된 상황 표현. 정답: `I first got to know him when we were in the same group in our first college class.`
9. `pattern-6` — 여성 이웃이 가장 믿을 수 있는 친구가 된 관계 표현. 정답: `Since then, she has become my most trustworthy friend.`
10. `pattern-7` — 남성 형을 책임감 있고 가족을 가장 잘 챙기는 사람으로 평가. 정답: `I think he is responsible and takes the best care of his family.`

기준선은 LearningUnit 10개, Activity 추천 10개, 카드 10개로 1:1 대응한다.

## 품질 점검

### 영어 패턴 보존

기준선의 패턴 1~7 `basis`는 Prepare에 보존된 7개 일반화 패턴과 일치한다. 최종 답안은 모두 해당 패턴에 새 인물·나이·외모·이유·시점·관계·평가를 채운 near-transfer 예시다. 패턴 3 답안의 `he is tall and has curly hair`, 패턴 7 답안의 `he is responsible and takes ...`는 원문 슬롯을 자연스러운 병렬 구조로 확장한 것이며 문법적으로 성립한다.

### 문법

기준 최종 답안의 영어 문장 8개를 검토한 결과 명백한 문법 오류는 발견하지 못했다. he/she, him/her, his/her의 성별 대응과 3인칭 단수형(`volunteers`, `listens`, `encourages`, `has become`, `takes`)도 일관된다. `strategy-flow`는 순서 배열 문제이고 `strategy-keywords`는 단어 회상 문제라 영어 문장 문법 평가 대상이 아니다.

### 정답 누출

의도하지 않은 정답 누출은 발견하지 못했다. 문제 앞면은 한국어 상황과 적용할 패턴 번호를 주지만 완성 영어 문장이나 고정 패턴 전문을 제시하지 않는다. `strategy-flow`의 word bank는 순서 재구성 활동에 필요한 의도된 선택지이며, 정답 순서를 직접 노출하지 않는다.

### 기계 오류

기준 artifact의 `checks.machineIssues`는 빈 배열이다. 모든 카드의 `qualityStatus`는 `passed`다. 다만 이는 자동 검사 결과이며 후보 품질을 대신 증명하지 않는다.

## 최종 판정과 다음 조건

이번 실행으로는 Terra Prepare의 품질이나 비용을 Sol 기준선과 비교할 수 없다. 따라서 모델 하향 승인/기각이 아니라 **실험 미완료**로 기록한다. 다음 실험은 PDF-derived payload를 `gpt-5.6-terra`에 전송하는 명시적 승인이 확보된 뒤 동일 label이 아직 비어 있음을 확인하고 1회 실행해야 한다. 후보 Prepare가 정확히 10 IDs를 유지하고 패턴 원문·operation·target·source evidence의 명백한 손실이 0일 때만 Activity/Cards를 이어서 실행한다.
