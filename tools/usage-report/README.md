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

## 작업 현황 탭 (2026-11-02)

같은 PC 폴더에서 여러 세션(A·B·C·D·Codex)이 동시에 고칠 때 겹치지 않게, 같은 서버의 [작업 현황] 탭(`http://127.0.0.1:3091/#work`, `작업 현황 보기.cmd`)에서 본다. 모델 호출 없음, 5초마다.

- 보이는 것: 커밋 안 된 파일(영역·구조도 칸·+/−·마지막 수정·누가·주의), 지금 고치는 세션, 구조도(`협업/구조도/구조도.html`을 `/structure`로 내주며 칸마다 테두리·꼬리표를 얹음), 남은 git 잠금, GitHub보다 앞섬/뒤처짐(2분마다 fetch), 최근 커밋.
- 주의: 빨강 = 두 세션이 같은 파일(겹침)·2분 넘은 `.git/*.lock` / 노랑 = 누가 고치는지 모름·약속 파일(`knowledge/api.ts` 등) 고치는 중(그 약속을 쓰는 칸에도 "영향") / 회색 = 영역 밖 수정([경계] 필요)·커밋 안 하고 12시간.
- 누가: Claude Code 세션은 파일을 고칠 때 훅(`.claude/settings.json` → `tools/work/claim-hook.mjs`)이 `.recaller-work/claims.jsonl`(git 제외)에 저절로 남긴다. 이름은 `RECALLER_WHO=A`로 켠 세션이면 붙고, 아니면 고친 파일 영역으로 "A?"처럼 짐작. Codex·사람은 `node tools/work/claim.mjs A <파일…> [--note 메모]`, 끝나면 `node tools/work/claim.mjs A --done`.
- 칸 ↔ 파일 표: `협업/구조도/파일지도.json`(영역·칸·약속 파일·무시할 파일). 구조도가 바뀌면 각자 작업 끝나고 같이 고친다.
- 한계: 클라우드에서 따로 작업하는 세션은 PC 폴더를 건드리거나 GitHub에 올리기 전에는 안 보인다.
