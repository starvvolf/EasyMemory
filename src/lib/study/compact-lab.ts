// 기억 합치기·구조 실험 (11/9 사용자 "입출력 오버헤드 고려해서 다양한 방법을 실험해봐"). 제품 흐름에 넣지 않는다.
// 같은 자료로 방법마다 한 번씩: 걸린 시간(벽시계, 호출마다 첫 글자·전체), 입력·출력 토큰, 값(API였다면), 결과(기억 수·메인·한 장짜리·빠진 카드).
// 결과는 study-gen/<id>/compact-lab/<방법>.json. 토큰은 assist-log.jsonl에서 이 실행의 trace(action "clab:<run>:…")로 모은다.
//   two        지금 제품: ① 영역 나누기(카드 줄 120자) → ② 영역마다 동시에 기억(카드 줄 전체)
//   one        한 번에: 영역 + 기억 (카드 줄 전체)
//   codeAreas  영역을 코드가: 목차 주제를 차례대로 카드 ~20장씩 덩어리 → 덩어리마다 동시에 기억 + 그 덩어리 이름. ① 호출이 없다
//   short      two와 같되 ②에도 카드 줄을 "종류|제목"만(입력 줄이기)
//   allInOne   two의 ②까지 + 구조를 같은 시간에: ③ 구조는 기억이 나와야 하니, 대신 ② 호출이 자기 영역의 상자·대비를 같이 내고 ③ 영역 사이 짝만 짧게
//   raw        카드 없이 원문에서 바로: ① 쪽 첫 줄들로 영역(쪽 범위) → ② 영역마다 그 쪽 원문으로 기억(근거는 쪽)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { askJson, S } from "../assist/model.ts";
import { withTrace } from "../ai/trace.ts";
import { costOf } from "../ai/prices.ts";
import { loadGen } from "./gen/runner.ts";
import { materialMap } from "./material-map.ts";
import { loadStructure } from "./structure.ts";
import { AREA_MEMORY_SYSTEM, AREA_SCHEMA, AREA_SYSTEM, COMPACT_MODEL, COMPACT_SYSTEM, MEM_SCHEMA, MEMORY_KINDS, MEMORY_ROLES, checkCompact, compactInput, type Reply } from "./compact.ts";

export const LAB_METHODS = ["two", "one", "codeAreas", "short", "allInOne", "raw", "plan", "planCards", "planDirect", "planShort"] as const;
// 11/10 "목차 빼고 바로 줄기로 가면?": planDirect = 목차 없이 쪽(제목 + 글 앞 300자)에서 바로 줄기(짧게: 이름·종류·역할·영역·쪽만).
//   planShort = plan과 같은 입력(목차)이되 짧게. 둘을 견주면 목차가 줄기에 무엇을 보태는지, 출력 줄이기가 얼마나 빠른지 보인다.
// 거꾸로 (11/10 사용자 "줄기에서 바로 카드로 가면 어떻게 되는지"): 카드 → 줄기가 아니라 줄기 → 카드.
//   plan       목차(엔진의 목차 단계 결과: 주제·항목 이름·쪽) + 쪽 첫 줄로 줄기(영역·기억·쪽)를 먼저. 카드 없이. 카드로 만든 줄기와 견준다.
//   planCards  plan 다음, 영역마다 동시에 그 쪽 원문 + 그 영역 기억 계획을 주고 기억 아래 카드를 쓴다(글자만, 그림 없음).
//              엔진 카드(지금 있는 것)의 핵심 카드 제목이 새 카드에 얼마나 나오는지 코드로 센다.
export type LabMethod = (typeof LAB_METHODS)[number];
const dataDir = () => process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data");
const M = COMPACT_MODEL;
type Mem = Reply["memories"][number];

const ONE_SCHEMA = S.obj({ areas: S.arr(S.obj({ name: S.str, question: S.str })), memories: MEM_SCHEMA.properties.memories });
const CHUNK_SYSTEM = AREA_MEMORY_SYSTEM.replace("지금은 이 강의의 한 영역만 받는다(영역 이름·배우는 질문이 주어진다). 그 영역의 카드만으로 기억을 만든다. area는 1로 쓴다.",
  "지금은 이 강의의 카드 한 덩어리(자료 순서로 이어진 구간)만 받는다. 이 덩어리의 카드만으로 기억을 만들고, 덩어리 전체에 이름(name, 2~14자)과 배우는 질문(question) 한 줄을 붙인다. area는 1로 쓴다.");
