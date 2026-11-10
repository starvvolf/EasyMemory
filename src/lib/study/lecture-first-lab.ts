// 강의 먼저 엔진 실험 (11/10 사용자 "엔진 앞부분에 강의를 진행시키는데, 처음에 목차를 입맛대로 페이지 묶어도 좋고, 카드 규칙을 주고
// 스트리밍으로 GPT 챗처럼. 카드 규칙은 강의 흐름에 맞춰서 알아야 하는 거 잡으라고 하고, 카드 양식 다 만들지 말고 표시만 해 주면
// 카드는 그때그때 호출로 따로 만들어. sol한테 시키고"). 제품 흐름에 넣지 않는다.
//   ① 강의(sol, 스트리밍 글): 자료 전체(원문 + 쪽 그림) → "## 목차"(강사가 묶은 장과 쪽) → 장마다 강의, 알아야 할 것이 나오는 자리에 ⟦카드: 이름 | 모양 | p.쪽⟧ 표시
//   ② 카드(terra, 표시가 나오는 즉시 하나씩 따로): 그 카드의 쪽 원문 + 쪽 그림 → 엔진의 기억 채우기와 같은 모양(stem.ts STEM_FILL)
import { callModel } from "../ai/model.ts";
import { currentTrace, withTrace } from "../ai/trace.ts";
import { LOCAL_CALLER, logAssistCall } from "../assist/model.ts";
import { astraJsonSchema } from "./gen/astra.ts";
import { STEM_FILL, stemFillSchema } from "./gen/stem.ts";

export const LECTURE_FIRST_SYSTEM = `너는 이 강의를 맡은 강사다. 강의 자료 한 편 전체(쪽마다 [p.N] 원문, 그림으로 된 쪽과 그림 조각은 "원문 p.N" 이름표의 이미지)를 받는다.
학생에게 이 자료를 처음부터 끝까지 강의한다. 채팅으로 말하듯 바로 써 내려간다.
1. 맨 처음 "## 목차"에 네가 강의할 순서를 쓴다. 줄마다 "N. 장 이름 (p.쪽, 쪽–쪽)". 이해하기 쉬운 순서라면 자료의 순서를 바꾸고 쪽을 마음대로 묶어도 된다. 배울 것이 있는 쪽은 모두 어느 장엔가 들어간다(표지·목차·강의 운영 안내는 뺀다).
2. 그다음 장마다 "## N. 장 이름" 아래에서 강의한다. 이 장이 왜 필요한지에서 시작해, 학생이 따라오게 한 단계씩 설명하고, 다음 장으로 넘어가는 까닭으로 맺는다.
   식은 원문 그대로 쓰고 무엇이 커지면 무엇이 어떻게 되는지 말로 풀어 준다. 원문에 예·값·그림이 있으면 그것으로 보여 준다. 기호는 처음 나올 때 뜻을 말한다.
3. 카드 표시: 강의 흐름에서 학생이 꼭 알아야 하는 것(외우고 복습할 단위)이 처음 제대로 설명되는 자리 바로 뒤에 한 줄로 표시를 단다.
   ⟦카드: 이름 | 모양 | p.쪽,쪽⟧ — 모양은 용어·사실·목록·조건·절차·공식·비교·개념·패턴 중 하나, 쪽은 그 내용이 있는 원문 쪽.
   카드의 내용은 쓰지 않는다(카드는 따로 만든다). 이 강의의 흐름에 필요한 것만 카드로 잡고, 지나가는 예·이미 아는 바탕은 카드로 만들지 않는다. 같은 것을 다시 다룰 때는 표시를 다시 달지 않는다.
4. 자료에 없는 사실을 지어내지 않는다. 쉬운 말, "~해요" 체, 용어는 "한국어(영어 원어)".`;
export const LF_LECTURE_MODEL = { model: "gpt-6.1-sol", effort: "low" };
export const LF_CARD_MODEL = { model: "gpt-6.1-terra", effort: "low" };

const MARK = /⟦카드:\s*([^|⟧]+?)\s*\|\s*([^|⟧]+?)\s*\|\s*([^⟧]*?)\s*⟧/g;
export type Mark = { n: number; name: string; kind: string; pages: number[]; at: number };
export function marksOf(text: string, pageNumbers: number[]): Array<Omit<Mark, "at" | "n">> {
  const out: Array<Omit<Mark, "at" | "n">> = [];
  for (const m of text.matchAll(MARK)) {
    const pages = [...new Set((m[3].match(/\d+/g) ?? []).map(Number).filter((p) => pageNumbers.includes(p)))].sort((a, b) => a - b);
    if (!out.some((x) => x.name === m[1].trim())) out.push({ name: m[1].trim(), kind: m[2].trim(), pages });
  }
  return out;
}
export function tocOf(text: string) {
  const toc = /## 목차\s*\n([\s\S]*?)(?=\n## |\s*$)/.exec(text)?.[1] ?? "";
  return toc.split("\n").map((l) => /^\s*(\d+)\.\s*(.+?)\s*\(([^)]*)\)\s*$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ n: Number(m[1]), title: m[2], pages: (m[3].match(/\d+(?:\s*[–-]\s*\d+)?/g) ?? []).flatMap((r) => { const [a, b] = r.split(/[–-]/).map((x) => Number(x.trim())); return b ? Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i) : [a]; }) }));
}

