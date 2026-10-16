# Study Forge 코딩 코치 1차 연결

## 목표

Study Forge 프로젝트, VS Code, GPT가 하나의 현재 코딩 학습 세션을 공유한다.

```text
Study Forge에서 목표·과제 시작
→ VS Code에서 프로젝트 연결
→ 선택 코드를 Ctrl+Alt+R로 제출
→ GPT가 MCP의 get_active_coding_session으로 목표·과제·최신 코드를 함께 읽음
```

## 현재 지원

- Study Forge 프로젝트별 코딩 학습 목표와 현재 과제 시작
- 한 프로젝트에 진행 중인 코딩 세션 하나 유지
- VS Code 코드 선택 제출
- 선택 영역 앞뒤 20줄을 보조 문맥으로 저장
- GPT용 MCP에서 가장 최근 세션 또는 지정 프로젝트 세션 조회
- 기존 PDF 프로젝트와 생성 흐름은 그대로 유지

## 사용 순서

1. Study Forge를 `npm.cmd run dev`로 실행한다.
2. 학습자료 화면에서 프로젝트를 고른다.
3. `코딩 학습`에 학습 목표와 현재 과제를 입력하고 `세션 시작`을 누른다.
4. VS Code에서 `tools/study-forge-vscode`를 확장 개발 경로로 실행한다.
5. 명령 팔레트에서 `Study Forge: 프로젝트 연결`을 실행한다.
6. 검토할 코드를 선택하고 `Ctrl+Alt+R`을 누른다.
7. GPT에서 Study Forge MCP를 선택하고 `현재 코딩 제출 검토해줘`라고 요청한다.

Study Forge 웹 서버가 3000번 포트가 아니라면 VS Code 설정의 `studyForge.serverUrl`을 바꾼다.

## GPT가 읽는 정보

```text
프로젝트 ID
학습 목표
현재 코딩 과제
VS Code 폴더 이름
제출 횟수
최신 파일 경로와 언어
선택 코드
선택 영역 주변 코드
직접 작성/AI 도움 여부(현재 기본값은 미지정)
```

GPT는 한 번의 제출만으로 실력 숙달을 확정하면 안 된다. 현재 단계에서는 코칭에 필요한 같은 맥락을 전달하는 데 집중한다.

## 아직 하지 않은 것

- GPT 답변 자동 저장
- 수정 전후 코드 연결
- 능력별 실력 평가
- GPT가 사용자 메시지 없이 스스로 응답하는 기능
- VS Code 확장 배포용 VSIX 패키징
- ChatGPT 원격 MCP 배포와 인증

이 항목들은 현재 제출 흐름을 실제로 사용해 본 뒤 순서대로 붙인다.
