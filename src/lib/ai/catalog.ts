// AI 호출 대장 (2026-11-06, AI 호출 실험실): 호출 종류마다 사람이 읽는 이름과 "지시문이 대충 뭐라고 하는지" 한두 줄.
// 볼 때마다 AI로 요약하지 않고 여기 써 둔다(비용 0, 말이 매번 같음). 지시문을 크게 바꾸면 여기도 고친다.
// 원문은 코드: 알고리즘 src/lib/assist/code-ai.ts, 지식 src/lib/assist/knowledge-ai.ts 등, PDF 엔진 src/lib/study/gen/(lab/프롬프트/).
export type CatalogEntry = { title: string; does: string; input?: string; output?: string };

export const ASSIST_CATALOG: Record<string, CatalogEntry> = {
  // 알고리즘 (A)
  "code:hint": { title: "힌트", does: "튜터 지시: 학습자가 스스로 고치게, 채점은 채점기가 정하니 맞다·틀리다 단정 금지. 단계(1~3)만큼만 짚고 고친 코드는 주지 않는다. 지난 막힘 기록이 같으면 \"지난번에도\"로.", input: "문제 글 · 학습자 코드 · 마지막 채점 결과 · 이번 풀이의 힌트 기록", output: "힌트 글" },
  "code:explain": { title: "코드 설명", does: "학습자가 고른 코드 줄이 무엇을 하는지 쉬운 말로. 답은 주지 않는다.", input: "고른 줄 · 코드 전체 · 질문", output: "설명 글" },
  "code:review": { title: "풀이 방향 검토", does: "제출 전 생각한 방향이 맞는지, 놓친 조건이 있는지 짚는다(heavy: 강도 medium).", input: "문제 · 코드 · 메모", output: "검토 글" },
  "code:error": { title: "오류 설명", does: "에러가 무슨 뜻인지, 몇 번째 줄 무엇 때문인지 쉬운 말로. 고치는 방향만, 고친 코드는 주지 않는다.", input: "코드 · 오류 글", output: "설명 글" },
  "code:counter": { title: "반례 후보", does: "학습자 코드를 깨뜨릴 만한 작고 까다로운 입력들을 제안. 실제로 깨지는지는 모범 풀이와 학습자 코드를 돌려 코드가 판정.", input: "문제 · 학습자 코드", output: "입력 후보 목록(JSON)" },
  "code:find": { title: "문제 찾아오기", does: "AI 웹 검색으로 다음에 풀 실제 문제 후보 3~5개(백준 먼저). 최근 한 것·푼 문제·다음에 배울 패턴으로 수준을 맞춘다. 이미 있는 문제는 코드가 거른다.", input: "요청 · 최근 기록 · 푼 문제 · 다음 패턴", output: "후보 목록(JSON)" },
  "code:make": { title: "문제 만들기(초안)", does: "주제·강의 글·붙여 넣은 문제로 표준 입출력 문제를 세팅: 문제 글, 제약, 모범 풀이, 단순 풀이(brute), 지식 이름. 원문이 있으면 원문 그대로.", input: "주제 또는 강의 글 · 원문 문제", output: "문제 초안(JSON)" },
  "code:generator": { title: "숨은 테스트 생성기", does: "입력 형식·제약을 그대로 지키는 테스트 입력 생성기를 JavaScript로. 정답은 모범 풀이가 낸다.", input: "문제 글 · 제약", output: "생성기 코드(JSON)" },
  "code:mutants": { title: "틀린 풀이들", does: "흔한 실수(경계값, off-by-one, 오버플로, 잘못된 그리디, 시간 초과…)가 든 틀린 풀이 3~5개. 숨은 테스트가 이걸 다 잡는지 코드가 확인.", input: "문제 글", output: "틀린 풀이 목록(JSON)" },
  "code:solve": { title: "독립 풀이(대조용)", does: "문제 글과 예제만 보고 처음부터 따로 푼다. 모범 풀이와 출력을 대조해 문제가 맞게 세팅됐는지 확인.", input: "문제 글 · 예제", output: "풀이 코드(JSON)" },
  "code:watch": { title: "코드 보며 조언", does: "코치 지시: 모범 풀이는 판단에만, 코드·식·기법 이름 먼저 금지. 지금 코드에서 어긋난 곳 한 줄.", input: "문제 · 지금 코드 · 실행 사실", output: "상태 · 짚을 것(JSON)" },
  "code:train-*": { title: "훈련 단계 판정", does: "7단계 훈련(이해→추상화→탐색→정당성→복잡도→구현→복기)에서 이 단계 답을 판정. 모범 풀이는 보여 주지 않는다.", input: "단계 · 학습자 답 · 모범 풀이", output: "상태 · 한마디(JSON)" },
  "code:train-ask": { title: "훈련 중 질문", does: "코드 쓰기 전 훈련 중 질문에 3~5문장. 다음 단계의 답을 요구하면 지금 단계에서 정리할 것부터.", input: "단계 · 지금까지 답 · 질문", output: "답 글" },
  "code:train-review": { title: "풀이 복기", does: "훈련 기록으로 생각·막힌 곳·다음에 쓸 것을 학습자 말투로 짧게.", input: "단계별 답 · 첫 틀림 · 통과", output: "idea · stuck · transfer(JSON)" },
  // 지식 (B)
  "knowledge:extract": { title: "웹 글 지식 잡기", does: "글에서 배울 지식 후보를 뽑는다(이름 · 뜻 · 근거 인용).", input: "글 본문", output: "지식 후보(JSON)" },
  "knowledge:map": { title: "웹 글 지도", does: "글 전체의 핵심 주제·흐름·용어를 한 번에.", input: "글 본문", output: "글 지도(JSON)" },
  "knowledge:classify": { title: "지식 종류 나누기", does: "지식 후보마다 종류(개념·절차·규칙…)와 폴더.", input: "지식 후보", output: "종류(JSON)" },
  "knowledge:dedupe": { title: "같은 지식 판정", does: "비슷한 이름·뜻의 두 지식이 같은 것인지 판정(합칠지).", input: "지식 두 개", output: "같음/다름(JSON)" },
  "knowledge:layer": { title: "지식 겹 만들기", does: "지식 하나를 핵심·조건·예시 겹으로 정리.", input: "지식 · 근거", output: "겹(JSON)" },
  "knowledge:claim": { title: "주장 채점", does: "학습자가 쓴 설명이 지식과 맞는지 맞음·일부·틀림과 빠진 점.", input: "지식 · 학습자 설명", output: "판정(JSON)" },
  "knowledge:explain": { title: "지식 설명", does: "지식 하나를 쉬운 말로 다시 설명.", input: "지식", output: "설명 글" },
  "knowledge:explain-item": { title: "카드 설명", does: "지식 창에서 카드 하나를 설명.", input: "지식", output: "설명 글" },
  "knowledge:ask": { title: "지식에 묻기", does: "학습자 질문에 지식과 출처를 근거로 답.", input: "질문 · 관련 지식", output: "답 글" },
  "knowledge:fill": { title: "빈 칸 채우기", does: "지식의 빈 칸(예시 등)을 채운다.", input: "지식", output: "채운 칸(JSON)" },
};

