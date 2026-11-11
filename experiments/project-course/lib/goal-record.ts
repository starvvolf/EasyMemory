// 목표 하나가 끝날 때 정리(11/5 사용자 "각 목표가 끝나면 쭉 대화 기록 받아서 정리하는 걸로. 질문 단위가 아니라. 학습자가 어떤 절차를 거쳐서 뭘 배웠는지").
// [다음으로]를 누르면 그 목표가 시작된 뒤의 대화 전체를 한 번 보내 ① 한 줄 정리 ② 학습자가 거친 과정(순서) ③ 배운 개념(뜻 · 어떻게 만났나 · 학습자 말 근거)을 받는다.
// 근거 구절은 코드가 그 목표 동안의 학습자 말과 대조한다(없으면 근거 없음으로 남김). 받은 것 · 버린 것 · 원문 답을 모두 기록한다.
import path from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { DATA, read, update, writeAtomic } from "./store.ts";
import { aiJson, S } from "./ai.ts";
import { applyMemory, memoryForRecord, type MemOps } from "./memory.ts";

export type GoalRecord = {
  goal: string; done: string; status: "마침" | "건너뜀"; mode: string | null; from: string; to: string;
  summary: string; steps: string[];
  /** 목표 한 칸 총정리(11/12, 도서관) */ review?: Review;
  /** 실습 기억 카드(11/10). 있으면 이게 원본이고 learned · gaps는 거기서 펼친 것 */
  cards?: Card[];
  learned: { type: Tab; concept: string; meaning: string; how: string; quote: string; verified: boolean; card?: Card }[];
  /** 11/6 사용자 "대화 내역을 봤을 때 나한테 부족한 점이 딱 보인다. 그걸 캐치해서 지식으로 잡는 게 중요" */
  gaps?: { type: Tab; concept: string; wrong: string; right: string; quote: string; verified: boolean; code?: GapCode; ids?: string[]; recheck?: { q: string; a: string }; prereq?: boolean; card?: { situation: string; next: string; how: string } }[];
  /** 11/6 사용자 "코드 보면 이 사람 파이썬 문법 잘 모르는 것 같은데? 이런 생각. 하드코딩 말고 자유를 주면 잡을 수 있다" → 학습자 메모리(lib/memory.ts)에 반영한 것 */
  memory?: { done: string[]; dropped: string[] }; at: string;
};
type Msg = { role: string; text: string; at: string };
/** 11/5 사용자 "그 목표랑 목표 수행하는 동안의 대화 내역 보고 개념/원리/절차/규칙/방법/비교 탭에 넣으라고 시키면 될 것 같다" */
export const TABS = ["개념", "원리", "절차", "규칙", "방법", "비교"] as const;
export type Tab = (typeof TABS)[number];
const file = (runId: string) => path.join(DATA, "goals", `${runId}.records.json`);
const logFile = () => path.join(DATA, "goals", "records.log.jsonl");
/** 학습자가 VS Code에서 저장한 코드(11/6 사용자 A안 "튜터는 내 코드를 보는데 정리하는 쪽은 못 본다"). 저장할 때마다 한 줄, AI 호출 없음 */
export type Save = { at: string; file: string; text: string };
/** 틀린 코드 덩어리(11/6 사용자 "AI가 몇 줄부터 몇 줄까지 뭐가 문제다 덩어리로 → 코드가 그 덩어리를 기억에"). code는 저장본에서 코드가 잘라 낸 원문 */
export type GapCode = { save: string; file: string; from: number; to: number; code: string };
const MAX_LINES = 12;
const savesFile = (runId: string) => path.join(DATA, "goals", `${runId}.saves.jsonl`);
const lastSaved = new Map<string, string>();
export async function logSave(runId: string, file: string, text: string) {
  const k = `${runId}:${file}`, t = text.slice(0, 20000);
  if (lastSaved.get(k) === t) return false;
  lastSaved.set(k, t);
  await mkdir(path.dirname(savesFile(runId)), { recursive: true });
  await appendFile(savesFile(runId), JSON.stringify({ at: new Date().toISOString(), file, text: t }) + "\n");
  return true;
}
export async function savesOf(runId: string): Promise<Save[]> {
  const raw = await readFile(savesFile(runId), "utf8").catch(() => "");
  return raw.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Save]; } catch { return []; } });
}
/** 줄 단위 차이(LCS). + 더한 줄, - 뺀 줄만. 바뀐 게 너무 많으면 앞 80줄 */
export function lineDiff(a: string, b: string): string[] {
  const x = a ? a.split(/\r?\n/) : [], y = b.split(/\r?\n/);
  if (x.length * y.length > 400_000) return y.slice(0, 80).map((l) => `+ ${l}`);
  const L = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { i++; j++; }
    else if (j < y.length && (i >= x.length || L[i][j + 1] >= L[i + 1][j])) { if (y[j].trim()) out.push(`+ ${y[j]}`); j++; }
    else { if (x[i].trim()) out.push(`- ${x[i]}`); i++; }
  }
  return out.slice(0, 80);
}
/** 더한 줄에 저장본의 줄 번호를 붙인다("+ 12| 코드"). AI가 덩어리를 줄 번호로 짚게 */
function numbered(a: string, b: string): string[] {
  const d = lineDiff(a, b), y = b.split(/\r?\n/);
  let k = 0;
  return d.map((l) => {
    if (!l.startsWith("+ ")) return l;
    const t = l.slice(2);
    while (k < y.length && y[k] !== t) k++;
    return k < y.length ? `+ ${String(++k).padStart(3)}| ${t}` : l;
  });
}
/** 목표 구간의 저장본을 "바뀐 줄" 조각으로. 구간 앞의 마지막 저장본이 비교 기준. 저장본 번호 S1, S2…(전체 순서) */
function codeTurns(saves: Save[], from: string, to: string) {
  const prev = new Map<string, string>();
  const out: { at: string; id: string; save: Save; text: string; added: string[] }[] = [];
  saves.forEach((sv, i) => {
    if (sv.at > to) return;
    if (sv.at >= from) {
      const d = numbered(prev.get(sv.file) ?? "", sv.text);
      if (d.length) out.push({ at: sv.at, id: `S${i + 1}`, save: sv, text: `[학습자 코드 저장 S${i + 1} ${sv.file}]\n${d.join("\n")}`, added: d.filter((l) => l.startsWith("+ ")).map((l) => l.replace(/^\+ (\s*\d+\| )?/, "")) });
    }
    prev.set(sv.file, sv.text);
  });
  return out;
}
/** AI가 짚은 범위를 저장본 원문에서 자른다(없는 저장본 · 범위 밖이면 버림, 길면 앞 12줄) */
export function cutCode(code: { id: string; save: Save }[], ref: { save?: string; from?: number; to?: number } | undefined): GapCode | undefined {
  const c = code.find((x) => x.id === String(ref?.save ?? "").trim());
  if (!c) return undefined;
  const lines = c.save.text.split(/\r?\n/);
  const from = Math.max(1, Math.floor(Number(ref?.from) || 0)), to0 = Math.floor(Number(ref?.to) || 0);
  if (!from || from > lines.length || to0 < from) return undefined;
  const to = Math.min(to0, lines.length, from + MAX_LINES - 1);
  const text = lines.slice(from - 1, to).join("\n");
  return text.trim() ? { save: c.id, file: c.save.file, from, to, code: text } : undefined;
}
export const recordsOf = async (runId: string) => (await read<{ items: GoalRecord[] }>(file(runId), { items: [] })).items;