const CHUNK_SCHEMA = S.obj({ name: S.str, question: S.str, memories: MEM_SCHEMA.properties.memories });
const LOCAL_STRUCT = `

[이 영역의 구조도 같이] 기억을 만든 뒤, 이 영역 안에서:
- boxes: 기억 번호(memories 배열의 순서, 1부터)를 뜻으로 묶은 상자 0~4개 {name 2~10자, head(대표 기억 번호 또는 0), items(나머지 번호), members(부분·종류·모두·순서·묶음)}. 혼자인 기억은 상자에 넣지 않아도 된다.
- versus: 나란히 견줄 두 기억 {a, b, on 8~14자} 0~3개.`;
const ALL_SCHEMA = S.obj({ memories: MEM_SCHEMA.properties.memories,
  boxes: S.arr(S.obj({ name: S.str, head: S.int, items: S.arr(S.int), members: S.oneOf("부분", "종류", "모두", "순서", "묶음") })),
  versus: S.arr(S.obj({ a: S.int, b: S.int, on: S.str })) });
const LINK_SYSTEM = `강의 자료의 기억 목록(영역별)을 받는다. 서로 다른 영역의 두 기억이 같은 생각(같은 판정·같은 갱신·같은 대칭)을 쓰거나, 하나가 다른 하나의 결과·도구를 쓰면 잇는다.
pairs 0~10개 {a, b: 기억 번호, why 12~20자}. 같은 영역끼리는 잇지 않는다.`;
const LINK_SCHEMA = S.obj({ pairs: S.arr(S.obj({ a: S.int, b: S.int, why: S.str })) });
const RAW_AREA_SYSTEM = `강의 자료 한 편의 쪽마다 첫 줄들(제목)을 받는다. 이 강의가 가르치려는 것을 큰 영역 3~7개로 자료 순서대로 나눈다.
name(2~14자), question(배우는 질문 한 줄), from·to(쪽 번호, 이어진 구간). 모든 쪽을 정확히 한 영역에 넣는다(표지·목차 쪽은 앞 영역에).`;
const RAW_AREA_SCHEMA = S.obj({ areas: S.arr(S.obj({ name: S.str, question: S.str, from: S.int, to: S.int })) });
const RAW_SYSTEM = COMPACT_SYSTEM
  .replace(/카드는 자료를 쪽마다[\s\S]*?이해하게 하는 것이다\.\n/, "카드 대신 강의 자료 원문(쪽마다 [p.N])을 받는다. 원문을 읽고 학습자가 외우고 복습할 기억을 바로 만든다. 목표는 쪽을 낱장으로 외우는 게 아니라 서로 이어진 몇 가지 원리·알고리즘·개념으로 이해하게 하는 것이다.\n")
  .replace(/먼저 \(쓰지 말고\)[\s\S]*?기억을 만든다\.\n/, "지금은 이 강의의 한 영역(쪽 구간)만 받는다. area는 1로 쓴다.\n")
  .replace("- 모든 카드를 정확히 한 기억에 넣는다.", "- 원문에서 배울 것을 빠뜨리지 않는다(표지·목차·참고문헌은 빼도 된다).")
  .replace("area: areas의 번호(1부터). cards: 카드 번호.", "area: 1. pages: 그 기억의 근거 쪽 번호.");
