// 강의 3 — 영역 한 흐름 (11/11 사용자 "강의 탭 새 방식으로 연결"). 11/10 정한 것: "메인 커리큘럼을 그때그때 만들지 말고 쭉 뽑고, 사이사이 모르는 게 있으면
// 대화 내용 잘라서 넣어 주면 되잖아", "큰 파트 나눠서", 실험 lecture-plan-lab.ts(영역 1: 첫 글자 3초, 70초, $0.046, 쪽 커버·기호·카드 자리 모두 좋음).
// - 파트 = 자료 지도의 영역(줄기 엔진이 자료 전체를 보고 이미 나눈 것). 영역 하나 = sol 호출 하나(스트리밍), 강사가 그 안을 걸음(⟦걸음 n | 제목⟧)으로 나눠 강의한다.
//   화면의 장 하나 = 걸음 하나. 카드는 이미 만든 기억(그래서 안다 = 카드만 / 모른다 = 강의, 둘이 같은 카드).
// - 메인 강의는 다시 쓰지 않는다. 학생 질문은 그 걸음 밑에(앞쪽은 영역 강의와 같게 두어 session_id 캐시, 할 일·수업 기록은 tail).
// - 다음 영역은 화면이 지금 영역을 보는 동안(지금 영역을 다 쓴 뒤) 하나만 미리 부른다.
// 저장 study-gen/<id>/lecture-areas.json, 쓰는 중인 글은 서버 메모리. /api/study-map/<id>/lecture?v=3
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { callModel } from "../ai/model.ts";
import { currentTrace, withTrace } from "../ai/trace.ts";
import { LOCAL_CALLER, logAssistCall } from "../assist/model.ts";
import { context, imagesOf } from "./lecture-steps.ts";
import type { MapCard } from "./material-map.ts";

