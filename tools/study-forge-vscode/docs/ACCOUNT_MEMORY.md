# VS Code 계정·공통 기억 소비자 (2026-09-07)

실행 설정 개선 `0bcfb493` 다음의 확장 전용 변경이다. Firebase 인증/저장은 담당 커밋 `438b7194`, 공통 기억 HTTP/규칙은 `a9f0dbfb` 계열과 함께 통합해야 한다. 이 작업은 서버 파일이나 공통 규칙을 복제·수정하지 않는다. 현재 검증은 합성 응답/공통 HTTP·규칙 모의 연결이며 실제 Firebase 로그인·AI·배포 성공이 아니다.

## 인증

사용자 설정 `studyForge.accountServerUrl`의 기본 주소만 사용한다. workspace 설정으로 인증 서버를 바꾸지 못한다. HTTPS 또는 loopback HTTP만 허용하며 사용자정보·쿼리·fragment·경로가 붙은 주소는 거부한다.

1. 계정 연결 버튼에서 256비트 random state와 43자 verifier를 메모리에 만들고 S256 challenge를 계산한다. 기존 계정은 먼저 연결 해제한다.
2. `/vscode-connect?callbackUri=...&challenge=...&state=...`를 시스템 브라우저로 연다. verifier/토큰은 URL에 없다.
3. `vscode.env.uriScheme://study-forge-local.study-forge-vscode/firebase-auth`만 UriHandler가 받는다. code/state, 정확한 주소, 중복 쿼리, 연결 generation, 로컬 5분 대기 만료를 검증한다. 서버의 일회 코드 TTL은 별도로 2분이다.
4. `/api/auth/vscode-link/exchange`에 `{code,state,verifier}`를 POST한다. 응답 `{customToken,firebaseApiKey,uid,email}`을 받은 즉시 공식 Firebase `accounts:signInWithCustomToken`으로 교환한다. 반환 ID token의 sub를 연결 UID와 대조한다. 로컬 JWT 내용 확인은 서버의 서명/claim 검증을 대체하지 않는다.
5. **refresh token만 SecretStorage**에 저장한다. ID token은 메모리, 서버 주소/UID/email/공개 Firebase API key만 globalState에 둔다. 만료 60초 전부터 공식 securetoken REST로 갱신한다. 갱신 UID도 비교하고 동시 갱신은 하나로 합친다.
6. 연결 해제/계정 변경 시 SecretStorage와 메모리 토큰/기억 캐시를 비우고 generation을 증가시킨다. 이전 generation 응답은 토큰 저장/기억 표시/AI 답변 표시로 반영하지 않는다. 다른 계정의 기억이 들어간 기존 AI thread도 재사용하지 않는다. 로컬 원문은 삭제하지 않는다.

토큰은 `learning.json`, webview, 로그, URL, 명령줄에 넣지 않는다. HTTP redirect를 따르지 않고 네트워크 오류 원문/응답 본문을 UI에 노출하지 않는다. 이 credential로 요청할 수 있는 경로는 기억 API와 `/context`뿐이다. 기존 프로젝트/AI API 및 ChatGPT managed 로그인과 완전히 별도다.

## 정리와 원문 연결

기존 정리 1회 응답에 `learnerMemoryCandidates` 전송 스키마만 추가한다. domain/topic/confirmed/uncertain/evidenceIds/basis를 공통 계약과 맞추고 관찰·자기평가·추론을 구분하도록 요청한다. 서버가 공통 규칙으로 후보를 검증·반영한다. 로컬에서 숙련도 판정/병합/삭제 재생방지 규칙을 다시 구현하지 않는다. 기존 수동/선택형 10분 정리 정책은 그대로다.

연결된 신규 세션은 `accountLink:{uid,serverUrl,linkedAt}`를 갖는다. 과거 세션은 자동 귀속·업로드하지 않는다. 사용자가 해당 세션의 정리 가져오기 버튼을 선택한 경우에만 명시 연결한다. 다른 UID/서버에 연결된 세션의 자동 apply는 실행하지 않는다.

정리 성공 후 POST `/api/learner-memory`:

```text
{ record:{recordId,summary:{throughMessageId,updatedAt,automatic,
    sections:[{text,messageIds,codeIds}],learnerMemoryCandidates},
    evidenceIndex:[{id,kind,contentHash}]}, expectedRevision, operationId }
```

