# 인수인계: 글·PDF 공부 → 지식쌓기 루트 설계 (2026-11-01)

**파트: C 엔진** (협업/현황.md "C 엔진" 칸. 사용자 10/31: "C가 없어 아직 엔진파트는 없고 … 너가 글·PDF 담당이니까 엔진이라고 봐야함")

이 스레드가 직접 한 것만 적었다. **모든 코드는 아직 커밋 전이다**(PC 작업 폴더에만 있음, 브랜치 claude/recaller2). 커밋은 사용자에게 묻고 할 것.

## 1. 한 일

### 1-1. 루트 설계 (문서만, 코드 없음)
- 글·PDF → 지식쌓기 루트 설계를 Claude 문서로 썼다(단계별 의사코드, "지금 되는 것 / 새로 할 것" 구분, 같은 PDF를 다시 만들면 44→96으로 늘어나는 중복 문제, 루트별 독립 실험).
- 프로젝트 스레드와 합의한 계약: `materialKey`, `attachSameMaterial`, `attachQuestions(지식id, {materialKey, title}, 문제[])`. 코드는 아직 없다.
- 실험 격리: 지식 저장소의 쓰기 순서(serial)는 서버 하나 안에서만 지켜지므로 루트마다 서버·데이터를 따로 쓴다. 이 루트는 포트 3005, 데이터 `tmp/lab-text`, 빌드 `.next-lab-text`. 공용 스크립트는 PS 스레드가 만든 `lab/run-lab.mjs --name text --port 3005 --seed`.
- **E1 실험**(기존 44→96 데이터에 "같은 자료면 이어 붙이기" 적용해 보기)은 설계만 하고 사용자 "ㄱㄱ"를 기다리는 중이다.

### 1-2. prep-2 규칙 보강 (`src/lib/study/gen/prep.ts`, `prep.test.ts`)
- `routePage2`에서 글자 층만 읽던 쪽 중 두 경우를 그림으로 보낸다.
  - 글자 300자 미만이고 선(pathOps) 20개 이상 → `page`(쪽 전체 그림). 선 도식.
  - 그림 면적(pictureCover) 2% 이상 → `figures`(그림 잘라 붙임). 식·작은 그림.
- 근거: `협업/결과보고/점검_prep2_벡터도식_20261031.md` (4개 PDF에서 잃던 7쪽 중 6쪽을 옮기고, 잃지 않던 쪽은 하나도 안 옮김). prep-1은 그대로다.

### 1-3. 정리 글 단계 (`summary.ts`, `summary.test.ts`) — 기본 꺼짐
- 전처리 결과(쪽 글자 층 + 필요한 쪽 그림)를 `[p.N]` 순서로 이어 붙여 sol·low 한 번에 정리 글을 스트리밍한다. 카드와 동시에 돌고, 실행 폴더의 `summary.json`에 저장한다. 같은 실행을 다시 시작해도(문제 만들기) 덮어쓰지 않는다. (p.N) 쪽 번호 범위도 검사한다.
- `lab.summary === true`일 때만 돈다. 1-5의 요약 → 카드로 대체될 예정이라 꺼 둔 것이다. 프롬프트·쪽 파서(`citedPages`, `pagesOutside`)는 1-5가 그대로 쓴다.

### 1-4. 엔진 기본 모델 (`types.ts`, `runner.ts`)
- 사용자 "다 수정해봐"(리서치 스레드 권고)에 따라 바꿨다. `rc-author`·`rc-check`는 sol → gpt-6.1-terra low. `rc-solve`는 sol high 그대로(출제 모델과 다르게). 공부 화면(`studyRecallerLab`)에 `hedgeMs: 8000`(정리가 8초 넘게 안 끝나면 같은 요청을 한 번 더).
- `transcribe`는 sol 그대로 두었다. 수식 0오류 실측이 sol뿐이고, 공부 화면(inlineRead)에서는 쓰지 않는다.

### 1-5. 요약 → 카드 엔진 (`digest.ts`, `digest.test.ts`, `recaller.ts`·`runner.ts`·`types.ts`·`cards.ts` 일부) — 실험 손잡이
- 사용자가 고른 "1번"(3차 구조 + 4차 장점, `협업/결과보고/실험_요약에서카드_20261031.md`, 기준 `기준_요약카드_유니브급_20261031.md`)이다. `lab.digest: true`일 때만 돌고 기본 흐름은 그대로다.
- 흐름:
  1. 뼈대 `rc-skeleton`(terra low, 스트리밍): `개요|쪽` 다음에 `tN|큰 주제|제목|쪽|관련` 줄. 줄이 오는 대로 `recaller.digest.skeleton.topics`에 들어가 목차로 쓸 수 있다. 코드(`settleSkeleton`)가 범위 밖 쪽과 두 곳에 들어간 쪽을 빼고, 빠진 쪽은 앞 주제에 넣고, 3쪽 넘는 주제를 경고하고, 주제마다 다른 생활 영역을 준다. 뼈대가 실패하면 전처리 구역으로 나눈다.
  2. 주제가 실행의 구역(sections, id `t1…`)이 된다.
  3. 주제별 정리 글 `rc-topic`(gpt-6.1-sol low, 모두 동시): 입력은 그 주제 쪽 + 관련 주제 쪽 + 뼈대, 그 쪽들의 그림. 출력은 본문 `[tN-bK] 이름: 한 문장. (p.N)`, `<<<EASY>>>`(한마디로·장면·안 맞는 점·줄마다 비유·흔한 오해·마무리), `<<<EXTRA>>>`(직접 해 보기·이어지는 개념·스스로 확인).
  4. `<<<EASY>>>`가 나오는 순간 본문 줄을 2~3줄씩(`batchLines`) `rc-digest-card`(terra low)로 보낸다. 묶음에는 그 줄이 인용한 쪽의 원문과 그림만 넣는다. 카드 모양은 `cardSchema` + `covers`이고, 안 덮인 줄은 한 번 더 보낸다.
  5. 코드가 카드마다 덮는 줄의 비유와 주제의 흔한 오해를 붙인다(`recaller.digest.notes[카드id]`, AI 호출 없음).
  6. `rc-wrap`(terra low): 모든 본문이 닫히면 개요 2문장과 주제마다 한 줄씩 핵심 정리를 쓴다.
  7. 검사(`recaller.digest.checks`): 입력 밖 인용 줄, 범위 밖 쪽, 안 덮인 줄, 주제 사이 같은 제목·용어(합칠 후보, 뒤 카드 제목에 " · 주제명"), 인용 안 된 쪽. 카드 이름 두 번 찍힘은 `cardLine`에서 고쳤다.
