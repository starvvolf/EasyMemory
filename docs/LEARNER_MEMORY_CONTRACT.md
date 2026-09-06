# 공통 학습자 기억 최소 계약

현재 상태: 공통 순수 규칙과 모의 검증 구현. 실제 Firebase 저장·인증·VS Code 소비자 연결은 아직 완료되지 않았다. 이 문서를 실제 연결 완료 또는 개인화 품질 검증 결과로 읽지 않는다.

## 책임과 기반

`src/lib/learner-memory/index.ts`는 기존 정리에서 얻은 후보를 현재 학습 상태로 반영하고, 현재 질문과 관련된 항목만 고른다. 별도 원문 기록 저장소나 모델 호출은 만들지 않는다. 기반은 Firebase 통합을 포함한 `c6d6d691`, 작업 브랜치는 `codex/common-learner-memory`다.

- 공통 기억 담당: 신규 learner-memory 규칙·계약·인접 테스트 및 이 문서.
- Firebase 담당: 기존 계정 저장 체계의 어댑터·인증·규칙·트랜잭션. 원문 소유권과 원문 위치 검증.
- VS Code 담당: 기존 summary 응답 계약 확장, 대화 참고 데이터 전달, 확인·수정·삭제 UI.

`src/lib/types.ts`, 생성 pipeline/MCP/PDF 및 기존 저장 파일은 변경하지 않는다. 정리 스케줄은 기존 VS Code 담당이 유지한다: 요청형 정리, 자동 기본 off, 첫 정리 이후 새 대화가 있는 활성 세션에서만 10분 간격.

## 기존 호출 경로와 연결 공백

VS Code `summary.js`의 `summaryInput → generate(기존 1회) → validateSummary → updateSummary`에서 원문 `messageIds`, `codeIds`, `throughMessageId`를 이미 보존한다. `learning-state.js`의 `LearningStore`는 `learning.json`에 로컬 세션을 저장한다. 현재 Firebase 저장에는 이 코딩 원문을 계정별로 저장하는 경로가 없다.

따라서 인증된 기억 API에서 클라이언트가 보낸 UID/원문 존재/위치를 믿고 저장하면 안 된다. Firebase 담당이 기존 기록의 계정 소유권과 명시적 저장 경계를 연결한 후 그 원문을 검증하는 어댑터가 필요하다. 계정 연결 전 로컬 자료를 자동 업로드하거나 계정에 자동 귀속하지 않는다. 확인되지 않은 어댑터를 import하는 API 껍데기는 만들지 않았다.

## 정리 응답 후보

기존 구조화 정리 응답에 `learnerMemoryCandidates` 배열을 함께 받는다. 후보는 최대 8개다. 선택적 후보가 없는 옛 정리는 빈 배열로 처리할 수 있다. 잘못된 후보는 검증 실패이며 기존 기억을 덮어쓰지 않는다.

```ts
{
  domain: 'algorithm' | 'cs' | 'opic' | 'report',
  topic: string,       // 최대 100자, 특정 문제 ID가 아닌 재사용할 주제
  confirmed: string[], // 최대 4개, 각각 240자: 관찰되거나 사용자가 확인한 내용
  uncertain: string[], // 최대 4개, 각각 240자: 아직 확인하지 못한 사항
  evidenceIds: string[] // 기존 원문 ID 1~12개, 각각 최대 200자
  basis: 'observation' | 'self-report' | 'inference'
}
```

`confirmed`는 모델이 숙련도를 인증했다는 뜻이 아니다. 설명 열람·질문·예제 통과만으로 숙달을 단정하지 않는다. 후보를 만드는 기존 정리 프롬프트에도 이 제한과 원문 근거 ID 요구를 유지한다. 공통 규칙은 문장 의미의 참/거짓까지 입증하지 못한다.

`basis`는 관찰 내용, 자기평가, 추론을 구분한다. 추론 후보는 confirmed를 비워야 하며, 사용자 확인·수정은 self-report로 표시한다. 계정 소유자가 제출한 원문을 서버에서 다시 읽어도 객관적 사실성이 인증되거나 독립 숙달 증거가 늘어난 것은 아니다.

## 저장 계약

`MemoryState`는 `{ownerUid, revision, entries, appliedSources}`다. 원문을 복제하지 않고 현재 관찰 내용과 기존 기록 참조만 갖는다. 각 entry는 영역/주제/짧은 확인·미확인 내용/날짜/근거 참조와 사용자 수정·삭제 상태를 가진다. 하나의 영역+정규화된 주제에는 하나의 최신 항목을 둔다. 점수나 증거 횟수는 없다.

`MemorySource`는 `{ownerUid, recordId, throughSequence, events:[{id,sequence}]}`다. **어댑터가 인증한 사용자 소유의 저장 원문에서 구성한다.** 모델과 API 클라이언트가 주장한 source를 그대로 사용하지 않는다. `throughSequence`는 원문 이벤트의 단조 증가 반영 위치다. 정리 실행 횟수나 summary revision, 날짜를 이 값으로 사용하지 않는다. 코드 snapshot의 ID도 실제 원문 이벤트와 연결된 위치를 사용하며, 같은 코드를 재독한 것만으로 새 이벤트를 만들지 않는다.

트랜잭션에서 계정 state와 source를 읽고 다음을 호출한다.

```ts
applyMemorySummary(state, uid, expectedRevision, source, candidates, nowISO)
editMemoryEntry(state, uid, expectedRevision, { domain, topic }, change, nowISO)
selectMemoryContext(state, uid, domain, currentQuestionTopics)
```