// 11/10 사용자 "자료 정리할 때 쓰던 기준, 그 종류 6개 … 필요 없어. 실습에서 쓰는 거는 실습용 폼을 하나": 배운 것 · 부족한 점을 실습 기억 카드 하나로.
// 카드 = 상황 · 내가 한 것 · 알게 된 것 · 다음엔 · 다시 확인 · 어떻게 알게 됐나. 혼자 해낸 게 아니면(도움 · 틀렸다 고침 · 아직) 부족함 원장으로 가 다시 확인한다.
export const HOW = ["혼자 해냄", "도움 받고 됨", "틀렸다 고침", "아직 모름"] as const;
export type How = (typeof HOW)[number];
export type Card = { name: string; situation: string; did: string; quote: string; learned: string; next: string; how: How; prereq: boolean; verified: boolean; code?: GapCode; ids?: string[]; recheck?: { q: string; a: string } };
export const SYSTEM_RECORD = `학습 목표 하나 동안 나눈 대화를 읽고, 학습자가 어떤 과정을 거쳐 무엇을 알게 됐고 무엇이 부족했는지 실습 기억 카드로 정리한다.
summary: 이 목표에서 학습자가 한 일과 도달한 곳을 2~3문장으로.
steps: 학습자가 거친 과정을 일어난 순서대로 3~8개. 각각 짧은 한 구절(예: "리스트 인덱스 예측 질문에 답함", "빈 리스트 pop이 오류인지 예측해 맞힘", "튜터가 만든 파일을 실행해 봄", "너무 쉽다고 해서 괄호 검사로 넘어감").
cards: 다음에 비슷한 상황을 만나면 학습자의 판단이 달라질 것만 카드로 만든다. 보통 1~3장, 많아도 5장. 튜터가 말만 하고 지나간 것, 이 프로젝트에서만 쓰는 이름(변수 · 함수 이름), 튜터가 대신 해 준 것을 학습자가 안 것처럼 쓰지 않는다. [이 목표 동안 Recaller가 잡은 부족함]에 적힌 것은 이 대화에서 사실이면 빠짐없이 카드로 만든다. 같은 원인은 한 장으로 묶는다.
- name: 다른 곳에서도 통하는 짧은 이름(예: 리스트 인덱스, 이미지와 컨테이너, 경쟁 상태, 같은 포트 두 번 켜기).
- situation: 무엇을 하다가 만났는지 한 구절(예: "단어 수 세기 결과를 정렬하다가").
- did: 학습자가 실제로 한 말 · 코드 · 명령이 무엇이었는지 한 문장. 틀렸으면 어떻게 잘못 알았는지(예: "이미지를 실행 중인 프로그램이라고 말함"). 나중에 한 질문보다 그 전에 실제로 틀린 것이 우선이다.
- quote: 그 근거가 된 학습자 말이나 코드 한 줄을 글자 그대로(없으면 빈 글).
- learned: 알게 된 것(바로 알아야 할 것) 한두 문장.
- next: 다음엔 이렇게 한다 — "이런 걸 보면 → 이렇게 한다" 꼴의 행동 한 줄(예: "포트 오류가 나면 이미 켜 둔 서버부터 찾는다").
- how: 혼자 해냄(도움 없이 맞힘 · 직접 해냄) · 도움 받고 됨(힌트 · 보충 · 튜터가 보여 준 뒤에 됨) · 틀렸다 고침(틀린 뒤 스스로 고침) · 아직 모름(끝까지 안 됨). 판정 기록에서 틀림 · 일부만 맞음인 답은 혼자 해냄의 근거가 아니다.
- prereq: 이 카드가 지금 목표 자체가 아니라 그 아래 먼저 알아야 할 것(선행)이면 true.
- code: 그 카드가 드러난 학습자 코드 덩어리(혼자 해냄이 아니고 코드에서 드러났을 때만): save는 저장본 번호(S3), from~to는 그 저장본의 줄 번호로 문제가 있는 곳만 좁게(12줄 이내). 아니면 save를 빈 글로.
- ids: [이 목표 동안 Recaller가 잡은 부족함]에 같은 것이 있으면 그 id들(G1-…). 없으면 빈 목록.
- recheck: 혼자 해냄이 아니면 며칠 뒤 다시 확인할 문항 하나. q는 이 대화를 몰라도 풀 수 있게 스스로 완결해서(필요하면 짧은 코드나 상황을 넣는다), 학습자가 잘못 알았거나 도움을 받았던 바로 그 지점을 건드리게(같은 오해가 남아 있으면 다시 틀리게). 대화의 예를 그대로 되풀이하지 말고 이름 · 값 · 상황을 바꾼다. 질문 안에 정답이나 정답에 들어갈 말을 넣지 않는다. 한 번에 답할 수 있는 짧은 질문(예측 · 설명 · 한두 줄 고치기 · 상황 판단)으로. a는 모범답과 이유 한두 문장. 혼자 해냄이면 q · a 모두 빈 글.
[학습자 코드 저장 S번호 파일]은 학습자가 직접 저장한 코드에서 바뀐 줄이다(+ 더함, - 뺌, + 뒤의 숫자는 그 저장본의 줄 번호). 학습자의 말과 코드에서 드러난 것을 기준으로 쓴다.
memory: [지금 학습자 메모리]는 지금까지 여러 목표에서 쌓인 이 학습자의 경향이다. 이번 목표에서 드러난 것을 모아 보면 이 학습자가 어떤지 보고 메모리를 갱신한다. 단정하지 말고 "~가 부족해 보인다" 정도로 쓴다.
- add: 메모리에 없는 새 경향. text는 한 문장, evidence는 근거가 된 카드(혼자 해냄이 아닌 것)의 name 그대로.
- update: 이미 있는 경향이 이번에도 보이면 그 id, text(고칠 게 없으면 그대로), evidence(카드 name 그대로).
- improved: 있던 경향이 이번에는 나아진 게 보이면 그 id와 evidence(혼자 해냄 카드의 name 그대로).
바뀔 게 없으면 모두 빈 목록.
review: 나중에 '기억 도서관'에서 이 목표 한 칸으로 보여 줄 총정리(11/12 사용자 · GPT 검토 "판정문처럼 나열하지 말고 장면을 다시 보여 주듯"). 며칠 뒤 이것만 읽어도 그 장면이 그려져야 한다.
말투는 "~해요" 체, 중학생도 읽히게 쉬운 말(용어는 바로 뒤에 쉬운 말로). "사실은", "~단계예요", "부족한 점"을 문장 속에서 되풀이하지 않는다. 순서는 하려던 일 → 막힌 장면과 푼 방법 → 여기까지 → 부족한 점.
- aim: 하려던 일 1~2문장(100자 안팎). 무엇을 만들거나 확인하려 했고 왜 그게 필요했는지, 실습 속 행동으로. 예) "실행할 때마다 지출을 money.txt에 쌓고, 저장된 기록을 다시 읽어 보려 했어요."
- scenes: 막힌 장면과 푼 방법 0~4개, 일어난 순서대로. 같은 원인에서 나온 것은 한 장면으로 묶는다. 막힌 것 없이 지나갔으면 빈 목록.
  · title: 그 장면을 한 줄 물음으로(25자 안팎). 예) "세 값을 어떻게 한 줄로 쓸까요?", "기록을 쌓으려면 어떤 모드로 열까요?"
  · body: 2~3문장(170자 안팎). 학습자가 무엇을 하려고 무엇을 했거나 물었는지 → 왜 그렇게 됐는지와 무엇이 맞는지를 바로 이어서 → 힌트 · 보충 · 튜터 설명을 받아 어떻게 됐는지. 코드는 아래 code 칸에 따로 보이니 글에 길게 옮기지 않는다. 쓰는 용어(input, 문자열 등)는 처음 나올 때 쉬운 말로 풀어 준다.
    예) "금액을 두 번 입력받아 더하면 합계가 나올 줄 알았어요. input()으로 받은 건 숫자처럼 보여도 글자(문자열)라서, +를 하면 더해지지 않고 이어 붙어요. int()로 숫자로 바꿔야 8000이 된다는 설명을 들었어요."
  · code: 그 장면을 보여 주는 코드 2~6줄. 학습자가 실제로 쓴 코드가 있으면 [학습자 말]이나 [학습자 코드 저장]에서 글자 그대로(줄바꿈 \n). 학습자가 코드를 안 쓰고 말로만 물었으면 그 물음을 보여 주는 아주 짧은 예 코드(2~4줄, 주석으로 넣은 값 · 결과 표시 가능)를 쓰고 example을 true로. 코드가 필요 없는 장면이면 빈 글.
  · result: 그 코드를 돌렸을 때 화면에 나온 것(오류 마지막 한 줄 · 출력 몇 줄)을 [학습자가 터미널에서 돌린 것]이나 학습자 말에서 그대로. 예 코드면 그 결과를 짧게. 없으면 빈 글.
  · example: code가 학습자가 쓴 게 아니라 설명용 예시면 true.
- reached: 여기까지 했어요 1문장(80자 안팎). 무엇을 완성하거나 확인했는지, 도움을 받았으면 밝힌다. 확인하지 못한 것은 성과로 부풀리지 않는다.
- weak: 이 목표에서 드러난 부족한 점 0~2개. 장면들을 묶어 "무엇을 아직 혼자 못 하는가"로. gap 한 문장(50자 안팎, "~를 몰라요 / ~를 아직 혼자 못 해요" 꼴), seen 어느 장면에서 드러났는지 한 문장(80자 안팎).
- 코드를 언제 보여 줬는지 같은 절차 이야기는 학습 내용에 꼭 필요할 때만. 기록에 없는 대화 · 코드 · 결과는 지어내지 않는다.`;
export const RECORD_SCHEMA = S.obj({ summary: S.str, steps: S.arr(S.str),
  cards: S.arr(S.obj({ name: S.str, situation: S.str, did: S.str, quote: S.str, learned: S.str, next: S.str, how: S.oneOf(...HOW), prereq: S.bool, code: S.obj({ save: S.str, from: S.int, to: S.int }), ids: S.arr(S.str), recheck: S.obj({ q: S.str, a: S.str }) })),
  memory: S.obj({ add: S.arr(S.obj({ text: S.str, evidence: S.arr(S.str) })), update: S.arr(S.obj({ id: S.str, text: S.str, evidence: S.arr(S.str) })), improved: S.arr(S.obj({ id: S.str, evidence: S.arr(S.str) })) }),
  review: S.obj({ aim: S.str, scenes: S.arr(S.obj({ title: S.str, body: S.str, code: S.str, result: S.str, example: S.bool })), reached: S.str, weak: S.arr(S.obj({ gap: S.str, seen: S.str })) }) });
