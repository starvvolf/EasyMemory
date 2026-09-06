# 로컬 예제 실행 (2026-09-07)

문제는 텍스트/그림을 복붙하거나 첨부한다. 사이트를 지정할 필요가 없으며 링크는 선택적 출처다. 사이트 파서·로그인·스크래핑·다운로더·자동 제출을 사용하지 않는다.

## 지원 형식

| 언어 | 전체 프로그램 | 함수/메서드 | 이 환경의 검증 |
|---|---|---|---|
| Python 3 | 단일 .py, stdin/stdout | 모듈 최상위 일반 함수 | 기존 번들 Python 3.12.14 실제 fixture 통과 |
| Java | package 없는 단일 클래스의 main | public static 메서드 또는 인자 없는 생성자로 만드는 인스턴스 public 메서드 | JDK 23 실제 fixture 통과 |
| C# | 단일 .cs의 Main 또는 top-level 프로그램 | public static 또는 인자 없는 생성자의 인스턴스 public 메서드 | 어댑터/계획 검증 완료, .NET SDK 부재로 실제 컴파일/실행 미검증 |

함수형 공통 자료형: int(32비트), long(±9,007,199,254,740,991 안전 정수 범위), double(유한한 수), bool, string, 각 자료형의 1차원 배열. Python int 주석은 기본 int로 읽으므로 더 넓은 정수는 사용자 확인 화면에서 long으로 바꾼다. Python float는 double에 대응한다. Java/C# float 단정도는 지원하지 않는다.

함수형 입력은 **인자 순서의 JSON 배열**, 기대 출력은 **JSON 값**이다.

```text
solution(int a, int b)      입력 [1,2]             기대 3
solution(string[] words)   입력 [[" a ","b"]]    기대 [" a ","b"]
solution(string text)      입력 ["hello\nworld"]  기대 "hello\nworld"
```

후보 추출은 정적 텍스트 분석이며 소스를 실행/import하지 않는다. 후보가 여러 개면 사용자가 선택한다. 후보의 호출 이름, 클래스/정적 여부, 인자명/순서/자료형, 반환형을 확인·수정하고 등록된 예제를 확인해야 실행된다. 확인은 소스 SHA-256과 연결되어 코드를 수정하면 무효가 된다. 확인 뒤 UI 규격만 고친 경우에도 실행 버튼이 다시 비활성화된다.

지원하지 않는 형식: 사용자 정의 복잡 타입, 제네릭/사전/튜플, 다차원 배열, nullable/null 반환, void, ref/out/params/가변 인자/기본 인자, async 함수, Python 클래스 메서드, Java package/C# namespace 및 여러 클래스, 외부 라이브러리/다중 소스 의존성, SQL. 문법 후보를 찾지 못하거나 타입이 지원 범위 밖이면 이유를 표시한다. 전체 프로그램의 stdout 텍스트에는 함수형 자료형 제한을 적용하지 않는다. 숨은 테스트나 온라인저지의 합격을 판정하지 않는다.

## 실행·비교·종료

- 사용자의 실행 버튼에서만 실행한다. 문제 텍스트나 AI 출력에서 명령을 만들지 않는다.
- 선택한 파일은 저장 상태여야 한다. 읽은 소스를 독립 `study-forge-run-*` 임시 폴더에 복사하고 wrapper/main도 그 폴더에 만든다. 원본 파일과 원본 프로젝트는 수정·빌드하지 않는다.
- Python은 `-I -X utf8`로 단일 소스를 실행한다. 함수형은 별도 harness가 해당 모듈의 함수를 호출한다.
- Java는 실제 JDK 바이너리를 사용한다(Oracle PATH 중계 실행 파일을 직접 실행하지 않음). javac는 명시 소스, 임시 classpath/sourcepath, `-proc:none`으로 컴파일한다. 기존 annotation processor나 빌드 스크립트를 불러오지 않는다.
- C#은 SDK의 Roslyn csc.dll과 SDK 참조팩 DLL을 명시한다. `-noconfig -nostdlib+`를 적용하며 csproj/MSBuild/restore를 호출하지 않는다. 생성한 ModuleInitializer가 stdin/stdout을 UTF-8로 지정한다. .NET SDK 6 이상과 맞는 런타임/참조팩이 필요하다.
- 컴파일 10초, 예제당 3초. stdout+stderr는 합계 64KB, 함수 반환 JSON까지 합쳐 같은 예산을 적용한다. 컴파일/실행 오류와 실제 출력을 분리 표시한다.
- 전체 프로그램은 CRLF→LF와 마지막 줄바꿈 1개만 정규화한다. 앞뒤/중간 공백은 보존한다. 함수형은 JSON을 파싱해 자료형 검증 후 값·배열 순서를 정확히 비교한다. 문자열 공백 보존, 숫자는 임의 오차 허용 없음. 함수의 디버그 stdout은 반환값과 별도로 표시한다.
- Windows는 taskkill /pid /T /F로 자손까지 종료한다. 종료 확인이 거부되면 직접 자식을 정리하고 `termination-error`를 표시하며 후속 예제를 중단한다. 자손이 가진 pipe 때문에 UI가 무한 대기하지 않게 한다. POSIX는 별도 프로세스 그룹에 SIGKILL을 보낸다.
- 실행 종료 후 생성한 임시 폴더만 제거한다. 테스트도 자신이 만든 폴더/fixture PID만 정리한다.

