// 입과 손 (설계 4번): 연출가가 정한 길을 코드와 말로 옮기는 작은 AI 호출들.
//   코드 쓰기(terra low): 문제 + 이번 길의 걸음 + **허용된 조각만**(설명 · 예시) + 직전 내 코드. 모범 풀이 · 허용 안 된 조각은 보내지 않는다.
//   말 쓰기(luna): 성격(말투) + 상황 → 질문 한두 문장.  배움 판정(luna): 튜터 답 + 이 문제의 조각 목록 → 가르친 조각 id.
//   (덧) 의심 확인(luna, 검사 5번의 3) · 장면 답하기(terra low, 채점 7번의 상황 재현).
// 세기: 엄격(기본) = 코드가 길 · 걸음을 정하고 AI는 옮기기만. 느슨 = 허용 조각 목록만 주고 AI가 길을 짠다(새 길은 지도 후보로).
// 가짜(--dry): AI 0번. 코드는 지도의 자리 코드로 엮고, 말은 틀로, 배움 판정은 낱말 맞추기로.
import { askJson, S } from "../assist/model.ts";
import { program } from "./map.ts";
import type { Fragment, ProblemMap, Route } from "./types.ts";

export type ProblemBrief = { title: string; statement: string; inputText: string; outputText: string };
export type CodeAsk = {
  problem: ProblemBrief; mode: "strict" | "loose";
  /** 엄격: 이번 길 · 쓸 걸음(upto 앞까지) · 자리마다 쓸 조각 */ route?: Route; upto?: number; picks: Record<string, string>;
  /** 허용된 조각(가진 것). 틀린 조각은 믿는 대로(맞다고 여기고) 준다. */ allowed: Fragment[];
  /** 이 걸음은 몰라서 지어 씀 */ guessAt?: number; guessWhat?: string;
  previous: string; feedback?: string;
};
export type CodeOut = { code: string; plan?: string[]; uses?: string[] };
export type SpeechKind = "stuck" | "method" | "verdict" | "confirm" | "slip" | "syntax";
export type SpeechAsk = { name: string; terse: number; kind: SpeechKind; situation: string; step?: string; verdict?: string };
export type Voice = {
  name: "ai" | "dry";
  code(a: CodeAsk): Promise<CodeOut>;
  speech(a: SpeechAsk): Promise<string>;
  learned(answer: string, fragments: Fragment[]): Promise<string[]>;
  suspect(code: string, allowed: Fragment[]): Promise<{ outside: boolean; what: string } | null>;
  sceneAnswer(view: Record<string, unknown>, allowed: Fragment[], wrongs: Fragment[]): Promise<string | null>;
};

const fragLines = (fs: Fragment[]) => fs.map((f) => `- ${f.id} (${f.layer}층): ${f.what}\n${f.example.split("\n").map((l) => `    ${l}`).join("\n")}`).join("\n");
const brief = (p: ProblemBrief) => `[문제] ${p.title}\n${p.statement}\n[입력] ${p.inputText}\n[출력] ${p.outputText}`;