type Img = { label: string; dataUrl: string };
export async function runLectureFirst(id: string, fileName: string, pages: number[], texts: Record<string, string>, imagesOf: (ps: number[]) => Img[]) {
  const t0 = Date.now();
  const user = [`[자료] ${fileName}`, ...pages.map((p) => `[p.${p}]\n${(texts[p] ?? "").trim() || "(글자 없음)"}`)].join("\n\n");
  const marks: Mark[] = [];
  const cards: Array<{ n: number; name: string; ms: number; doneAt: number; ok: boolean; card?: unknown; error?: string }> = [];
  const jobs: Promise<void>[] = [];
  let firstText = 0;
  const schema = astraJsonSchema(stemFillSchema);
  const makeCard = (mk: Mark) => withTrace({ area: "pdf", action: "quiz-lf-card", ref: id }, async () => {
    const t = Date.now();
    const u = `[기억 계획]\n- c${mk.n} | ${mk.name} | ${mk.kind} | 메인 | p.${mk.pages.join(",")}\n\n[원문]\n${mk.pages.map((p) => `[p.${p}]\n${texts[p] ?? ""}`).join("\n\n")}`;
    try {
      const r = await callModel({ purpose: "lab:lf-card", system: `${STEM_FILL}\n출력은 JSON으로만 한다.`, user: u, json: true, schema, schemaName: "recaller_lab_lf_card", ...LF_CARD_MODEL, caller: LOCAL_CALLER, images: imagesOf(mk.pages) });
      log("lab:lf-card", LF_CARD_MODEL, t, r.usage, u.length);
      cards.push({ n: mk.n, name: mk.name, ms: Date.now() - t, doneAt: Date.now() - t0, ok: true, card: (r.data as { memories?: unknown[] })?.memories?.[0] });
    } catch (e) { cards.push({ n: mk.n, name: mk.name, ms: Date.now() - t, doneAt: Date.now() - t0, ok: false, error: e instanceof Error ? e.message : String(e) }); }
  });
  const started = Date.now();
  const lecture = await withTrace({ area: "pdf", action: "quiz-lf-lecture", ref: id }, async () => {
    const r = await callModel({ purpose: "lab:lf-lecture", system: LECTURE_FIRST_SYSTEM, user, ...LF_LECTURE_MODEL, caller: LOCAL_CALLER, images: imagesOf(pages),
      onText: (text) => {
        if (!firstText) firstText = Date.now();
        for (const m of marksOf(text, pages)) {
          if (marks.some((x) => x.name === m.name)) continue;
          const mk = { ...m, n: marks.length + 1, at: Date.now() - t0 };
          marks.push(mk);
          jobs.push(makeCard(mk));
        }
      } });
    log("lab:lf-lecture", LF_LECTURE_MODEL, started, r.usage, user.length, firstText ? firstText - started : undefined);
    return r.text;
  });
  const lectureMs = Date.now() - t0;
  for (const m of marksOf(lecture, pages)) if (!marks.some((x) => x.name === m.name)) { const mk = { ...m, n: marks.length + 1, at: lectureMs }; marks.push(mk); jobs.push(makeCard(mk)); }
  await Promise.all(jobs);
  const toc = tocOf(lecture);
  const covered = new Set([...toc.flatMap((c) => c.pages), ...marks.flatMap((m) => m.pages)]);
  return { wall: Date.now() - t0, firstTextMs: firstText ? firstText - t0 : null, lectureMs, firstMarkMs: marks[0]?.at ?? null, firstCardMs: cards.length ? Math.min(...cards.map((c) => c.doneAt)) : null,
    lectureChars: lecture.length, toc, marks, cards: cards.sort((a, b) => a.n - b.n), missingPages: pages.filter((p) => !covered.has(p)), lecture };
}

function log(purpose: string, m: { model: string; effort: string }, started: number, u: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; reasoningTokens?: number } | undefined, inChars: number, firstTextMs?: number) {
  logAssistCall({ at: new Date(started).toISOString(), purpose, ...m, ms: Date.now() - started, ...(firstTextMs ? { firstTextMs } : {}), ok: true, inChars,
    ...(u ? { tokens: { in: u.inputTokens, cached: u.cachedInputTokens, out: u.outputTokens, reasoning: u.reasoningTokens } } : {}), trace: currentTrace() });
}