const PLAN_SYSTEM = `강의 자료 한 편의 목차(주제·항목 이름·쪽)와 쪽마다 첫 줄을 받는다. 카드를 만들기 전에, 학습자가 외우고 복습할 "기억"의 계획(줄기)을 먼저 세운다.
먼저 (쓰지 말고) 생각한다: 이 강의가 가르치려는 것은 무엇인가? 큰 영역 몇 개로 나뉘고, 영역마다 "배우는 질문"은 무엇인가?
- areas: 영역 3~7개, 자료 순서로 {name 2~14자, question 한 줄}.
- memories: 하나의 알고리즘·절차·방법은 기억 하나(그 방법의 식·조건·초깃값·경우를 모두 안에), 따로 서는 정의·개념·판정 규칙은 혼자 기억. 같은 것을 다른 꼴로 적은 항목은 하나로.
- role: 메인(이 강의에서 새로 배우는 것) · 바탕(앞 과목의 수학 식·정의를 다시 적은 것) · 곁(배경·종류 나열·제품 이름).
- 기억마다 {name, kind(알고리즘·원리·개념·비교·판정·구조), role, area(번호), question, line(요지 40~90자), steps(알고리즘·절차면 3~7단계, 아니면 []), pages(근거 쪽)}.
- 목차의 항목을 빠뜨리지 않는다(표지·목차 쪽 빼고).`;
const PLAN_SCHEMA = S.obj({ areas: S.arr(S.obj({ name: S.str, question: S.str })), memories: S.arr(S.obj({ name: S.str, kind: S.oneOf(...MEMORY_KINDS), role: S.oneOf(...MEMORY_ROLES), area: S.int, question: S.str, line: S.str, steps: S.arr(S.str), pages: S.arr(S.int) })) });
const SHORT_RULE = "\n\n[짧게] 지금은 계획만: 기억마다 name, kind, role, area, pages만 쓴다. question·line은 빈 문자열, steps는 빈 배열(카드를 쓸 때 채운다).";
const DIRECT_SYSTEM = PLAN_SYSTEM.replace("강의 자료 한 편의 목차(주제·항목 이름·쪽)와 쪽마다 첫 줄을 받는다.", "강의 자료 한 편을 쪽마다(제목 | 글 앞부분) 받는다. 글자가 없는 쪽은 그림으로 된 쪽이다(제목과 앞뒤 쪽으로 짐작).")
  .replace("- 목차의 항목을 빠뜨리지 않는다(표지·목차 쪽 빼고).", "- 자료에서 배울 것을 빠뜨리지 않는다(표지·목차 쪽 빼고).");
const PCARD_SYSTEM = `강의 자료 한 영역의 원문(쪽마다 [p.N])과, 이 영역에서 학습자가 외울 기억 계획을 받는다. 기억마다 그 아래에 들어갈 카드(근거 조각)를 원문에서 뽑는다.
- 카드는 원문에 있는 정의·식·조건·단계·경우 하나씩. 기억의 단계·식·조건을 원문으로 받쳐 주는 것. 기억 하나에 보통 1~8장.
- 카드마다 {memory(기억 번호), title(10~30자), kind(용어·사실·목록·조건·절차·공식·비교·개념·패턴), text(내용 한두 문장, 식은 그대로), quote(원문 구절 그대로 10~60자), page}.
- 기억 계획에 없는데 원문에 꼭 배울 것이 있으면 memory 0으로.`;
const PCARD_SCHEMA = S.obj({ cards: S.arr(S.obj({ memory: S.int, title: S.str, kind: S.str, text: S.str, quote: S.str, page: S.int })) });
const bareName = (x: string) => x.replace(/\([^)]*\)/g, "").replace(/[\s·:,/]/g, "").toLowerCase();
const RAW_SCHEMA = S.obj({ memories: S.arr(S.obj({ name: S.str, kind: S.oneOf(...MEMORY_KINDS), role: S.oneOf(...MEMORY_ROLES), area: S.int, question: S.str, line: S.str, steps: S.arr(S.str), pages: S.arr(S.int) })) });

async function inputs(id: string) {
  if (!/^gen_[a-z0-9]{8,64}$/.test(id)) throw Object.assign(new Error("자료 id가 올바르지 않아요."), { status: 400 });
  const state = await loadGen(id);
  const map = state ? materialMap(state, {}) : null;
  if (!state || !map) throw Object.assign(new Error("자료를 찾을 수 없어요."), { status: 404 });
  const texts = (state as unknown as { recaller?: { texts?: Record<string, string> } }).recaller?.texts ?? {};
  return { map, texts, structure: await loadStructure(id) };
}

async function callsOf(run: string, t0: number) {
  await new Promise((r) => setTimeout(r, 400)); // 기록은 비동기로 붙는다
  const lines = (await readFile(path.join(dataDir(), "assist-log.jsonl"), "utf8").catch(() => "")).split("\n").slice(-400);
  return lines.flatMap((l) => { try { const x = JSON.parse(l); return x?.trace?.action?.startsWith(`clab:${run}:`) && Date.parse(x.at) >= t0 - 1000 ? [x] : []; } catch { return []; } })
    .map((x) => ({ step: String(x.trace.action).split(":")[2], ms: x.ms as number, first: x.firstTextMs as number, in: x.tokens?.in ?? 0, out: x.tokens?.out ?? 0,
      cost: costOf(x.model, { inputTokens: x.tokens?.in, cachedInputTokens: x.tokens?.cached, outputTokens: x.tokens?.out }) ?? 0 }));
}

