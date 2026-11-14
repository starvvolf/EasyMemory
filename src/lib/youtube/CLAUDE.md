# 유튜브 → Recaller (2번 판, 11/15)

사용자의 「유튜브 정리 패널」(Tampermonkey, `youtube-summary.user.js`)에서 **→ Recaller**(또는 Alt+R)를 누르면 그 영상이 Recaller 자료가 된다.

## 흐름

1. 패널이 자막(`compactTranscript` 꼴: `[분:초] 내용`, `=== [챕터] … ===`)과 영상 정보, 그리고 패널에서 이미 정리했으면 그 정리(마크다운)를 `POST /api/youtube`로 보낸다(머리글 `X-Recaller-Client: youtube-panel`, `src/proxy.ts`가 이 머리글이 있을 때만 같은 출처 검사를 건너뛴다).
2. `ingest.ts`: 글 자료(`../study/text-sources.ts`, kind `youtube`)로 저장 → 실행을 만들고 대기열에 넣는다. 같은 영상 · 같은 글이면 그 실행을 연다.
3. 엔진(`../study/gen/runner.ts`): PDF가 없는 txt_ 자료는 `readyTextSource`가 먼저 쪽 글을 준비한다. 유튜브는 정리가 없으면 **내용 정리**(yt-notes, `prompt.ts` = 패널의 SYSTEM_PROMPT 그대로, gpt-6.1-sol low)를 흘려 쓰며 1초마다 저장한다.
4. 정리의 가장 큰 단원(# 없으면 ##)이 한 "쪽"이 된다(`notes.ts` `notesPages`, 복습 질문 · 참고 · 협찬 단원은 빼고). 그 뒤는 PDF와 같은 길: 줄기 → 학습 목표 → 기억 채우기.
5. 화면: 자료 지도 첫 탭 **[정리]**(`src/app/study/workspace/youtube/YoutubeNotes.tsx`, 패널과 같은 모양), 카드의 "원문"은 그 단원 + "이 장면부터 영상 보기". `[분:초]`는 영상의 그 시각으로.

## 파일

- `notes.ts`: 패널의 순수 함수(정리 마크다운 → HTML, 이스케이프) + 쪽 나누기
- `prompt.ts`: 패널의 지시문(바꿀 때는 패널과 같이)
- `ingest.ts`: 받기 · 저장 · 실행 · 내용 정리 쓰기 · [정리] 탭 데이터
- `panel/recaller-panel-1.8.0.patch`: 패널 1.7.0 → 1.8.0에 더한 것(→ Recaller 단추, Alt+R, `recallerUrl` 설정, `@connect 127.0.0.1`). 패널 본체는 사용자 개인 프로그램이라 이 공개 저장소에 두지 않는다.
- API `src/app/api/youtube/[[...path]]/route.ts`

## 테스트

`src/lib/study/gen/recaller.test.ts`의 유튜브 두 개(자막만 → 정리부터, 패널 정리 → 정리 호출 없음).
