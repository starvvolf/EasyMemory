// 구조 단위 출제 (11/8 새벽 사용자: "브레젠험·중점 원은 묶어서 처리가 가능하다, 여섯 개를 굳이 다 물을 필요가 없어" — 문제설계 메모
// "구조가 그대로 문제 재료가 된다"; 04:30 "처음에 설정 값·설문·옵션에 따라 어떻게 동작할지, 아쉬운 점 고치기, 그림은 어떻게 — 비용도").
// 시험용 길: 지금 제품의 문제 만들기(recaller.ts, 카드마다 한 문제)는 그대로 두고 옆에서 비교한다. 결과는 study-gen/<id>/quiz-plan.json.
//
// 1) 계획(코드, AI 없음): 구조와 카드에서 문제 단위를 고르고, 설정(QuizOptions)이 수·난이도·방식·그림을 정한다.
//    차례 상자 → 여러 단계를 한 문제로 · 대비 쌍 → 구별 · 갈래 상자 → "아닌 것" · 대표 카드 → 뜻 · 잇기(다른 상자의 짝) → 두 지식을 이어 쓰기
//    · 남은 핵심 낱장 → 카드 종류대로. 주제마다 하나는 꼭. 용어 카드는 플래시카드(코드), 그림 알아보기는 코드가 보기를 만든다(AI 없음).
// 2) 만들기(AI): 단위마다 한 번(sol low), 동시에. 따로 풀기(sol low)가 답·하나로 정해지는지·쉬운지(단계 수)를 본다. 걸리면 한 번 고쳐 쓴다.
//    그림 문제는 잘린 그림을 출제·따로 풀기에 같이 보여 주고, 그림 없이 한 번 더 풀어 "그림이 있어야 풀리는지"를 확인한다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { askJson, LOCAL_CALLER, S } from "../assist/model.ts";
import { callModel } from "../ai/model.ts";
import { currentTrace, newCallId, recordCall, withTrace } from "../ai/trace.ts";
import { cardLine, type Card } from "./gen/cards.ts";
import type { MapCard, MaterialMap } from "./material-map.ts";
import type { Structure } from "./structure.ts";

export const UNITS = ["차례", "대비", "갈래", "대표", "잇기", "낱장"] as const;
export type Unit = (typeof UNITS)[number];
export const FORMS = ["ox", "choice", "order", "short"] as const;
export type Form = (typeof FORMS)[number];

// ── 설정 (문제 만들기 전에 사용자가 고르는 것) ─────────────────────────────────────────────
/**
 * goal 처음 공부(넓고 쉽게, 뜻·구별 위주) · 복습(기본) · 시험 대비(깊게, 계산·상황·잇기 많이, 수 많이)
 * scope 핵심만(차례·대비·대표·잇기만) · 고르게(기본, 주제마다 하나) · 전부(나중 묶음까지 한 번에)
 * style 섞어서(기본) · 개념 위주(계산을 뜻·순서 묻기로) · 계산 위주(공식·절차는 수치 문제, 낱장도 계산)
 * figures 끔 · 조금(문제의 1/5까지, 기본) · 많이(2/5까지). 그림 알아보기는 코드라 비용이 없고, 그림 상황 문제는 이미지 토큰만큼 든다.
 * count 첫 묶음 문제 수(비우면 카드 수와 goal로), topics 이 주제들만, flashcards 플래시카드 같이(기본 켬)
 */
export type QuizOptions = { goal: "처음" | "복습" | "시험"; scope: "핵심" | "고르게" | "전부"; style: "섞어서" | "개념" | "계산"; figures: "끔" | "조금" | "많이";
  count?: number; topics?: string[]; flashcards?: boolean };
export const DEFAULT_QUIZ_OPTIONS: QuizOptions = { goal: "복습", scope: "고르게", style: "섞어서", figures: "조금", flashcards: true };

/** 1 떠올리기 2 알아보기 3 구별하기 4 적용하기(상황·계산) 5 잇기 */
export type PlanItem = { n: number; unit: Unit; name: string; cards: string[]; form: Form; level: number; ask: string; topic: string; why: string;
  /** 그림 문제: 보여 줄 잘린 그림(figures/<file>)과 묻는 방식 */ figure?: { file: string; page: number; says: string; mode: "상황" | "알아보기" } };
export type Flashcard = { cardId: string; front: string; back: string };
/** 코드로 만든 그림 알아보기(AI 없음): 그림을 보여 주고 이 그림이 보여 주는 지식을 고른다. 같은 그림을 쓰는 다른 카드는 보기에서 뺀다. */
export type FigureQuiz = { cardId: string; file: string; page: number; stem: string; options: string[]; answer: number };
export type QuizPlan = { options: QuizOptions; lean: { calcShare: number; kind: "계산" | "개념" }; cards: number; first: number; items: PlanItem[]; later: PlanItem[];
  flashcards: Flashcard[]; figureQuizzes: FigureQuiz[]; coveredTopics: number; topics: number; notes: string[] };

const isFlow = (c: MapCard) => c.title.startsWith("흐름: ");
const topicOf = (id: string) => id.split(".")[0];
const shapeOf = (c: MapCard) => c.shape as { form?: string; name?: string; symbol?: string; definition?: string };
const isCalc = (c: MapCard) => c.kind === "공식" || c.kind === "절차";