/* ---------- 지시문(앞쪽 고정 → 캐시) ---------- */
export const CODE_SYSTEM = `너는 알고리즘을 배우는 학습자의 "손"이다. 이 학습자가 아는 조각만으로 코드를 쓴다. 정답을 찾으려 하지 않는다.
- [아는 조각]에 없는 생각 · 도구 · 문법은 쓰지 않는다. 더 좋은 방법을 알아도 쓰지 않는다.
- [아는 조각] 중 "믿는 것"으로 표시된 것은 이 학습자가 맞다고 믿는 생각이다. 그 생각대로 자신 있게 쓴다(고치지 않는다).
- [걸음]이 주어지면 그 순서대로만 쓴다. 걸음에 없는 반복 · 검사를 더하지 않는다. "여기까지만"이면 그 앞 걸음까지만 쓰고 멈춘다.
- "지어 쓰기" 걸음은 이 학습자가 방법을 모르는 자리다. 아는 것으로 그럴듯하게 어림해서 쓴다(모르는 문법이면 있을 법한 문법을 지어 쓴다. 틀려도 된다).
- 파이썬. 표준 입력을 읽고 답을 출력하는 프로그램 하나. 설명 없이 코드만 code 칸에.`;
export const CODE_LOOSE_SYSTEM = `너는 알고리즘을 배우는 학습자의 "손"이다. 이 학습자가 아는 조각만 가지고 스스로 풀이를 짠다.
- [아는 조각]에 없는 생각 · 도구 · 문법은 쓰지 않는다. "믿는 것"으로 표시된 것은 맞다고 믿고 그대로 쓴다.
- 아는 조각으로 끝까지 못 가면, 갈 수 있는 데까지 쓰고 남은 곳은 어림한다.
- plan: 걸음 한 줄씩. uses: 실제로 쓴 조각 id. code: 파이썬 프로그램 하나(표준 입력 → 출력).`;
export const SPEECH_SYSTEM = `너는 알고리즘 문제를 푸는 학습자다. AI 튜터에게 보낼 말을 한두 문장으로 쓴다. 한국어 반말 섞인 존댓말(학생 말투).
- [상황]에 있는 것만 말한다. 모르는 개념의 이름을 먼저 대지 않는다(모르니까). 답을 달라고 하지 않고 막힌 곳을 묻는다.
- 말 짧음이 높으면 아주 짧게(한 문장, 20자 안팎). 낮으면 두 문장까지.
- say 칸에 말만.`;
export const LEARN_SYSTEM = `튜터의 답 하나를 읽고, 그 답이 학습자에게 실제로 가르친(설명하거나 코드로 보여 준) 조각을 [조각 목록]에서 고른다.
- 이름만 스쳐 지나간 것은 넣지 않는다. 그 조각의 내용(무엇을 · 어떻게)을 알려 줬을 때만.
- 틀린 조각(✗)이 왜 틀렸는지 짚었으면, 그 틀린 조각 대신 맞는 조각(→ 뒤)의 id를 넣는다.
- taught 칸에 id만. 없으면 빈 목록.`;
export const SUSPECT_SYSTEM = `학습자 코드가 [허용된 조각] 밖의 생각 · 도구를 쓰는지 본다. 허용된 조각만으로 쓸 수 있는 코드면 outside=false. 밖의 것을 썼으면 outside=true, what에 무엇을 썼는지 짧게.`;
export const SCENE_ANSWER_SYSTEM = `너는 복습 장면을 푸는 학습자다. [아는 조각]만 안다. "믿는 것"은 맞다고 믿는다. 정답을 추리해 맞히려 하지 않는다. 그 사람이 실제로 낼 답을 answer 칸에.
형식별로 낼 것: write · function = 학습자 자리 코드만 / blank = 빈칸마다 한 줄씩 / fix = 고친 전체 프로그램 / predict = 생각한 출력 그대로(코드는 머릿속으로 따라감) / choice = 고른 보기 번호(0부터).`;

const allowedBlock = (fs: Fragment[]) => {
  const ok = fs.filter((f) => !f.wrong), bel = fs.filter((f) => f.wrong);
  return [`[아는 조각]\n${fragLines(ok)}`, bel.length ? `[믿는 것] (이 학습자는 맞다고 믿는다)\n${fragLines(bel.map((f) => ({ ...f, wrong: false })))}` : ""].filter(Boolean).join("\n\n");
};
export function codeUser(a: CodeAsk) {
  const steps = a.route ? a.route.steps.slice(0, a.upto ?? a.route.steps.length).map((s, i) => `${i + 1}. ${s.text}${a.guessAt === i ? `  ← 지어 쓰기(${a.guessWhat ?? "방법을 모름"})` : ""}`).join("\n") : "";
  return [brief(a.problem), allowedBlock(a.allowed),
    a.mode === "strict" && a.route ? `[걸음]${a.upto !== undefined && a.upto < a.route.steps.length ? ` (여기까지만: ${a.upto}번 걸음까지)` : ""}\n${steps}` : "",
    a.previous.trim() ? `[직전 내 코드]\n${a.previous.slice(0, 6000)}` : "", a.feedback ? `[다시 쓰기] ${a.feedback}` : ""].filter(Boolean).join("\n\n");
}

