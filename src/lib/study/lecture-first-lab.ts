// 강의 먼저 엔진 실험 (11/10 사용자 "엔진 앞부분에 강의를 진행시키는데, 처음에 목차를 입맛대로 페이지 묶어도 좋고, 카드 규칙을 주고
// 스트리밍으로 GPT 챗처럼. 카드 규칙은 강의 흐름에 맞춰서 알아야 하는 거 잡으라고 하고, 카드 양식 다 만들지 말고 표시만 해 주면
// 카드는 그때그때 호출로 따로 만들어. sol한테 시키고"). 제품 흐름에 넣지 않는다.
//   ① 강의(sol, 스트리밍 글): 자료 전체(원문 + 쪽 그림) → "## 목차"(강사가 묶은 장과 쪽) → 장마다 강의.
//      알아야 할 것이 나오는 자리에 ⟦카드: 이름 | 모양 | 역할 | p.쪽⟧, 보여 줄 그림에 ⟦그림: 이미지 이름표 | 볼 것⟧, 표에 ⟦표: p.쪽 | 무엇⟧
//   ② 카드(terra, 표시가 몇 개 모이거나 장이 바뀌면 묶어서 따로): 그 카드들의 쪽 원문 + 쪽 그림 → 엔진의 기억 채우기와 같은 모양(stem.ts STEM_FILL)
// 2차(11/10 사용자 "고칠 거 다 고쳐서 테스트"): 카드 기준을 줄기 엔진의 기억 기준대로(단위·역할·이름·겹침), 그림·표 표시, 카드 묶어 부르기, 수식은 $…$.
import { callModel } from "../ai/model.ts";
import { currentTrace, withTrace } from "../ai/trace.ts";
import { LOCAL_CALLER, logAssistCall } from "../assist/model.ts";
import { astraJsonSchema } from "./gen/astra.ts";
import { STEM_FILL, stemFillSchema } from "./gen/stem.ts";

export const LECTURE_FIRST_SYSTEM = `너는 이 강의를 맡은 강사다. 강의 자료 한 편 전체(쪽마다 [p.N] 원문, 그림은 "[이미지] 이름표"가 붙은 이미지)를 받는다.
학생에게 이 자료를 처음부터 끝까지 강의한다. 채팅으로 말하듯 바로 써 내려간다.

1. 맨 처음 "## 목차"에 네가 강의할 순서를 쓴다. 줄마다 "N. 장 이름 (p.쪽, 쪽–쪽)". 이해하기 쉬운 순서라면 자료의 순서를 바꾸고 쪽을 마음대로 묶어도 된다. 배울 것이 있는 쪽은 모두 어느 장엔가 들어간다(표지·목차·강의 운영 안내는 뺀다).
2. 그다음 장마다 "## N. 장 이름" 아래에서 강의한다. 이 장이 왜 필요한지에서 시작해, 학생이 따라오게 한 단계씩 설명하고, 다음 장으로 넘어가는 까닭으로 맺는다.
   식은 $…$(한 줄 식은 $$…$$)로 쓰고, 무엇이 커지면 무엇이 어떻게 되는지 말로 풀어 준다. 원문에 예·값이 있으면 그것으로 보여 준다. 기호는 처음 나올 때 뜻을 말한다.

3. 카드 표시 — 카드는 학습자가 외우고 복습하는 단위(기억)다. 나중에 카드 하나로 문제를 내고 복습한다.
   ⟦카드: 이름 | 모양 | 역할 | p.쪽,쪽⟧ 를 그 내용이 처음 제대로 설명된 자리 바로 뒤에 한 줄로 단다. 카드의 내용은 쓰지 않는다(카드는 따로 만든다).
   - 단위: 하나의 생각(한 정의, 한 판정, 한 절차, 한 식과 그 조건, 한 비교)이 한 카드다. 한 절차의 단계들은 한 카드로 두되, 단계 하나가 따로 외울 식이나 판정이면 그 단계도 카드가 된다.
   - 모양: 용어·사실·목록·조건·절차·공식·비교·개념·패턴 중 하나.
   - 역할: 메인(이 강의에서 새로 배우는 것) · 바탕(이 강의가 기대는, 앞에서 배웠을 지식을 다시 짚은 것) · 곁(알아 두면 좋지만 줄기에서 벗어난 것).
   - 이름: 원문의 용어를 살려 "한국어(영어 원어)"로. 원문 용어가 없으면 한국어로만.
   - 이미 단 카드와 같은 생각이면(다른 장에서 같은 식·같은 판정을 다시 쓰더라도) 새 카드를 달지 않는다.
   - 지나가는 예는 카드로 만들지 않는다.

4. 그림·표 표시 — 학생에게 그림이나 표를 보여 주며 설명할 자리에 한 줄로 단다.
   ⟦그림: 이미지 이름표 | 이 그림에서 볼 것⟧ — 이미지 이름표는 받은 "[이미지]" 뒤의 이름표를 그대로 쓴다.
   ⟦표: p.쪽 | 무엇의 표인지⟧ — 원문에 표가 있는 쪽. 표가 짧으면 본문에 표로 옮겨 써도 된다.

5. 자료에 없는 사실을 지어내지 않는다. 쉬운 말, "~해요" 체, 용어는 "한국어(영어 원어)".`;
export const LF_LECTURE_MODEL = { model: "gpt-6.1-sol", effort: "low" };
export const LF_CARD_MODEL = { model: "gpt-6.1-terra", effort: "low" };

