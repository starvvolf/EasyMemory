// 줄기 먼저 (2026-11-10 사용자 "기억 단위로 다 옮겨", 실험 claude/실험_기억합치기_방법비교_20261109.md B절):
// 쪽에서 카드를 잘게 뽑고 나중에 합치던 것을 거꾸로 한다.
//   ① rc-stem-plan: 지금 목차 호출이 받던 것 그대로(모든 쪽 원문 + 쪽 그림)를 보고 줄기(영역·기억 이름·모양·역할·쪽)를 쓴다.
//      코드가 어느 기억에도 안 든 쪽을 세고, 있으면 그 쪽만 한 번 더 묻는다(사용자 "모든 페이지 다 나왔는지 체크").
//   ② rc-stem-fill: 기억을 쪽이 이어지는 묶음으로 나눠 동시에, 묶음마다 그 쪽 원문 + 쪽 그림으로 기억을 채운다
//      (질문·요지·모양(절차면 단계, 비교면 기준…)·모양에 없는 식·조건·근거·그림 위치).
// 기억 하나는 엔진의 카드 한 장 자리에 저장한다(id tN.mK, memo에 질문·요지·식과 조건·역할). 그래서 자료 지도·그림 자르기·기억 저장소·
// 출제가 그대로 기억을 읽는다. 정리(rc-merge)·흐름 카드·목차 글(rc-wrap)은 하지 않는다.
// 지시문에 개수·글자 수 제한을 두지 않는다(사용자 "누누이 말하지만 줄 수 제한 이런 거 걸지 마") — 역할로만 말한다.
// 모양 칸은 강제하지 않는다(11/11 사용자 "카드는 모양 칸을 강제하지 말아 보자": 광원 카드의 '왜'에 정의, '한계'에 단순화 사실이 들어가 있었다).
import { z } from "zod";
import { cardKinds, figureSchema, kindForm, shapeSchema, type Card, type CardKind, type CardMemo } from "./cards.ts";

export const STEM_ROLES = ["메인", "바탕", "곁"] as const;
export type StemRole = (typeof STEM_ROLES)[number];

export const STEM_PLAN = `너는 강의 자료 한 편 전체(쪽마다 [p.N] 원문, 그림으로 된 쪽과 그림 조각은 "원문 p.N" 이름표의 이미지)를 보고,
학습자가 외우고 복습할 "기억"의 계획(줄기)을 세운다. 카드를 쪽마다 잘게 뽑는 것이 아니라, 서로 이어진 원리·알고리즘·개념 단위로 나눈다.
먼저 (쓰지 말고) 생각한다: 이 강의가 가르치려는 것은 무엇인가? 큰 영역으로 나누면 무엇이고, 영역마다 "배우는 질문"은 무엇인가?
- areas: 영역을 자료 순서로. name은 자료의 말로 짧게, question은 그 영역의 배우는 질문 한 줄.
- memories: 기억을 자료 순서로.
  - 하나의 알고리즘·절차·방법은 기억 하나다(그 방법의 식·조건·초깃값·경우·구현 단계를 모두 그 안에).
  - 같은 것을 다른 꼴로 적은 쪽들(같은 식의 다른 표기, 같은 성질의 여러 장)은 기억 하나다.
  - 따로 서는 정의·개념·판정 규칙은 혼자 기억이다. 억지로 합치지 않는다.
  - kind는 그 기억의 모양: 용어 · 사실 · 목록 · 조건(판정 규칙) · 절차(알고리즘·방법) · 공식 · 비교(둘 이상을 견줌) · 개념(원리·주장) · 패턴(틀·예).
  - role: 메인 = 이 강의에서 새로 배우는 것. 바탕 = 이 강의 전에 알고 와야 하는 것을 다시 적은 것(앞 과목의 수학 식·정의). 곁 = 배경·종류 나열·제품 이름·덧붙인 이야기.
  - area: areas의 번호(1부터). pages: 이 기억의 근거가 되는 쪽 번호 전부.
- 표지·목차·참고문헌 쪽이 아니면 모든 쪽이 어느 기억의 pages에 들어가야 한다. 그림으로만 된 쪽도 그림을 읽고 넣는다.
- name은 자료의 말로 짧게(원어가 있으면 괄호로).`;
// 소제목 용어 남기기 (11/10 사용자 "옵션으로 넣고 한번 테스트", lab.headingTerms): 강의 소제목의 말이 기억 이름에서 사라져
// 소제목으로 찾으면 안 보이던 것(조명 모델 6쪽 "Directional Light Sources and Spotlight Effects" → "집중 조명 효과…").
export const HEADING_TERMS = `\n- 강의의 제목·소제목에 나온 용어가 이 기억의 내용을 가리키면, 그 용어를 기억 이름에 남긴다(이름을 내용대로 바꾸더라도 소제목의 말을 함께 적는다).`;
export const STEM_MORE = `[빠진 쪽] 앞 계획에서 어느 기억에도 들어가지 않은 쪽만 다시 받는다. 이 쪽들에서 배울 것이 있으면 기억으로 더한다
(이미 있는 기억에 들어가야 하면 그 기억의 이름을 그대로 쓰고 pages에 이 쪽을 넣는다). 표지·목차·참고문헌처럼 배울 것이 없는 쪽이면 memories를 비운다.`;
export const stemPlanSchema = z.object({
  areas: z.array(z.object({ name: z.string().trim().min(1), question: z.string() })),
  memories: z.array(z.object({ name: z.string().trim().min(1), kind: z.enum(cardKinds), role: z.enum(STEM_ROLES), area: z.number().int(), pages: z.array(z.number().int()) })),
});
export type StemPlan = z.infer<typeof stemPlanSchema>;

