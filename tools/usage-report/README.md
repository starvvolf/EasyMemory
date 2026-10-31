# 토큰 사용량 보기

실행 기록을 모아 한 장짜리 HTML(그래프·표)로 만든다. 모델 호출 없음, 설치할 것 없음.

- 켜기(자동 갱신): 저장소 맨 위 `토큰 사용량 보기.cmd` 또는 `node tools/usage-report/build.mjs --serve --open`
  - `http://127.0.0.1:3091/`에 작은 서버를 띄운다(127.0.0.1에만 열림, 포트는 `RECALLER_USAGE_PORT`로 바꿈, 3000~3003은 쓰지 않음). 포트가 차 있으면 이 도구인지 확인해 브라우저만 열고, 다른 프로그램이면 다음 포트를 쓴다.
  - 화면은 10초마다 `/version`을 묻고, 기록 파일이 바뀌었을 때만 `/data.json`을 다시 받아 그린다(새로고침 없이: 필터·원/달러·환율·펼친 줄·스크롤 유지). 서버는 파일의 수정 시각·크기가 바뀐 것만 다시 읽는다.
  - 위쪽 "자동 갱신 켜짐 · 마지막 갱신 …"에서 끄기/켜기, 지금 새로고침. 서버 창을 닫으면 "연결 끊김"으로 바뀌고 계속 다시 시도한다.
- 한 번만 만들기: `node tools/usage-report/build.mjs --open` → `tmp/usage-report.html` (git에 안 올라감. 자료 이름이 들어 있으니 커밋하지 않는다). 파일로 연 화면은 갱신되지 않는다.
- 읽는 곳: `.env.local`의 `STUDY_FORGE_DATA_DIR`(앱 3000), 그 옆 `engine-data`(엔진 실험 3002), 저장소의 `.study-forge-data`, `experiments/project-course/.study-forge-data`. 다른 폴더는 인자로: `node tools/usage-report/build.mjs <폴더> ...`
  - `study-gen/gen_*/calls/*.json`: PDF 엔진 호출(실행 단위)
  - `study-gen/web-trials/wt_*.json`: 웹 글 실험
  - `assist-log.jsonl`: 지식·코드·프로젝트 도우미 호출(실행 번호가 없어 같은 갈래가 3분 안에 이어지면 한 실행으로 묶음)
- 가격: `view.html`의 `PRICES`(OpenAI 공식 가격표, 2026-10-31). 앱은 ChatGPT 계정으로 부르므로 "API로 불렀다면"의 추정이다. 가격이 바뀌면 그 표만 고친다.