const ASK: Record<Unit, string> = {
  차례: "여러 단계를 차례로 써야 풀리는 문제 하나. 단계 하나만 알아서는 못 풀게.",
  대비: "두 카드를 가르는 기준으로 묻는다: 상황·설명 하나를 주고 둘 중 어느 쪽인지.",
  갈래: "갈래들 가운데 하나만 다른 것(아닌 것) 또는 빠진 것을 고르게.",
  대표: "이 묶음이 가리키는 개념의 뜻을 확인한다(정의의 핵심을 살짝 바꾼 보기와 가르게).",
  잇기: "서로 다른 곳의 두 지식을 이어야 풀리게: 앞 카드의 결과·조건을 뒤 카드가 쓰는 상황.",
  낱장: "카드 하나의 핵심을 묻는다.",
};
// 단위 × 설정 → 방식·난이도 (코드 규칙)
function formFor(unit: Unit, cards: MapCard[], o: QuizOptions, lean: "계산" | "개념"): { form: Form; level: number } {
  const calc = cards.some(isCalc) && o.style !== "개념" && (lean === "계산" || o.style === "계산");
  const down = o.goal === "처음" ? 1 : 0, up = o.goal === "시험" ? 1 : 0;
  // 5(잇기)는 잇기 단위만. 시험 대비는 2·3을 한 단계 올리고 4는 4로 둔다(11/8: 그래픽스 시험 대비 29개 중 19개가 5가 됐다)
  const lv = (n: number) => Math.max(2, Math.min(4, n - down + up));
  if (unit === "차례") return calc ? { form: "short", level: lv(4) } : { form: "order", level: lv(3) };
  if (unit === "대비") return { form: "choice", level: lv(3) };
  if (unit === "갈래") return { form: "choice", level: lv(2) };
  if (unit === "대표") return { form: o.goal === "처음" ? "ox" : "choice", level: lv(2) };
  if (unit === "잇기") return { form: calc ? "short" : "choice", level: 5 };
  const k = cards[0]?.kind;
  if (k === "공식" && o.style !== "개념") return { form: "short", level: lv(4) };
  if (k === "절차" || k === "조건") return { form: "choice", level: lv(o.goal === "처음" ? 3 : 4) };
  if (k === "비교") return { form: "choice", level: lv(3) };
  return { form: o.style === "계산" && isCalc(cards[0]) ? "short" : "ox", level: lv(2) };
}