/* ---------- 진짜 AI ---------- */
const TERRA = { model: "gpt-6.1-terra", effort: "low" } as const;
// 말 · 배움 판정은 뒤에 검사가 있는 곳이라 싼 모델(설계 4번, CLAUDE.md "싼 모델은 검사가 뒤에 있는 곳에만"): 배움 판정은 코드가 id를 걸러 받는다.
const LUNA = { model: "gpt-6-luna", effort: "low" } as const;
const fence = (s: string) => s.replace(/^```(?:python|py)?\n([\s\S]*?)\n?```\s*$/m, "$1");
export function aiVoice(): Voice {
  return {
    name: "ai",
    async code(a) {
      if (a.mode === "loose") {
        const r = await askJson<{ code: string; plan: string[]; uses: string[] }>("npc:code", CODE_LOOSE_SYSTEM, codeUser(a), S.obj({ code: S.str, plan: S.arr(S.str), uses: S.arr(S.str) }), TERRA);
        return { code: fence(r.code ?? ""), plan: r.plan ?? [], uses: r.uses ?? [] };
      }
      const r = await askJson<{ code: string }>("npc:code", CODE_SYSTEM, codeUser(a), S.obj({ code: S.str }), TERRA);
      return { code: fence(r.code ?? "") };
    },
    async speech(a) {
      const user = `[학습자] ${a.name} · 말 짧음 ${a.terse.toFixed(1)}\n[상황] ${a.situation}${a.step ? `\n[하려던 걸음] ${a.step}` : ""}${a.verdict ? `\n[채점] ${a.verdict}` : ""}`;
      const r = await askJson<{ say: string }>("npc:speech", SPEECH_SYSTEM, user, S.obj({ say: S.str }), LUNA);
      return (r.say ?? "").trim().slice(0, 400) || drySpeech(a);
    },
    async learned(answer, fragments) {
      const list = fragments.map((f) => `- ${f.wrong ? `✗ ${f.id} → ${f.right ?? ""}` : f.id}: ${f.what}`).join("\n");
      const r = await askJson<{ taught: string[] }>("npc:learn", LEARN_SYSTEM, `[조각 목록]\n${list}\n\n[튜터 답]\n${answer.slice(0, 6000)}`, S.obj({ taught: S.arr(S.str) }), LUNA);
      const ids = new Set(fragments.filter((f) => !f.wrong).map((f) => f.id));
      // 틀린 조각 id를 냈으면 그 맞는 짝으로 바꾼다(코드가 이름 맞추기)
      return [...new Set((r.taught ?? []).map((x) => fragments.find((f) => f.id === x && f.wrong)?.right ?? x).filter((x) => ids.has(x)))];
    },
    async suspect(code, allowed) {
      const r = await askJson<{ outside: boolean; what: string }>("npc:suspect", SUSPECT_SYSTEM, `[허용된 조각]\n${fragLines(allowed)}\n\n[코드]\n${code.slice(0, 6000)}`, S.obj({ outside: { type: "boolean" }, what: S.str }), LUNA);
      return { outside: Boolean(r.outside), what: (r.what ?? "").slice(0, 200) };
    },
    async sceneAnswer(view, allowed, wrongs) {
      const r = await askJson<{ answer: string }>("npc:scene", SCENE_ANSWER_SYSTEM, `${allowedBlock([...allowed, ...wrongs])}\n\n[장면]\n${JSON.stringify(view, null, 1).slice(0, 8000)}`, S.obj({ answer: S.str }), TERRA);
      return r.answer ?? "";
    },
  };
}

/* ---------- 가짜(--dry): AI 0번 ---------- */
export function drySpeech(a: SpeechAsk): string {
  const short = a.terse >= 0.7;
  switch (a.kind) {
    case "method": return short ? "이거 어떻게 풀어요?" : `이거 어떻게 풀어요? ${a.situation} 어떤 방법을 써야 할지 모르겠어요.`;
    case "syntax": return short ? `'${a.step}' 이거 코드로 어떻게 써요?` : `'${a.step}'을 하려는데 파이썬으로 어떻게 쓰는지 모르겠어요. ${a.situation}`;
    case "stuck": return short ? `'${a.step}'에서 막혔어요.` : `'${a.step}' 부분에서 막혔어요. ${a.situation} 어떻게 해요?`;
    case "verdict": return short ? `${a.verdict ?? "틀렸"}이 나와요. 왜요?` : `${a.verdict ?? "틀렸습니다"}가 나와요. ${a.situation} 어디가 틀렸어요?`;
    case "slip": return short ? "어디가 틀렸어요?" : `${a.verdict ?? "틀렸습니다"}가 나와요. 제가 뭘 잘못 쳤는지 모르겠어요.`;
    case "confirm": return short ? "이렇게 하면 맞아요?" : `말씀하신 대로 하면 되는 거 맞아요? ${a.situation}`;
  }
}
const keyHit = (text: string, f: Fragment) => (f.keys ?? []).some((k) => { try { return new RegExp(k, "i").test(text); } catch { return text.includes(k); } });
/** 낱말 맞추기 배움 판정: 조각의 keys가 튜터 답에 나오면 가르친 것으로. 틀린 조각의 keys면 그 맞는 짝. */
export function keywordLearned(answer: string, fragments: Fragment[]): string[] {
  const out = new Set<string>();
  for (const f of fragments) if (keyHit(answer, f)) out.add(f.wrong ? f.right ?? "" : f.id);
  out.delete("");
  return [...out];
}
export function dryVoice(map: ProblemMap): Voice {
  void map;
  return {
    name: "dry",
    async code(a) { return { code: a.route ? program(a.route, a.picks, { upto: a.upto, guessAt: a.guessAt }) : a.previous }; },
    async speech(a) { return drySpeech(a); },
    async learned(answer, fragments) { return keywordLearned(answer, fragments); },
    async suspect() { return null; },
    async sceneAnswer() { return null; },
  };
}
