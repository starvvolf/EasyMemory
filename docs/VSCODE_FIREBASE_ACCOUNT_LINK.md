# VS Code Firebase 계정 연결

Study Forge 웹의 확인된 Google 계정을 VS Code 확장과 연결하는 최소 인증 계약이다. ChatGPT 로그인이나 Codex 세션은 이 계정 연결의 인증 수단이 아니다.

## 흐름

1. 확장은 임의의 `state`와 PKCE S256 `verifier`/`challenge`를 만들고 등록된 URI handler를 callback으로 지정한다.
2. 사용자는 웹의 `/vscode-connect`에서 현재 Google 계정을 명시적으로 선택한다.
3. 서버는 UID, 이메일, callback, challenge, state 해시, 2분 만료 시각을 해시된 일회용 코드 문서에 저장한다. Firebase ID token, refresh token, custom token은 저장하지 않는다.
4. callback URI에는 `code`와 `state`만 포함된다.
5. 확장은 `code`, `state`, `verifier`를 `/api/auth/vscode-link/exchange`에 POST한다. 서버는 Firestore 트랜잭션 안에서 검증하고 코드 문서를 삭제한다.
6. 소비가 성공한 뒤 서버가 `studyForgeClient: vscode` claim을 가진 Firebase custom token을 만든다. 확장은 공식 Firebase Auth REST API로 ID/refresh token으로 교환한다.
7. refresh token은 VS Code SecretStorage에만 저장한다. URL, 로그, 일반 설정, Firestore에는 기록하지 않는다.

## 권한 경계

- VS Code custom-token 세션은 `/api/learner-memory/**`와 `/api/learning-records/**`에서만 허용한다.
- 기존 Google verified-email 및 운영자 AI 권한 판정은 바꾸지 않는다.
- custom-token 세션은 항상 `canUseAi: false`이며 AI 생성 API와 운영자 API에 사용할 수 없다.
- `vscodeLinkCodes`는 Admin SDK만 접근한다. Firestore 클라이언트 규칙은 사용자에게도 접근을 허용하지 않는다.

## 저장과 충돌

학습 기록은 `users/{uid}/learnerMemoryRecords/{recordId}`, 파생 메모리는 `users/{uid}/learnerMemory/state`에 저장한다. 두 문서와 operation idempotency 표시는 같은 Firestore 트랜잭션에서 갱신한다. 기존 evidence index는 내용 해시를 포함한 prefix가 정확히 같을 때만 뒤에 추가할 수 있다. 상태 또는 기록 문서가 900KB를 넘기기 전에 명시적으로 거부한다.

실제 Firebase 프로젝트의 Auth 공급자, Admin 자격 증명, 허용 도메인, 배포 URL 설정은 이 저장소만으로 검증할 수 없다. 로컬 검증은 mock 및 Firebase Emulator를 기준으로 한다.