export const AREA_MODEL = { model: "gpt-6.1-sol", effort: "low" };
// 11/11 사용자 "강의가 왜 페이지마다 흐름이 똑같지" → "gpt랑 얘기 좀 해 봐 프롬프트에 대해": sol(medium)과 두 번 상의한 최종안.
// 진단: 걸음마다 시작(상황 질문)·끝(확인)을 못 박고 "여기서 많이들…" 문구까지 지정해, 모델이 매 걸음 다섯 칸을 채웠다. 카드가 걸음 끝 신호가 됐다.
// + 사용자 "자유롭게 풀어 놔도 초심자도 술술 읽히고, 나오는 내용은 다 배워야 하는 핵심".
// + 사용자 "굵게 쓰는 걸 컨트롤해서 카드로"(11/11): 카드의 핵심 말은 ⟦굵게 id | 말⟧ — 화면이 굵게 그리고 누르면 그 카드.
// 바꾼 것: 도입·헷갈림·카드·확인은 필요한 자리에(걸음마다 채울 칸이 아님), 확인은 뒤 설명이 앞의 구분·조건에 기대는 곳 + 영역 끝, 카드 경계 ≠ 걸음 경계.
export const AREA_SYSTEM = `너는 이 강의를 맡은 강사다. 학생은 이 자료를 처음 본다. 글자로만 답한다.
받는 것: 강의 전체의 영역과 기억 카드 목록, 지금 영역의 기억 카드(id · 이름 · 모양 · 역할 · 요지 · 식과 조건 · 헷갈리는 점 · 쪽), 지금 영역의 쪽들 원문과 그림("[이미지] 이름표"), 맨 끝의 [할 일].

공통 원칙:
- 자료에 근거해 설명하고, 자료에 없는 사실·조건·관계를 지어내지 않는다. 자료만으로 알 수 없는 것은 그 한계를 밝힌다.
- 식은 $…$(독립된 식은 $$…$$)로, 기호와 이름은 원문 그대로 쓴다. 기호는 처음 사용할 때 뜻을 밝히고, 식의 조건과 무엇이 달라지면 무엇이 어떻게 달라지는지 말로 풀어 준다.
- 그림은 받은 그림만 가리킨다. 그 그림을 보며 설명할 자리에 ⟦그림: 이미지 이름표 | 이 그림에서 볼 것⟧을 별도 줄에 쓴다(받은 이름표 그대로). 표는 본문에 표로 옮겨 써도 된다.
- 쉬운 말, "~해요" 체를 쓴다. 용어는 자료에 영어 원어가 있으면 "한국어(영어 원어)"로 소개한다.
- [할 일]에 맞춰 답한다. 아래는 영역 강의를 요청받았을 때 적용한다.

영역을 강의할 때:
- 말투와 전개는 자유롭게 풀어 써도 된다. 다만 처음 배우는 사람이 막힘없이 술술 읽히게 쓰고, 나오는 문장은 모두 이 영역에서 배워야 할 핵심을 위한 것이어야 한다(꾸밈말·같은 말 되풀이·배울 것과 상관없는 이야기는 넣지 않는다).
- 지금 영역 쪽의 내용은 카드에 안 들어간 것까지 빠짐없이 다룬다. 반복된 내용은 이어서 쓰되, 새로 붙은 조건이나 차이는 설명한다.
- 영역을 이해가 진전되는 순서로 걸음으로 나눈다. 걸음 하나는 앞 걸음까지로는 할 수 없던 설명·구분·판단을 할 수 있게 한다. 새 학습 과제로 넘어가면 걸음을 나누고, 식과 적용 조건처럼 함께 보아야 이해되는 내용은 함께 다룬다.
- 걸음 맨 앞에 ⟦걸음 n | 제목⟧을 별도 줄에 쓴다(n은 1부터, 제목은 무엇을 배우는지).
- 새 개념이 나오는 걸음은 정의보다 먼저 감을 잡게 해 준다: 자료의 예·그림·작은 값으로 보여 주거나, 개념과 딱 맞는 익숙한 장면이 있으면 그걸로. 맞지 않는 비유를 끌어오지 않고, 질문으로만 열지 않는다. 앞 내용을 이어 가는 걸음은 바로 들어간다.
- 시작과 전개는 내용의 연결에 맞춘다. 상황이나 질문은 배울 필요를 드러낼 때 쓰고, 앞 설명에서 필요가 드러났다면 바로 이어 설명한다. 도입·헷갈림 교정·카드·확인은 걸음마다 채울 칸이 아니라 각각 필요한 자리에 놓는다.
- 카드의 헷갈리는 점과 원문에서 혼동하기 쉬운 구분은 관련 내용을 설명하는 자리에서 조건·차이·적용 범위로 풀어 준다. 이미 설명으로 해결한 혼동은 별도 문단으로 반복하지 않는다. 학생들이 흔히 틀린다는 주장은 근거 없이 붙이지 않는다.
- 쪽 사이에서 기호나 조건이 달라지면 원문 표기를 유지하며 차이를 짚는다. 자료가 설명하지 않은 차이의 이유는 지어내지 않는다.
- 카드의 핵심 말(용어·결론)이 강의에서 처음 나올 때 ⟦굵게 카드id | 그 말⟧로 쓴다. 화면에서 그 말이 굵게 보이고, 누르면 그 카드가 펼쳐진다. 카드와 상관없이 강조할 말은 **그 말**로 쓴다. 문장마다 굵게 쓰지 않는다.
- 지금 영역의 카드는 모두, 그 카드의 내용을 다 설명한 자리에 ⟦카드 카드id⟧를 별도 줄에 쓴다(받은 id 그대로). 카드 경계와 걸음 경계는 별개다. 바탕 카드는 쓰이는 곳에서 필요한 내용을 떠올려 주고, 곁 카드는 현재 설명과의 관계와 요지를 설명한다.
- 뒤의 설명이 앞서 배운 중요한 구분이나 적용 조건에 의존하는 지점에서는, 그 이해를 확인하고 이어 간다. 영역을 마칠 때는 핵심 내용을 연결해 판단할 수 있는지 확인한다.
- 확인은 그때까지 배운 내용으로 구분하거나 적용해 보는 질문으로 한다. ⟦확인⟧ 뒤에 질문을 쓰고, 다음 줄에 ⟦답⟧ 뒤에 답과 까닭을 쓴다.
- 마지막 걸음 끝에서 이 영역을 묶고, 다음 영역이 있으면 넘어가는 까닭을 말한다.
- 다른 영역의 구체적인 설명은 해당 영역에 맡긴다. "질문 있나요?"는 쓰지 않는다(학생이 화면에서 묻는다).`;
const ASK_RULE = `[할 일] 강의 도중 학생이 지금 걸음에서 물었다. 지금까지의 수업과 이 영역 쪽들의 원문을 바탕으로, 학생이 막힌 곳만 짧고 쉽게 답한다.
학생이 무엇을 잘못 알고 있었는지가 보이면 그것을 바로잡는다. 답이 이 영역의 뒤 걸음이나 다른 영역에서 나오면 "뒤에서 자세히 볼게요"라고 짧게 짚는다.
걸음 표시(⟦걸음⟧)와 ⟦확인⟧은 쓰지 않는다. 식은 $…$. 그림이 도움이 되면 ⟦그림: 이미지 이름표 | 볼 것⟧. 메인 설명을 처음부터 다시 하지 않는다. "~해요" 체.`;