/** 목표 한 칸 총정리(11/12): 도서관이 목표마다 그대로 보여 준다 */
export type Scene = { title: string; body: string; code?: string; result?: string; example?: boolean };
export type Review = { aim: string; scenes: Scene[]; reached: string; weak: { gap: string; seen: string }[] };
/** corpus: 학습자 말 · 저장한 코드 · 터미널 출력(띄어쓰기 무시). code 줄이 거기 없으면 예시로 표시, result가 거기 없으면(예시가 아니면) 버린다 */
export function cleanReview(raw: unknown, corpus?: string): Review | undefined {
  const o = (raw ?? {}) as Record<string, unknown>;
  const c = (v: unknown, n: number) => String(v ?? "").replace(/```[\s\S]*?```/g, "").replace(/\s+/g, " ").trim().slice(0, n);
  const arr = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
  const r: Review = { aim: c(o.aim, 200), reached: c(o.reached, 160),
    scenes: arr(o.scenes).map((x): Scene => {
      const sq = (t: string) => t.replace(/\s+/g, "");
      const code = String(x.code ?? "").replace(/```\w*\n?|```/g, "").split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim()).slice(0, 8).join("\n").slice(0, 500);
      const result = String(x.result ?? "").replace(/```\w*\n?|```/g, "").split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim()).slice(-4).join("\n").slice(0, 300);
      const inCorpus = (t: string) => !corpus || t.split("\n").every((l) => sq(l.replace(/#.*$/, "")) === "" || corpus.includes(sq(l.replace(/#.*$/, ""))));
      const example = Boolean(x.example) || (code ? !inCorpus(code) : false);
      const keepResult = result && (example || !corpus || result.split("\n").some((l) => corpus.includes(sq(l))));
      return { title: c(x.title, 60), body: c(x.body, 360), ...(code ? { code } : {}), ...(keepResult ? { result } : {}), ...(code && example ? { example: true } : {}) };
    }).filter((x) => x.title && x.body).slice(0, 4),
    weak: arr(o.weak).map((x) => ({ gap: c(x.gap, 110), seen: c(x.seen, 160) })).filter((x) => x.gap && !/확인되지 않|알 수 없/.test(x.gap)).slice(0, 2) };
  return r.aim || r.scenes.length ? r : undefined;
}
const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

/** 목표 하나를 정리한다. messages: 그 대화 전체(at 포함), since: 목표가 시작된 시각 */
type GoalIn = { title: string; done: string; understood: boolean; applied: boolean; at: string };
/** 정리 호출에 보낼 글(평가에서도 같은 것을 쓴다, lib/evals.ts). 대화와 코드 저장을 시각 순서로 섞는다 */
export function recordInput(goal: GoalIn, messages: Msg[], show: (m: Msg) => string, saves: Save[], to: string, memory: string) {
  const seg = messages.filter((m) => m.at >= goal.at && m.at <= to);
  const code = codeTurns(saves, goal.at, to);
  const text = [...seg.map((m) => ({ at: m.at, text: show(m) })), ...code.map((c) => ({ at: c.at, text: c.text }))]
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map((x) => x.text).filter(Boolean).join("\n\n").slice(-60000);
  const user = `[목표] ${goal.title}\n[완료 조건] ${goal.done}\n[지금 학습자 메모리]\n${memory}\n[결과] ${goal.understood && goal.applied ? "이해 · 적용까지 하고 마침" : `건너뜀(이해 ${goal.understood ? "✓" : "–"}, 적용 ${goal.applied ? "✓" : "–"})`}\n\n[이 목표 동안의 대화]\n${text}`;
  return { seg, code, user };
}
/** 하다가 나간 목표(11/12 사용자 "하다가 나간 목표는 진행 중으로 정리해서 관리"): 끝나지 않은 현재 목표를 그때까지로 정리한 것. 기록 · 메모리 · 앱 기억에는 안 넣고 따로 둔다.
 *  그 목표가 진짜로 끝나 정리되면 지운다. */
export type Ongoing = { goal: string; done?: string; from: string; at: string; msgs: number; summary: string; review?: Review };
const ongoingFile = (runId: string) => path.join(DATA, "goals", `${runId}.ongoing.json`);
export const ongoingOf = (runId: string) => read<Ongoing | null>(ongoingFile(runId), null);
export async function recordGoal(runId: string, goal: GoalIn, mode: string | null, messages: Msg[], show: (m: Msg) => string, redo?: { to: string; index: number }, saves: Save[] = [], ledger = "", ongoing = false) {
  const base = recordInput(goal, messages, show, saves, redo?.to ?? new Date().toISOString(), await memoryForRecord());
  // 부족함 원장(11/8): 이 목표 동안 코드가 잡은 부족함을 같이 보내 이름 · 재확인 문항을 받는다
  // 이미 쓴 지식 이름(11/8 실측: 정리마다 "빈 목표 상태와 대체값" / "빈 목표 상태"처럼 이름이 흔들려 앱 지식이 늘어남) — 같은 것이면 그 이름 그대로
  const used = [...new Set((await recordsOf(runId)).flatMap((r) => [...r.learned.map((x) => x.concept), ...(r.gaps ?? []).map((x) => x.concept)]))].slice(-60);
  // 다른 실습에서 이미 쓴 이름도(11/10 학습 노트: 같은 선행 · 오해가 실습마다 다른 이름이 되지 않게)
  const other = await (await import("./learner-note.ts")).knownNames().catch(() => [] as string[]);
  for (const n of other) if (!used.includes(n) && used.length < 120) used.push(n);
  const names = used.length ? `\n\n[이 실습에서 이미 쓴 지식 이름 — 같은 지식이면 새 이름을 만들지 말고 이 이름을 글자 그대로 쓴다]\n${used.join(" · ")}` : "";
  // 학습자가 터미널에서 돌린 것(11/12, 총정리 장면에 실제 화면을 보이려고): 이 목표 동안 최대 8개, 출력은 끝부분
  const runs = (await (await import("./shell.ts")).learnerRunsSince(runId, goal.at).catch(() => [])).filter((r) => r.at <= (redo?.to ?? new Date().toISOString())).slice(-8);
  const runText = runs.length ? `\n\n[학습자가 터미널에서 돌린 것]\n${runs.map((r) => `$ ${r.command} → 종료 코드 ${r.code ?? "모름"}\n${r.out.split("\n").slice(-6).join("\n").slice(-600)}`).join("\n")}` : "";
  const { seg, code } = base, user = `${base.user}${runText}${ledger ? `\n\n${ledger}` : ""}${names}`;
  const corpus = [...seg.filter((m) => m.role === "user").map((m) => m.text), ...code.flatMap((c) => c.added), ...runs.map((r) => r.out)].join("\n").replace(/\s+/g, "");
  const log: Record<string, unknown> = { at: new Date().toISOString(), runId, goal: goal.title, messages: seg.length };
  const t0 = Date.now();
  try {
    if (!seg.some((m) => m.role === "user")) { log.skipped = "학습자 말 없음"; return null; }
    if (ongoing) { // 그 뒤로 말이 늘지 않았으면 다시 안 부른다
      const was = await ongoingOf(runId);
      if (was && was.goal === goal.title && was.msgs >= seg.length) { log.skipped = "진행 중 정리: 새 말 없음"; return null; }
    }
    type RawCard = { name: string; situation: string; did: string; quote: string; learned: string; next: string; how: string; prereq: boolean; code?: { save: string; from: number; to: number }; ids?: string[]; recheck?: { q: string; a: string } };
    const out = await aiJson<{ summary: string; steps: string[]; cards: RawCard[]; memory?: MemOps; review?: unknown }>("goal-record", SYSTEM_RECORD, user + (ongoing ? "\n\n[참고] 이 목표는 아직 끝나지 않았다(학습자가 하다가 손을 놓음). 지금까지로만 쓴다. reached는 어디까지 하다 멈췄는지." : ""), RECORD_SCHEMA);
    if (ongoing) {
      const o: Ongoing = { goal: goal.title, done: goal.done, from: goal.at, at: new Date().toISOString(), msgs: seg.length, summary: String(out.summary ?? "").trim().slice(0, 600), review: cleanReview(out.review, corpus) };
      await mkdir(path.dirname(ongoingFile(runId)), { recursive: true });
      await writeAtomic(ongoingFile(runId), JSON.stringify(o, null, 1));
      Object.assign(log, { ms: Date.now() - t0, chars: user.length, ongoing: true });
      return null;
    }
    // 근거는 학습자 말 또는 학습자가 저장한 코드 줄
    const learnerText = [...seg.filter((m) => m.role === "user").map((m) => norm(m.text)), ...code.flatMap((c) => c.added.map(norm))];
    const unverified: string[] = [];
    // 한 글자 답("3")은 그 말 전체와 같을 때만, 두 글자 이상은 그 말 안에 있으면 근거로 인정
    const found = (q: string) => q.length >= 1 && learnerText.some((t) => (q.length >= 2 ? t.includes(norm(q)) : t === norm(q)));
    const t = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
    const cards: Card[] = (out.cards ?? []).filter((x) => t(x.name, 80)).slice(0, 6).map((x) => {
      const q = t(x.quote, 200), ok = found(q);
      if (q && !ok) unverified.push(`${x.name}: "${q}"`);
      const how = ((HOW as readonly string[]).includes(x.how) ? x.how : "도움 받고 됨") as How;
      const cc = how !== "혼자 해냄" && x.code?.save ? cutCode(code, x.code) : undefined;
      if (how !== "혼자 해냄" && x.code?.save && !cc) unverified.push(`${x.name}: 코드 ${x.code.save} ${x.code.from}~${x.code.to}`);
      return { name: t(x.name, 80), situation: t(x.situation, 160), did: t(x.did, 300), quote: ok ? q : "", learned: t(x.learned, 400), next: t(x.next, 200), how, prereq: !!x.prereq, verified: ok || !!cc,
        ...(cc ? { code: cc } : {}), ids: (x.ids ?? []).map(String).filter((i) => /^G\d+-[0-9a-f]{4}$/.test(i)).slice(0, 6),
        ...(how !== "혼자 해냄" && x.recheck?.q && x.recheck?.a ? { recheck: { q: t(x.recheck.q, 1200), a: t(x.recheck.a, 600) } } : {}) };
    });
    // 예전 꼴(learned · gaps)로도 펼친다: 앱 지식 · 원장 · 메모리 · 화면이 그대로 읽게. 칸(type)은 더 쓰지 않아 "개념"으로 둔다
    const learned = cards.map((c) => ({ type: "개념" as Tab, concept: c.name, meaning: c.learned, how: c.how, quote: c.quote, verified: c.verified, card: c }));
    const gaps = cards.filter((c) => c.how !== "혼자 해냄").map((c) => ({ type: "개념" as Tab, concept: c.name, wrong: c.did, right: c.learned, quote: c.quote, verified: c.verified, ...(c.code ? { code: c.code } : {}), ids: c.ids, ...(c.recheck ? { recheck: c.recheck } : {}),
      prereq: c.prereq, card: { situation: c.situation, next: c.next, how: c.how } }));
    // 메모리 갱신: 근거는 이번 정리의 부족했던 점(나아짐은 배운 것) 이름만 인정, 상태는 코드가(lib/memory.ts)
    const memory = await applyMemory(runId, goal.title, out.memory, gaps.map((g) => g.concept), learned.map((l) => l.concept));
    const rec: GoalRecord = { goal: goal.title, done: goal.done, status: goal.understood && goal.applied ? "마침" : "건너뜀", mode, from: goal.at, to: redo?.to ?? new Date().toISOString(),
      review: cleanReview(out.review, corpus), summary: String(out.summary ?? "").trim().slice(0, 600), steps: (out.steps ?? []).map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 10), cards, learned, gaps, memory, at: new Date().toISOString() };
    await update<{ items: GoalRecord[] }>(file(runId), { items: [] }, (s) => { if (redo && s.items[redo.index]) s.items[redo.index] = rec; else s.items.push(rec); });
    // 진짜로 끝나 정리됐으니 그 목표의 '진행 중' 정리는 지운다
    if (!redo) { const was = await ongoingOf(runId); if (was?.goal === goal.title) await writeAtomic(ongoingFile(runId), "null"); }
    Object.assign(log, { ms: Date.now() - t0, chars: user.length, codeSaves: code.length, raw: out, unverified });
    return rec;
  } catch (e) {
    Object.assign(log, { ms: Date.now() - t0, error: (e as Error).message });
    return null;
  } finally {
    await mkdir(path.dirname(logFile()), { recursive: true }).catch(() => {});
    await appendFile(logFile(), JSON.stringify(log) + "\n").catch(() => {});
  }
}

/** 지난 목표 정리를 같은 구간의 대화로 다시 한다(11/6, 부족한 점을 더한 뒤 이미 끝난 목표에도). 앱에 보낸 열쇠는 그대로라 새로 생긴 것만 간다. */
export async function redoRecords(runId: string, messages: Msg[], show: (m: Msg) => string) {
  const old = await recordsOf(runId), saves = await savesOf(runId);
  const out = [];
  for (let i = 0; i < old.length; i++) {
    const r = old[i];
    const done = r.status === "마침";
    out.push(await recordGoal(runId, { title: r.goal, done: r.done, understood: done, applied: done, at: r.from }, r.mode, messages, show, { to: r.to, index: i }, saves));
  }
  return out;
}
