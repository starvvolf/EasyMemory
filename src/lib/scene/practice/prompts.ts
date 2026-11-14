// 실습 전용 형식의 장면 지시문(AI 1번): 13 어디에 넣을까 · 15 명령 한 줄. 정답 · 오답 값은 쓰지 않게 한다(코드가 돌려서 만든다).
// 14 시간 순서 표는 AI 없이 은행, 16 작은 재현 프로젝트는 실습 서버(lib/scene-folders.ts PROJECT_SYSTEM), 17은 AI 없이 저장본.
import { S } from "../../assist/model.ts";

export const WHERE_SYSTEM = `너는 실습 복습 장면 "어디에 넣을까"를 만든다. 학습자가 실습에서 놓친 생각(빈틈) 하나를, 코드의 어느 줄 범위에 잠금 · 트랜잭션 · await · 검사를 넣어야 하는지 고르는 작은 과제로 만든다.

## 프로그램
- code: 돌아가는 전체 프로그램(주어진 언어, 40줄 이하). 표준 입력에서 숫자 하나(동시에 오는 요청 수 등)를 읽는다. 출력은 한 단어: 맞으면 ok, 어긋나면 lost(또는 그 상황에 맞는 영어 한 단어 둘).
- 아무것도 넣지 않으면 늘 어긋나야 한다: 읽기와 쓰기 사이에 일부러 쉬게(sleep · Thread.Sleep · await sleep) 만든다. 매번 같은 출력이어야 한다(우연히 맞는 일이 없게).
- 넣을 것(guard)의 코드 before · after는 code에 이미 있는 이름만 쓴다(예: before "lock (gate) {", after "}" / 파이썬 before "with gate:", after ""). 잠금 객체 같은 준비는 code 안에 이미 만들어 둔다.
- regionFrom~regionTo: 학습자가 고를 수 있는 줄(1부터, 함수 몸통 3~8줄). answerFrom~answerTo: 모범 범위. mineFrom~mineTo: 그때 학습자가 넣은 범위(빈틈의 그때 생각대로, 예: 쓰기 줄에만). mineWhat: 그 생각 한 구절.
- 코드가 그 범위의 줄을 한 칸 더 들여 쓰고 앞에 before, 뒤에 after를 넣어 돌린다. 범위 안에서 만든 변수를 범위 밖에서 쓰지 않게 짠다.
- others: 흔한 다른 틀린 범위 0~2개(id 짧은 영어). alsoRight: (확인할 것이 ability일 때) 고를 수 있는 줄 전체를 바꾸는 다른 맞는 고침(예: Interlocked.Add, 원자적 갱신). form이면 빈 목록.
- inputs: 표준 입력 4개. 하나는 요청이 하나뿐이라 누구나 맞는 것("1"), 나머지 셋은 어긋나는 것("2", "3", "5" 꼴).
## 글
- story: 상황 2문장(무엇을 하는 코드인지, 입력 · 출력의 뜻). ask: 무엇을 고르는지 한 문장. explain: 맞는 생각 한 문장. 한국어로. 무슨 빈틈인지 story에 쓰지 않는다.
- distance가 far면 원래 실습과 다른 겉모습(다른 주제 · 이름)으로.`;
export const WHERE_SCHEMA = S.obj({ story: S.str, ask: S.str, explain: S.str, guard: S.oneOf("lock", "transaction", "await", "check"), before: S.str, after: S.str, code: S.str,
  regionFrom: S.int, regionTo: S.int, answerFrom: S.int, answerTo: S.int, mineFrom: S.int, mineTo: S.int, mineWhat: S.str,
  others: S.arr(S.obj({ id: S.str, from: S.int, to: S.int, what: S.str })), alsoRight: S.arr(S.obj({ what: S.str, code: S.str })), inputs: S.arr(S.str) });

export const COMMAND_SYSTEM = `너는 실습 복습 장면 "명령 · 설정 한 줄"을 만든다. 학습자가 실습에서 막혔던 실행 · 도구 빈틈 하나를, 터미널 명령(또는 설정 한 줄) 하나를 쓰는 과제로 만든다.
- task: 무엇을 하는 명령인지 한 구절(예: "솔루션 폴더에서 서버 프로젝트만 실행").
- reference: 모범 명령 한 줄. alsoRight: 같은 일을 하는 다른 맞는 명령들(옵션 순서만 다른 것은 코드가 알아서 같게 보니 쓰지 않아도 된다).
- mine: 그때 학습자가 친 명령(빈틈의 그때 생각대로). mineWhat: 그 생각 한 구절. others: 흔한 다른 틀린 명령 0~2개.
- files: 이 명령을 실제로 돌려 볼 아주 작은 예제 폴더(파일 1~3개, 각 30줄 이하). node · python · dotnet 명령이고 돌려서 결과가 나오는 것일 때만. 설치 · 네트워크 · 포트가 필요하면 빈 목록.
- 셸 연결(; | > &&)은 쓰지 않는다. 단 "cd 폴더 && 명령"은 된다.
- story: 상황 2문장(폴더 모양 등), ask: 무엇을 쓰는지 한 문장, explain: 맞는 생각 한 문장. 한국어로. distance가 far면 다른 겉모습으로.`;
export const COMMAND_SCHEMA = S.obj({ story: S.str, ask: S.str, explain: S.str, task: S.str, reference: S.str, alsoRight: S.arr(S.str), mineWhat: S.str, mine: S.str,
  others: S.arr(S.obj({ id: S.str, what: S.str, command: S.str })), files: S.arr(S.obj({ path: S.str, text: S.str })) });
