# 구형 API·최근 정렬 API·JSON 직접 경로 비교

비교 기준:

- 구형 API: `150138f73301365b7d07fbfab4b8093c8f4409ca`
- 최근 정렬 API: `272c37e31474cacfb590e8ed8bb84a45f58914dd`
- 수정 경로: `api-json-direct-v1-2026-09-06`

## 구조 차이

| 항목 | 구형 `150138f` | 최근 정렬 `272c37e` | JSON 직접 경로 |
| --- | --- | --- | --- |
| 단계 | Analyze→Plan→Recall→Prepare→Cards | Analyze→Concept Tree→Learning Design→Activity Design→Cards | Analyze→Plan→Recall→Prepare→Cards |
| 모델 출력 | 단계별 의미 필드가 strict JSON | strict JSON 외곽의 단일 문자열 안에 자연어 블록 | 단계별 의미 필드가 strict JSON |
| 내부 해석 | Zod JSON parse 후 구형 생성 파이프라인 | MCP 자연어 parser와 materializer | Zod JSON parse와 항목별 관계 검증만 사용 |
| PDF 문맥 | 앞 4단계에 PDF | Analyze·CT·LD에 PDF | 앞 4단계에 PDF |
| Cards 이후 | `materializeCards`가 내용 변환 | MCP가 자연어를 앱 카드로 조립 | 원본 카드 필드 유지, 저장 ID만 별도 추가 |
| 잘못된 관계 | 일부 값을 첫 항목으로 fallback | parser·서버 보정 또는 재시도 | 항목별 오류로 거부하고 원본 시도 보존 |
| 재시도 | 이번 3자료 실행은 0회 | 자연어 내부 문법 오류로 반복 발생 | 최대 3회, 직전 JSON과 전체 오류 전달 |

최근 정렬 경로의 strict JSON은 `outlineText`, `treeText`, `learningDesignText`,
`activityDesignText`, `cardsText` 문자열을 감싸는 외곽 계약이었다. 내부 데이터가
자연어 문법이므로 CT 들여쓰기, LEARNING 필드, DESIGN enum과 CARD 목록을 MCP parser가
다시 해석했다. JSON 직접 경로는 이 문자열 계약과 MCP 의존을 모두 제거했다.

구형은 raw Cards JSON을 Zod로 읽은 뒤 공용 `materializeCards`를 호출했고, 최근 정렬
경로도 `ChatGptParityService`의 자연어 조립 뒤 같은 공용 `materializeCards`에
진입한다. 따라서 질문·빈칸을 바꾸는 결함은 MCP 전용이 아니라 두 API 경로가 공유한
후처리 문제다. 수정 경로는 이 함수를 호출하지 않는다.

## 삭제한 내용 변경·조용한 보정

- `normalizeClozeText`: 기존 빈칸을 유지한 채 answer 문자열을 추가 치환하던 처리
- `normalizeClozeAnswers`: 모델의 답 배열을 다시 해석·구성하는 처리
- `cleanEmbeddedStructureChoices`: 질문 문자열에서 구조 선택지를 정리하는 처리
- 잘못된 `recommendedOptionId`를 첫 option으로 바꾸는 fallback
- 누락된 카드 연결값이나 지원 불가 설계를 다른 카드로 조용히 대체하는 처리
- Learning Design의 첫 개념·첫 sourceRef 페이지를 실제 카드 출처로 추정하는 처리
- 검수하지 않은 결과에 `qualityPassed=true`를 부여하는 처리

수정 경로는 이 동작을 다른 구현으로 대체하지 않는다. 모델 JSON이 잘못되면 원본을
보존하고 검증 오류를 반환한다.

## 유지한 비내용 처리와 검사

- strict JSON Schema와 Zod 형식 검사
- 고유 ID, parent 참조, 페이지 범위, source 참조 검사
- Recall 추천 ID와 template/filled variant 관계 검사
- LearningUnit 수 상한과 원문 위치 검사
- 카드–LearningUnit 참조 및 sourceId/sourcePage/sourceRange 일치 검사
- cloze 빈칸 수와 answers 수, answer 순서 검사
- 객관식 선택지·정답 index와 구조복원 parent 참조 검사
- 모델/추론 강도, 요청·응답·usage·오류·버전 trace와 유한 재시도
- 최종 저장용 카드 ID 추가. 생성 내용은 추가 전후 SHA-256으로 동일성을 검사
- Critic을 실행하지 않았으므로 `qualityPassed=false`, `qualityStatus=not_run`, 빈
  `qualityNotes`만 허용

형식 검사는 의미를 다시 쓰지 않는다. 예를 들어 빈칸과 답 수가 다르면 빈칸을 추가하거나
답을 삭제하지 않고 해당 카드 경로가 포함된 오류를 반환한다.

## 실제 DFS/BFS 회귀

구형 재시험의 실제 Recall·Prepare·Cards raw JSON을 fixture로 복사했다. Recall
SHA-256은 `bceb152a1853fac7a7b1dda1fcc3009f1082d50a721986d00cd703789c28a110`, Prepare는
`bfb55a828a314a4746c9e8e29e63e8919eb715ff47584c32211d4295eaa47593`, Cards SHA-256은
`be7d3ba93b5d395cacc6cb9496bc675c94bbace725d67a1116789c55b7b39838`이며 각각 평가
원본과 같다.

- raw 16개는 모두 `____` 수와 `answers` 수가 일치해 검증을 통과한다.
- `generatedCards`와 `appCards`에서 ID를 제외한 모든 필드가 deep-equal이다.
- 구형 후처리가 손상했던 C5·C6·C10·C16도 raw 질문과 답 배열이 그대로 유지된다.
- C5에 빈칸 하나와 잘못된 sourcePage를 주입한 검사는 두 오류를 함께 반환하고 값을
  수정하지 않는다.

이는 JSON→최종 연결의 내용 무변경만 증명한다. 그래프와 시작점이 빠진 C8·C12의
학습 품질이 좋아졌다는 증거는 아니다.

## 남은 의미·계약 한계

- 코드만으로 `basis`가 정답 전체를 의미상 입증하는지 확인하지 못한다. 빈 문자열과
  source 참조는 검사하지만 원문 의미 판정은 모델·별도 평가가 필요하다.
- 여러 근거 span, 단일/다중 인스턴스 조건과 그래프·도표 재료를 별도 구조 필드로
  표현하는 새 계약은 추가하지 않았다. 구형 필드가 담은 정보만 무손실로 전달한다.
- Plan/Prepare가 원문 범위를 의미상 축소했는지는 페이지와 참조 형식 검사만으로 완전히
  판정할 수 없다.
- `appCards`는 비교 산출물이며 현재 웹앱이나 IndexedDB에 자동 발행하지 않는다.
- 정렬 경로의 Learning Design 60개 하드 한도와 지원 불가 과제의 설명 flashcard
  fallback은 이식하지 않았다. Plan의 JSON `maxLearningUnitCount`는 구형 계약의 최대
  200 soft budget이며, 이를 초과하면 내용을 줄이지 않고 오류로 반환한다.
- 토큰 압축, 새 모델, 새 단계, Critic과 학습 품질 평가는 이번 범위가 아니다.

따라서 이번 수정은 자연어 파서와 파괴적 후처리를 제거한 실행 가능한 비교 경로이지,
구형 엔진의 모든 학습 설계 결함을 해결한 제품 배포본은 아니다.
