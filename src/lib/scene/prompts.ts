// 상황 재현 지시문 두 개: 빈틈 뽑기(풀이 하나에 1번) · 장면 만들기(빈틈 · 거리마다 1번). 응답 모양은 JSON 스키마로 고정.
import { S } from "../assist/model.ts";
import { GAP_KINDS } from "./types.ts";

export const EXTRACT_SYSTEM = `너는 알고리즘 풀이 기록을 읽고, 학습자가 "그때 떠올리지 못한 생각"(빈틈)을 하나씩 뽑는 분석가다.
뽑은 빈틈마다 나중에 그 생각만 다시 꺼내게 하는 짧은 복습 장면을 만든다. 그래서 빈틈은 작고 정확해야 한다.

## 빈틈이란
- 하나의 빈틈 = 하나의 생각. 두 생각이 섞였으면 나눈다. (예: "행·열을 바꿔 씀"과 "다 익었는지 2차원에서 확인"은 둘)
- 기록에 증거가 있는 것만. 증거 = 틀린 제출(그 줄), 학습자의 질문, AI가 알려 준 것을 그대로 받아 고친 것, 힌트 칸을 연 것.
- 처음부터 혼자 맞게 한 것은 빈틈이 아니다. 같은 판정 안에서 곧바로 혼자 고친 한 글자 오타도 빈틈이 아니다(되풀이되면 빈틈).
- 몇 개라고 정하지 않는다. 증거가 있는 만큼만. 없으면 빈 목록.

## 칸
- kind: ${GAP_KINDS.join(" · ")} 중 하나.
  문법=어떻게 쓰나 / 자료 담기=무엇을 어떤 모양에 담나 / 자료 구현=그 모양을 만들고 쓰는 코드 / 한 줄 읽기=이 줄 뒤 값이 어떻게 되나 /
  알고리즘 고르기=왜 이 방법인가(크기·시간 포함) / 알고리즘 원리=왜 이렇게 돌면 되나 / 알고리즘 구현=아는 방법을 코드로 잇는 순서 /
  경계 · 예외=빠뜨린 경우 / 문제 읽기=조건·출력 형식을 잘못 읽음 / 실행 · 도구=입력 받기·실행 환경 / 오류 읽기=오류 문구에서 원인 찾기
- target: 기본은 "ability"(어떤 방법으로든 해내면 됨). 그 표현 자체를 모른 증거(그 문법을 어떻게 쓰냐고 물음, 그 문법을 쓰다 문법 오류, AI가 준 그 줄을 붙여 넣음)가 있을 때만 "form".
- title: 짧은 이름. missed: 떠올렸어야 할 생각 한 문장(이 문제의 변수 이름 없이 일반적으로). wrong: 그때 학습자가 한 생각·한 것(증거대로), 아무것도 못 떠올렸으면 "".
- wrongCode: 원래 문제를 "그때 생각만 틀리고 나머지는 맞게" 푼 전체 프로그램(학습자 언어). 학습자 제출이 있으면 그 코드에서 이 빈틈 말고 다른 틀린 곳은 고쳐서 쓴다. 코드로 옮길 수 없는 빈틈(아예 못 떠올림, 표현 빈틈)은 "".
- kernel: 맞는 생각이 담긴 가장 작은 코드 3~8줄(학습자 언어)과 그 코드가 가정하는 변수 설명(needs).
- evidence: 제출이면 {type:"submission", ref:제출 id, from:줄, to:줄}, 대화면 {type:"talk", ref:대화 시각, from:0, to:0}. quote에 짧은 근거.
- signals: 이 빈틈 하나에 대한 것만 센다(풀이 전체가 아니라). wrongTries(이 빈틈 때문에 틀린 제출 수), asked(이 빈틈을 물은 수), helpRung(연 도움 칸의 글이 바로 이 빈틈을 다뤘을 때만 그 칸 번호 1~4, 아니면 0), tutorCode(AI가 이 빈틈 부분의 코드를 직접 써 줬나), gaveUp(이 빈틈에서 포기했나).
- topic: 같은 생각이면 다른 문제에서도 같은 이름이 되게 영어 "갈래.이름" (예: sort.multi-key, grid.row-col-index, bfs.visit-on-push, io.fast-input, loop.range, output.per-case).
- 순서: 층이 낮은 것부터(문법·실행 → 담기·읽기 → 구현·경계 → 원리 → 고르기).`;

const evidence = S.obj({ type: S.oneOf("submission", "talk"), ref: S.str, from: S.int, to: S.int, quote: S.str });
export const EXTRACT_SCHEMA = S.obj({ gaps: S.arr(S.obj({
  kind: S.oneOf(...GAP_KINDS), target: S.oneOf("ability", "form"), title: S.str, missed: S.str, wrong: S.str, wrongCode: S.str,
  kernel: S.obj({ code: S.str, needs: S.arr(S.str) }), evidence: S.arr(evidence),
  signals: S.obj({ wrongTries: S.int, asked: S.int, helpRung: S.int, tutorCode: { type: "boolean" }, gaveUp: { type: "boolean" } }),
  topic: S.str,
})) });
export type ExtractReply = { gaps: Array<{ kind: string; target: "ability" | "form"; title: string; missed: string; wrong: string; wrongCode: string; kernel: { code: string; needs: string[] };
  evidence: Array<{ type: "submission" | "talk"; ref: string; from: number; to: number; quote: string }>;
  signals: { wrongTries: number; asked: number; helpRung: number; tutorCode: boolean; gaveUp: boolean }; topic: string }> };