type Ask = { q: string; a: string; status: "writing" | "done" | "failed"; at: string };
type Area = { status: "writing" | "done" | "failed" | "stopped"; text: string; ms?: number; firstTextMs?: number; at: string };
export type LectureAreas = { areas: Record<string, Area>; asks: Record<string, Ask[]> };

const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");
const fileOf = (id: string) => { if (!/^gen_[a-z0-9]{8,64}$/.test(id)) throw Object.assign(new Error("자료를 찾을 수 없어요."), { status: 404 }); return path.join(dataDir(), "study-gen", id, "lecture-areas.json"); };
async function load(id: string): Promise<LectureAreas> { try { return JSON.parse(await readFile(fileOf(id), "utf8")) as LectureAreas; } catch { return { areas: {}, asks: {} }; } }
let saving = Promise.resolve();
function save(id: string, l: LectureAreas) { saving = saving.then(async () => { const f = fileOf(id); await mkdir(path.dirname(f), { recursive: true }); await writeFile(`${f}.tmp`, JSON.stringify(l, null, 1)); await rename(`${f}.tmp`, f); }).catch(() => undefined); return saving; }

const live = new Map<string, string>();
const aborts = new Map<string, AbortController>();
const lectures = new Map<string, LectureAreas>();
// 서버가 다시 켜지면(개발 서버가 코드를 다시 읽을 때도) 쓰던 호출은 사라진다: 파일에 '쓰는 중'으로 남은 영역은 멈춘 것으로.
async function lectureOf(id: string) {
  let l = lectures.get(id);
  if (!l) { l = await load(id); for (const [k, a] of Object.entries(l.areas)) if (a.status === "writing" && !aborts.has(`${id}:${k}`)) a.status = "stopped";
    for (const list of Object.values(l.asks)) for (const q of list) if (q.status === "writing") q.status = "failed"; lectures.set(id, l); }
  return l;
}

/** 강사의 글을 걸음으로 나눈다(⟦걸음 n | 제목⟧). 첫 표시 앞의 글은 첫 걸음에 붙인다. */
export function stepsOf(text: string) {
  const marks = [...text.matchAll(/⟦걸음\s*(\d+)\s*(?:\|\s*([^⟧]*?))?\s*⟧/g)];
  if (!marks.length) return text.trim() ? [{ n: 1, title: "", text }] : [];
  return marks.map((m, i) => ({ n: Number(m[1]), title: (m[2] ?? "").trim(), text: `${i === 0 ? text.slice(0, m.index) : ""}${text.slice(m.index! + m[0].length, marks[i + 1]?.index ?? text.length)}`.replace(/^\s+/, "") }));
}

