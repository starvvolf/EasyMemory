# 생성 엔진 (C)

PDF를 지식 카드 → 자료 전체 정리 → 자료 지도로 만들고, 학습자가 원하면 문제를 만든다. 기본 엔진은 `recaller`. 경계: 이 문서와 루트 `CLAUDE.md` (`docs/GENERATION_ENGINE_BOUNDARY.md`는 옛 엔진 기준이라 맞지 않는다).

## 흐름 (기본 엔진 recaller, 공부 화면)

1. 전처리(`prep.ts`): 쪽 글자, 반복 머리글 제거, 그림·수식 쪽만 이미지로(`vision.ts`)
2. 쪽마다 지식 카드(동시 실행)
3. 자료 전체 정리(rc-merge, 기본 켬): 핵심/보조 중요도, 지식끼리 연결, 같은 지식 묶기. 실패하면 `consolidated.error`
4. `questionsLater`면 여기서 멈추고 자료 지도로. 14쪽 약 35초, 호출 16번
5. 지도의 "문제 만들기"(`POST /api/lab/gen/<id>/questions`)가 같은 실행을 이어 문제를 만든다. 14쪽 24문제 약 22초

## 파일

- 진입 `runner.ts`, 엔진 `recaller.ts`, 엔진 목록 `types.ts`(v2·v3·astra·v4·v5·alpha는 비교용)
- 지식 포인트 내보내기 `../knowledge.ts`(`knowledgeLayer`), 약속 `../knowledge-contract.ts`
- 자료 지도 데이터 `../material-map.ts`, 화면 `workspace/MaterialMap.tsx`
- 실험실 `src/app/lab/`, `src/app/api/lab/`

## 지켜야 하는 것

- `KnowledgeLayer` 모양(포인트 id·이름·essentials·구역·쪽, `byObjective`)과 id 규칙(`자료id:포인트id`)을 유지한다. 엔진을 고치면 푸시 전에 약속 테스트를 돌린다.
- 실험은 엔진 실험 서버(3002, 데이터 `tmp/engine-data`)에서. 3000번은 건드리지 않는다.
- 엔진 쪽 모델·추론 강도는 엔진 파일 안에서 정한다(`src/lib/ai/model.ts`는 함께 쓰는 파일).
- 강의 PDF·생성 결과는 커밋하지 않는다.
- `codex/engine-astra` 쪽 파일은 건드리지 않는다.

## 테스트

`node --experimental-strip-types --test src/lib/study/gen/*.test.ts src/lib/study/knowledge-contract.test.ts`
