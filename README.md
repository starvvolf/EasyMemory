# Recaller

배운 것을 **기억 하나**로 쌓고, 잊을 때쯤 다시 묻는 PC 학습 앱입니다.
이론(PDF)은 읽어서, 알고리즘은 풀어서, 실습은 만들어 보며 배운 것을 한곳에 모읍니다.

> AI는 만들고 돕기만 합니다. **판정 · 기록 · 복습 날짜는 코드가 정합니다.**

## 무엇을 하나

| 갈래 | 하는 일 |
|---|---|
| **PDF → 기억** | 강의 PDF를 넣으면 쪽마다 글 · 그림 비중을 코드로 재서 필요한 것만 AI에 보내고, 주제별로 나눠 동시에 기억 카드를 만듭니다. 52쪽 자료 약 1분 44초. ([분석](docs/결과/PDF_시간토큰비용분석.md)) |
| **알고리즘 튜터** | 문제를 풀 때 튜터가 한 걸음씩만 돕고, 제출 코드는 이 PC에서 직접 채점합니다(Python · JavaScript · C++ · C#). |
| **상황 재현 복습** | 풀이 기록에서 "그때 떠올리지 못한 생각"을 뽑아, 그 생각만 다시 꺼내게 하는 작은 장면(17가지 형식)을 냅니다. 정답 · 오답 모양은 AI가 쓰지 않고 **코드를 돌려서** 만들고, 학습자의 답도 실행 결과로 판정합니다. ([설계](docs/상황재현_설계.md)) |
| **실습 코스** | 게시판 API를 단계별로 만들며, 실제 HTTP 요청으로 검사하고 VS Code에서 고칩니다. |
| **유튜브 요약** | 강의 영상 자막을 요약 노트로 만들어 기억으로 넘깁니다. |
| **가상 학습자** | AI가 여러 성향의 학습자를 연기해 앱을 끝까지 써 보는 자체 시험 도구입니다. ([설계](docs/가상학습자_설계.md) · [결과](docs/결과/상황재현_자체시험.md)) |

## 구조

```
화면(Next.js, src/app/study) ──> API(src/app/api) ──> 기능(src/lib)
                                                     ├ study/gen   PDF → 기억 엔진
                                                     ├ code        알고리즘 · 채점기
                                                     ├ scene       상황 재현(뽑기 · 고르기 · 만들기 · 검사 · 채점 · 반영)
                                                     ├ knowledge   기억 저장소 · 복습 날짜
                                                     └ npc         가상 학습자
데스크톱 창(desktop, Electron) ── 앱 서버(3000) + 실습 서버(experiments/project-course, 4100)
```

자세한 그림: [docs/구조도](docs/구조도/구조도.html) · 동작 설명: [docs](docs)

기술: Next.js 16 · React 19 · TypeScript · Electron 33 · Node.js 24 · pdf.js · Transformers.js(EmbeddingGemma) · OpenCode SDK

## 켜기 (Windows)

### 필요한 것

| 무엇 | 왜 |
|---|---|
| Windows 10/11, [Node.js 24](https://nodejs.org) | 앱 실행 |
| ChatGPT 계정 | AI 기능 (앱 안에서 로그인) |
| Python 3 | 알고리즘 채점 · 상황 재현 |
| VS Code | 실습 |
| (선택) g++, .NET | C++ · C#으로 풀 때 |

### 처음 켜기

1. 이 저장소를 받습니다(`git clone` 또는 ZIP).
2. **`Recaller 켜기.cmd`** 를 더블클릭합니다.
   - 처음 한 번 패키지 · 데스크톱 창 · 실습 튜터를 설치하고 화면을 빌드합니다(인터넷 속도에 따라 수 분).
   - 그다음부터는 바로 켜집니다.
3. 창이 뜨면 화면 위 **[ChatGPT 로그인]** 을 누릅니다. 로그인은 평소 쓰는 브라우저에서 열리고, 끝나면 창으로 돌아와 새로 고침(Ctrl+R)합니다.

창을 닫으면 확인한 뒤 서버를 모두 끕니다.

### 데이터

- 공부 기록 · 넣은 PDF · 로그인 정보는 **이 폴더의 `data/`에만** 저장됩니다. 어디로도 올리지 않습니다.
- 로그인 토큰은 암호화해 두고, 열쇠는 사용자 폴더(`~/.study-forge`)에 따로 둡니다.
- 처음부터 다시: 앱을 끄고 `data/` 폴더 이름을 바꾸면 빈 상태로 켜집니다.

### 용량

| 무엇 | 크기 |
|---|---|
| 저장소 (코드 · 문서) | 약 7MB |
| 앱 패키지 (`node_modules`) | 약 1.2GB |
| 데스크톱 창 (Electron) | 약 270MB |
| 빌드한 화면 (`.next`) | 약 100MB |
| 실습 튜터 (Node 24 · OpenCode) | 약 0.2~0.3GB |
| 기억 비교 모델 (처음 쓸 때 받음) | 약 300MB |

합쳐서 약 2~2.5GB입니다.

### AI 사용량

AI 호출은 로그인한 ChatGPT 계정의 사용량을 씁니다. PDF 50쪽 하나로 기억을 만들면 호출 16번쯤입니다.

## 시험

```bash
npm test                 # 249개 (파이썬을 실제로 돌리는 채점 시험 포함, AI 없음)
npx tsc --noEmit -p .    # 타입 검사
```

ChatGPT 없이 앱을 끝까지 돌리는 자체 시험: `tools/harness`(대역 모델 중계) · 가상 학습자: `tools/npc`.

## 폴더

| 폴더 | 무엇 |
|---|---|
| `src/` | 앱. 화면 `src/app/study`, API `src/app/api`, 기능 `src/lib` |
| `desktop/` | 데스크톱 창(Electron): 빌드 · 서버 켜고 끄기 |
| `experiments/project-course/` | 실습 코스 서버와 VS Code 연결 확장 |
| `tools/` | 자체 시험(harness) · 가상 학습자(npc) |
| `docs/` | 설계 · 동작 설명 · 측정 결과 · 구조도 |

## 라이선스 · 출처

- 글꼴 Pretendard: SIL Open Font License (`experiments/project-course/web/Pretendard-LICENSE.txt`)
- 알고리즘 문제 목록은 문제 번호 · 제목만 담고, 문제 원문은 담지 않습니다.
