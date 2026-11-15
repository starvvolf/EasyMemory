# Recaller 데스크톱 창

`Recaller 켜기.cmd`(저장소 맨 위)가 이 폴더의 Electron 창을 켭니다. 창(`main.js`)이 하는 일:

1. 처음 한 번, 또는 코드가 바뀌었으면 화면을 빌드합니다(`next build`, 1분쯤).
2. 앱 서버를 켭니다(`next start`, 127.0.0.1:3000).
3. 실습 서버를 켭니다(127.0.0.1:4100, `experiments/project-course`).
4. `/study`를 창으로 엽니다.

창을 닫으면 확인한 뒤 두 서버를 끕니다. 데이터는 저장소의 `data/`에만 남습니다(받기 · 올리기 없음).

- 포트 바꾸기: `RECALLER_PORT`, `PROJECT_COURSE_URL` 환경 변수
- 데이터 폴더 바꾸기: `STUDY_FORGE_DATA_DIR`
- 메뉴 → 데이터 폴더 열기 · 브라우저로 열기 · 개발자 도구
