# 생성 엔진 (C)

PDF를 지식 카드 → 자료 전체 정리 → 자료 지도로 만들고, 학습자가 원하면 문제를 만든다. 기본 엔진은 `recaller`. 경계: 이 문서와 루트 `CLAUDE.md` (`docs/GENERATION_ENGINE_BOUNDARY.md`는 옛 엔진 기준이라 맞지 않는다). 정한 것은 `docs/DECISIONS.md`의 10/29~10/30 엔진 항목.

## 흐름 (기본 엔진 recaller, 공부 화면)

공부 화면에서 시작하면 `runner.ts`의 `studyRecallerLab`이 손잡이를 정하고, 시작은 늘 `questionsLater`(지식까지만)다.

1. 전처리(`prep.ts`, prep-2): 쪽마다 읽는 길을 코드가 정한다(`layer` 글자 층 / `figures` 그림만 잘라 붙임 / `page` 쪽 전체 이미지 / `empty`). 쪽 그리기는 작업 프로세스 8개(`prep-worker.ts`, 1024px). 쪽 제목으로 목차를 만든다. 44쪽 약 2초.
2. 쪽마다 지식 카드(rc-organize, 최대 64쪽 동시): 쪽 글 + 그 쪽 그림(따로 옮겨 쓰지 않고 바로 붙임, `inlineRead`) + 목차 힌트. 답을 흘려 받아 서버 메모리에 두고(`setGenLive`), 지도가 `GET /api/study-map/<id>/live`로 쪽 순서대로 실시간으로 그린다. 인용이 원문에 있는지 코드가 확인한다(`checkCards`).
3. 쪽 의도 판정(rc-intent, 2와 동시): 모든 쪽 썸네일(저화질)을 한 번에 보고 자료 성격과 쪽 의도(표지·예고·안내·정의·…·예제·이어서·요약)를 정한다. 표지·예고·안내 쪽 카드는 빼고, 현황 쪽 카드는 보조로. 예고·안내는 이 판정으로만 정한다(쪽 혼자 보면 식이 그림인 쪽을 예고로 잘못 봄).
4. 자료 전체 정리(rc-merge, 카드가 다 모이면 바로): 주제(흐름 순서 + 한 줄), 원리 0~3개, 핵심(카드 1/3 이하, 쪽당 2개까지), 같은 지식, 이름 고치기, 연결. 바뀐 것만 답하게 한다(44쪽 99초 → 약 20초). 실패해도 카드는 그대로(`consolidated.error`).
5. `questionsLater`면 여기서 멈추고 자료 지도로. 데드락 14쪽: 지도 완성 약 35초, AI 호출 16번.
6. 지도의 "문제 만들기"(`POST /api/lab/gen/<id>/questions` → `questionsGen`)가 같은 실행을 이어 카드마다 문제(rc-author) → 따로 풀어 검증(rc-check)한다. 카드·정리는 다시 하지 않는다. 14쪽 24문제 약 22초. 심화 문제(rc-deep)는 시작할 때 고른 경우만.

- 카드의 `mistakes`(헷갈리기 쉬운 점)는 오답 재료로만 쓰고 지도에는 보이지 않는다(10/30 사용자).
- 끊김: 일시 오류는 2·5·12초 뒤 다시, 그래도 멈추면 10초 뒤 이어 하기(3번까지). 호출 상한 쪽당 8번 + 40번. 같은 짧은 글을 40번 넘게 되풀이하는 답은 자른다.

## 모델

기본값은 `types.ts`의 `DEFAULT_GEN_MODELS`(엔진 쪽 모델·추론 강도는 엔진 파일 안에서 정한다. `src/lib/ai/model.ts`는 함께 쓰는 파일).

- gpt-6.1-terra low: 쪽 카드, 쪽 의도, 자료 전체 정리 (빠르게, 뒤에서 검사가 받쳐 주는 단계)
- gpt-6-sol low: 문제 만들기, 따로 풀기 / sol high: 심화 문제 풀이 확인 (정확도가 먼저인 단계)
- 호출 하나 = 첫 글자 대기 약 3.4초 + 출력 길이 ÷ 출력 속도(terra 약 117, sol 약 64 토큰/초, 낮 기준). 입력 길이·동시 수는 거의 영향 없음(`협업/결과보고/연구_입력AI출력_여러쪽PDF_C_20261030.md`).