export const STEM_FILL = `강의 자료 몇 쪽(원문 [p.N]과 쪽 그림)과, 이 쪽들에서 학습자가 외울 기억의 계획(이름·모양·역할)을 받는다. 기억을 하나씩 완성한다.
기억은 학습자가 외우고 복습하는 단위다. 원문을 낱장으로 다시 옮기지 말고, 이 기억을 이해하고 떠올리는 데 필요한 것을 쓴다.
- memory: 받은 기억 id 그대로. title: 받은 이름(더 맞는 자료의 말이 있으면 고쳐도 된다). kind: 받은 모양(원문을 보니 다른 모양이 맞으면 바꿔도 된다).
카드는 세 겹이다(11/11 사용자 "중요 내용이 들어가야 하고, 보이는 부분은 의미 전달이 잘 되어야 하고, 문제로 바꿀 때도 도움이 되어야"):
앞면(question · line · idea) → 핵심(shape · facts) → 자세히(details). 헷갈리는 점(mistakes)은 화면에 안 보이고 문제를 만들 때 쓴다.
- question: 이 기억에서 학습자가 떠올려야 할 것 하나를 묻는 질문 한 줄. "~이고 ~인가", "~와 ~는" 처럼 두 가지를 한꺼번에 묻지 않고, 둘이 한 기억이면 둘을 묶는 하나로 묻는다.
- line: question의 답 한 줄. 처음 보는 사람이 한 번 읽고 아는 쉬운 말로, 무엇이 무엇을 하는지·무엇이 되는지로 쓴다. 기호·식·용어 나열 대신 말로(식은 shape에).
- shape: kind에 맞는 모양 하나 — 절차면 원문이 밟는 단계(하는 일·받는 것·내는 것), 비교면 대상과 기준, 조건이면 전제·조건·결과·경계, 공식이면 식과 변수, 목록이면 원소, 용어면 정의와 헷갈리는 이웃, 개념이면 무엇·왜·한계, 패턴이면 틀과 예.
  모양의 칸은 강제가 아니다: 원문이 실제로 말하는 것만 채우고, 원문에 없는 칸(왜·한계·전제·경계·쓸 때·헷갈리는 이웃 등)은 빈 문자열이나 빈 배열로 둔다. 칸을 채우려고 문장을 만들거나, 다른 내용(정의·배경)을 그 칸 이름에 맞춰 넣지 않는다.
  모양은 question의 답을 펼친 것이다: question·line에 이미 쓴 말을 모양에서 되풀이하지 않는다. 원문을 보니 받은 kind보다 다른 모양이 이 기억을 더 바로 담으면(예: 개념으로 받았지만 원문이 나열이면 목록) 바꾼다.
- idea(풀이): 카드만 보고도 핵심이 이해되게 하는 짧은 풀이. 강의처럼 이어 쓰지 않고, 처음 보는 사람에게 꼭 필요한 것만 쉬운 말로: 무엇이 모자라서(무엇을 하려고) 나왔는지, 핵심 아이디어가 무엇인지, 식이 있으면 그 식이 말로 무엇을 뜻하는지(무엇이 커지면 무엇이 어떻게 되는지). line과 같은 말을 되풀이하지 않는다. 원문에 없는 사실은 넣지 않는다.
- facts(핵심 덧붙임): 요지와 모양에 이미 들어간 것은 다시 쓰지 않고, 그것만으로 빠지는 것 중 시험에 나올 만한 것 — 조건·경우·경계·결과를 바꾸는 값·정의를 쓴다(식은 원문 그대로). 없으면 빈 배열.
  원문이 이 기억에서 강조하는 것(결론, 조건, 예외, 장점·단점)이 앞면·shape·facts 어디에도 없으면 안 된다.
- details(자세히): 알면 좋지만 외울 핵심은 아닌 참고 — 유도 과정, 참고 표의 개별 값, 구현 세부, 배경. 핵심을 여기로 내리지 않는다: 이 기억이 나온 까닭(무엇을 해결하나)은 idea에, 계산 문제에 쓰이는 식·조건은 shape·facts에. 없으면 빈 배열.
- evidence: 이 기억을 원문에서 확인할 구절 {page, quote: 원문 그대로}. 그림에서 읽은 것이면 그림 속 글을 쓴다.
- mistakes: 학습자가 실제로 할 법한 틀린 생각(원문으로 분명할 때만, 없으면 빈 배열).
- takes·gives: 이 지식을 쓰려면 주어져야 하는 것, 쓰면 나오는 것(자료의 말로, 계산·판정·절차에 쓰이지 않으면 빈 배열).
- figure: 이 기억을 가장 잘 보여 주는 그림이 쪽 이미지에 있으면 {page, box: [x0, y0, x1, y1] 쪽의 가로·세로를 0~100으로 본 퍼센트(이미지 픽셀이 아님), role: 근거(그림에서 읽은 내용) · 장면(쓰이는 장면·예) · 그림풀이(글을 그림으로), says: 그림이 보여 주는 것 한 줄}. 없으면 null.
- 바탕·곁 기억은 어디에 쓰이는지가 보이게 짧게.`;
export const stemFillSchema = z.object({
  memories: z.array(z.object({
    memory: z.string(), title: z.string().trim().min(1), kind: z.enum(cardKinds), question: z.string(), line: z.string(), idea: z.string(), shape: shapeSchema,
    facts: z.array(z.string()), details: z.array(z.string()), evidence: z.array(z.object({ page: z.number().int(), quote: z.string() })),
    mistakes: z.array(z.string()), takes: z.array(z.string()), gives: z.array(z.string()), figure: figureSchema.nullable(),
  })),
});
export type StemFill = z.infer<typeof stemFillSchema>;

