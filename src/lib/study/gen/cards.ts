// 정리 (Recaller 문제 생성 파이프라인, 2026-10-24): each section's prepared text becomes knowledge cards — what to know,
// in the shape of its kind (a rule has its condition and boundary, a procedure its steps, a formula its variables),
// with evidence quoted from the page, the mistakes learners make with it, and links to other cards. Questions are made
// from cards, not from pages, so later steps neither re-read the material nor re-judge what matters.
import { z } from "zod";

export const cardKinds = ["용어", "사실", "목록", "조건", "절차", "공식", "비교", "개념", "패턴"] as const;
export type CardKind = (typeof cardKinds)[number];
export const linkKinds = ["앞뒤", "확장", "대비", "원인"] as const;

const text = z.string().trim().min(1);
const page = z.number().int().positive();
// One shape per kind, told apart by `form` (a union, so a card writes only its own part: eight null parts per card made
// replies long and once sent a reply into an endless run of blank space).
export const shapeSchema = z.union([
  z.object({ form: z.literal("term"), name: text, symbol: z.string().describe("기호(없으면 빈 문자열)"), definition: text, neighbors: z.array(text) }).describe("용어: 원문 표기 이름, 기호, 정의, 헷갈리는 이웃 용어"),
  z.object({ form: z.literal("fact"), subject: text, value: text }).describe("사실: 무엇이, 어떠하다"),
  z.object({ form: z.literal("list"), name: text, items: z.array(text).min(2), ordered: z.boolean() }).describe("목록: 이름, 원소, 순서가 의미 있는지"),
  z.object({ form: z.literal("rule"), premise: z.string(), condition: text, result: text, boundary: z.string() }).describe("조건: 전제(좌표계 등), 조건, 결론, 경계값에서 어떻게 되는지"),
  z.object({ form: z.literal("procedure"), steps: z.array(z.object({ action: text, input: z.string(), output: z.string() })).min(2) }).describe("절차: 단계마다 하는 일, 받는 것, 내는 것"),
  z.object({ form: z.literal("formula"), expr: text, vars: z.array(z.object({ symbol: text, meaning: text })), when: z.string().describe("이 식을 쓰는 조건·전제(카드 이름을 되풀이하지 않는다, 없으면 빈 문자열)") }).describe("공식: 식(평문), 변수 뜻, 쓰는 조건"),
  z.object({ form: z.literal("compare"), targets: z.array(text).min(2), criteria: z.array(z.object({ name: text, values: z.array(z.string()) })).min(1) }).describe("비교: 대상들, 기준마다 대상 순서대로 값"),
  z.object({ form: z.literal("concept"), claim: text, reason: z.string(), limit: z.string() }).describe("개념·주장: 무엇, 왜, 한계"),
  z.object({ form: z.literal("pattern"), frame: text, slots: z.array(text), example: z.string() }).describe("패턴: 틀, 빈칸, 원문 예"),
]);
export type Shape = z.infer<typeof shapeSchema>;
// Lean on purpose (a three-slide material took 40 s to organize): only what questions are made from, each part one line.
export const cardSchema = z.object({
  id: text.describe("c1, c2 … 순서대로"),
  kind: z.enum(cardKinds),
  title: text.describe("짧은 이름"),
  weight: z.enum(["핵심", "보조"]),
  shape: shapeSchema,
  evidence: z.array(z.object({ page, quote: z.string().describe("원문 그대로 짧게(60자 이내). 그림·식에서 읽은 것이면 빈 문자열") })).min(1).max(2),
  mistakes: z.array(text.describe("학습자가 실제로 할 법한 틀린 생각·계산 한 줄")).max(3),
  links: z.array(z.object({ to: text, kind: z.enum(linkKinds) })).describe("같은 쪽 카드와의 연결(없으면 빈 배열)"),
  // What the knowledge needs and what it produces, in the material's own words: cards whose outputs feed other cards'
  // inputs can be chained into one long problem, across pages and materials, without anyone naming the chain.
  takes: z.array(text).max(3).describe("이 지식을 쓰려면 주어져야 하는 것(자료의 말로, 명사구). 계산·판정·절차에 쓰이지 않으면 빈 배열"),
  gives: z.array(text).max(3).describe("이 지식을 쓰면 나오는 결과(자료의 말로, 명사구). 없으면 빈 배열"),
});
/** 줄기 모드(stem.ts, 11/10): 카드 한 장이 기억 하나 — 질문·요지·모양에 없는 식과 조건·역할(메인/바탕/곁). */
export type CardMemo = { question: string; line: string; facts: string[]; /** 질문 하나 · 답 하나(11/11 lab.cardQA): 칸 없이 필요한 만큼 쓴 답(마크다운, 단계·식·표 그대로). 있으면 화면은 이것만 */ answer?: string; /** 풀이(11/11): 처음 보는 사람이 핵심을 이해하게 — 왜 나왔나 · 아이디어 · 식이 말하는 것 */ idea?: string; /** 자세히(11/11): 유도·표의 값·구현 세부 — 외울 핵심은 아닌 참고 */ details?: string[]; role: "메인" | "바탕" | "곁" };
export type Card = z.infer<typeof cardSchema> & { figure?: CardFigure; /** 그림 둘째부터 (11/13 사용자 "그림 여러 개"): 첫 그림은 figure 그대로 */ moreFigures?: CardFigure[]; memo?: CardMemo };

