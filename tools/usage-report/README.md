# 토큰 사용량 보기

실행 기록을 모아 한 장짜리 HTML(그래프·표)로 만든다. 모델 호출 없음, 설치할 것 없음.

- 켜기: 저장소 맨 위 `토큰 사용량 보기.cmd` 또는 `node tools/usage-report/build.mjs --open`
- 결과: `tmp/usage-report.html` (git에 안 올라감. 자료 이름이 들어 있으니 커밋하지 않는다)
- 읽는 곳: `.env.local`의 `STUDY_FORGE_DATA_DIR`(앱 3000), 그 옆 `engine-data`(엔진 실험 3002), 저장소의 `.study-forge-data`, `experiments/project-course/.study-forge-data`. 다른 폴더는 인자로: `node tools/usage-report/build.mjs <폴더> ...`
  - `study-gen/gen_*/calls/*.json`: PDF 엔진 호출(실행 단위)
  - `study-gen/web-trials/wt_*.json`: 웹 글 실험
  - `assist-log.jsonl`: 지식·코드·프로젝트 도우미 호출(실행 번호가 없어 같은 갈래가 3분 안에 이어지면 한 실행으로 묶음)
- 가격: `view.html`의 `PRICES`(OpenAI 공식 가격표, 2026-10-31). 앱은 ChatGPT 계정으로 부르므로 "API로 불렀다면"의 추정이다. 가격이 바뀌면 그 표만 고친다.