export function planQuiz(map: MaterialMap, structure: Structure, options: Partial<QuizOptions> = {}): QuizPlan {
  const o: QuizOptions = { ...DEFAULT_QUIZ_OPTIONS, ...options };
  const notes: string[] = [];
  const inScope = (c: MapCard) => !o.topics?.length || o.topics.includes(topicOf(c.id));
  const all = map.sections.flatMap((s) => s.cards).filter((c) => !isFlow(c) && inScope(c));
  const byId = new Map(all.map((c) => [c.id, c]));
  const title = (id: string) => byId.get(id)?.title ?? id;
  // 자료 성격: 공식·절차 카드가 1/4 넘으면 계산 강의(그래픽스 04 44%, 데드락 13%)
  const calcShare = all.length ? all.filter(isCalc).length / all.length : 0;
  const lean = calcShare >= 0.25 ? "계산" as const : "개념" as const;
  const used = new Set<string>();
  const items: Omit<PlanItem, "n" | "topic">[] = [];
  const add = (unit: Unit, name: string, ids: string[], why: string) => {
    const cards = [...new Set(ids)].map((id) => byId.get(id)).filter((c): c is MapCard => Boolean(c));
    if (!cards.length || (unit !== "낱장" && unit !== "대표" && cards.length < 2)) return;
    items.push({ unit, name, cards: cards.map((c) => c.id), ...formFor(unit, cards, o, lean), ask: ASK[unit], why });
    for (const c of cards) used.add(c.id);
  };
  const kids = (g: Structure["groups"][number]) => structure.groups.filter((x) => x.parent === g.id);
  const mainTopic = (it: Omit<PlanItem, "n" | "topic">) => { const counts = new Map<string, number>(); for (const id of it.cards) counts.set(topicOf(id), (counts.get(topicOf(id)) ?? 0) + 1); return [...counts].sort((a, b) => b[1] - a[1])[0][0]; };
  for (const g of structure.groups) {
    if (g.members !== "순서") continue;
    const ids = [...(g.head ? [g.head] : []), ...g.cards, ...kids(g).flatMap((k) => [...(k.head ? [k.head] : []), ...k.cards])].filter((id) => byId.has(id));
    // 단계가 너무 많으면(브레젠험 12장) 한 문제가 다 못 쓴다: 앞 8장까지, 나머지는 "나중"의 낱장으로 남긴다
    if (ids.length >= 2) add("차례", g.name, ids.slice(0, 8), `차례 상자 ${ids.length}장${ids.length > 8 ? "(앞 8장)" : ""}을 문제 하나로`);
  }
  for (const v of structure.versus ?? []) if (byId.has(v.a) && byId.has(v.b)) add("대비", `${title(v.a)} ↔ ${title(v.b)}`, [v.a, v.b], `견주는 기준: ${v.on}`);
  for (const g of structure.groups) {
    if (!g.members || !["종류", "모두", "부분"].includes(g.members)) continue;
    const ids = [...g.cards, ...kids(g).map((k) => k.head).filter((x): x is string => Boolean(x))].filter((id) => byId.has(id));
    if (ids.length >= 3) add("갈래", g.name, [...(g.head ? [g.head] : []), ...ids], `${g.members} ${ids.length}개`);
  }
  for (const g of structure.groups) if (g.head && byId.has(g.head) && !used.has(g.head)) add("대표", title(g.head), [g.head], `묶음 "${g.name}"의 대표`);
  // 잇기: 다른 상자의 카드 짝(조건 ↔ 깨는 방법, 정의 ↔ 판정). 시험 대비에서만 첫 묶음에 크게, 그 밖엔 나중으로
  for (const p of structure.pairs ?? []) if (byId.has(p.a) && byId.has(p.b)) add("잇기", `${title(p.a)} → ${title(p.b)}`, [p.a, p.b], `짝: ${p.why}`);
  if (o.scope !== "핵심") for (const c of all) if (c.core && !used.has(c.id)) add("낱장", c.title, [c.id], "핵심 카드");
  const topics = [...new Set(all.map((c) => topicOf(c.id)))];
  // 주제 덮기는 "그 주제가 중심인 문제"로 센다(11/8: 다른 주제 문제에 카드 한 장 끼었다고 덮었다고 봐서 그래픽스 24개 중 4개가 빠졌다)
  const centered = (t: string) => items.some((it) => mainTopic(it) === t);
  if (o.scope !== "핵심") for (const t of topics) {
    if (centered(t)) continue;
    const c = all.find((x) => topicOf(x.id) === t && x.core && !used.has(x.id)) ?? all.find((x) => topicOf(x.id) === t && !used.has(x.id)) ?? all.find((x) => topicOf(x.id) === t);
    if (c) add("낱장", c.title, [c.id], "이 주제에 문제가 없어서");
  }
  // 무게: 차례·대비 > 대표 > 잇기(시험이면 위로) > 갈래 > 낱장, 같으면 핵심 카드가 많은 것
  const weight: Record<Unit, number> = { 차례: 5, 대비: 4, 대표: 3, 잇기: o.goal === "시험" ? 4.5 : 1.5, 갈래: 2, 낱장: 1 };
  const score = (it: Omit<PlanItem, "n" | "topic">) => weight[it.unit] * 10 + it.cards.filter((id) => byId.get(id)?.core).length;
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  // 첫 묶음 크기: 처음 1/5 · 복습 1/4 · 시험 1/3 (최소 6, 최대 30). 고르게면 주제 수보다 작지 않게(11/8: 20개 제한에 주제 24개 중 4개가 빠졌다)
  const share = o.goal === "처음" ? 5 : o.goal === "시험" ? 3 : 4;
  let size = o.count ?? Math.max(6, Math.min(30, Math.round(all.length / share)));
  if (!o.count && o.scope === "고르게") size = Math.max(size, Math.min(30, topics.length));
  if (o.scope === "전부") size = sorted.length;
  const first: typeof items = [], seen = new Set<string>();
  if (o.scope !== "핵심") for (const it of sorted) if (first.length < size && !seen.has(mainTopic(it)) && it.unit !== "잇기") { first.push(it); seen.add(mainTopic(it)); }
  // 잇기는 첫 묶음의 1/4까지(11/8: 시험 대비에서 데드락 10개 중 6개가 잇기였다), 시험이 아니면 1개
  const capOf = (u: Unit) => u === "잇기" ? (o.goal === "시험" ? Math.max(1, Math.round(size / 4)) : 1) : Infinity;
  const fits = (it: typeof items[number]) => first.filter((x) => x.unit === it.unit).length < capOf(it.unit);
  for (const it of sorted) if (first.length < size && !first.includes(it) && fits(it)) first.push(it);
  // 같은 카드가 첫 묶음에 세 번 넘게 나오지 않게(대비·잇기·대표가 한 카드에 몰림)
  const uses = new Map<string, number>();
  const firstSet = new Set<typeof items[number]>();
  for (const it of first) { if (it.cards.length <= 2 && it.cards.some((id) => (uses.get(id) ?? 0) >= 2)) continue; firstSet.add(it); for (const id of it.cards) uses.set(id, (uses.get(id) ?? 0) + 1); }
  const number = (list: typeof items, from: number): PlanItem[] => list.map((it, i) => ({ ...it, n: from + i, topic: mainTopic(it) }));
  const firstItems = number(sorted.filter((it) => firstSet.has(it)), 1);
  const later = number(sorted.filter((it) => !firstSet.has(it)), firstItems.length + 1);
  // 그림 상황 문제: 그림(장면·근거)이 붙은 카드가 든 단위에, 첫 묶음의 1/5(조금)·2/5(많이)까지. 대비·차례·낱장 계산이 먼저.
  if (o.figures !== "끔") {
    const cap = Math.round(firstItems.length * (o.figures === "많이" ? 0.4 : 0.2));
    const prefer: Record<Unit, number> = { 차례: 3, 낱장: 3, 대비: 2, 잇기: 1, 갈래: 0, 대표: 0 };
    // 글 덩어리(mode block)는 빼고 그림 조각만(11/8 1회차: 예약 간선 그림은 글 상자째 잘려 "So, deny"가 답을 말했다)
    const cands = firstItems.map((it) => ({ it, fig: it.cards.map((id) => byId.get(id)?.figure).find((f) => f && (f.role === "장면" || f.role === "근거") && f.mode !== "block") }))
      .filter((x) => x.fig && prefer[x.it.unit] > 0).sort((a, b) => prefer[b.it.unit] - prefer[a.it.unit]);
    const files = new Set<string>();
    for (const { it, fig } of cands) {
      if ([...files].length >= cap || files.has(fig!.file)) continue;
      it.figure = { file: fig!.file, page: fig!.page, says: fig!.says, mode: "상황" }; files.add(fig!.file);
    }
    if (cands.length) notes.push(`그림 상황 문제 ${files.size}개(후보 ${cands.length}, 한도 ${cap})`);
  }
  const flashcards: Flashcard[] = o.flashcards === false ? [] : all.filter((c) => c.kind === "용어" && shapeOf(c).definition).map((c) => ({ cardId: c.id, front: `${shapeOf(c).name || c.title}${shapeOf(c).symbol ? ` (${shapeOf(c).symbol})` : ""}`, back: shapeOf(c).definition! }));
  const figureQuizzes = o.figures === "끔" ? [] : figureIdQuizzes(all, structure, firstItems, o.figures === "많이" ? 12 : 6);
  if (o.scope === "핵심") notes.push("핵심만: 낱장·주제 덮기 없음");
  return { options: o, lean: { calcShare: Math.round(calcShare * 100) / 100, kind: lean }, cards: all.length, first: firstItems.length, items: firstItems, later, flashcards, figureQuizzes,
    coveredTopics: new Set(firstItems.map((it) => it.topic)).size, topics: topics.length, notes };
}