- `change`는 `'confirm'`, `'delete'`, 또는 `{confirmed, uncertain}`.
- `uid`는 서버 인증 결과. 경로 역시 이 UID로 구성한다.
- 저장 시 expectedRevision 비교는 필수이며 트랜잭션 안에서 수행한다. 순수 함수만 호출한 것으로 동시 쓰기나 인증이 해결되지 않는다.
- 순수 함수는 기존 객체를 변경하지 않는다. 어댑터 저장 성공 후에만 반환 상태를 소비자에 게시한다. 검증/네트워크/트랜잭션 실패는 기존 성공 상태를 보존한다.
- 충돌은 최신 상태를 다시 읽도록 명확히 표시한다. 오래된 후보를 새 revision에 조용히 덮어쓰지 않는다.
- `appliedSources`는 record별 최대 원문 위치를 저장한다. 동일·이전 위치 재처리는 no-op. 새 정리에도 기존 위치 이전 근거만 있는 후보는 반영하지 않는다.
- 신규 증거가 있으면 자동 항목을 최신 관찰로 교체한다. 과거 원문+요약을 각각 독립 증거로 누적하지 않는다.
- 사용자 확인·수정은 `userEdited`로 자동 덮어쓰기를 막는다. 확인은 미확인 내용을 자동으로 확인 내용으로 승격하지 않는다.
- 삭제는 본문과 세부 evidenceIds를 비우고 영역/주제 및 재생 방지 표식을 남긴다. 삭제한 주제는 이후 자동 정리로도 되살리지 않는다. 현재 최소 UI에는 자동 갱신 잠금 해제/삭제 복구 기능이 없다.
- 최대 entry 500개(삭제 표식 포함), source 위치 2,000개. 한도에서 재생 방지 정보를 버리지 않고 실패한다. 어댑터는 DB 문서 byte 한도도 검증해야 한다.

## 다음 대화와 최소 UI

`selectMemoryContext`는 영역과 정규화한 주제가 정확히 일치하는 항목만 최대 5개/전체 JSON 2,400자로 반환한다. 주제는 현재 질문에서 확인된 값만 사용한다. 관련 주제를 알 수 없으면 빈 배열을 전달한다. 현재 문제의 옛 정리 주제를 무조건 넣거나 무관한 전체 기억을 fallback으로 읽지 않는다.

반환값은 `{kind:'learner-memory-user-data',entries:[...]}`다. 이를 시스템/개발자 메시지에 이어붙이지 말고, 기존 질문의 참고 자료 객체에 **사용자 데이터**로 전달한다. 현재 사용자의 설명·정정이 과거 상태보다 우선한다는 정책은 소비자가 유지한다. 데이터 내부의 명령 문구를 실행하지 않는다.

최소 UI는 내용·날짜·기존 기록 근거를 확인하고, 확인/두 내용 배열 수정/삭제를 수행한다. 서버 저장 실패를 성공으로 표시하지 않는다. 재접속은 인증 후 서버에서 다시 읽고 타계정 캐시를 재사용하지 않는다.

## 검증과 남은 완료 조건

실행: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test src/lib/learner-memory/index.test.ts`.

독립 테스트는 관련/무관 영역·주제 선택, 원문 위치 재처리, 새 정리의 옛 근거, 사용자 확인·정정·삭제, JSON 재로딩, 소유자 불일치, 잘못된 후보/근거, revision 충돌, 컨텍스트 한도, 용량 초과를 검증한다. 실제 저장 실패·재접속·동시 쓰기는 Firebase 어댑터 모의 통합 테스트가 추가로 필요하다.

미완료: 인증된 원문 저장 경로 합의, Firebase 어댑터/규칙, 얇은 API, VS Code summary/chat/UI 실제 연결, 통합 mock의 저장 실패·계정 격리·재접속 검증. 실 Firebase 설정과 Google 로그인, 실제 AI 호출 및 개인화 품질은 시험하지 않는다.

현재 검증: 독립 테스트 10개, 범위 ESLint, strict TypeScript 검사 통과. 전체 Next 빌드는 이 작업트리에 node_modules가 없어 Next package를 해석하지 못해 시작 단계에서 실패했다. 다른 checkout 실행기로 시도했으며 의존성을 새로 설치하거나 package/lock을 수정하지 않았다.

반복 파일 가져오기를 기본 흐름으로 쓰는 안은 기획팀2가 승인하지 않았다. 파일 가져오기는 기존 자료 이전 보조만 될 수 있다. 완료하려면 최초 계정 연결 뒤 기존 정리 성공에서 상태를 갱신하고 다음 VS Code 질문에서 관련 상태를 자동으로 읽어야 한다. 신규 인증 전달 경로는 Firebase·VS Code 담당이 검토 중이며 아직 구현·승인되지 않았다. 기존 `server-auth.ts`는 Bearer Firebase ID token을 이미 받지만 `auth-policy.ts`는 Google provider만 허용하므로 custom token을 그대로 호환된다고 가정하지 않는다.

저장 단위는 기존 summary와 근거 참조를 크기 제한 아래 재사용하며 전체 이벤트별 저장·이미지 이전을 선결조건으로 만들지 않는다. 같은 session의 기존 ID·내용·순서 및 반영 위치를 보존해야 한다. 날짜 재정렬로 기존 sequence를 바꾸면 과거 근거 재처리 방지가 깨지므로 금지한다. 동일 자료의 중복 가져오기도 새 독립 근거로 만들지 않는다. 서버에서 기록을 다시 읽었다고 내용의 객관적 사실성을 인증한 것이 아니다.