// 카드에 붙는 그림 (2026-11-08 사용자 "그림은 카드가 아니라 카드에 붙는 것" → 시험 → "한번 해봐"): 카드 AI가 쪽 그림을 볼 때
// 그 카드에 붙일 그림의 대략 위치(쪽을 0~100으로 본 상자)·역할·설명 한 줄을 같이 쓴다. 코드가 위치를 그림에 맞춰 잘라 둔다(quote-crop.ts).
// 글자 층이 있는 쪽은 인용으로 위치를 찾는다(AI 위치 없이).
export const figureRoles = ["근거", "장면", "그림풀이"] as const;
export const figureSchema = z.object({ page, box: z.array(z.number()).describe("쪽 이미지를 가로·세로 0~100으로 본 [x0, y0, x1, y1], 왼쪽 위 0,0"),
  role: z.enum(figureRoles), says: z.string().describe("그림이 보여 주는 것 한 줄(40자 안팎)") });
export type CardFigure = z.infer<typeof figureSchema> & { /** 잘라 둔 그림 파일(figures/ 아래) */ file?: string; mode?: "figure" | "block"; from?: "hint" | "quote" };
/**
 * AI가 준 그림 칸을 쓸 수 있게 다듬는다: 쪽이 그 호출의 쪽이 아니면 버리고, 뒤집힌 상자는 버린다.
 * 11/8 그래픽스 04: AI가 0~100 대신 보낸 쪽 이미지의 픽셀 좌표([162,328,346,509], 이미지 1024×576)를 주는 일이 있다. 두 값 넘게 100을 넘으면
 * 픽셀로 보고 그 쪽 이미지 크기(sizeOf)로 나눈다(크기를 모르면 버림). 한 값만 넘으면 자리 실수(588 → 58.8).
 */
export function cleanFigure(f: unknown, pages: number[], sizeOf?: (page: number) => { width: number; height: number } | undefined): CardFigure | undefined {
  const r = figureSchema.safeParse(f);
  if (!r.success || !pages.includes(r.data.page) || r.data.box.length !== 4) return undefined;
  const over = r.data.box.filter((v) => v > 100).length;
  let box: number[];
  if (over >= 2) {
    const size = sizeOf?.(r.data.page);
    if (!size) return undefined;
    box = r.data.box.map((v, i) => Math.min(100, Math.max(0, v / (i % 2 ? size.height : size.width) * 100)));
  } else box = r.data.box.map((v) => (v > 100 && v <= 1000 ? v / 10 : Math.min(100, Math.max(0, v))));
  if (box[2] - box[0] < 2 || box[3] - box[1] < 2) return undefined;
  return { ...r.data, box, says: r.data.says.trim().slice(0, 120) };
}
// 쪽 의도 (2026-10-29, 사용자 "PDF는 페이지마다 의도가 있지"): what each page is there to do, decided before its cards.
// A cover, a preview or a guide page makes no card; a page that goes on with the one before adds only what is new;
// a worked example becomes one example card (its steps with the numbers) under the formula it uses.
export const pageIntents = ["표지", "예고", "안내", "정의", "공식", "절차", "비교", "분류", "개념", "현황", "예제", "이어서", "요약", "연습문제"] as const;
/** What kind of material it is decides what its pages are for (사용자 10/29: "PDF 성격을 생각하면서"). */
export const materialKinds = ["이론·계산 강의", "개념 설명 강의", "개론·현황 자료", "서술형 교재", "규정·제도", "문제·기출", "기타"] as const;
export type PageIntent = (typeof pageIntents)[number];
export const kindForm: Record<CardKind, Shape["form"]> = { 용어: "term", 사실: "fact", 목록: "list", 조건: "rule", 절차: "procedure", 공식: "formula", 비교: "compare", 개념: "concept", 패턴: "pattern" };

export type CardIssue = { cardId: string | null; severity: "error" | "warning"; message: string };
const squash = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");

/** A card as one compact line for later prompts and screens. */
export function cardLine(c: Card) {
  const s = c.shape;
  // A name the title already says is not said again (요약 → 카드 4차: "System modeling: System modeling:").
  const named = (name: string, rest: string) => squash(name) === squash(c.title) ? rest : `${name}: ${rest}`;
  const body = s.form === "term" ? (squash(s.name) === squash(c.title) ? `${s.symbol ? `(${s.symbol}) ` : ""}${s.definition}` : `${s.name}${s.symbol ? ` (${s.symbol})` : ""}: ${s.definition}`) : s.form === "fact" ? `${s.subject} — ${s.value}` : s.form === "list" ? named(s.name, s.items.join(s.ordered ? " → " : ", "))
    : s.form === "rule" ? `${s.premise ? `[${s.premise}] ` : ""}${s.condition} ⇒ ${s.result}${s.boundary ? ` (경계: ${s.boundary})` : ""}`
    : s.form === "procedure" ? s.steps.map((x, i) => `${i + 1}) ${x.action}`).join(" ") : s.form === "formula" ? `${s.expr}${s.when ? ` (${s.when})` : ""}`
    : s.form === "compare" ? `${s.targets.join(" vs ")}: ${s.criteria.map((k) => `${k.name}=${k.values.join("/")}`).join("; ")}`
    : s.form === "concept" ? `${s.claim}${s.reason ? ` — ${s.reason}` : ""}` : s.frame;
  const io = c.takes?.length || c.gives?.length ? ` ⟨받음: ${(c.takes ?? []).join(", ") || "-"} / 냄: ${(c.gives ?? []).join(", ") || "-"}⟩` : "";
  return `[${c.kind}] ${c.title}: ${body}${io}`;
}