/**
 * 그림 알아보기 (코드, AI 없음): 그림풀이·근거 그림이 붙은 카드에서, 그림을 보여 주고 "이 그림이 보여 주는 것은?" 보기 4개.
 * 오답은 같은 상자(없으면 같은 주제)의 다른 카드 이름. 같은 그림을 쓰는 카드는 오답에서 뺀다(답이 둘이 된다). 그림 상황 문제에 쓴 그림은 뺀다.
 */
export function figureIdQuizzes(all: MapCard[], structure: Structure, items: PlanItem[], max: number): FigureQuiz[] {
  const taken = new Set(items.map((it) => it.figure?.file).filter(Boolean));
  const groupOf = new Map<string, string>();
  for (const g of structure.groups) for (const id of [...(g.head ? [g.head] : []), ...g.cards]) groupOf.set(id, g.id);
  const parentOf = new Map(structure.groups.map((g) => [g.id, g.parent]));
  const sameFile = (a: MapCard, b: MapCard) => Boolean(a.figure && b.figure && a.figure.file === b.figure.file);
  const out: FigureQuiz[] = [], files = new Set<string>();
  const cands = all.filter((c) => c.figure && !taken.has(c.figure.file)).sort((a, b) => Number(b.core) - Number(a.core));
  for (const c of cands) {
    if (out.length >= max || files.has(c.figure!.file)) continue;
    const g = groupOf.get(c.id), pg = g ? parentOf.get(g) : undefined;
    const near = (x: MapCard) => x.id !== c.id && !sameFile(x, c) && !isFlow(x);
    const pool = [...all.filter((x) => near(x) && groupOf.get(x.id) === g), ...all.filter((x) => near(x) && pg && parentOf.get(groupOf.get(x.id) ?? "") === pg),
      ...all.filter((x) => near(x) && topicOf(x.id) === topicOf(c.id)), ...all.filter(near)];
    const wrong = [...new Map(pool.map((x) => [x.title, x])).values()].filter((x) => x.title !== c.title).slice(0, 3);
    if (wrong.length < 3) continue;
    // 보기 자리는 카드 id로 정해 섞는다(같은 자료면 늘 같게)
    const at = [...c.id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 4;
    const options = wrong.map((x) => x.title); options.splice(at, 0, c.title);
    out.push({ cardId: c.id, file: c.figure!.file, page: c.figure!.page, stem: "이 그림이 보여 주는 것은?", options, answer: at + 1 });
    files.add(c.figure!.file);
  }
  return out;
}

export const QUIZ_SYSTEM = `너는 대학 강의 자료로 복습 문제를 만든다. 문제 하나를 만든다.
- 받은 카드(지식)와 원문(source)에 있는 것만 묻는다. 원문에 없는 사실·수치를 지어내지 않는다(예제 수치는 새로 정해도 되지만 원문의 방법으로 풀려야 한다). 자료에 없는 변환 규칙·절차를 지어서 상황을 만들지 않는다.
- unit이 차례면 카드 여러 장의 단계를 다 써야 풀리게 하나로 묶는다. 대비면 두 카드를 가르는 기준으로, 갈래면 갈래들 사이에서 고르게, 잇기면 두 지식을 이어야 풀리게.
- form: ox(맞다/틀리다 명제 하나), choice(보기 4개, 정답 하나), order(단계 3~6개를 뒤섞어 주고 바른 순서), short(짧은 답: 수, 좌표, 낱말 — answer에는 값만, 문장 말고. options는 빈 배열, 문제 글에 보기를 넣지 않는다).
- level: 2 알아보기 · 3 구별하기 · 4 적용하기(상황·계산) · 5 잇기. 받은 level에 맞춘다.
  - 4·5는 풀이에 두 단계 넘게 써야 한다. 답이 문제에 이미 주어진 값(끝점, 시작점, 주어진 수)이거나 한 번 보고 바로 나오면 실패다.
- 오답 보기는 카드의 mistakes(헷갈리기 쉬운 점)에서 가져온다. 정답이 문장 길이나 말투로 드러나지 않게, 보기끼리 같은 말을 되풀이하지 않게.
- 답이 문제 글에 드러나면 실패다: 정답 보기가 문제 글의 말을 그대로 되풀이하지 않는다(문제가 "사전 정보를 요구하는 방법은?"이면 보기에 "사전 정보를 요구한다"를 쓰지 않는다).
  상황 문제는 판정의 열쇠(순환이 생겼다, 불안전하다)를 문제 글에 말하지 않는다. 학습자가 주어진 간선·수치에서 그것을 끌어내게 한다.
- 서로 상관없는 두 값을 더하거나 이어 붙인 억지 문제, 단계 이름의 개수 세기 같은 외우기 문제를 level 4로 내지 않는다.
- 한국어로 쓴다. 용어는 처음에 "한국어(영어 원어)". 수식·기호·변수는 원문 그대로.
- answer: ox는 "O" 또는 "X", choice는 정답 보기 번호(1부터), order는 바른 순서의 번호를 쉼표로(예: "3,1,2,4"), short는 답.
- explain: 왜 그 답인지 두세 문장. 차례·계산이면 단계별 값을 짧게.
- uses: 이 문제가 실제로 쓰는 카드 번호들.`;
// 그림 상황 문제 (11/8): 그림을 문제에 보여 준다. 그림을 읽어야 풀리게, 그림 속 이름·수를 그대로 쓴다.
export const FIGURE_QUIZ = `[그림] 이 문제는 받은 그림을 학습자에게 같이 보여 준다.
- 그림을 읽어야 풀리게 만든다: 그림 속 요소(정점·간선·화소·좌표·라벨)를 문제가 직접 가리키고, 답이 그림에서 정해지게.
- 그림이 보여 주는 상황 자체를 판정·계산하게 한다(이 그래프에 순환이 있나, 이 화소 다음은 어디인가). 그림 요소를 억지로 세게 하거나 그림의 수를 다른 계산에 끌어다 쓰지 않는다(11/8: "맨 아래 행 화소 개수만큼 x를 늘려…").
- 그림에 보이는 이름·수·기호를 그대로 쓴다. 그림에 없는 요소를 있다고 하지 않는다. 그림을 글로 다시 다 풀어 쓰지 않는다(그러면 그림이 필요 없다).
- figure_read: 그림에서 읽은 것(문제에 쓰는 요소만) 한두 줄. 확인용이다.
- figure_text: 그림 안에 적힌 문장·설명 글을 그대로 옮긴다(라벨·변수 이름은 빼고, 없으면 빈 문자열).
- 그림 안 글이 결론을 말하면(예: "Cycle → unsafe → deny", "So, deny") 그 결론을 묻지 않는다. 그림의 다른 요소(간선 방향, 좌표, 개수)로 묻는다.`;
const QUIZ_SCHEMA = S.obj({ form: S.oneOf(...FORMS), level: S.int, stem: S.str, options: S.arr(S.str), answer: S.str, explain: S.str, uses: S.arr(S.int) });
const QUIZ_FIG_SCHEMA = S.obj({ figure_read: S.str, figure_text: S.str, form: S.oneOf(...FORMS), level: S.int, stem: S.str, options: S.arr(S.str), answer: S.str, explain: S.str, uses: S.arr(S.int) });
export type QuizReply = { form: Form; level: number; stem: string; options: string[]; answer: string; explain: string; uses: number[]; figure_read?: string; figure_text?: string };

export const SOLVE_SYSTEM = `정답을 모르는 상태에서 문제 하나를 정리된 지식과 원문(source)으로 푼다(원문 글이 비었으면 정리된 지식이 그 쪽 그림에서 읽은 것이다). 그림이 있으면 그림도 본다.
answer: ox는 "O"/"X", choice는 보기 번호(1부터), order는 바른 순서 번호를 쉼표로, short는 값·낱말만 짧게(문장 말고).
steps: 답까지 실제로 거친 단계 수(문제에 답이 이미 보이면 0, 한 번 보고 바로 알면 1).
true_options: choice면 보기를 하나씩 따져 지식·원문으로 맞는 보기 번호를 모두(답을 고르기 전에). 다른 형식은 빈 배열.
지식·원문·그림으로 답이 하나로 정해지지 않으면(보기 둘이 맞음, 근거가 없음, 조건이 모자람) unique=false와 doubt 한 줄.`;
// true_options: 보기마다 따로 (11/8 3회차: "점유와 대기 예방"에서 보기 둘이 다 자료의 방법이었는데 따로 풀기가 하나만 고르고 넘어갔다)
const SOLVE_SCHEMA = S.obj({ true_options: S.arr(S.int), answer: S.str, steps: S.int, unique: { type: "boolean" }, doubt: S.str });
export type SolveReply = { answer: string; steps: number; unique: boolean; doubt: string; true_options?: number[] };

// 답이 엇갈릴 때 (11/8 1회차: 중점 원은 출제 답이 맞고 따로 풀기가 틀렸다, 타원은 출제 답 칸만 틀리고 해설은 맞았다)
export const JUDGE_SYSTEM = `문제 하나에 출제자 답과 따로 푼 답이 다르다. 정리된 지식·원문(그림이 있으면 그림)으로 직접 다시 풀어 어느 쪽이 맞는지 정한다.
winner: author(출제자 답이 맞음) · solver(따로 푼 답이 맞음) · neither(둘 다 틀림이거나 문제가 모호함). answer: 맞는 답(값만). why: 한 줄.`;
const JUDGE_SCHEMA = S.obj({ winner: S.oneOf("author", "solver", "neither"), answer: S.str, why: S.str });
export type JudgeReply = { winner: "author" | "solver" | "neither"; answer: string; why: string };
/** 그림 안 글이 답을 말하는지(코드): 정답 보기·답의 낱말이 그림 글에 다 들어 있으면 샌 것으로 본다. */
export function figureLeaks(q: QuizReply): boolean {
  const text = q.figure_text?.trim(); if (!text || q.form === "order") return false;
  const ans = q.form === "choice" ? q.options[Number(q.answer.match(/\d+/)?.[0] ?? 0) - 1] ?? "" : q.form === "ox" ? "" : q.answer;
  const w = [...words(ans)].filter((x) => !/^\d+$/.test(x)); if (!w.length) return false;
  const tw = [...words(text.toLowerCase())];
  return w.every((x) => tw.some((v) => v.includes(x.toLowerCase()) || x.toLowerCase().includes(v)));
}
export type MadeQuestion = PlanItem & { ok: boolean; held?: string; q?: QuizReply; solved?: SolveReply; blind?: SolveReply; needsFigure?: boolean; judge?: JudgeReply; easy?: boolean; fixed?: string; tries: number; problems: string[]; ms: number };
export type CheckedFigureQuiz = FigureQuiz & { ok: boolean; solved?: SolveReply; held?: string };
export type QuizRun = { at: string; ms: number; label?: string; plan: QuizPlan; made: MadeQuestion[]; figureChecks?: CheckedFigureQuiz[] };
export const QUIZ_MODEL = { model: "gpt-6-sol", effort: "low" };

const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");
const genDir = (id: string) => { if (!/^gen_[a-z0-9]{8,64}$/.test(id)) throw Object.assign(new Error("자료 id가 올바르지 않아요."), { status: 400 }); return path.join(dataDir(), "study-gen", id); };
const fileOf = (id: string, label?: string) => path.join(genDir(id), label ? `quiz-plan.${label.replace(/[^\w-]/g, "_")}.json` : "quiz-plan.json");
export async function loadQuizRun(id: string, label?: string): Promise<QuizRun | null> { try { return JSON.parse(await readFile(fileOf(id, label), "utf8")) as QuizRun; } catch { return null; } }

// 11/8 첫 시험: "−6"(유니코드 빼기)과 "-6", "거부, 요청 간선"과 "순환이 생기므로 요청을 거부한다. P2 → R2는 요청 간선이다."를 다르다고 봤다.
const norm = (s: string) => s.normalize("NFKC").replace(/[−–—]/g, "-").replace(/\s+/g, "").replace(/[()（）.,·:;'"“”]/g, "").toLowerCase();
const nums = (s: string): string[] => s.normalize("NFKC").replace(/[−–—]/g, "-").match(/-?\d+(?:\.\d+)?/g) ?? [];
const words = (s: string) => new Set((s.normalize("NFKC").match(/[\p{L}\d]{2,}/gu) ?? []).map((w) => w.replace(/(이다|한다|된다|는|은|을|를|이|가|다)$/u, "")).filter((w) => w.length >= 2));
export function sameAnswer(form: Form, a: string, b: string) {
  if (form === "ox") { const f = (x: string) => /^\s*(o|맞|참|true)/i.test(x) ? "O" : /^\s*(x|틀|거짓|false)/i.test(x) ? "X" : ""; return f(a) !== "" && f(a) === f(b); }
  if (form === "choice" || form === "order") return (a.match(/\d+/g) ?? []).join(",") === (b.match(/\d+/g) ?? []).join(",");
  if (norm(a) === norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a))) return true;
  const na = nums(a), nb = nums(b);
  if (na.length && nb.length) return na.join(",") === nb.join(",") || (nb.every((x) => na.includes(x)) && na.every((x) => nb.includes(x)));
  const wa = words(a), wb = words(b);
  return wa.size > 0 && [...wa].every((w) => [...wb].some((v) => v.includes(w) || w.includes(v)));
}

/** 보기 섞기(코드, 11/8 4회차: 정답이 1번에 몰렸다 — 데드락 시험 대비 1,1,1,3). 같은 문제면 늘 같게 섞는다. */
export function shuffleChoice(q: QuizReply, seed: string) {
  if (q.form !== "choice" || q.options.length < 2) return;
  const right = Number(q.answer.match(/\d+/)?.[0] ?? 0) - 1;
  if (right < 0 || right >= q.options.length) return;
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const order = q.options.map((_, i) => i);
  // 위쪽 비트를 쓴다(아래 비트는 주기가 짧아 2번 자리가 안 나왔다, 11/8 5회차)
  for (let i = order.length - 1; i > 0; i--) { h = (h * 1103515245 + 12345) >>> 0; const j = (h >>> 16) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  q.options = order.map((i) => q.options[i]);
  q.answer = String(order.indexOf(right) + 1);
  // 해설이 "2번"처럼 번호를 말하면 섞은 뒤 틀리므로 번호 말을 뺀다
  q.explain = q.explain.replace(/\(?\s*[1-4]\s*번\s*\)?/g, "").replace(/\s{2,}/g, " ").trim();
}

/** 모양 검사(코드): 고쳐 쓰게 할 문제를 말로. 없으면 null. */
export function shapeProblem(q: QuizReply, want: { form: Form; level: number }): string | null {
  if (q.form === "short" && q.options.length) return "short인데 보기를 줬다. 보기 없이 값을 묻는다.";
  if (q.form === "short" && /(^|\n)\s*[1-4①-④][.)]\s/.test(q.stem)) return "short인데 문제 글에 보기 목록이 있다.";
  if (q.form === "choice" && q.options.length !== 4) return `choice 보기가 ${q.options.length}개다. 4개로.`;
  if (q.form === "order" && (q.options.length < 3 || (q.answer.match(/\d+/g) ?? []).length !== q.options.length)) return "order는 단계 3~6개와 그 수만큼의 순서 번호.";
  if (q.form === "choice" && new Set(q.options.map((x) => norm(x))).size < q.options.length) return "보기가 겹친다.";
  if (q.form === "short" && q.answer.length > 60) return "short 답이 너무 길다. 값·낱말만.";
  if (want.form === "short" && q.form !== "short" && want.level >= 4) return "계산(short)으로 내야 한다.";
  return null;
}

const toDataUrl = (b: Buffer) => `data:image/jpeg;base64,${b.toString("base64")}`;
type Img = { label: string; dataUrl: string; detail?: "low" | "high" };
/** askJson과 같되 그림을 같이 보낸다(함께 쓰는 assist/model.ts는 건드리지 않으려고 여기서, 호출 기록도 같은 모양으로). */
async function ask<T>(purpose: string, system: string, user: string, schema: Record<string, unknown>, images?: Img[]): Promise<T> {
  if (!images?.length) return askJson<T>(purpose, system, user, schema, QUIZ_MODEL);
  const started = Date.now(); let first = 0, ok = false, reply = "", error = "";
  let usage: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; reasoningTokens?: number } | undefined;
  const sent = { system: `${system}\n출력은 JSON으로만 한다.`, user };
  try {
    const r = await callModel({ purpose, ...sent, json: true, schema, schemaName: `recaller_${purpose.replace(/\W+/g, "_")}`, ...QUIZ_MODEL, caller: LOCAL_CALLER, images, onText: () => { if (!first) first = Date.now(); } });
    ok = true; usage = r.usage; reply = JSON.stringify(r.data ?? ""); return r.data as T;
  } catch (e) { error = (e as Error)?.message?.slice(0, 500) ?? String(e); throw e; }
  finally {
    const trace = currentTrace();
    recordCall({ id: newCallId(), at: new Date(started).toISOString(), purpose, ...QUIZ_MODEL, ms: Date.now() - started, ...(first ? { firstTextMs: first - started } : {}), ok, ...(error ? { error } : {}),
      ...(usage ? { tokens: { in: usage.inputTokens, cached: usage.cachedInputTokens, out: usage.outputTokens, reasoning: usage.reasoningTokens } } : {}), ...(trace ? { trace } : {}),
      system: sent.system, user: `${sent.user}\n[그림 ${images.length}장]`, reply });
  }
}