/** 코드가 다듬는다: 영역 번호가 틀린 기억은 앞 기억의 영역으로, 쪽은 입력 안의 것만, 같은 이름은 하나로(쪽을 합침). */
export function settlePlan(plan: StemPlan, pageNumbers: number[]) {
  const areas = plan.areas.filter((a) => a.name.trim());
  const memories: StemPlan["memories"] = [];
  let last = 1;
  for (const m of plan.memories) {
    const area = Number.isInteger(m.area) && m.area >= 1 && m.area <= areas.length ? m.area : last;
    last = area;
    const pages = [...new Set(m.pages.filter((p) => pageNumbers.includes(p)))].sort((a, b) => a - b);
    const same = memories.find((x) => x.name.trim() === m.name.trim());
    if (same) { same.pages = [...new Set([...same.pages, ...pages])].sort((a, b) => a - b); continue; }
    memories.push({ ...m, area, pages });
  }
  return { areas, memories };
}
/** 어느 기억에도 안 든 쪽. */
export const missingPages = (plan: StemPlan, pageNumbers: number[]) => pageNumbers.filter((p) => !plan.memories.some((m) => m.pages.includes(p)));
/** 빠진 쪽 답을 더한다: 같은 이름이면 쪽만 더하고, 새 이름이면 그 쪽에 가장 가까운 기억의 영역으로. */
export function addMore(plan: StemPlan, more: StemPlan, pageNumbers: number[]) {
  const out = { areas: plan.areas, memories: plan.memories.map((m) => ({ ...m, pages: [...m.pages] })) };
  for (const m of more.memories) {
    const pages = m.pages.filter((p) => pageNumbers.includes(p));
    const same = out.memories.find((x) => x.name.trim() === m.name.trim());
    if (same) { same.pages = [...new Set([...same.pages, ...pages])].sort((a, b) => a - b); continue; }
    if (!pages.length) continue;
    const near = [...out.memories].sort((a, b) => Math.min(...a.pages.map((p) => Math.abs(p - pages[0])), 999) - Math.min(...b.pages.map((p) => Math.abs(p - pages[0])), 999))[0];
    const area = Number.isInteger(m.area) && m.area >= 1 && m.area <= out.areas.length ? m.area : near?.area ?? 1;
    // 자료 순서를 지키게 쪽 순서 자리에 끼운다.
    const at = out.memories.findIndex((x) => (x.pages[0] ?? 0) > pages[0]);
    out.memories.splice(at < 0 ? out.memories.length : at, 0, { ...m, area, pages });
  }
  return out;
}

