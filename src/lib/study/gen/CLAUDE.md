# 자료 엔진 (recaller)

자료 한 편(PDF, 또는 쪽으로 나눈 글)을 기억 카드로 만든다. 11/15 리팩토링으로 앱이 쓰는 길 하나만 남겼다(DECISIONS 2026-11-15).

## 흐름

1. 전처리(`prep.ts`, 코드만): 쪽마다 글자 층 · 그림이 필요한 쪽(`figures` 그림 영역 / `page` 쪽 전체) · 쪽 제목. 쪽 그리기는 작업 프로세스 8개(`prep-worker.ts`, 1024px). PDF가 없으면 쪽 글(`prepFromTexts`)로.
2. 줄기 계획(rc-stem-plan, terra low, `stem.ts` STEM_PLAN_LINES): 모든 쪽 원문 + 쪽 그림 → 영역(= `state.sections`, `digest.skeleton.topics`) · 기억(= `digest.concepts`, 모양 · 메인/바탕/곁 · 근거 쪽). 빠진 쪽은 그 쪽만 한 번 더.
3. 학습 목표(rc-q-goals, 줄기 뒤 한 번): 자료 지도 [줄기] 탭 위에 보인다. 실패해도 카드는 그대로.
4. 기억 채우기(rc-stem-fill, STEM_FILL_QA): 영역 안에서 쪽이 이어지는 기억 묶음(쪽 6장 · 기억 5개)마다 한 번, 모두 동시에. 기억 하나 = 카드 한 장(`tN.mK`, 질문 하나 · 답 하나). 그림 위치 → 코드가 자른다(`figures.ts`, `quote-crop.ts`).
5. 다른 영역의 같은 이름 카드는 뒤 카드에 영역 이름을 붙인다. 끝.

- 끊김: 일시 오류는 2·5·12초 뒤 다시, 그래도 멈추면 10초 뒤 이어 하기(3번까지). 호출 상한 쪽당 8번 + 40번. 같은 짧은 글을 40번 넘게 되풀이하는 답은 자른다.
- 다 만든 뒤 `input.lecture`면 강의 첫 영역을 뒤에서 써 둔다(`../lecture-areas.ts`).

## 파일

- 진입 `runner.ts`(실행 · 저장 · 이어 하기 · 호출 기록), 엔진 `recaller.ts`, 줄기 · 채우기 지시문 `stem.ts`, 카드 모양 `cards.ts`, 학습 목표 · 데이터 모양 `digest.ts`
- 전처리 `prep.ts` · `prep-worker.ts` · `pages.ts`, 그림 `figures.ts` · `quote-crop.ts` · `image-size.ts`
- 글 자료 저장 `../text-sources.ts`(txt_ id, 쪽 글). PDF가 없는 실행은 여기서 쪽 글을 읽는다.
- 카드 → 기억 저장소 `../knowledge.ts`(`importCardsOf`: 카드 ref로 기록을 남길 때 그 자료 카드를 먼저 넣는다)
- 자료 지도 데이터 `../material-map.ts`, 화면 `src/app/study/workspace/MaterialMap.tsx`, API `src/app/api/study-map/[id]/`
- 입구 API `src/app/api/lab/gen/`(목록 · 새 실행 · 한 실행 · 이어 만들기 · 호출 기록)

옛 실행(예전 엔진 · 문제 · 정리 글)의 데이터 모양(`RecallerState`, `DigestState`, `SummaryState`)은 읽기용으로 남겼다. 옛 실행은 이어 만들 수 없다.

## 모델

기본값은 `types.ts`의 `DEFAULT_GEN_MODELS`. 줄기 · 채우기 · 목표 모두 gpt-6.1-terra low.

## 지켜야 하는 것

- 카드 ref 규칙(`자료id:카드id`)과 카드 모양(`cards.ts` Card, `memo`)을 유지한다. 기억 저장소 · 강의 · 구조가 이것을 읽는다.
- 지시문에 개수 · 줄 수 제한을 두지 않는다(사용자). 호출 크기 나눔은 코드에서.
- AI 사용량이 드는 실행은 하기 전에 사용자에게 말한다. 가짜 모델(fake) 테스트는 임시 폴더에서.
- 강의 PDF · 블로그 글 · 생성 결과는 커밋하지 않는다.

## 테스트

`node --experimental-strip-types --test src/lib/study/gen/*.test.ts src/lib/study/material-map.test.ts`