const cardText = (c: MapCard) => {
  const m = (c as MapCard & { memo?: { line?: string; facts?: string[]; details?: string[]; role?: string } }).memo;
  return [`[${c.id}] ${c.title} (${c.kind}, ${m?.role ?? (c.core ? "메인" : "바탕")}, p.${c.pages.join(",")})`, c.shape ? `  모양: ${JSON.stringify(c.shape)}` : "", m?.line ? `  요지: ${m.line}` : "",
    ...(m?.facts ?? []).map((f) => `  식·조건: ${f}`), ...(m?.details ?? []).map((f) => `  참고: ${f}`), ...c.mistakes.map((x) => `  헷갈리는 점: ${x}`)].filter(Boolean).join("\n");
};
// 캐시(session_id): 앞쪽(지시문 · 목록 · 이 영역 카드 · 쪽 원문 + 그림)은 그 영역의 강의와 질문들이 똑같이 쓰고, 바뀌는 것은 tail로.
async function prefix(id: string, sectionId: string) {
  const { map, texts, sections } = await context(id);
  const i = sections.findIndex((x) => x.id === sectionId);
  const sec = sections[i];
  if (!sec) throw Object.assign(new Error("그 영역을 찾을 수 없어요."), { status: 404 });
  const list = sections.map((x, k) => `영역 ${k + 1}. ${x.title}\n${x.cards.map((c) => `- ${c.title}`).join("\n")}`).join("\n");
  const user = `[자료] ${map.title}\n\n[영역과 기억 카드 목록]\n${list}\n\n[지금 영역] 영역 ${i + 1}. ${sec.title} (p.${sec.pages.join(",")})${i === sections.length - 1 ? " — 마지막 영역" : ""}\n[지금 영역의 카드]\n${sec.cards.map(cardText).join("\n")}\n\n[원문]\n${sec.pages.map((p) => `[p.${p}]\n${texts[p] ?? ""}`).join("\n\n")}`;
  return { sec, n: i + 1, user, images: await imagesOf(id, sec.pages) };
}

async function stream(id: string, key: string, purpose: string, user: string, tail: string, images: Array<{ label: string; dataUrl: string }>, cacheKey: string, onDone: (text: string, ok: boolean, stopped: boolean, ms: number, firstMs?: number) => void, current: () => boolean = () => true) {
  aborts.get(key)?.abort();
  const abort = new AbortController(); aborts.set(key, abort); live.set(key, "");
  const t = Date.now(); let first = 0;
  try {
    const r = await withTrace({ area: "pdf", action: "lecture-area", ref: id }, async () => {
      const x = await callModel({ purpose, system: AREA_SYSTEM, user, tail, cacheKey, ...AREA_MODEL, caller: LOCAL_CALLER, images: images.map(({ label, dataUrl }) => ({ label, dataUrl })),
        signal: abort.signal, onText: (s) => { if (!first) first = Date.now(); if (current()) live.set(key, s); } });
      const u = x.usage;
      logAssistCall({ at: new Date(t).toISOString(), purpose, ...AREA_MODEL, ms: Date.now() - t, ...(first ? { firstTextMs: first - t } : {}), ok: true, inChars: user.length,
        ...(u ? { tokens: { in: u.inputTokens, cached: u.cachedInputTokens, out: u.outputTokens, reasoning: u.reasoningTokens } } : {}), trace: currentTrace() });
      return x;
    });
    onDone(r.text, true, false, Date.now() - t, first ? first - t : undefined);
  } catch { onDone(current() ? live.get(key) ?? "" : "", false, abort.signal.aborted, Date.now() - t, first ? first - t : undefined); }
  finally { if (aborts.get(key) === abort) { live.delete(key); aborts.delete(key); } }
}

// 같은 영역을 두 번 부르지 않는다(11/11 버그: [다음 영역]과 미리 부르기가 거의 같이 와서, 둘 다 그림을 그리는 동안 검사를 지나 호출이 둘 —
// 두 글이 같은 자리에 번갈아 써져 화면의 장이 혼자 바뀌었다). 검사와 '쓰는 중' 표시를 기다림 없이 한 번에 하고, 한 영역에 도는 호출은 하나(새로 부르면 앞의 것은 끊고 그 답은 버린다).
const runs = new Map<string, number>();
export async function startArea(id: string, sectionId: string, opts: { again?: boolean } = {}) {
  const l = await lectureOf(id);
  const had = l.areas[sectionId];
  if (had && !opts.again && (had.status === "writing" || had.status === "done")) return;
  const key = `${id}:${sectionId}`;
  const run = (runs.get(key) ?? 0) + 1; runs.set(key, run);
  aborts.get(key)?.abort();
  l.areas[sectionId] = { status: "writing", text: "", at: new Date().toISOString() };
  if (opts.again) for (const k of Object.keys(l.asks)) if (k.startsWith(`${sectionId}:`)) delete l.asks[k];
  void save(id, l);
  let pre: Awaited<ReturnType<typeof prefix>>;
  try { pre = await prefix(id, sectionId); } catch (e) { if (runs.get(key) === run) { l.areas[sectionId] = { ...l.areas[sectionId], status: "failed" }; void save(id, l); } throw e; }
  if (runs.get(key) !== run) return; // 그사이 다시 불렸다
  const { sec, n, user, images } = pre;
  void stream(id, key, "map:lecture-area", user, `[할 일] 영역 ${n}. ${sec.title}을 강의한다.`, images, `recaller-lecture3-${id}-${sectionId}`, (text, ok, stopped, ms, firstTextMs) => {
    if (runs.get(key) !== run) return; // 끊고 다시 부른 앞의 호출
    l.areas[sectionId] = { status: ok ? "done" : stopped ? "stopped" : "failed", text, ms, ...(firstTextMs ? { firstTextMs } : {}), at: l.areas[sectionId]?.at ?? new Date().toISOString() };
    void save(id, l);
  }, () => runs.get(key) === run);
}