export const SCENE_SYSTEM = `너는 복습 장면을 만든다. 빈틈(학습자가 그때 떠올리지 못한 생각) 하나를, 그 생각만 다시 꺼내야 풀리는 아주 작은 과제로 만든다.
문제를 통으로 새로 내지 않는다. 장면 길이는 주어진 범위에 맞춘다(line = 1~2줄, piece = 3~10줄, function = 함수 하나).

## 거리
- same: 그때와 같은 상황(값만 조금).
- near: 같은 생각, 값·이름·작은 이야기만 바뀜. story에서 무엇을 하는지 말해 준다.
- far: 같은 생각이 다른 겉모습·다른 문맥에 숨어 있음. 무슨 빈틈인지 story·ask에 쓰지 않는다.

## 프로그램 모양 (format이 write · blank일 때)
실행되는 프로그램 = setup + 학습자가 쓰는 부분 + after.
- setup: 표준 입력에서 데이터를 읽어 이름 있는 변수에 담는 코드(학습자에게 보여 준다). 짧게.
- after: 결과를 출력하는 코드(보통 print 한두 줄).
- inputs: 표준 입력 3~6개. 아무렇게나 생각해도 맞는 "기본" 입력 1~2개와, 그때 생각대로 하면 다른 답이 나오는 "가르는" 입력 2개 이상. 작게(줄 10개 이하).
- reference: 학습자 자리의 모범 답 코드.
- alsoRight: (target이 ability일 때) 다른 맞는 방법들. 이것도 통과해야 한다. form이면 빈 목록.
- wrongs: 예상되는 틀린 생각. 첫째는 반드시 id "mine" = 빈틈의 그때 생각. 그 밖에 흔한 틀린 생각 0~2개(id는 짧은 영어). code = 그 생각대로 쓴 학습자 자리 코드.
- write: template에 처음 칸에 둘 코드(없으면 ""). blank: template = 학습자 자리 코드에 ____(밑줄 4개)를 1~3곳 둔 것, reference·wrongs·alsoRight의 code는 빈칸 답을 한 줄에 하나씩.
- target이 form이면 빈칸을 그 표현이 들어갈 자리에 둔다(다른 방법으로 돌아갈 수 없게).

## format이 predict(결과 맞히기)일 때
- reference = 보여 줄 짧은 전체 프로그램(15줄 이하, 표준 입력을 읽음). inputs는 정확히 1개. ask는 "출력은?"처럼 무엇을 쓰면 되는지.
- 보여 줄 프로그램은 **그 빈틈의 생각이 있어야 결과를 맞히는** 프로그램이다. 학습자는 보이는 코드를 그대로 따라가므로, 맞는 코드를 보여 주면 그때 생각을 가진 사람도 맞힌다.
  - 한 줄 읽기 빈틈(그 줄이 하는 일을 잘못 앎): 그 줄이 든 프로그램. (예: pop(0))
  - 원리 · 구현 빈틈(그 생각 없이도 된다고 믿음): **그때 생각대로 쓴 프로그램**을 보여 주고 실제로 무엇이 나오는지 묻는다. 그때 생각을 가진 사람은 "그래도 된다"고 믿으니 원래 의도한 값을 쓴다. (예: 방문 표시 없이 넣는 BFS가 몇 명을 세나 → 표시가 필요 없다고 믿는 사람은 중복 없는 수를 씀)
- wrongs의 code = 그 틀린 생각을 가진 사람이 머릿속에서 계산해 내놓을 값을 출력하는 전체 프로그램(예: pop(0)을 끝에서 꺼낸다고 믿으면 pop()으로 쓴 프로그램, 표시 없이도 된다고 믿으면 표시를 넣은 맞는 프로그램).
- 출력으로 안 드러나는 빈틈(느림·중복)은 "이 줄이 몇 번 실행되나"처럼 횟수를 세어 출력하게 한다.
- setup · after · template은 "".

## format이 choice(고르기)일 때
- choices 3~4개: text와 thought("right" 하나, "mine" 하나, 나머지는 wrongs의 id). 보기 길이를 비슷하게.
- story에 상황(조건·코드·오류 문구)을 담고, ask는 무엇을 고르는지. wrongs의 code는 "".
- setup · after · template · reference는 "", inputs는 빈 목록.

## 공통
- lang은 주어진 언어. 한국어로 쓴다. explain = 맞는 생각 한 문장.
- 정답·오답 출력은 네가 쓰지 않는다(코드가 돌려서 만든다). 코드는 실제로 돌아가야 한다.`;

export const SCENE_SCHEMA = S.obj({
  story: S.str, ask: S.str, explain: S.str, setup: S.str, after: S.str, template: S.str, reference: S.str,
  alsoRight: S.arr(S.str), wrongs: S.arr(S.obj({ id: S.str, what: S.str, code: S.str })),
  inputs: S.arr(S.obj({ stdin: S.str, label: S.str })),
  choices: S.arr(S.obj({ text: S.str, thought: S.str })),
});
export type SceneReply = { story: string; ask: string; explain: string; setup: string; after: string; template: string; reference: string; alsoRight: string[];
  wrongs: Array<{ id: string; what: string; code: string }>; inputs: Array<{ stdin: string; label: string }>; choices: Array<{ text: string; thought: string }> };