/** 계획 + (make면) 단위마다 문제 하나를 만들고 따로 풀어 확인한다. texts: 쪽 번호 → 원문 글. */
export async function makeQuiz(id: string, map: MaterialMap, structure: Structure, texts: Record<string, string>,
  run: { make?: boolean; only?: number; options?: Partial<QuizOptions>; label?: string; noRetry?: boolean; noBlind?: boolean; units?: number[] } = {}): Promise<QuizRun> {
  const t0 = Date.now();
  const plan = planQuiz(map, structure, run.options);
  const byId = new Map(map.sections.flatMap((s) => s.cards).map((c) => [c.id, c]));
  const made: MadeQuestion[] = [], figureChecks: CheckedFigureQuiz[] = [];
  if (run.make) {
    let list = run.only ? plan.items.slice(0, run.only) : plan.items;
    if (run.units?.length) list = [...plan.items, ...plan.later].filter((it) => run.units!.includes(it.n));
    const [m, f] = await Promise.all([Promise.all(list.map((it) => makeOne(id, map, it, byId, texts, run))), run.units?.length ? Promise.resolve([]) : checkFigureQuizzes(id, plan.figureQuizzes)]);
    made.push(...m); figureChecks.push(...f);
  }
  const out: QuizRun = { at: new Date().toISOString(), ms: Date.now() - t0, ...(run.label ? { label: run.label } : {}), plan, made, ...(figureChecks.length ? { figureChecks } : {}) };
  if (run.make) { await mkdir(genDir(id), { recursive: true }); await writeFile(fileOf(id, run.label), JSON.stringify(out, null, 1)); }
  return out;
}

