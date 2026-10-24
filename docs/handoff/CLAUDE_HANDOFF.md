# Claude 세션 인수인계 (2026-10-24 15:30)

이전 Claude 세션이 한도에 걸려 새 세션으로 넘긴다. 공통 내용(폴더, 구조, 안건)은 `docs/handoff/RECALLER2_HANDOFF.md`에 있으니 먼저 읽는다. 이 문서는 Claude 작업 환경과 사용자와 일하는 방식만 덧붙인다.

## 1. 사용자와 일하는 방식

- **말투**: 한국어 반말 섞인 짧은 메시지를 쓴다("ㄱㄱ", "ㅇㅇ", "뭔문제"). 답은 존댓말, 짧게, 결과 위주로 한다. 과정을 늘어놓지 않는다.
- **진행 방식**: "ㄱㄱ", "ㅇㅇ", "진행"은 바로 만들라는 뜻이다.
- **화면 변경**: UI 배치를 크게 바꾸기 전에는 선택지 2~3개와 추천안을 보여 주고 고르게 한다. 사용자가 "바로 바꾸기 전에 나랑 상의"라고 요청한 적이 있다.
- **사용자가 중요하게 보는 방향**:
  - 차별점(해자)으로 원하는 것: 핵심을 정확히 모르면 휘둘리는 응용 문제. 여러 과정이 "까리하게 섞인" 문제를 말한다(예: 지구·달 공전 좌표, 추적 카메라).
  - 앱 방향: 에이전트가 스스로 또는 사람 피드백으로 MD 파일을 고쳐 가고, 그게 도구 사용 방식을 바꾸는 구조.
  - 검증 방식: 작은 샘플(PDF 1~2쪽)로 자잘하게 검증하는 걸 좋아한다.
- **배경**: 컴퓨터그래픽스 시험(10/24 오전)은 끝났다. 그래픽스 자료는 보관함으로 치웠다. 비교 대상으로 ThetaWave를 써 봤고, 빠르고 게임 같은 학습이 좋다고 했다.
- **유료 호출**: 실제 모델 호출(엔진 비교, 품질 테스트)은 돌리기 전에 확인을 받는다. 사용자가 앱에서 직접 누르는 실행은 괜찮다.
- **보안**: `.env`, API 키, `chatgpt-auth`는 절대 출력하거나 올리지 않는다. EasyMemory는 공개 저장소이고, 기출이나 시험 원문은 비공개 `RecallerData`에만 둔다.

## 2. 작업 환경

- **클라우드 작업 폴더**: `/home/claude/v5`는 `claude/recaller2` 브랜치 작업트리다. 세션이 바뀌면 없을 수 있으니, 없으면 새로 clone하고 체크아웃한다.
  - 의존성 설치는 `NO_PROXY= no_proxy= npm ci --noproxy=''`로 한다. 그냥 하면 레지스트리 DNS 오류가 난다.
  - 타입 검사: `node node_modules/typescript/bin/tsc --noEmit -p .`
  - 린트: `npx eslint <파일>`
- **클라우드 화면 확인**:
  - 가짜 모델로 서버를 띄운다(명령은 RECALLER2_HANDOFF 1절). 서버는 턴 사이에 꺼질 수 있어서 매번 상태를 확인하고 다시 띄운다.
  - Playwright는 `scratchpad/tc/node_modules`에 설치하고 `executablePath: "/opt/pw-browsers/chromium"`으로 쓴다.
  - 모델 응답은 `page.route("**/api/study-notes")`에서 compose 요청을 가짜로 채워 확인한다.
  - 데스크톱 창 모양은 `document.documentElement.dataset.shell = "desktop"`으로 흉내 낸다.
  - API를 curl로 칠 때는 `Origin: http://127.0.0.1:3000` 헤더가 필요하다.
- **사용자 노트북**: 원격 기기 도구로 접근한다.
  - 연결 폴더는 `$HOME/mnt/projects/EasyMemory`이고, 그 옆이 `RecallerData`다.
  - 그 폴더에서는 파일 삭제가 막혀 있다. 노트북에 반영하는 절차:
    ```
    mvl(){ for l in $(find .git -name '*.lock'); do mv "$l" ".git/stale-$(basename $l)-$(date +%s%N)"; done; }
    mvl; B=claude/recaller2; git fetch -q origin $B:refs/remotes/origin/$B
    N=$(git rev-parse origin/$B)
    git diff --name-only HEAD $N | while read f; do git show $N:"$f" > "$f"; done   # 한글 파일명은 printf '%b'로 따옴표 풀기
    git update-ref refs/heads/$B $N; mvl; git reset -q --mixed; mvl
    ```
  - lock 파일은 `.git/stale-*`로만 옮긴다. `.git/refs` 아래로는 옮기지 않는다.
  - `.pnpm-store/`, `pnpm-workspace.yaml`은 사용자 쪽 파일이니 건드리지 않는다.
- **커밋**: 작업할 때마다 `claude/recaller2`에 커밋하고 push한 뒤 노트북에 반영한다. 사용자는 앱에서 Ctrl+R(화면 코드) 또는 앱 재시작(서버나 `desktop/main.js`가 바뀐 경우)으로 확인한다.
- **브라우저**: 사용자 Chrome 확장은 연결이 안 됐었다. 앱 안의 내장 브라우저를 쓸 수 있다.

## 3. 방금까지 하던 것

- 작업대 흐름 캔버스(`src/app/study/FlowBench.tsx`)를 만들었다: 박스와 화살표, 모델 박스 기본값, JSON/스키마 출력.
- 실제 ChatGPT로는 아직 안 돌려 봤다. 사용자가 노트북에서 처음 돌려 보면 피드백이 올 것이다.
- 사용자와 합의한 다음 순서:
  1. 흐름 루프와 멈춤 조건
  2. 대화 이어가기·스트리밍
  3. 피드백에서 MD 수정안으로 이어지는 고리
- 같은 내용을 GPT에도 넘겼다(RECALLER2_HANDOFF). GPT가 같은 파일을 동시에 고칠 수 있으니, 시작할 때 `git log`로 남이 올린 커밋을 확인한다.