## 런타임 확인 결과

- PATH Python/python3는 WindowsApps 별칭으로 일반 런타임으로 사용하지 않음. 일반 Python 설치는 발견하지 못했다. **이미 존재하는** Codex 번들 Python 3.12.14로 fixture를 검증했다. 실제 확장은 사용자 설정 `studyForge.pythonExecutable`에 사용자가 선택한 Python 3 경로를 지정하거나 정상 PATH 설치가 필요하다. 설치/설정 변경은 수행하지 않았다.
- JDK 23: java/javac 실행 가능. `java.home`으로 실제 바이너리를 찾고 출력 UTF-8을 지정해 한글 출력과 JVM 취소 문제를 해결했다.
- .NET: 6.0.11 런타임만 있으며 `dotnet --list-sdks`는 빈 결과. **.NET SDK 설치가 필요**하고 현재 C# 실행 버튼은 활성화되지 않는다. 런타임만 추가하는 것으로 해결되지 않는다. SDK를 설치하지 않았다.

## 검증

기존 대화/정리 모의 테스트와 언어 fixture를 함께 실행:

```powershell
$env:STUDY_FORGE_TEST_PYTHON = '<기존 Python 3 실행 파일 절대 경로>'
node --test tools/study-forge-vscode/test/*.test.cjs scripts/study-forge-vscode.test.cjs
```

Python/Java 각 전체 프로그램·함수형에서 정상/오답/오류/구문오류/시간초과/취소, 문자열/배열/기본자료형/한글/공백, 기본코드, 원본 무수정, stdout/반환값 출력 제한을 실제 프로세스로 검증했다. Windows 사용자 권한에서 각 언어의 timeout/cancel 자손 종료도 확인했다. 제한된 agent sandbox에서는 taskkill 트리 조회가 거부되므로 이 검증만 일반 사용자 권한으로 실행했다. 거부 경로는 별도 모의 종료기 테스트에서 명시적 실패·후속 중단을 검증한다.

최종 회귀 결과는 **40개 중 32개 통과, 8개 skip, 실패 0**이다. C# 8개 실행 테스트는 SDK 부재로 skip이며 성공으로 집계하지 않는다. C# wrapper 생성·입력검증·직접 csc 계획은 오프라인 테스트한다. SDK 설치 후 같은 suite로 실제 검증해야 한다.

브라우저 합성 webview fixture에서 다중 후보 미선택, 인자/반환형 편집, 확인 전 실행 비활성, 확인 후 활성, 규격 변경 후 재비활성까지 확인했다. 미리보기는 실제 코드 실행을 하지 않는다. VS Code 설치는 확인했으나 현재 native UI 제어 도구가 비활성이라 **실제 개발호스트/그림 붙여넣기 E2E는 미검증**이다.

ChatGPT 로그인·AI 실호출·배포는 계속 보류. 기존 원문 보존과 선택형 정리 정책을 유지한다.

공식 명령 근거: [Java javac](https://docs.oracle.com/en/java/javase/23/docs/specs/man/javac.html), [C# NoConfig](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/miscellaneous).
