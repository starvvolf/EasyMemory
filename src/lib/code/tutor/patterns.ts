// PS 튜터 (2026-11-08, 사용자 결정 "접근을 체화시킨다"): PS 패턴 목록. 손으로 정의한 고정 목록이고, 교육용 문제 모델(AI)은
// 이 id 중에서만 고른다(problem-model.ts가 대조). 사다리(../grade.ts) 칸과 이어 두어 "필요한 능력"과 같은 말로 보인다.
// 설계: 프로젝트 문서 claude/설계토론_PS튜터_학습운영모델_20261108.md
export type Pattern = {
  id: string; name: string;
  /** 바킹독 단원(chapter 코드). 처음 배우는 순서도 이 순서를 따른다. */ chapters: string[];
  /** 사다리 칸 id (grade.ts LADDER) */ ability: string;
  what: string;
  /** 이 패턴을 떠올리게 하는 문제의 신호 */ signals: string[];
  /** 흔한 실수 */ pitfalls: string[];
};

export const PATTERNS: Pattern[] = [
  { id: "count-array", name: "값을 인덱스로 세기", chapters: ["0x03"], ability: "array", what: "값 자체를 배열 칸 번호로 써서 몇 번 나왔는지 센다",
    signals: ["값의 범위가 작다(예: 0~100만)", "몇 번 나오는지·있는지 묻는다"], pitfalls: ["음수 값은 더해서 0부터 시작하게 옮겨야 한다", "범위 밖 칸을 쓴다"] },
  { id: "exist-table", name: "있는지 표로 짝 찾기", chapters: ["0x03"], ability: "array", what: "본 값을 표에 표시해 두고, 짝(X - 값)이 이미 있는지 바로 본다",
    signals: ["두 수의 합·차가 X인 쌍", "N이 커서 모든 쌍을 볼 수 없다"], pitfalls: ["자기 자신과 짝을 지어 버린다", "같은 쌍을 두 번 센다"] },
  { id: "min-max-init", name: "최솟값·최댓값 초기값", chapters: ["0x03", "0x02"], ability: "array", what: "최솟값은 아주 큰 수나 첫 값으로, 최댓값은 아주 작은 수나 첫 값으로 시작한다",
    signals: ["가장 작은·큰 값을 구한다"], pitfalls: ["0으로 시작해서 음수 입력에서 틀린다"] },
  { id: "cursor-list", name: "커서 앞뒤로 편집", chapters: ["0x04"], ability: "linked", what: "커서 위치에서 넣고 지우는 일이 많으면 연결 리스트나 스택 두 개로 앞뒤를 나눈다",
    signals: ["커서를 옮기며 글자를 넣고 지운다", "중간 삽입·삭제가 아주 많다"], pitfalls: ["배열 중간 삽입은 한 번에 O(N)이라 전체가 느려진다", "맨 앞·맨 뒤에서 커서를 더 옮긴다"] },
  { id: "stack-match", name: "짝 맞추기 스택", chapters: ["0x08", "0x05"], ability: "stack", what: "여는 것을 쌓고 닫는 것이 나오면 맨 위와 짝이 맞는지 본다",
    signals: ["괄호", "가장 최근 것과 짝을 짓는다"], pitfalls: ["끝난 뒤 스택이 비었는지 확인하지 않는다", "빈 스택에서 꺼낸다"] },
  { id: "stack-mono", name: "단조 스택", chapters: ["0x05"], ability: "stack", what: "스택에 커지거나 작아지는 순서만 남겨, 가장 가까운 큰(작은) 값을 한 번에 찾는다",
    signals: ["왼쪽·오른쪽에서 처음 만나는 더 큰 값", "N이 커서 이중 반복이 안 된다"], pitfalls: ["꺼내는 조건의 같음(≤/<)을 틀린다", "답을 기록하는 시점을 틀린다"] },
  { id: "queue-sim", name: "큐로 차례 흉내 내기", chapters: ["0x06"], ability: "queue", what: "먼저 온 것이 먼저 나가는 차례를 큐로 그대로 흉내 낸다",
    signals: ["줄을 서고 앞에서부터 처리", "맨 앞을 빼서 뒤로 보낸다"], pitfalls: ["배열 앞에서 빼기(shift)를 반복해 느려진다"] },
  { id: "deque-both", name: "양쪽 끝 덱", chapters: ["0x07"], ability: "queue", what: "앞과 뒤 양쪽에서 넣고 빼야 하면 덱을 쓴다",
    signals: ["앞뒤로 회전", "뒤집기를 실제로 하지 않고 방향만 바꾼다"], pitfalls: ["정말로 뒤집어서 O(N)을 반복한다", "빈 덱에서 꺼낸다"] },
  { id: "grid-dxdy", name: "격자 사방 탐색", chapters: ["0x09"], ability: "grid", what: "dx, dy 배열로 상하좌우 이웃을 돌고, 먼저 경계를 검사한다",
    signals: ["격자·지도·칸", "상하좌우로 이동"], pitfalls: ["경계 검사 전에 칸을 읽는다", "행·열(x·y)을 뒤바꾼다"] },
  { id: "visited", name: "방문 표시", chapters: ["0x09"], ability: "graph", what: "한 번 넣은 칸은 표시해서 다시 넣지 않는다",
    signals: ["같은 칸에 여러 길로 갈 수 있다"], pitfalls: ["꺼낼 때 표시해서 같은 칸이 큐에 여러 번 들어간다"] },
  { id: "bfs-distance", name: "거리 배열 BFS", chapters: ["0x09"], ability: "graph", what: "시작점에서 한 칸씩 퍼지며 거리 배열에 (이전 거리 + 1)을 적는다",
    signals: ["최소 이동 횟수", "가중치가 모두 같다"], pitfalls: ["DFS로 최단 거리를 구한다", "도달 못 하는 경우를 처리하지 않는다"] },
  { id: "multi-source", name: "시작점 여러 개 BFS", chapters: ["0x09"], ability: "graph", what: "시작점을 처음에 모두 큐에 넣고 동시에 퍼뜨린다",
    signals: ["여러 곳에서 동시에 퍼진다(익는다·번진다)"], pitfalls: ["시작점마다 따로 BFS를 돌려 느려진다"] },
  { id: "components", name: "덩어리 세기", chapters: ["0x09"], ability: "graph", what: "아직 안 간 칸에서 탐색을 시작할 때마다 덩어리 하나를 센다",
    signals: ["연결된 영역의 개수·크기"], pitfalls: ["새 탐색마다 크기를 다시 0으로 두지 않는다"] },
  { id: "recursion-reduce", name: "작은 문제로 줄이기", chapters: ["0x0B"], ability: "recursion", what: "끝나는 경우(기저)를 정하고, n의 답을 n-1(더 작은 것)의 답으로 만든다",
    signals: ["같은 모양의 더 작은 문제가 안에 들어 있다", "하노이 탑·거듭제곱"], pitfalls: ["기저 사례가 없거나 닿지 않는다", "큰 지수를 그대로 반복해 느려진다"] },
  { id: "divide-quarter", name: "나눠서 같은 일 하기", chapters: ["0x0B"], ability: "divide", what: "영역을 같은 크기로 나눠 각각에 같은 함수를 부른다",
    signals: ["정사각형을 4·9등분", "모두 같으면 멈춘다"], pitfalls: ["나눈 조각의 시작 좌표를 틀린다"] },
  { id: "backtrack-choose", name: "고르고 되돌리기", chapters: ["0x0C"], ability: "backtrack", what: "하나 고르고 다음 칸으로 들어갔다가, 돌아오면 고른 것을 되돌린다",
    signals: ["가능한 배치·순열을 모두 만든다", "N이 작다(대략 10 안팎)"], pitfalls: ["돌아올 때 사용 표시를 풀지 않는다"] },
  { id: "backtrack-start", name: "시작 위치로 중복 피하기", chapters: ["0x0C"], ability: "backtrack", what: "다음 선택을 이전 선택 뒤에서부터 시작해 같은 조합을 두 번 만들지 않는다",
    signals: ["순서가 상관없는 조합", "오름차순으로 출력"], pitfalls: ["순열과 조합을 헷갈린다"] },
  { id: "backtrack-prune", name: "가지치기", chapters: ["0x0C"], ability: "backtrack", what: "이미 안 되는 경우는 더 들어가지 않고 바로 돌아온다",
    signals: ["N-Queen처럼 충돌하면 끝", "합이 이미 넘으면 끝"], pitfalls: ["충돌 검사를 매번 처음부터 다 해서 느리다(열·대각선 표시로 바로 본다)"] },
  { id: "sort-key", name: "정렬 기준 정하기", chapters: ["0x0F", "0x0E"], ability: "sortfn", what: "무엇을 먼저, 같으면 무엇으로 비교할지 기준을 정해 정렬한다",
    signals: ["여러 조건으로 줄 세우기", "같으면 ~ 순"], pitfalls: ["비교 함수가 같은 경우를 일관되게 처리하지 않는다"] },
  { id: "counting-sort", name: "값 범위로 정렬", chapters: ["0x0E"], ability: "array", what: "값 범위가 작고 개수가 아주 많으면, 세어 두었다가 작은 값부터 센 만큼 출력한다",
    signals: ["N이 아주 크고 값은 작다", "메모리 제한이 빡빡하다"], pitfalls: ["모든 값을 배열에 담아 메모리 초과"] },
  { id: "stable-sort", name: "들어온 순서 지키기", chapters: ["0x0F"], ability: "sortfn", what: "기준이 같으면 먼저 들어온 것이 앞에 오게 한다(안정 정렬 또는 순번을 기준에 넣기)",
    signals: ["같으면 먼저 가입한 순"], pitfalls: ["안정하지 않은 정렬을 쓴다"] },
  { id: "merge-two", name: "정렬된 두 줄 합치기", chapters: ["0x0E"], ability: "sortfn", what: "두 줄의 앞을 비교해 작은 것부터 꺼내며 한 줄로 합친다",
    signals: ["이미 정렬된 두 배열", "병합 정렬"], pitfalls: ["한쪽이 먼저 끝난 뒤 남은 것을 붙이지 않는다"] },
  { id: "fast-io", name: "빠른 입출력", chapters: ["0x0E", "0x02"], ability: "io", what: "입력·출력이 수십만 줄이면 한 번에 읽고 한 번에 출력한다",
    signals: ["N이 10만 이상", "출력 줄이 아주 많다"], pitfalls: ["줄마다 print해서 시간 초과"] },
];
export const PATTERN_IDS = PATTERNS.map((p) => p.id);
export const patternOf = (id: string) => PATTERNS.find((p) => p.id === id);

/** 이번 튜터가 다루는 단원(바킹독), 배우는 순서. 시뮬레이션(57문제)·기초 코드 작성 요령은 다음으로 미룸(11/8). */
export const TUTOR_CHAPTERS = ["0x03", "0x04", "0x05", "0x06", "0x07", "0x08", "0x09", "0x0B", "0x0C", "0x0E", "0x0F"];