const CARD = /⟦카드:\s*([^|⟧]+?)\s*\|\s*([^|⟧]+?)\s*\|\s*([^|⟧]+?)\s*\|\s*([^⟧]*?)\s*⟧/g;
const FIG = /⟦그림:\s*([^|⟧]+?)\s*\|\s*([^⟧]*?)\s*⟧/g;
const TABLE = /⟦표:\s*([^|⟧]+?)\s*\|\s*([^⟧]*?)\s*⟧/g;
const ROLES = ["메인", "바탕", "곁"];
export type Mark = { n: number; name: string; kind: string; role: string; pages: number[]; index: number; at: number };
const nums = (s: string, pages: number[]) => [...new Set((s.match(/\d+/g) ?? []).map(Number).filter((p) => pages.includes(p)))].sort((a, b) => a - b);
export function marksOf(text: string, pageNumbers: number[]) {
  const out: Array<Omit<Mark, "at" | "n">> = [];
  for (const m of text.matchAll(CARD)) {
    if (out.some((x) => x.name === m[1].trim())) continue;
    out.push({ name: m[1].trim(), kind: m[2].trim(), role: ROLES.includes(m[3].trim()) ? m[3].trim() : "메인", pages: nums(m[4], pageNumbers), index: m.index ?? 0 });
  }
  return out;
}
const bareLabel = (s: string) => s.replace(/^\[이미지\]\s*/, "").replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, "").toLowerCase();
export function figuresOf(text: string) {
  return [...text.matchAll(FIG)].map((m) => ({ label: m[1].trim(), says: m[2].trim(), index: m.index ?? 0 }));
}
export function tablesOf(text: string, pageNumbers: number[]) {
  return [...text.matchAll(TABLE)].map((m) => ({ pages: nums(m[1], pageNumbers), says: m[2].trim(), index: m.index ?? 0 }));
}
export function tocOf(text: string) {
  const toc = /## 목차\s*\n([\s\S]*?)(?=\n## |\s*$)/.exec(text)?.[1] ?? "";
  return toc.split("\n").map((l) => /^\s*(\d+)\.\s*(.+?)\s*\(([^)]*)\)\s*$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ n: Number(m[1]), title: m[2], pages: (m[3].match(/\d+(?:\s*[–-]\s*\d+)?/g) ?? []).flatMap((r) => { const [a, b] = r.split(/[–-]/).map((x) => Number(x.trim())); return b ? Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i) : [a]; }) }));
}
const norm = (s: string) => s.replace(/\([^)]*\)/g, "").replace(/[\s·・,/-]/g, "").toLowerCase();
/** 겹침 의심(코드): 이름(괄호 뺀 것)이 같거나 한쪽이 다른 쪽을 품고, 쪽이 겹친다. */
export function overlaps(marks: Array<Pick<Mark, "name" | "pages">>) {
  const out: string[] = [];
  for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) {
    const a = norm(marks[i].name), b = norm(marks[j].name);
    if (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a)) && marks[i].pages.some((p) => marks[j].pages.includes(p))) out.push(`${marks[i].name} ≈ ${marks[j].name}`);
  }
  return out;
}