5개 정리 섹션을 순서대로 flatten한다. 원문 본문·이미지·코드 사본은 보내지 않는다. 근거 색인은 로컬 기존 ID/내용의 SHA-256만 가진다. 신규 이벤트를 뒤에 추가하고 기존 prefix를 바꾸거나 날짜로 재정렬하지 않는다. 옛 세션처럼 통합 색인이 없으면 기존 코드 배열 순서 다음 메시지 배열 순서로 최초 한 번 초기화한다(시간순 원문 복원이라고 주장하지 않는다). 이후 prefix는 고정한다. pending 답변은 완성/중단 시에만 색인에 넣고 기존 ID의 내용 변경은 오류로 막는다.

실패해도 로컬 정리/기억의 마지막 성공 상태를 보존한다. 충돌(409)은 사용자에게 새로 읽기 후 재시도를 안내하며 오래된 mutation을 자동 재전송하지 않는다. 같은 UID에서 늦게 도착한 낮은 revision 읽기도 최신 캐시를 덮어쓰지 않는다.

서버 한도(최신 통합에서 flatten 정리 150항목, 근거 2,000개, 문서 900KB)를 넘으면 실패를 표시한다. 한도에 맞춰 원문/후보를 조용히 자르지 않는다. 큰 정리는 문서 byte 한도로 계정 저장에 실패할 수 있다. Firebase 후속 수정 `b7a1e597`은 같은 정리의 재적용을 duplicate로 반환하므로 함께 통합해야 한다.

## 다음 질문·UI

GET `/api/learner-memory`는 `{state}`. PATCH는 `{target:{domain,topic},change:'confirm'|'delete'|{confirmed,uncertain},expectedRevision,operationId}`다. 날짜/basis/기존 기록 근거와 확인·수정·삭제를 작은 펼침 UI로 표시한다.

질문마다 사용자가 영역과 관련 주제를 명시한다(한 줄에 하나). GET `/api/learner-memory/context?domain=...&topic=...&topic=...`로 조회하고 공통 서버가 정확히 관련된 항목만 최대 5개/JSON 2,400자로 반환한다. 관련 주제를 모르면 빈 상태를 사용하고 전체 기억을 fallback으로 주입하지 않는다. 자동 주제 추론은 아직 없다. 응답은 기존 질문의 `referenceMaterial.learnerMemory` 사용자 자료로만 전달하며 현재 정정이 우선한다. 시스템/개발자 지시로 삽입하지 않는다.

## 검증

```powershell
$env:STUDY_FORGE_TEST_PYTHON = '<기존 Python 실행 파일>'
$env:STUDY_FORGE_MEMORY_COMMON_ROOT = '<통합 대상 src/lib/learner-memory 절대 경로>'
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tools/study-forge-vscode/test/*.test.cjs scripts/study-forge-vscode.test.cjs
```

54개 중 46통과, C# SDK 부재 8 skip, 실패 0. 공통 경로를 지정하지 않으면 공통 HTTP 통합 1개도 skip되므로 결과를 구분한다. S256/state/TTL/UID/중복 callback, 취소/갱신/이전 응답, refresh 전용 저장, 원문 비전송, append 색인, 신규/명시 반입, 정리 실패 보존, 사용자 자료 주입, 공통 apply/context/edit/delete/reload를 모의 검증했다. 기존 실행/정리 회귀도 함께 확인했다.

브라우저 합성 webview에서 계정/ChatGPT 구분, 기억 날짜·basis·근거, 확인·수정·삭제 버튼, 편집 입력 유지를 확인했다. 질문 폼이 기억 편집을 가리던 sticky 배치를 제거하고 선택적 참고 주제는 접힌 영역으로 두었다. 실제 서버 저장은 화면 미리보기에서 실행하지 않는다.

확장 lint 통과. 루트 build는 worktree에 Next 의존성이 없어 시작하지 못했다. npm 의존성을 설치하지 않았다. 실제 OS SecretStorage/VS Code URI callback E2E·웹 로그인·Firebase 트랜잭션·실AI·개인화 품질은 미검증이며 이 확장 테스트만으로 서버 배포 완료를 주장하지 않는다. 계정 generation 검증은 한 확장 호스트 내에서 시험했으며 여러 VS Code 창 사이의 계정 전환 동시성은 미검증이다.

공식 근거: [Firebase Auth REST](https://firebase.google.com/docs/reference/rest/auth), [VS Code SecretStorage/URI API](https://code.visualstudio.com/api/references/vscode-api).