- 화면용 데이터: `genLive`(`/api/study-map/[id]/live`)가 `digest`를 함께 돌려준다. `digestText(d)`는 전체를 마크다운 한 편으로 만든다.
- 테스트: 가짜 모델로 전 흐름이 돈다. 엔진·계약 테스트는 118개 통과하고 tsc도 통과했다. "빠른 전처리" 1개는 리눅스 VM에서만 실패한다(DOMMatrix 없음). 윈도우에서 확인할 것.

### 1-6. 정리 탭 화면 시안
- https://claude.ai/artifact/8U3WJ4wWonCGDKjPfuL2Rm (원본 파일 `/mnt/project-files/engine-staging/digest-tab-mockup.html`). 왼쪽은 뼈대 목차, 오른쪽은 정리 글이다. 문단마다 그 줄로 만든 카드 묶음이 붙고(줄 앞 색 = 카드 색), 쉬운 설명과 더 해 보기는 접혀 있다. **사용자 확인 전이라 화면 코드는 아직 없다.**

## 2. 결정된 것 (모두 정한 사람: 사용자, DECISIONS.md에는 아직 안 적음)
- 10/31 "지금까지 실험한 방식중에 가장 합리적인 걸로": prep-2 보강 두 줄.
- 10/31 "다 수정해봐": 엔진 모델 기본값(1-4).
- 10/31 "일단 1번": 요약 → 카드 구조(1-5). 그 전의 정리 글 단계·정리 탭 브리프는 이것으로 대체되었다.

## 3. 만든·고친 파일 (커밋 전)
- 새 파일: `src/lib/study/gen/digest.ts`, `digest.test.ts`, `summary.ts`, `summary.test.ts`
- 고친 파일: `src/lib/study/gen/prep.ts`, `prep.test.ts`, `recaller.ts`, `runner.ts`, `types.ts`, `cards.ts`
- 작업 폴더에는 다른 스레드의 커밋 전 변경도 섞여 있다. 커밋할 때는 위 파일만 고를 것.
- prep.ts·prep.test.ts가 한때 CRLF로 바뀌어 통째로 diff가 났었다. LF로 되돌렸다(HEAD가 LF).

## 4. 남은 일
1. 사용자 답을 기다리는 두 가지: 정리 탭 시안을 이대로 만들지, 실측(데드락 14쪽 약 300원, 그래픽스 44쪽 약 900원 예상, 구독 사용량)을 돌릴지.
2. 실측 목표(데드락 14쪽): 첫 글자 5초 이하, 카드 다 됨 40초 이하, 전체 60초 이하, S·C·B 모두 통과. 그다음 그래픽스 44쪽.
3. 정리 탭 화면 만들기(`src/app/study/workspace/MaterialMap.tsx` 근처). 데이터는 `genLive().digest`에 있다.
4. 공부 화면 기본값을 digest로 바꿀지는 실측 뒤에 결정한다(`studyRecallerLab`에 `digest: true`).
5. DECISIONS.md에 위 세 결정을 추가하고(정한 사람: 사용자), 협업/현황.md C 칸을 갱신하고, 커밋한다(사용자에게 묻고).
6. E1 실험과 글(웹 기사) 비교 실험 설계는 사용자 승인 대기 중.

## 5. 주의점
- AI 사용량이 드는 실행은 미리 말하고 할 것. 3000 서버는 끄거나 다시 켜지 말 것. `.env.local`은 건드리지 말 것.
- 공개 저장소다. 강의 자료 원문·문제 원본은 커밋하지 말 것(시안의 예시 문장도 저장소에 넣지 말 것).
- 정리 글이 쓰는 모델: rc-summary와 rc-topic은 **gpt-6.1-sol**이다(실측도 6.1-sol). 브리프의 "gpt-6-sol"과 다르다.
- digest 모드에서는 쪽 정리(rc-organize)와 쪽 의도(rc-intent)를 하지 않는다. 자료 전체 정리(rc-merge)와 문제 만들기는 그대로 이어진다.
- `askText`가 `(step, page|null, …, images, onPartial?)`로 바뀌었다. 스트리밍 텍스트 호출이 필요하면 이걸 쓰면 된다.