export type Img = { page: number; label: string; dataUrl: string };
export async function runLectureFirst(id: string, fileName: string, pages: number[], texts: Record<string, string>, images: Img[]) {
  const t0 = Date.now();
  const imagesOf = (ps: number[]) => images.filter((x) => ps.includes(x.page)).map(({ label, dataUrl }) => ({ label, dataUrl }));
  const user = [`[자료] ${fileName}`, ...pages.map((p) => `[p.${p}]\n${(texts[p] ?? "").trim() || "(글자 없음)"}`)].join("\n\n");
  const marks: Mark[] = [];
  let pending: Mark[] = [];
  let chapters = 0;
  const cards: Array<{ n: number; name: string; role: string; doneAt: number; batch: number; ok: boolean; card?: unknown; error?: string }> = [];
  const batches: Array<{ size: number; ms: number }> = [];
  const jobs: Promise<void>[] = [];
  let firstText = 0;
  const schema = astraJsonSchema(stemFillSchema);
  const flush = () => {
    if (!pending.length) return;
    const group = pending; pending = [];
    const b = batches.length; batches.push({ size: group.length, ms: 0 });
    jobs.push(withTrace({ area: "pdf", action: "quiz-lf-card", ref: id }, async () => {
      const t = Date.now();
      const ps = [...new Set(group.flatMap((m) => m.pages))].sort((x, y) => x - y);
      const u = `[기억 계획]\n${group.map((m) => `- c${m.n} | ${m.name} | ${m.kind} | ${m.role} | p.${m.pages.join(",")}`).join("\n")}\n\n[원문]\n${ps.map((p) => `[p.${p}]\n${texts[p] ?? ""}`).join("\n\n")}`;
      try {
        const r = await callModel({ purpose: "lab:lf-card", system: `${STEM_FILL}\n출력은 JSON으로만 한다.`, user: u, json: true, schema, schemaName: "recaller_lab_lf_card", ...LF_CARD_MODEL, caller: LOCAL_CALLER, images: imagesOf(ps) });
        log("lab:lf-card", LF_CARD_MODEL, t, r.usage, u.length);
        const got = ((r.data as { memories?: Array<{ memory: string }> })?.memories ?? []);
        for (const m of group) { const card = got.find((x) => x.memory === `c${m.n}`); cards.push({ n: m.n, name: m.name, role: m.role, doneAt: Date.now() - t0, batch: b, ok: Boolean(card), card, ...(card ? {} : { error: "답에 없음" }) }); }
      } catch (e) { for (const m of group) cards.push({ n: m.n, name: m.name, role: m.role, doneAt: Date.now() - t0, batch: b, ok: false, error: e instanceof Error ? e.message : String(e) }); }
      batches[b].ms = Date.now() - t;
    }));
  };
  const take = (text: string, final: boolean) => {
    for (const m of marksOf(text, pages)) {
      if (marks.some((x) => x.name === m.name)) continue;
      const mk = { ...m, n: marks.length + 1, at: Date.now() - t0 };
      marks.push(mk); pending.push(mk);
    }
    const ch = (text.match(/\n## (?!목차)/g) ?? []).length;
    if (ch !== chapters) { chapters = ch; flush(); }
    if (pending.length >= 3 || final) flush();
  };
  const started = Date.now();
  const lecture = await withTrace({ area: "pdf", action: "quiz-lf-lecture", ref: id }, async () => {
    const r = await callModel({ purpose: "lab:lf-lecture", system: LECTURE_FIRST_SYSTEM, user, ...LF_LECTURE_MODEL, caller: LOCAL_CALLER, images: imagesOf(pages),
      onText: (text) => { if (!firstText) firstText = Date.now(); take(text, false); } });
    log("lab:lf-lecture", LF_LECTURE_MODEL, started, r.usage, user.length, firstText ? firstText - started : undefined);
    return r.text;
  });
  const lectureMs = Date.now() - t0;
  take(lecture, true);
  await Promise.all(jobs);
  // 그림 표시 → 받은 이미지(이름표가 같은 것). 카드에는 같은 장에서 바로 앞에 나온 그림 표시를 붙인다.
  const byLabel = new Map(images.map((x) => [bareLabel(x.label), x]));
  const figures = figuresOf(lecture).map((f) => { const img = byLabel.get(bareLabel(f.label)); return { ...f, found: Boolean(img), page: img?.page, dataUrl: img?.dataUrl }; });
  const heads = [...lecture.matchAll(/\n## (?!목차)/g)].map((m) => m.index ?? 0);
  const chapterOf = (i: number) => heads.filter((h) => h <= i).length;
  const cardFigure = new Map(marks.map((m) => { const f = [...figures].reverse().find((x) => x.found && x.index < m.index && chapterOf(x.index) === chapterOf(m.index) && (!m.pages.length || m.pages.includes(x.page!))); return [m.n, f?.label]; }));
  const toc = tocOf(lecture);
  const covered = new Set([...toc.flatMap((c) => c.pages), ...marks.flatMap((m) => m.pages)]);
  return { wall: Date.now() - t0, firstTextMs: firstText ? firstText - t0 : null, lectureMs, firstMarkMs: marks[0]?.at ?? null, firstCardMs: cards.length ? Math.min(...cards.map((c) => c.doneAt)) : null,
    lectureChars: lecture.length, toc, marks: marks.map((m) => ({ ...m, figure: cardFigure.get(m.n) ?? null })), batches, cards: cards.sort((a, b) => a.n - b.n),
    roles: Object.fromEntries(ROLES.map((r) => [r, marks.filter((m) => m.role === r).length])), overlaps: overlaps(marks),
    figures, figuresFound: figures.filter((f) => f.found).length, tables: tablesOf(lecture, pages), missingPages: pages.filter((p) => !covered.has(p)), lecture };
}

function log(purpose: string, m: { model: string; effort: string }, started: number, u: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; reasoningTokens?: number } | undefined, inChars: number, firstTextMs?: number) {
  logAssistCall({ at: new Date(started).toISOString(), purpose, ...m, ms: Date.now() - started, ...(firstTextMs ? { firstTextMs } : {}), ok: true, inChars,
    ...(u ? { tokens: { in: u.inputTokens, cached: u.cachedInputTokens, out: u.outputTokens, reasoning: u.reasoningTokens } } : {}), trace: currentTrace() });
}