/** 방법 하나를 돌린다. 저장하고 요약을 돌려준다. 제품의 compact.json은 건드리지 않는다. */
export async function runCompactLab(id: string, method: LabMethod) {
  const { map, texts, structure } = await inputs(id);
  const run = `${method}-${Date.now().toString(36)}`;
  const ask = <T>(step: string, system: string, user: string, schema: Record<string, unknown>) =>
    withTrace({ area: "pdf", action: `clab:${run}:${step}`, ref: id }, () => askJson<T>(`lab:compact-${method}`, system, user, schema, M));
  const { user, ids, titles } = compactInput(map, structure);
  const lines = user.split("\n");
  const head = lines.slice(0, lines.findIndex((l) => l.startsWith("카드 ("))).join("\n");
  const cardLines = lines.filter((l) => /^\d+\|/.test(l));
  const shortLine = (n: number) => { const c = map.sections.flatMap((s) => s.cards).filter((x) => !x.title.startsWith("흐름: "))[n - 1]; return `${c.kind}|${c.title}`; };
  const t0 = Date.now();
  let reply: Reply = { areas: [], memories: [] };
  let extra: Record<string, unknown> = {};

  const byAreas = async (areas: Array<{ name: string; question: string; cards: number[] }>, short = false, withStruct = false) => {
    const parts = await Promise.all(areas.map(async (a, ai) => {
      const nums = [...a.cards].sort((x, y) => x - y);
      const own = nums.map((n, i) => `${i + 1}|${short ? shortLine(n) : cardLines[n - 1].split("|").slice(1).join("|")}`);
      const u = `${head}\n영역 ${ai + 1}/${areas.length}: ${a.name} — ${a.question}\n(다른 영역: ${areas.filter((x) => x !== a).map((x) => x.name).join(" / ")})\n\n카드 (번호|${short ? "종류|제목" : "구조 자리|구조 역할|핵심·보조|카드"})\n${own.join("\n")}`;
      const r = await ask<{ memories: Mem[]; boxes?: unknown[]; versus?: unknown[] }>(`area${ai + 1}`, withStruct ? AREA_MEMORY_SYSTEM + LOCAL_STRUCT : AREA_MEMORY_SYSTEM, u, withStruct ? ALL_SCHEMA : MEM_SCHEMA);
      return { mems: (r.memories ?? []).map((m) => ({ ...m, area: ai + 1, cards: (m.cards ?? []).map((k) => nums[k - 1] ?? -1) })), boxes: r.boxes ?? [], versus: r.versus ?? [] };
    }));
    return parts;
  };
  const aiAreas = async () => {
    const brief = `${head}\n카드 (번호|구조 자리|구조 역할|핵심·보조|카드)\n${cardLines.map((l) => l.slice(0, 120)).join("\n")}`;
    const split = await ask<{ areas: Array<{ name: string; question: string; cards: number[] }> }>("areas", AREA_SYSTEM, brief, AREA_SCHEMA);
    const seen = new Set<number>();
    const areas = (split.areas ?? []).map((a) => ({ name: a.name, question: a.question, cards: (a.cards ?? []).filter((n) => n >= 1 && n <= ids.length && !seen.has(n) && (seen.add(n), true)) })).filter((a) => a.cards.length);
    for (let n = 1; n <= ids.length; n++) if (!seen.has(n)) { let best = areas[0], gap = Infinity; for (const a of areas) for (const m of a.cards) if (Math.abs(m - n) < gap) { gap = Math.abs(m - n); best = a; } best.cards.push(n); }
    return areas;
  };

  if (method === "two" || method === "short" || method === "allInOne") {
    const areas = await aiAreas();
    const parts = await byAreas(areas, method === "short", method === "allInOne");
    reply = { areas: areas.map(({ name, question }) => ({ name, question })), memories: parts.flatMap((p) => p.mems) };
    if (method === "allInOne") {
      // 영역 사이 짝만: 기억 이름 목록(짧은 입력)
      const all = reply.memories;
      const list = all.map((m, i) => `${i + 1}|${areas[m.area - 1]?.name}|${m.name}|${m.line.slice(0, 60)}`).join("\n");
      const links = await ask<{ pairs: Array<{ a: number; b: number; why: string }> }>("links", LINK_SYSTEM, `자료: ${map.title}\n기억 (번호|영역|이름|요지)\n${list}`, LINK_SCHEMA);
      extra = { boxes: parts.map((p, i) => ({ area: areas[i].name, boxes: p.boxes, versus: p.versus })), pairs: (links.pairs ?? []).map((p) => `${all[p.a - 1]?.name} — ${all[p.b - 1]?.name} (${p.why})`) };
    }
  } else if (method === "one") {
    const r = await ask<Reply>("one", COMPACT_SYSTEM, user, ONE_SCHEMA);
    reply = r;
  } else if (method === "codeAreas") {
    // 목차 주제(=map.sections)를 차례대로 붙여 카드 ~20장 덩어리. 주제를 쪼개지 않는다.
    const chunks: Array<{ name: string; question: string; cards: number[] }> = [];
    let n = 0, cur: number[] = [];
    for (const s of map.sections) {
      const own = s.cards.filter((c) => !c.title.startsWith("흐름: ")).map(() => ++n);
      if (cur.length && cur.length + own.length > 22) { chunks.push({ name: "", question: "", cards: cur }); cur = []; }
      cur.push(...own);
    }
    if (cur.length) chunks.push({ name: "", question: "", cards: cur });
    const parts = await Promise.all(chunks.map(async (a, ai) => {
      const nums = a.cards;
      const own = nums.map((k, i) => `${i + 1}|${cardLines[k - 1].split("|").slice(1).join("|")}`);
      const r = await ask<{ name: string; question: string; memories: Mem[] }>(`chunk${ai + 1}`, CHUNK_SYSTEM, `${head}\n덩어리 ${ai + 1}/${chunks.length}\n\n카드 (번호|구조 자리|구조 역할|핵심·보조|카드)\n${own.join("\n")}`, CHUNK_SCHEMA);
      return { name: r.name, question: r.question, mems: (r.memories ?? []).map((m) => ({ ...m, area: ai + 1, cards: (m.cards ?? []).map((k) => nums[k - 1] ?? -1) })) };
    }));
    reply = { areas: parts.map((p) => ({ name: p.name, question: p.question })), memories: parts.flatMap((p) => p.mems) };
  } else if (method === "planDirect" || method === "planShort") {
    let u: string;
    if (method === "planDirect") {
      const prep = (await loadGen(id) as unknown as { recaller?: { prep?: { pages?: Array<{ page: number; title?: string }> } } })?.recaller?.prep?.pages ?? [];
      const title = new Map(prep.map((x) => [x.page, x.title ?? ""]));
      const pages = Object.keys(texts).map(Number).filter((x) => x > 0).sort((a, b) => a - b);
      u = `자료: ${map.title}\n\n${pages.map((p) => `p.${p} ${title.get(p) || "(제목 없음)"} | ${(texts[p] ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || "(글자 없음)"}`).join("\n")}`;
    } else {
      const d = (await loadGen(id) as unknown as { recaller?: { digest?: { skeleton?: { topics: Array<{ id: string; title: string; pages: number[] }> }; topics?: Record<string, { body?: Array<{ name: string; pages: number[] }> }> } } })?.recaller?.digest;
      u = `자료: ${map.title}\n\n[목차]\n${(d?.skeleton?.topics ?? []).map((t) => `${t.id} | ${t.title} | p.${t.pages.join(",")}\n${(d?.topics?.[t.id]?.body ?? []).map((l) => `  - ${l.name} (p.${l.pages.join(",")})`).join("\n")}`).join("\n")}`;
    }
    const plan = await ask<{ areas: Array<{ name: string; question: string }>; memories: Array<Omit<Mem, "cards"> & { pages: number[] }> }>("plan", (method === "planDirect" ? DIRECT_SYSTEM : PLAN_SYSTEM) + SHORT_RULE, u, PLAN_SCHEMA);
    const mems = plan.memories ?? [];
    const wall = Date.now() - t0;
    const calls = await callsOf(run, t0);
    const summary = { method, run, wall, calls, tokensIn: calls.reduce((a, c) => a + c.in, 0), tokensOut: calls.reduce((a, c) => a + c.out, 0), cost: calls.reduce((a, c) => a + c.cost, 0),
      areas: plan.areas ?? [], memories: mems.length, main: mems.filter((m) => m.role === "메인").length,
      planMemories: mems.map((m) => ({ area: m.area, name: m.name, role: m.role, kind: m.kind, pages: m.pages })) };
    await save(id, method, summary);
    return summary;
  } else if (method === "plan" || method === "planCards") {
    const d = (await loadGen(id) as unknown as { recaller?: { digest?: { skeleton?: { topics: Array<{ id: string; title: string; pages: number[] }> }; topics?: Record<string, { body?: Array<{ name: string; pages: number[] }> }> } } })?.recaller?.digest;
    const outline = (d?.skeleton?.topics ?? []).map((t) => `${t.id} | ${t.title} | p.${t.pages.join(",")}\n${(d?.topics?.[t.id]?.body ?? []).map((l) => `  - ${l.name} (p.${l.pages.join(",")})`).join("\n")}`).join("\n");
    const pages = Object.keys(texts).map(Number).filter((x) => x > 0).sort((a, b) => a - b);
    const firstLines = pages.map((p) => `p.${p}: ${(texts[p] ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2).join(" / ").slice(0, 90)}`).join("\n");
    const plan = await ask<{ areas: Array<{ name: string; question: string }>; memories: Array<Omit<Mem, "cards"> & { pages: number[] }> }>("plan", PLAN_SYSTEM, `자료: ${map.title}\n\n[목차]\n${outline}\n\n[쪽 첫 줄]\n${firstLines}`, PLAN_SCHEMA);
    const mems = plan.memories ?? [];
    extra = { planMemories: mems.map((m) => ({ area: m.area, name: m.name, role: m.role, kind: m.kind, pages: m.pages, steps: m.steps.length, line: m.line })) };
    if (method === "planCards") {
      const areas = plan.areas ?? [];
      const made = await Promise.all(areas.map(async (a, ai) => {
        const own = mems.map((m, i) => ({ m, i })).filter(({ m }) => m.area === ai + 1);
        const ps = [...new Set(own.flatMap(({ m }) => m.pages))].filter((p) => texts[p] !== undefined).sort((x, y) => x - y);
        if (!own.length || !ps.length) return [];
        const planText = own.map(({ m }, k) => `${k + 1}|${m.role}|${m.kind}|${m.name}|${m.line}${m.steps.length ? ` | 단계: ${m.steps.join(" → ")}` : ""}`).join("\n");
        const r = await ask<{ cards: Array<{ memory: number; title: string; kind: string; text: string; quote: string; page: number }> }>(`cards${ai + 1}`, PCARD_SYSTEM,
          `자료: ${map.title}\n영역: ${a.name} — ${a.question}\n\n[기억 계획] (번호|역할|종류|이름|요지)\n${planText}\n\n[원문]\n${ps.map((p) => `[p.${p}]\n${(texts[p] ?? "").slice(0, 2500)}`).join("\n\n")}`, PCARD_SCHEMA);
        return (r.cards ?? []).map((c) => ({ ...c, memory: c.memory >= 1 && c.memory <= own.length ? own[c.memory - 1].m.name : "(계획 밖)", quoteOk: (texts[c.page] ?? "").replace(/\s+/g, "").includes(String(c.quote).replace(/\s+/g, "")) }));
      }));
      const cards = made.flat();
      const engineCore = map.sections.flatMap((s) => s.cards).filter((c) => c.core && !c.title.startsWith("흐름: "));
      const newTitles = cards.map((c) => bareName(`${c.title} ${c.text}`));
      const covered = engineCore.filter((c) => { const b = bareName(c.title).slice(0, 8); return b.length >= 2 && newTitles.some((t) => t.includes(b)); });
      extra = { ...extra, cards: cards.length, quoteOk: cards.filter((c) => c.quoteOk).length, outsidePlan: cards.filter((c) => c.memory === "(계획 밖)").length,
        engineCore: engineCore.length, coreCovered: covered.length, coreMissed: engineCore.filter((c) => !covered.includes(c)).map((c) => c.title),
        perMemory: Object.entries(cards.reduce<Record<string, number>>((o, c) => { o[c.memory] = (o[c.memory] ?? 0) + 1; return o; }, {})), sample: cards.slice(0, 12) };
    }
    const wall = Date.now() - t0;
    const calls = await callsOf(run, t0);
    const summary = { method, run, wall, calls, tokensIn: calls.reduce((s2, c) => s2 + c.in, 0), tokensOut: calls.reduce((s2, c) => s2 + c.out, 0), cost: calls.reduce((s2, c) => s2 + c.cost, 0),
      areas: plan.areas ?? [], memories: mems.length, main: mems.filter((m) => m.role === "메인").length, ...extra };
    await save(id, method, summary);
    return summary;
  } else if (method === "raw") {
    const pages = Object.keys(texts).map(Number).filter((x) => x > 0).sort((a, b) => a - b);
    const firstLines = pages.map((p) => `p.${p}: ${(texts[p] ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2).join(" / ").slice(0, 90)}`).join("\n");
    const split = await ask<{ areas: Array<{ name: string; question: string; from: number; to: number }> }>("areas", RAW_AREA_SYSTEM, `자료: ${map.title}\n${firstLines}`, RAW_AREA_SCHEMA);
    const areas = (split.areas ?? []).filter((a) => a.from <= a.to);
    const parts = await Promise.all(areas.map(async (a, ai) => {
      const own = pages.filter((p) => p >= a.from && p <= a.to).map((p) => `[p.${p}]\n${(texts[p] ?? "").slice(0, 2500)}`).join("\n\n");
      const r = await ask<{ memories: Array<Omit<Mem, "cards"> & { pages: number[] }> }>(`area${ai + 1}`, RAW_SYSTEM, `자료: ${map.title}\n영역 ${ai + 1}/${areas.length}: ${a.name} — ${a.question} (p.${a.from}–${a.to})\n\n${own}`, RAW_SCHEMA);
      return (r.memories ?? []).map((m) => ({ ...m, area: ai + 1 }));
    }));
    const mems = parts.flat();
    extra = { rawMemories: mems.map((m) => ({ area: m.area, name: m.name, role: m.role, kind: m.kind, pages: m.pages, steps: m.steps.length, line: m.line })) };
    reply = { areas: areas.map(({ name, question }) => ({ name, question })), memories: [] };
    const wall = Date.now() - t0;
    const calls = await callsOf(run, t0);
    const summary = { method, run, wall, calls, tokensIn: calls.reduce((s, c) => s + c.in, 0), tokensOut: calls.reduce((s, c) => s + c.out, 0), cost: calls.reduce((s, c) => s + c.cost, 0),
      areas: reply.areas, memories: mems.length, main: mems.filter((m) => m.role === "메인").length, ...extra };
    await save(id, method, summary);
    return summary;
  }
  const wall = Date.now() - t0;
  const checked = checkCompact(reply, ids, titles);
  const calls = await callsOf(run, t0);
  const mems = checked.memories;
  const summary = { method, run, wall, calls, tokensIn: calls.reduce((s, c) => s + c.in, 0), tokensOut: calls.reduce((s, c) => s + c.out, 0), cost: calls.reduce((s, c) => s + c.cost, 0),
    cards: ids.length, areas: checked.areas, memories: mems.length, main: mems.filter((m) => m.role === "메인").length,
    singleMain: mems.filter((m) => m.role === "메인" && m.cards.length === 1).length, missing: checked.fixes.filter((f) => f.startsWith("빠진 카드")).length, fixes: checked.fixes.length,
    list: mems.map((m) => ({ area: m.area, name: m.name, role: m.role, kind: m.kind, cards: m.cards.length, steps: m.steps.length, line: m.line })), ...extra };
  await save(id, method, summary);
  return summary;
}
async function save(id: string, method: string, data: unknown) {
  const dir = path.join(dataDir(), "study-gen", id, "compact-lab");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${method}.json`), JSON.stringify(data, null, 1));
}
export async function compactLabApi(request: Request, id: string) {
  const { NextResponse } = await import("next/server");
  const method = new URL(request.url).searchParams.get("m") as LabMethod;
  if (!LAB_METHODS.includes(method)) return NextResponse.json({ message: `m은 ${LAB_METHODS.join(", ")} 중 하나` }, { status: 400 });
  if (request.method === "GET") return NextResponse.json({ result: JSON.parse(await readFile(path.join(dataDir(), "study-gen", id, "compact-lab", `${method}.json`), "utf8").catch(() => "null")) });
  return NextResponse.json({ result: await runCompactLab(id, method) });
}
