# Recaller

AI와 공부한 것을 **기억**으로 쌓고, 그 기억을 바탕으로 복습하는 로컬 PC용 AI 학습 프로그램입니다.
이론(PDF)은 읽어서, 알고리즘은 풀어서, 실습은 만들어 보며 배운 것을 한곳에 모읍니다.

> AI는 만들고 돕기만 합니다. **판정 · 기록 · 복습 날짜는 코드가 정합니다.**

## 무엇을 하나

| 갈래 | 하는 일 |
|---|---|
| **PDF → 기억** | 강의 PDF를 넣으면 쪽마다 글 · 그림 비중을 코드로 재서 필요한 것만 AI에 보내고, 주제별로 나눠 동시에 기억 카드를 만듭니다. 50쪽 자료 평균 약 69초(같은 자료 3번 실행). ([분석](docs/결과/PDF_시간토큰비용분석.md)) |
| **알고리즘 튜터** | 문제를 풀 때 튜터가 한 걸음씩만 돕고, 제출 코드는 이 PC에서 직접 채점합니다(Python · JavaScript · C++ · C#). |
| **상황 재현 복습** | 알고리즘 풀이 기록을 처음부터 따라가며 막힌 곳을 찾고(목차 · 막힌 구간), 걸린 것을 발상 · 기본기로 나눕니다. 기본기는 묶어서 짧게, 발상은 원래 문제와 다른 상황에서 그 생각 하나만 쓰면 풀리는 작은 문제로 다시 묻습니다. 틀린 답은 그때 실제로 쓴 코드이고, 맞고 틀림은 **코드를 돌려서** 정합니다(통과 · 같은 실수 · 원인 미확정). |
| **실습 코스** | 게시판 API를 단계별로 만들며, 실제 HTTP 요청으로 검사하고 VS Code에서 고칩니다. 실습이 끝나면 AI가 그 실습에서 배운 개념을 강의처럼 정리한 **복습 자료**(장마다 정의 · 왜 필요한가 · 어떻게 동작하나 · 이 실습의 코드 · 기억할 것)를 만듭니다. |
| **유튜브 요약** | 강의 영상 자막을 요약 노트로 만들어 기억으로 넘깁니다. |

## 구조

```
화면(Next.js, src/app/study) ──> API(src/app/api) ──> 기능(src/lib)
                                                     ├ study/gen   PDF → 기억 엔진
                                                     ├ code        알고리즘 · 채점기
                                                     ├ scene       상황 재현(뽑기 · 고르기 · 만들기 · 검사 · 채점 · 반영)
                                                     └ knowledge   기억 저장소 · 복습 날짜
데스크톱 창(desktop, Electron) ── 앱 서버(3000) + 실습 서버(experiments/project-course, 4100)
```

자세한 그림: [docs/구조도](docs/구조도/구조도.html) · 동작 설명: [docs](docs)

기술: Next.js 16 · React 19 · TypeScript · Electron 33 · Node.js 24 · pdf.js · OpenCode SDK

## 설치와 켜기 (Windows)

### 1. 먼저 깔 것

| 무엇 | 왜 | 받는 곳 |
|---|---|---|
| **Node.js 24 LTS** | 앱 실행 (22·23이어도 되지만, 그러면 실습 튜터용 Node 24를 따로 180MB 더 받습니다) | https://nodejs.org |
| **Python 3** | 알고리즘 채점 · 상황 재현 (설치할 때 "Add python.exe to PATH" 체크) | https://www.python.org |
| **VS Code** | 실습 (고치기는 VS Code에서 합니다) | https://code.visualstudio.com |
| ChatGPT 계정 | AI 기능 (앱 안에서 로그인) | — |
| (선택) g++ · .NET SDK | C++ · C#으로 풀 때만 | — |

### 2. 받기

저장소: https://github.com/starvvolf/EasyMemory/tree/recaller/v3-release (`recaller/v3-release` 브랜치)

- Git이 있으면: `git clone -b recaller/v3-release https://github.com/starvvolf/EasyMemory.git`
- 없으면: 위 주소의 **Code → Download ZIP**으로 받아 풀어 둡니다. 폴더 이름 · 위치는 마음대로 해도 됩니다.

### 3. 켜기

**`Recaller 켜기.cmd`** 를 더블클릭합니다.

처음 한 번은 아래를 저절로 합니다(인터넷 속도에 따라 5~10분).

| 순서 | 하는 일 |
|---|---|
| 1 | 앱 패키지 설치 (`npm install`) |
| 2 | 데스크톱 창(Electron) 설치 |
| 3 | 실습 튜터(OpenCode) 설치 |
| 4 | 창이 뜨고, 화면을 한 번 빌드 (1분쯤) |

그다음부터는 10초 안팎으로 켜집니다. 코드를 고쳤으면 다음에 켤 때 저절로 다시 빌드합니다.

### 4. 로그인

창이 뜨면 화면 위 **[ChatGPT 로그인]** 을 누릅니다. 로그인은 평소 쓰는 브라우저에서 열리고, 끝나면 창으로 돌아와 새로 고침(Ctrl+R)합니다.

### 끄기

창을 닫으면 확인한 뒤 앱 서버 · 실습 서버를 모두 끕니다.

### 안 켜질 때

| 보이는 것 | 할 것 |
|---|---|
| "Node.js가 없어요" | Node.js 24를 깔고 다시 켜기 (깐 뒤 창을 새로 열어야 인식됩니다) |
| "설치하지 못했어요" | 인터넷 확인 후 다시 켜기. 계속되면 `node_modules` 폴더를 지우고 다시 |
| "앱 서버가 꺼졌어요 … 포트" | 다른 프로그램이 3000 · 4100을 쓰는 중. 그 프로그램을 끄거나, `RECALLER_PORT` · `PROJECT_COURSE_URL` 환경 변수로 다른 포트 |
| 알고리즘 채점이 안 됨 | Python이 PATH에 있는지 (`python --version`) |

## 데이터

- 처음 켜면 **예시가 하나씩** 들어 있습니다: 자료(직접 만든 "그래프 탐색 BFS·DFS" 강의 노트 9쪽의 자료 지도 · 기억 카드), 알고리즘(내장 문제 「소문이 퍼진 사람 수」를 두 번 틀렸다 맞힌 기록 · 총정리 · 상황 재현 장면 2개). 예시는 `seed/data`에 있습니다.
- 공부 기록 · 넣은 PDF · 로그인 정보는 **이 폴더의 `data/`에만** 저장됩니다. 어디로도 올리지 않습니다(창 메뉴 → 데이터 폴더 열기).
- 로그인 토큰은 암호화해 두고, 열쇠는 사용자 폴더(`~/.study-forge`)에 따로 둡니다.
- 처음부터 다시: 앱을 끄고 `data/` 폴더 이름을 바꾸면 빈 상태로 켜집니다.
- 다른 폴더에 두려면 `STUDY_FORGE_DATA_DIR` 환경 변수.

## 용량

GitHub에 올라가는 것은 코드뿐입니다(약 7MB). 나머지는 켤 때 내 PC에 설치됩니다.

| 무엇 | 크기 | 어디 |
|---|---|---|
| 코드 · 문서 | 약 7MB | 저장소 |
| 앱 패키지 | 약 0.5GB | `node_modules` |
| 실습 튜터 (OpenCode) | 약 0.4GB | `experiments/project-course/node_modules` |
| 데스크톱 창 (Electron) | 약 0.27GB | `desktop/node_modules` |
| 빌드한 화면 | 약 30MB | `.next` |
| (Node가 22·23일 때만) 실습용 Node 24 | 약 0.18GB | `experiments/project-course/.node24` |

합쳐서 **약 1.2GB**, 공부 기록은 `data/`에 따로 쌓입니다. 지울 때는 폴더를 통째로 지우면 됩니다(+ `~/.study-forge`).

### AI 사용량

AI 호출은 로그인한 ChatGPT 계정의 사용량을 씁니다. PDF 50쪽 하나로 기억을 만들면 호출 16번쯤입니다.

## 시험

```bash
npm test                 # 253개 (파이썬을 실제로 돌리는 채점 시험 포함, AI 없음)
npx tsc --noEmit -p .    # 타입 검사
```

## 폴더

| 폴더 | 무엇 |
|---|---|
| `src/` | 앱. 화면 `src/app/study`, API `src/app/api`, 기능 `src/lib` |
| `desktop/` | 데스크톱 창(Electron): 빌드 · 서버 켜고 끄기 |
| `experiments/project-course/` | 실습 코스 서버와 VS Code 연결 확장 |
| `docs/` | 설계 · 동작 설명 · 측정 결과 · 구조도 |

## 라이선스 · 출처

- 글꼴 Pretendard: SIL Open Font License (`experiments/project-course/web/Pretendard-LICENSE.txt`)
- 알고리즘 문제 목록은 문제 번호 · 제목만 담고, 문제 원문은 담지 않습니다.