/**
 * 그림 알아보기 확인 (11/8 3회차): 코드가 고른 오답이 그 그림에도 맞을 수 있다("요청 간선" 그림에 "자원 할당 그래프").
 * 그림만 보고(지식·원문 없이) 한 번 풀어, 정답을 하나로 고르면 남긴다.
 */
async function checkFigureQuizzes(id: string, list: FigureQuiz[]): Promise<CheckedFigureQuiz[]> {
  return Promise.all(list.map(async (f): Promise<CheckedFigureQuiz> => {
    const image = await readFile(path.join(genDir(id), "figures", f.file)).then(toDataUrl).catch(() => null);
    if (!image) return { ...f, ok: false, held: "그림 파일 없음" };
    try {
      const solved = await withTrace({ area: "pdf", action: "quiz-figure-id", ref: id }, () => ask<SolveReply>("map:quiz-figure-id", `${SOLVE_SYSTEM}\n그림이 보여 주는 것을 고르는 문제다. 그림에 보기 둘 이상이 함께 보이거나 보기 하나가 다른 보기를 포함하면(전체와 부분) unique=false.`,
        `form: choice\n${f.stem}\n${f.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`, SOLVE_SCHEMA, [{ label: "그림", dataUrl: image }]));
      const ok = solved.unique && sameAnswer("choice", String(f.answer), solved.answer);
      return { ...f, ok, solved, ...(ok ? {} : { held: solved.unique ? `그림만 보고 고른 답이 다름(${solved.answer})` : `답이 하나가 아님: ${solved.doubt}` }) };
    } catch (error) { return { ...f, ok: false, held: `실패: ${(error as Error).message}`.slice(0, 160) }; }
  }));
}

