# Recaller

이론(PDF·웹 글)은 읽어서, 알고리즘은 풀어서, 실습에서는 만들어 보며 배운 것을 지식 하나로 쌓고, 잊을 때쯤 다시 묻는 PC 학습 앱입니다.

- 작업 규칙: [CLAUDE.md](CLAUDE.md) · 지금 상태: [협업/현황.md](협업/현황.md) · 정한 것: [docs/DECISIONS.md](docs/DECISIONS.md)
- 구조도: [협업/구조도/구조도.html](https://starvvolf.github.io/EasyMemory/%ED%98%91%EC%97%85/%EA%B5%AC%EC%A1%B0%EB%8F%84/%EA%B5%AC%EC%A1%B0%EB%8F%84.html)
- 브랜치 `claude/recaller2`

## 켜고 끄기

`Recaller 앱.cmd` 하나만 씁니다. 처음 한 번 바탕화면에 `Recaller` 바로가기를 만듭니다.

- **켤 때**(로딩 창): 코드 받기 → 패키지(바뀐 때만) → 데이터 받기(RecallerData) → 앱 서버(127.0.0.1:3000) → 실습 코스 서버(4100) → 창 열기
- **끌 때**: 창의 X(또는 Ctrl+Q) → "Recaller를 끝낼까요?" → 실습 코스 서버 끄기 → 앱 서버 끄기 → 데이터 올리기

Node.js 24, AI는 ChatGPT 계정 로그인. 키와 개인 학습자료는 이 저장소에 넣지 않습니다(데이터는 비공개 저장소 RecallerData).

## 폴더

| 폴더 | 무엇 |
|---|---|
| `src/` | 앱(Next.js). 화면 `src/app/study`, API `src/app/api`, 기능 `src/lib` |
| `desktop/` | Electron 앱(켜고 끄기) |
| `experiments/project-course/` | 실습 코스 서버(4100)와 VS Code 확장 |
| `extension/` | 크롬 확장(웹 글) |
| `scripts/` | 앱 켜기·끄기·데이터 동기화·데이터 보관 |
| `lab/` | 실험실: 실험 서버(엔진 3002, PS 3003), 문제 만들기·프롬프트 점검 실험, 실험 코드. 제품 흐름에는 없음 |
| `tools/` | 개발 도구: 토큰 사용량·작업 현황(3091), 용량 보기(`space.mjs`), 데이터 보관하고 새로 시작, 에이전트 MCP |
| `협업/`, `docs/` | 협업 문서, 결정·파이프라인 설명 |

## 데이터

- 시연 전 새로 시작: 앱을 끈 뒤 `tools/데이터 보관하고 새로 시작.cmd` (지금 데이터를 RecallerData의 `보관/<날짜-이름>/`으로 옮기고 빈 데이터로 시작, 지우지 않음). 되돌리기: `node scripts/recaller-data.mjs restore <보관본>`.
- 용량 큰 것 위치: `node tools/space.mjs` (지워도 되는 것·확인 후 지울 것·남길 것, 아무것도 지우지 않음).
