# 문제 만들기 실험 (A, 11/2)

생성 엔진의 기본 문제 단계(rc-author)만 떼어, 싼 모델(gpt-6-luna)로 OX·객관식이 정말 헷갈리게, 빈칸 카드는 결정적인 말을 비우게 만들 수 있는지 본다. 결과: `협업/결과보고/실험_luna문제만들기_A_20261102.md`.

- 엔진 파일과 3002 데이터는 고치지 않는다. 지난 recaller 실행(예전 폴더 `tmp/engine-data/study-gen`)의 카드를 읽기만 한다.
- 방식: `L0`(지금 엔진 지시문 한 번) · `L1`(헷갈림 규칙 한 번) · `P`·`P2`·`P3`(여러 겹 + 코드가 고름, P3가 최신: 코드 규칙 전부 + luna 따로 풀기) · `OLD`(지난 실행의 sol 문제, 생성 없음)
- 켜기: `문제만들기 실험.cmd`(P3, luna low) · `문제만들기 실험 medium.cmd`(P3, luna medium)
- 손잡이: `QG_VARIANTS=OLD,L0,L1,P`, `QG_PER=12`(자료마다 카드 수), `QG_PARALLEL=8`, `QG_EFFORT=medium`, `QG_EVAL=1`(luna 채점, 기본 꺼짐)
- 흐름만 보기: `QG_FAKE=1 QG_GEN_DIR=<study-gen 폴더> node --experimental-strip-types experiments/question-gen/run.ts`
- 결과 `out/<시각>/report.md`, 문제 전부 `records.jsonl`, 호출별 토큰 `assist-log.jsonl`. `out/`은 강의 내용이 들어 있어 깃에 올리지 않는다.