export async function askStep(id: string, sectionId: string, step: number, q: string) {
  const l = await lectureOf(id);
  const area = l.areas[sectionId];
  if (!area?.text) throw Object.assign(new Error("설명을 들은 걸음에서 물을 수 있어요."), { status: 409 });
  const steps = stepsOf(area.status === "writing" ? live.get(`${id}:${sectionId}`) ?? area.text : area.text);
  const upto = steps.filter((s) => s.n <= step);
  const key = `${sectionId}:${step}`;
  const before = l.asks[key] ?? [];
  const { user, images } = await prefix(id, sectionId);
  const ask: Ask = { q: q.slice(0, 1000), a: "", status: "writing", at: new Date().toISOString() };
  const tail = `[지금까지의 수업]\n${upto.map((s) => `⟪걸음 ${s.n}. ${s.title}⟫\n${s.text}`).join("\n\n")}\n${before.filter((a) => a.status === "done").map((a) => `\n(학생) ${a.q}\n(강사) ${a.a}`).join("")}\n\n[학생 질문 — 걸음 ${step}] ${ask.q}\n\n${ASK_RULE}`;
  l.asks[key] = [...before, ask];
  await save(id, l);
  void stream(id, `${id}:${key}:ask`, "map:lecture-area-ask", user, tail, images, `recaller-lecture3-${id}-${sectionId}`, (text, ok, stopped) => {
    ask.a = text; ask.status = ok || stopped ? "done" : "failed";
    void save(id, l);
  });
}

/** /api/study-map/<id>/lecture?v=3 — GET 영역·걸음·질문(쓰는 중 글 포함) · POST {action:"area"|"ask"|"stop"|"again", section, step, q} (그림은 ?v=2&fig=) */
export async function lectureAreasApi(request: Request, id: string) {
  const { NextResponse } = await import("next/server");
  if (request.method === "GET") {
    const l = await lectureOf(id);
    const { sections } = await context(id);
    const view = sections.map((s) => {
      const a = l.areas[s.id];
      const text = a?.status === "writing" ? live.get(`${id}:${s.id}`) ?? a.text : a?.text ?? "";
      const steps = stepsOf(text).map((x) => ({ ...x, asks: (l.asks[`${s.id}:${x.n}`] ?? []).map((q, k, all) => ({ ...q, a: q.status === "writing" && k === all.length - 1 ? live.get(`${id}:${s.id}:${x.n}:ask`) ?? q.a : q.a })) }));
      return { id: s.id, title: s.title, cards: s.cards.map((c) => c.id), status: a?.status ?? null, ms: a?.ms ?? null, steps };
    });
    return NextResponse.json({ lecture: { areas: view } });
  }
  const body = await request.json().catch(() => ({})) as { action?: string; section?: string; step?: number; q?: string };
  if (body.action === "area" && body.section) await startArea(id, body.section);
  else if (body.action === "again" && body.section) await startArea(id, body.section, { again: true });
  else if (body.action === "ask" && body.section && Number.isInteger(body.step) && body.q?.trim()) await askStep(id, body.section, body.step!, body.q.trim());
  else if (body.action === "stop") { for (const [k, a] of aborts) if (k.startsWith(`${id}:`)) a.abort(); }
  else return NextResponse.json({ message: "action은 area·ask·stop·again" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
