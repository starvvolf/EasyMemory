# 실험실 (lab/)

제품 흐름(Recaller 앱)에 들어가지 않는 실험을 모은 곳이다(2026-11-05 정리). 여기 것은 앱을 켜도 돌지 않고, 결과 데이터는 깃에 올리지 않는다(`tmp/`, 각 폴더의 `out/`).

| 무엇 | 켜기 | 주인 | 데이터 |
|---|---|---|---|
| AI 호출 실험실 | 앱 서버의 `http://127.0.0.1:3000/lab/ai` (11/6) | A | 기록 `<data>/ai-calls/`, 설정 `<data>/lab/ai-settings.json` (이 PC에만) |
| 엔진 실험 서버 (3002) | `엔진 실험 서버.cmd` (`run-engine-lab.mjs`) | C | `tmp/engine-data`, 로그 `tmp/engine-lab.log` |
| 루트별 실험 서버 (PS 3003 등) | `PS 실험 서버.cmd` (`run-lab.mjs --name … --port …`) | A | `tmp/lab-<이름>/data` |
| 토론방 | `토론방.cmd` (앱 서버의 `/room`) | 공통 | `협업/토론/` |
| 문제 만들기 실험 (luna) | `question-gen/문제만들기 실험.cmd` | A | `question-gen/out/` |
| 프롬프트 점검 실험 | `prompt-review/README.md` | 공통 | `tmp/prompt-review-*` |
| 실험 코드 모음 | `실험코드/` (요약카드, 검사 스크립트) | C | — |

- 엔진 실험실 화면(`/lab`)은 앱 서버 안에 있어 ··· > 개발용 화면 > 엔진 실험실로도 연다.
- 실험 서버들은 앱 서버(3000)와 데이터·빌드 폴더를 나눠 쓴다. 3000을 끄거나 재시작하지 않는다.
- 크기와 지워도 되는지는 `node tools/space.mjs`.