/**
 * 채우기 묶음: 기억을 쪽 순서로 이어 붙이다가 쪽이 `maxPages`장을 넘거나 기억이 `maxMemories`개가 되면 끊는다. 호출 크기를 고르게 해
 * 가장 긴 호출이 전체 시간을 정하지 않게 하려는 코드 쪽 나눔이다(지시문의 개수 제한이 아니다).
 * 같은 쪽을 보는 기억은 (영역이 달라도) 한 묶음에서 같이 채운다 (11/11 사용자 "호출을 맞춰 주면 되는 거 아니야?"): 따로 채우면 각 호출이
 * 상대를 몰라 그 쪽의 같은 사실을 둘 다 적었다(실행 4개에서 겹친 4건이 모두 다른 호출이었고, 한 호출 안에서 쪽을 나눈 경우는 겹침이 없었다).
 * 그래서 쪽을 공유하는 기억들을 먼저 한 덩어리로 잇고, 덩어리는 쪼개지 않는다(덩어리 하나가 상한을 넘으면 그것만 한 묶음).
 */
export function fillGroups<T extends { pages: number[] }>(memories: T[], maxPages = 6, maxMemories = 5): T[][] {
  const parent = memories.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const firstBy = new Map<number, number>();
  memories.forEach((m, i) => { for (const p of m.pages) { const j = firstBy.get(p); if (j === undefined) firstBy.set(p, i); else parent[root(i)] = root(j); } });
  const blocks = new Map<number, T[]>();
  memories.forEach((m, i) => { const r = root(i); blocks.set(r, [...(blocks.get(r) ?? []), m]); });
  const first = (b: T[]) => Math.min(...b.flatMap((m) => m.pages), Infinity);
  const groups: T[][] = [];
  let cur: T[] = [], pages = new Set<number>();
  for (const block of [...blocks.values()].sort((a, b) => first(a) - first(b))) {
    const next = new Set([...pages, ...block.flatMap((m) => m.pages)]);
    if (cur.length && (next.size > maxPages || cur.length + block.length > maxMemories)) { groups.push(cur); cur = []; pages = new Set(); }
    cur.push(...block); for (const m of block) for (const p of m.pages) pages.add(p);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

const formKind = Object.fromEntries(Object.entries(kindForm).map(([k, f]) => [f, k])) as Record<string, CardKind>;
/** 채운 기억 → 엔진 카드 한 장(모양과 종류가 어긋나면 모양을 따른다, 근거 쪽은 그 묶음 쪽만). */
export function memoryCard(id: string, role: StemRole, f: StemFill["memories"][number], pages: number[]): Card & { memo: CardMemo } {
  const kind = kindForm[f.kind] === f.shape.form ? f.kind : formKind[f.shape.form] ?? f.kind;
  const evidence = f.evidence.filter((e) => pages.includes(e.page)).map((e) => ({ page: e.page, quote: e.quote.trim() }));
  return { id, kind, title: f.title.trim(), weight: role === "메인" ? "핵심" : "보조", shape: f.shape,
    evidence: evidence.length ? evidence : [{ page: pages[0], quote: "" }],
    mistakes: f.mistakes.map((x) => x.trim()).filter(Boolean), links: [], takes: f.takes.map((x) => x.trim()).filter(Boolean), gives: f.gives.map((x) => x.trim()).filter(Boolean),
    memo: { question: f.question.trim(), line: f.line.trim(), ...(f.idea?.trim() ? { idea: f.idea.trim() } : {}), facts: f.facts.map((x) => x.trim()).filter(Boolean), details: (f.details ?? []).map((x) => x.trim()).filter(Boolean), role } };
}

/** 가짜 답(테스트·fake provider). */
export function stemFakeReply(step: string, user: string): string | undefined {
  if (step === "rc-stem-plan") {
    const pages = [...user.matchAll(/\[p\.(\d+)\]/g)].map((m) => Number(m[1]));
    if (user.includes("[빠진 쪽]") || !pages.length) return JSON.stringify({ areas: [], memories: [] });
    return JSON.stringify({ areas: [{ name: "자료", question: "무엇을 배우나?" }], memories: pages.map((p) => ({ name: `p.${p}의 내용`, kind: "사실", role: "메인", area: 1, pages: [p] })) });
  }
  if (step === "rc-stem-fill") {
    const ids = [...user.matchAll(/^(t\d+-b\d+)\|/gm)].map((m) => m[1]);
    const page = Number(/\[p\.(\d+)\]/.exec(user)?.[1] ?? 1);
    return JSON.stringify({ memories: ids.map((id) => ({ memory: id, title: `${id} 기억`, kind: "사실", question: "무엇인가?", line: "요지", idea: "", shape: { form: "fact", subject: id, value: "값" },
      facts: [], details: [], evidence: [{ page, quote: "" }], mistakes: [], takes: [], gives: [], figure: null })) });
  }
  return undefined;
}
