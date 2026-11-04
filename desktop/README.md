# Recaller 앱 (Electron 창)

Recaller를 켜고 끄는 유일한 길이다(2026-11-05).

- `Recaller 앱.cmd`를 더블클릭하면 켜진다. 처음 한 번은 Electron을 받고, 바탕화면에 `Recaller` 바로가기를 만든다.
- 켤 때(로딩 창): `scripts/recaller-start.mjs`(코드 받기 · 패키지 · 데이터 받기 · 앱 서버 3000) → 실습 코스 서버(4100, `experiments/project-course/tools/keeper.mjs`, 이 앱의 자식 프로세스) → `tmp/fresh-start`가 있으면(데이터 새로 시작 뒤) 창 저장소 비우기 → `/study` 창.
- 끌 때: X · Ctrl+Q · 메뉴 "끝내기" → 확인 창 → 코스 서버 끄기 → `scripts/recaller-stop.mjs`(앱 서버 끄기 · 데이터 올리기).
- 창 안 화면은 웹앱 그대로라서 코드가 바뀌면 `Ctrl+R`로 반영된다. `main.js`를 바꿨을 때만 앱을 껐다 켠다.
- 실습 코스 화면(127.0.0.1:4100)은 Recaller 창으로, ChatGPT 로그인 같은 바깥 주소는 평소 브라우저로 열린다. 로그인 뒤 창에서 `Ctrl+R`.
- 실험 서버(엔진 3002, PS 3003)는 이 흐름에 없다. `lab/`의 `.cmd`로 따로 켠다.