## 파일

- 진입 `runner.ts`(실행·재시도·이어 하기·실시간 카드·`questionsGen`·`remergeGen`), 엔진 `recaller.ts`, 프롬프트·카드 모양·쪽 의도 `cards.ts`, 전처리 `prep.ts`·`prep-worker.ts`·`pages.ts`, 검사 `checks.ts`, 출제 기준 폴더 읽기 `guide.ts`(`출제기준/`)
- 엔진 목록 `types.ts`(v2·v3·astra·v4·v5·alpha는 비교용, `astra.ts`·`v3.ts`)
- 지식 포인트 내보내기 `../knowledge.ts`(`knowledgeLayer`), 약속 `../knowledge-contract.ts`
- 자료 지도 데이터 `../material-map.ts`, 화면 `src/app/study/workspace/MaterialMap.tsx`, API `src/app/api/study-map/[id]/`(지도, `live`)
- 실험실 `src/app/lab/`, `src/app/api/lab/` (`/lab/gen`, 정리만 다시 `POST /api/lab/gen/<id>/remerge`)
- 실험: `webtrial.ts` + `POST /api/lab/web-trial` — 그림 섞인 웹 글을 PDF 없이 카드로(방법 4개 비교, 결과 `협업/결과보고/실험_웹글그림_C_20261031.md`). 서버가 주소로 글을 받는 `action:"url"`은 **실험용**이다. 제품에서는 웹 글을 주소로 가져오지 않는다(사용자 결정). 기능으로 만들 때는 확장(B)이 읽은 본문을 받는다.

## 지켜야 하는 것

- `KnowledgeLayer` 모양(포인트 id·이름·essentials·구역·쪽, `byObjective`)과 id 규칙(`자료id:포인트id`)을 유지한다. 엔진을 고치면 푸시 전에 약속 테스트를 돌린다.
- 실험은 엔진 실험 서버(3002, `Recaller 엔진실험 서버.cmd`, 빌드 `.next-engine`, 데이터 `tmp/engine-data`)에서. 3000번은 건드리지 않는다. 주소는 `http://127.0.0.1:3002`(localhost로 열면 로컬 실험 모드가 꺼져 로그인 화면이 뜬다).
- 3002의 데이터(시험용 PDF `tmp/engine-data/mcp-sources`, 그림 쪽 읽기 캐시 `study-gen/readings`, 지난 실행)는 예전 폴더 `CreatorTemp\recaller-integration\tmp\engine-data`에 있다. 새 폴더(`coding\Recaller`)에서 켜면 비어 있으니, 그 폴더를 복사하거나 `RECALLER_ENGINE_DATA_DIR`로 가리킨다.
- 시험용 PDF는 `mcp-sources`에 `src_<sha256>.pdf`와 같은 이름의 `.json`(id·fileName·pageCount·sha256)을 두면 등록된다.
- 가짜 모델(fake) 실행은 3002 데이터에서 돌리지 않는다: 그림 쪽 읽기 캐시(`readings`)를 가짜 글로 덮는다. 테스트는 임시 폴더를 쓴다.
- AI 사용량이 드는 실행(PDF 생성, 문제 만들기, web-trial)은 하기 전에 사용자에게 말한다.
- 강의 PDF·블로그 글·생성 결과는 커밋하지 않는다.
- `codex/engine-astra` 쪽 파일은 건드리지 않는다.

## 남은 것 (10/31)

- 한 쪽만 늦게 오는 꼬리: 8초에 같은 요청 한 번 더(`lab.hedgeMs`, 기본 꺼짐). 44쪽 실측 전.
- 지식 정리에서 `mistakes`·빈 칸 빼서 출력 줄이기(문제 만들 때 실수 메모를 같이 만들게).
- 웹 글(그림 포함)을 기능으로: 소제목 덩어리 + 그 덩어리 그림(B 확장과 함께).
- 문제 범위 고르기(핵심만·이 주제만), 카드에서 바로 묻기.

## 테스트

`node --experimental-strip-types --test src/lib/study/gen/*.test.ts src/lib/study/knowledge-contract.test.ts`