/** PDF 엔진 단계(이름은 types.ts genStepLabel). 지시문 설명은 lab/프롬프트/ 와 같은 내용을 줄인 것. */
export const GEN_CATALOG: Record<string, CatalogEntry> = {
  "rc-digest-plan": { title: "목차·성격", does: "자료 전체(쪽마다 글 + 그림 쪽 이미지)를 읽고 목차를 쓴다: 주제마다 큰 주제·제목·쪽·성격, 항목(tN-cK)까지. 끝 표시(<<<OUTLINE_END>>>)를 써야 카드가 시작된다.", input: "모든 쪽 글자 층 + 그림 쪽 이미지(1024px)", output: "목차 글" },
  "rc-digest-card": { title: "주제별 카드", does: "카드 공통 지시(종류·모양·근거 인용·오답 메모·제목 규칙) + 항목마다 원문을 읽고 카드를 만들라는 지시 + 정리 기준(출제기준 폴더).", input: "주제 · 항목 줄 · 그 쪽 원문·그림 · 용어 목록", output: "카드(JSON)" },
  "rc-digest-one": { title: "정리 글 한 번", does: "목차 다음 주제 요약 글을 한 번에(같은 앞부분으로 캐시).", input: "자료 전체 + 목차", output: "정리 글" },
  "rc-topic": { title: "주제 요약", does: "주제 하나의 본문 줄 3~7개, 정리 한 줄, 쉬운 설명과 흔한 오해. 성격마다 규칙이 다르다.", input: "주제 · 그 쪽 원문", output: "요약 글" },
  "rc-skeleton": { title: "정리 뼈대", does: "쪽 목록으로 주제 뼈대를 잡는다.", input: "쪽 제목·글", output: "뼈대 글" },
  "rc-wrap": { title: "개요·핵심 정리", does: "맨 앞 개요 두 문장과 주제마다 시험 전에 볼 것 한 줄.", input: "목차 · 주제 본문 줄 · 개요 쪽", output: "개요 글" },
  "rc-q-goals": { title: "학습 목표", does: "시험이라면 확인할 학습 목표 6~12개. 동사(떠올리기·구별·판정·계산·설명)가 문제 형식을 정한다. 목표형이면 목표마다 주는 것(상황)·내는 것(답 종류)까지.", input: "목차 · 자료 전체 글", output: "목표 목록" },
  "rc-organize": { title: "쪽 카드", does: "쪽 하나의 글·그림으로 지식 카드 1~3장(근거 인용 필수).", input: "쪽 글 + 그 쪽 그림 + 목차 힌트", output: "카드(JSON)" },
  "rc-intent": { title: "쪽 의도", does: "모든 쪽 썸네일을 한 번에 보고 쪽마다 표지·예고·정의·예제·요약 등을 정한다.", input: "쪽 썸네일(저화질)", output: "쪽 의도(JSON)" },
  "rc-merge": { title: "자료 전체 정리", does: "카드 전부를 보고 주제 흐름, 핵심(1/3 이하), 같은 지식, 이름 고치기, 연결. 바뀐 것만 답한다.", input: "모든 카드 · 쪽 목차", output: "정리(JSON)" },
  "rc-q-pick": { title: "출제 고르기", does: "학습 목표 하나에 문항 하나, 목표 동사로 형식(상황 객관식·서술·빈칸)을 고르고 출제할 카드를 정한다.", input: "목표 · 카드 줄", output: "고른 문항(JSON)" },
  "rc-q-case": { title: "상황 판정 문제", does: "상황·질문·가능한 판정 전부를 보기로 한 번에. 정답 말이 질문에 새는지는 코드가 본다.", input: "카드 · 목표 · 원문", output: "문제(JSON)" },
  "rc-q-material": { title: "문제 재료", does: "맞는 진술 3개와 오개념 쌍 5개(한 단어만 다른 맞는/틀린 문장).", input: "카드 · 물을 지점 · 원문", output: "재료(JSON)" },
  "rc-q-choice": { title: "객관식 재료", does: "객관식 문제 글, 정답, 오답 후보 6개. 상황형 우선.", input: "재료", output: "문제(JSON)" },
  "rc-q-score": { title: "오답 점수", does: "오답 후보마다 틀림 확실·그럴듯함을 매기고 정답이 질문에 맞는지. 코드가 3개를 고른다.", input: "문제 · 정답 · 후보", output: "점수(JSON)" },
  "rc-q-cloze": { title: "빈칸 재료", does: "빈칸 문장 하나와 비울 말 후보 3개. 코드가 일반어·답 노출을 거른다.", input: "카드 · 원문", output: "빈칸(JSON)" },
  "rc-q-write": { title: "서술 문제", does: "왜·어떻게를 2~3문장으로 설명하게 하는 질문, 모범 답, 채점 요소.", input: "카드 · 목표", output: "문제(JSON)" },
  "rc-q-explain": { title: "힌트·해설", does: "다 만든 문제에 힌트, 보기별 한 줄 설명, 해설.", input: "카드 · 문제", output: "해설(JSON)" },
  "rc-solve": { title: "따로 풀기", does: "정답을 모른 채 근거 쪽만 보고 문제를 푼다. 답이 하나로 안 정해지거나 다르면 버린다.", input: "문제 · 근거 쪽", output: "답(JSON)" },
  "rc-check": { title: "묶음 검토", does: "만든 문제 묶음을 같이 보고 겹침·오류를 짚는다.", input: "문제들", output: "검토(JSON)" },
  "rc-author": { title: "기본 문제", does: "카드 하나로 기본 문제를 쓴다(옛 흐름).", input: "카드", output: "문제(JSON)" },
  "rc-deep": { title: "심화 문제", does: "카드 여러 장을 엮는 심화 문제.", input: "카드들", output: "문제(JSON)" },
  "rc-flow": { title: "흐름 카드", does: "카드 다음에 절차 흐름 카드를 만든다.", input: "카드들", output: "카드(JSON)" },
  "rc-link": { title: "연결 묶기", does: "카드 사이 관계(선행·포함·비교)를 묶는다.", input: "카드들", output: "연결(JSON)" },
  "rc-summary": { title: "정리 글", does: "자료 정리 글.", input: "카드", output: "글" },
};

export const TUTOR_CATALOG: CatalogEntry = { title: "튜터 한 차례", does: "Codex 자체 지시문(바꿀 수 없음, 큼) + 우리 튜터 안내(첫 차례) + 학습자 메모리·목표 맥락 + 파일 고치기 허용 여부 + 학습자 말. MCP 도구로 학습 기록·작업 폴더 파일을 읽는다.", input: "학습자 말 + 붙인 맥락", output: "답 · 도구 호출" };

export function assistEntry(purpose: string): CatalogEntry | null {
  if (ASSIST_CATALOG[purpose]) return ASSIST_CATALOG[purpose];
  const wild = Object.keys(ASSIST_CATALOG).find((k) => k.endsWith("*") && purpose.startsWith(k.slice(0, -1)));
  return wild ? ASSIST_CATALOG[wild] : null;
}