async function makeOne(id: string, map: MaterialMap, it: PlanItem, byId: Map<string, MapCard>, texts: Record<string, string>, run: { noRetry?: boolean; noBlind?: boolean }): Promise<MadeQuestion> {
  const t = Date.now();
  const cards = it.cards.map((x) => byId.get(x)!).filter(Boolean);
  const pages = [...new Set(cards.flatMap((c) => c.pages))].sort((a, b) => a - b);
  const source = pages.map((p) => `[원문 p.${p}]\n${texts[p] ?? ""}`).join("\n\n").slice(0, 14000);
  const line = (c: MapCard) => cardLine({ kind: c.kind, title: c.title, shape: c.shape, takes: c.takes, gives: c.gives } as Card).replace(/\s+/g, " ").slice(0, 400);
  const lines = cards.map((c, i) => `${i + 1}|${c.kind}|${line(c)}${c.mistakes.length ? `\n  헷갈리기 쉬운 점: ${c.mistakes.slice(0, 3).join(" / ")}` : ""}${c.figure?.says && !it.figure ? `\n  그림: ${c.figure.says}` : ""}`);
  const known = cards.map((c, i) => `${i + 1}. ${line(c)}`).join("\n");
  const image = it.figure ? await readFile(path.join(genDir(id), "figures", it.figure.file)).then(toDataUrl).catch(() => null) : null;
  const images = image ? [{ label: `그림 (원문 p.${it.figure!.page})`, dataUrl: image }] : undefined;
  const problems: string[] = [];
  let revision = "";
  const max = run.noRetry ? 1 : 2;
  let last: MadeQuestion | null = null;
  for (let tries = 1; tries <= max; tries++) {
    try {
      const user = `자료: ${map.title}\nunit: ${it.unit} (${it.name}) — ${it.ask}\nform: ${it.form} · level: ${it.level}\n\n카드 (번호|종류|내용)\n${lines.join("\n")}\n\nsource\n${source}${revision ? `\n\n고쳐 쓰기: 앞 문제는 이래서 안 됐다 — ${revision}` : ""}`;
      const q = await withTrace({ area: "pdf", action: "quiz-unit", ref: id }, () => ask<QuizReply>(images ? "map:quiz-figure" : "map:quiz-unit", images ? `${QUIZ_SYSTEM}\n\n${FIGURE_QUIZ}` : QUIZ_SYSTEM, user, images ? QUIZ_FIG_SCHEMA : QUIZ_SCHEMA, images));
      if (q.form === "short") q.options = [];
      const shape = shapeProblem(q, it) ?? (images && figureLeaks(q) ? `그림 안 글("${q.figure_text!.slice(0, 60)}")이 답을 말한다. 그림의 다른 요소로 묻는다.` : null);
      if (shape) { problems.push(shape); revision = `${shape} (앞 문제: ${q.stem.slice(0, 200)})`; last = { ...it, ok: false, held: shape, q, tries, problems, ms: 0 }; continue; }
      const view = `form: ${q.form}\n${q.stem}${q.options.length ? `\n${q.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}` : ""}`;
      const ctxText = `정리된 지식\n${known}\n\nsource\n${source}`;
      const solve = (withImage: boolean) => withTrace({ area: "pdf", action: "quiz-solve", ref: id }, () => ask<SolveReply>("map:quiz-solve", SOLVE_SYSTEM, `${view}\n\n${ctxText}`, SOLVE_SCHEMA, withImage ? images : undefined));
      // 그림 문제는 그림 없이도 한 번(그림이 있어야 풀리는지). 둘은 동시에.
      const [solved, blind] = await Promise.all([solve(true), images && !run.noBlind ? solve(false).catch(() => undefined) : Promise.resolve(undefined)]);
      const needsFigure = blind ? !(blind.unique && sameAnswer(q.form, q.answer, blind.answer)) : undefined;
      let judge: JudgeReply | undefined, fixed: string | undefined;
      const many = q.form === "choice" && (solved.true_options?.length ?? 0) > 1;
      let held: string | undefined = !solved.unique ? `답이 하나가 아님: ${solved.doubt}` : many ? `맞는 보기가 여럿(${solved.true_options!.join(", ")})` : undefined;
      if (!held && !sameAnswer(q.form, q.answer, solved.answer)) {
        judge = await withTrace({ area: "pdf", action: "quiz-judge", ref: id }, () => ask<JudgeReply>("map:quiz-judge", JUDGE_SYSTEM, `${view}\n\n출제자 답: ${q.answer}\n출제자 해설: ${q.explain}\n따로 푼 답: ${solved.answer}\n\n${ctxText}`, JUDGE_SCHEMA, images));
        if (judge.winner === "author" && sameAnswer(q.form, q.answer, judge.answer)) { /* 출제 답이 맞다 */ }
        // 따로 푼 답이 맞고 출제 해설이 그 답을 말하면 답 칸만 고친다(타원: 답 칸 √21/3, 해설 5√5/3)
        else if (judge.winner === "solver" && sameAnswer(q.form, solved.answer, judge.answer) && q.form === "short" && nums(solved.answer).every((x) => nums(q.explain).includes(x))) { fixed = `답 ${q.answer} → ${solved.answer}`; q.answer = solved.answer; }
        else held = `따로 푼 답이 다름(${solved.answer} ≠ ${q.answer}, 판정 ${judge.winner}: ${judge.why})`;
      }
      // 쉬움으로 고쳐 쓰기는 계산·순서 문제만(11/8 4회차: 개념 객관식은 한 단계가 자연스러운데 데드락 11개 중 8개를 다시 썼다). 답이 보이는 것(0단계)은 늘.
      const easy = !held && (solved.steps === 0 || (it.level >= 4 && solved.steps <= 1 && (q.form === "short" || q.form === "order")));
      // 그림이 있어도 그림 없이 풀리면(그림이 장식) 한 번 고쳐 쓴다
      const decorative = !held && images && needsFigure === false;
      const result: MadeQuestion = { ...it, ok: !held, ...(held ? { held } : {}), q, solved, ...(blind ? { blind, needsFigure } : {}), ...(judge ? { judge } : {}), ...(fixed ? { fixed } : {}), ...(easy ? { easy } : {}), tries, problems, ms: Date.now() - t };
      if ((held || easy || decorative) && tries < max) {
        const why = held ?? (easy ? `너무 쉽다(풀이 ${solved.steps}단계). 판정의 열쇠를 문제 글에 말하지 말고 학습자가 끌어내게, 단계를 더 쓰게` : "그림 없이도 풀린다. 그림을 읽어야 풀리게(그림 내용을 문제 글에 다 적지 않는다)");
        problems.push(why); revision = `${why}. 앞 문제: ${q.stem.slice(0, 300)} / 답 ${q.answer}`; last = result; continue;
      }
      // 고쳐 쓴 것이 오히려 걸리면, 앞의 것(쉽거나 그림이 장식일 뿐 맞는 문제)을 쓴다
      const final = !result.ok && last?.ok ? { ...last, tries, problems, ms: Date.now() - t } : result;
      // 고쳐 써도 쉬우면 난이도 표시를 2로 낮춘다(11/8 2회차: 장치 좌표 "최종 좌표 기호는?"이 L4로 남았다)
      if (final.ok && final.easy && final.level >= 4) final.level = 2;
      if (final.ok && final.q) shuffleChoice(final.q, `${id}:${it.n}:${it.cards.join(",")}`);
      return final;
    } catch (error) { problems.push(`실패: ${(error as Error).message}`.slice(0, 200)); }
  }
  if (last) return { ...last, tries: max, problems, ms: Date.now() - t };
  return { ...it, ok: false, held: problems.at(-1) ?? "실패", tries: run.noRetry ? 1 : 2, problems, ms: Date.now() - t };
}
