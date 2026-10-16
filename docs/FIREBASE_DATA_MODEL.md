# Firebase 계정별 저장 구조

## 현재 문제

기존 덱·학습 기록은 브라우저 IndexedDB에 있고 프로젝트·원본 PDF는 PC 파일에
저장된다. 어느 쪽도 Firebase UID로 분리되지 않으므로 로그인만 추가해서는 다른
계정이나 기기에서 안전하게 사용할 수 없다.

## 저장 구조

모든 개인 문서는 `users/{uid}` 아래에 둔다. 클라이언트가 보낸 UID는 사용하지 않고
서버가 Firebase ID 토큰을 검증해 얻은 UID로 경로를 만든다.

```text
users/{uid}
├─ projects/{projectId}                         프로젝트 목록용 요약
│  └─ conceptTrees/{treeId}                     기존 개념트리 전체
├─ sources/{sourceId}                           원본 파일 메타데이터
│  └─ content/main                              구조 분석·읽기 분석 상세
├─ decks/{deckId}                               덱 목록용 요약
│  ├─ content/main                              카드 이외 덱 상세
│  └─ cards/{cardId}                            카드 한 장 전체
├─ studySessions/{sessionId}                    학습 세션 1회
│  └─ attempts/{attemptId}                      응답·채점 기록 1회
├─ reviewStates/{deckId}:{cardId}               사용자+카드 최신 복습 상태
├─ readingStates/{sourceId}                     PDF 최신 읽기 페이지
├─ imports/{fingerprint}                        기존 자료 중복 가져오기 방지
└─ operations/{operationId}                     네트워크 재시도 중복 방지
```

Cloud Storage 원본 경로는 다음과 같다.

```text
users/{uid}/sources/{sourceId}/original/{safeFileName}
```

## 실제 타입의 손실 없는 매핑

- `Deck.cards`만 카드별 문서로 분리하고 나머지 `Deck` 필드는
  `decks/{deckId}/content/main`에 그대로 저장한다.
- 목록 문서는 제목, 과목, 태그, 상태, 카드 수, 복습 예정 수, source 수, 수정 시각과
  revision만 갖는다. 목록 조회에서 카드·대형 분석·학습 기록을 읽지 않는다.
- `Card`의 질문(`front`/`clozeText`), 정답(`back`/`answer`/형식별 정답), 설명,
  근거와 `sourceId`/`sourcePage`/`sourceRange`는 카드 한 문서에 함께 저장한다.
- `PdfAnalysisResult.sourceOutline`과 페이지별 항목 참조는
  `sources/{sourceId}/content/main`의 분석 객체 안에 그대로 보존한다. 문장별 문서는
  만들지 않으며 새로운 목차 생성 기능도 추가하지 않는다.
- `StudyAttempt`는 세션 아래 독립 문서로 저장하고, 해당 카드의 최신
  `reviewSchedule`과 상태는 `reviewStates`에도 갱신한다.

## 저장 일관성과 재시도

`saveStudyProgress`에 해당하는 서버 저장은 Firestore 트랜잭션 하나에서 카드,
세션, attempt, 최신 복습 상태, 덱 요약을 함께 갱신한다. 하나라도 실패하면 성공을
반환하지 않는다. `attemptId`와 `operationId`를 다시 보내면 같은 요청으로 취급하고,
같은 ID에 다른 내용이 있으면 거부한다.

덱, 학습 세션, 읽기 위치 저장은 revision을 비교한다. 학습 진행 저장은 변경된 덱과
세션 revision을 함께 반환한다. 다른 기기가 먼저 저장한 경우 HTTP 409를 반환하며
서버 값을 조용히 덮어쓰지 않는다. 화면은 최신 상세를 다시 읽은 뒤 사용자 변경을
재적용하도록 안내해야 한다. 오프라인 쓰기는 성공으로 표시하거나 백그라운드 큐에
넣지 않는다.

## 기존 자료 가져오기

기존 IndexedDB와 PC 파일은 로그인만으로 어떤 계정에도 귀속하지 않는다. 사용자가
명시적으로 가져오기를 실행할 때만 업로드하며 원본 로컬 자료는 삭제하지 않는다.
서버가 덱 JSON과 원본 파일 바이트로 SHA-256 fingerprint를 계산해 `imports`에
기록하므로 같은 자료를 반복 가져와도 새 덱과 응답 기록이 중복되지 않는다.

읽기 위치 API는 계정의 `sources/{sourceId}`가 있을 때만 저장한다. 상태 조회 결과는
`ready`와 `import_required`를 구분하므로 화면은 일반 오류 대신 먼저 가져오기가
필요하다고 표시할 수 있다.

## 이번에 하지 않는 것

- 공개 공유와 공개 자료 컬렉션
- 기존 로컬 자료의 자동 귀속·삭제·이전
- 문장 단위 Firestore 문서화
- 생성 파이프라인, MCP 계약 또는 프롬프트 변경
