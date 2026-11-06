// 목표 하나가 끝날 때 정리(11/5 사용자 "각 목표가 끝나면 쭉 대화 기록 받아서 정리하는 걸로. 질문 단위가 아니라. 학습자가 어떤 절차를 거쳐서 뭘 배웠는지").
// [다음으로]를 누르면 그 목표가 시작된 뒤의 대화 전체를 한 번 보내 ① 한 줄 정리 ② 학습자가 거친 과정(순서) ③ 배운 개념(뜻 · 어떻게 만났나 · 학습자 말 근거)을 받는다.
// 근거 구절은 코드가 그 목표 동안의 학습자 말과 대조한다(없으면 근거 없음으로 남김). 받은 것 · 버린 것 · 원문 답을 모두 기록한다.
import path from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { DATA, read, update } from "./store.ts";
import { aiJson, S } from "./ai.ts";
import { applyMemory, memoryForRecord, type MemOps } from "./memory.ts";

export type GoalRecord = {
  goal: string; done: string; status: "마침" | "건너뜀"; mode: string | null; from: string; to: string;
  summary: string; steps: string[]; learned: { type: Tab; concept: string; meaning: string; how: string; quote: string; verified: boolean }[];
  /** 11/6 사용자 "대화 내역을 봤을 때 나한테 부족한 점이 딱 보인다. 그걸 캐치해서 지식으로 잡는 게 중요" */
  gaps?: { type: Tab; concept: string; wrong: string; right: string; quote: string; verified: boolean }[];
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
/** 목표 구간의 저장본을 "바뀐 줄" 조각으로. 구간 앞의 마지막 저장본이 비교 기준 */
function codeTurns(saves: Save[], from: string, to: string) {
  const prev = new Map<string, string>();
  const out: { at: string; text: string; added: string[] }[] = [];
  for (const sv of saves) {
    if (sv.at > to) break;
    if (sv.at >= from) {
      const d = lineDiff(prev.get(sv.file) ?? "", sv.text);
      if (d.length) out.push({ at: sv.at, text: `[학습자 코드 저장 ${sv.file}]\n${d.join("\n")}`, added: d.filter((l) => l.startsWith("+ ")).map((l) => l.slice(2)) });
    }
    prev.set(sv.file, sv.text);
  }
  return out;
}
export const recordsOf = async (runId: string) => (await read<{ items: GoalRecord[] }>(file(runId), { items: [] })).items;

export const SYSTEM_RECORD = `학습 목표 하나 동안 나눈 대화를 읽고, 학습자가 어떤 과정을 거쳐 무엇을 배웠는지 정리한다.
summary: 이 목표에서 학습자가 한 일과 도달한 곳을 2~3문장으로.
steps: 학습자가 거친 과정을 일어난 순서대로 3~8개. 각각 짧은 한 구절(예: "리스트 인덱스 예측 질문에 답함", "빈 리스트 pop이 오류인지 예측해 맞힘", "튜터가 만든 파일을 실행해 봄", "너무 쉽다고 해서 괄호 검사로 넘어감").
learned: 이 목표에서 학습자가 배운 것을 여섯 칸 중 하나(type)에 넣는다.
- 개념: 무엇인지(정의). 예: 해시 테이블, 스택
- 원리: 왜 · 어떻게 그렇게 동작하는지. 예: 같은 키는 늘 같은 칸으로 가서 다시 찾을 수 있다
- 절차: 순서대로 하는 단계. 예: 충돌이 나는 해시 테이블에 넣고 찾는 순서
- 규칙: 지켜야 하는 문법 · 약속. 예: 딕셔너리 값은 대괄호에 키를 넣어 꺼낸다
- 방법: 문제를 푸는 기법 · 요령. 예: 같은 칸의 항목을 리스트로 묶는 체이닝, 스택으로 괄호 검사
- 비교: 둘 이상의 차이. 예: 리스트와 딕셔너리, 스택과 큐
각 항목은 concept(다른 곳에서도 통하는 이름), meaning(그 칸에 맞는 한두 문장: 개념은 정의, 원리는 이유, 절차는 단계, 규칙은 약속, 방법은 언제 · 어떻게, 비교는 차이), how(학습자가 그걸 어떻게 만났는지 한 구절: 설명을 들음 · 예측해 맞힘/틀림 · 직접 써 봄 · 헷갈려 물어봄 등), quote(그게 드러난 학습자 말을 글자 그대로, 없으면 빈 글).
[학습자 코드 저장]은 학습자가 직접 저장한 코드에서 바뀐 줄이다(+ 더함, - 뺌). 학습자의 말과 코드에서 드러난 것을 기준으로 쓰고, 튜터가 말만 하고 지나간 것은 뺀다.
gaps: 이 목표 동안 드러난 학습자의 부족한 점. 틀린 답, 잘못 쓴 코드, 오해, 몰라서 물어본 것, 튜터가 바로잡아 준 것. 같은 원인은 하나로 묶는다. 각 항목은 type(위 여섯 칸), concept(그 지식 이름), wrong(학습자가 무엇을 몰랐거나 어떻게 잘못 알았는지 한 문장), right(바로 알아야 할 내용 한두 문장), quote(그게 드러난 학습자 말이나 코드 한 줄을 글자 그대로, 없으면 빈 글). 없으면 빈 목록.
memory: [지금 학습자 메모리]는 지금까지 여러 목표에서 쌓인 이 학습자의 경향이다. 이번 목표에서 드러난 것을 모아 보면 이 학습자가 어떤지 보고 메모리를 갱신한다. 단정하지 말고 "~가 부족해 보인다" 정도로 쓴다.
- add: 메모리에 없는 새 경향. text는 한 문장, evidence는 근거가 된 gaps의 concept 그대로.
- update: 이미 있는 경향이 이번에도 보이면 그 id, text(고칠 게 없으면 그대로), evidence(gaps의 concept 그대로).
- improved: 있던 경향이 이번에는 나아진 게 보이면 그 id와 evidence(나아진 게 드러난 learned의 concept 그대로).
바뀔 게 없으면 모두 빈 목록.`;
const SCHEMA = S.obj({ summary: S.str, steps: S.arr(S.str), learned: S.arr(S.obj({ type: S.oneOf(...TABS), concept: S.str, meaning: S.str, how: S.str, quote: S.str })),
  gaps: S.arr(S.obj({ type: S.oneOf(...TABS), concept: S.str, wrong: S.str, right: S.str, quote: S.str })),
  memory: S.obj({ add: S.arr(S.obj({ text: S.str, evidence: S.arr(S.str) })), update: S.arr(S.obj({ id: S.str, text: S.str, evidence: S.arr(S.str) })), improved: S.arr(S.obj({ id: S.str, evidence: S.arr(S.str) })) }) });
const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

/** 목표 하나를 정리한다. messages: 그 대화 전체(at 포함), since: 목표가 시작된 시각 */
export async function recordGoal(runId: string, goal: { title: string; done: string; understood: boolean; applied: boolean; at: string }, mode: string | null, messages: Msg[], show: (m: Msg) => string, redo?: { to: string; index: number }, saves: Save[] = []) {
  const seg = messages.filter((m) => m.at >= goal.at && (!redo || m.at <= redo.to));
  const code = codeTurns(saves, goal.at, redo?.to ?? new Date().toISOString());
  const log: Record<string, unknown> = { at: new Date().toISOString(), runId, goal: goal.title, messages: seg.length };
  const t0 = Date.now();
  try {
    if (!seg.some((m) => m.role === "user")) { log.skipped = "학습자 말 없음"; return null; }
    // 대화와 코드 저장을 시각 순서로 섞는다
    const text = [...seg.map((m) => ({ at: m.at, text: show(m) })), ...code.map((c) => ({ at: c.at, text: c.text }))]
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map((x) => x.text).filter(Boolean).join("\n\n").slice(-60000);
    const user = `[목표] ${goal.title}\n[완료 조건] ${goal.done}\n[지금 학습자 메모리]\n${await memoryForRecord()}\n[결과] ${goal.understood && goal.applied ? "이해 · 적용까지 하고 마침" : `건너뜀(이해 ${goal.understood ? "✓" : "–"}, 적용 ${goal.applied ? "✓" : "–"})`}\n\n[이 목표 동안의 대화]\n${text}`;
    const out = await aiJson<{ summary: string; steps: string[]; learned: { type: string; concept: string; meaning: string; how: string; quote: string }[]; gaps?: { type: string; concept: string; wrong: string; right: string; quote: string }[]; memory?: MemOps }>("goal-record", SYSTEM_RECORD, user, SCHEMA);
    // 근거는 학습자 말 또는 학습자가 저장한 코드 줄
    const learnerText = [...seg.filter((m) => m.role === "user").map((m) => norm(m.text)), ...code.flatMap((c) => c.added.map(norm))];
    const unverified: string[] = [];
    // 한 글자 답("3")은 그 말 전체와 같을 때만, 두 글자 이상은 그 말 안에 있으면 근거로 인정
    const found = (q: string) => q.length >= 1 && learnerText.some((t) => (q.length >= 2 ? t.includes(norm(q)) : t === norm(q)));
    const tab = (t: string) => ((TABS as readonly string[]).includes(t) ? t : "개념") as Tab;
    const learned = (out.learned ?? []).filter((x) => String(x.concept ?? "").trim()).slice(0, 12).map((x) => {
      const q = String(x.quote ?? "").trim();
      const ok = found(q);
      if (q && !ok) unverified.push(`${x.concept}: "${q}"`);
      return { type: tab(x.type), concept: String(x.concept).trim().slice(0, 80), meaning: String(x.meaning ?? "").trim().slice(0, 300), how: String(x.how ?? "").trim().slice(0, 120), quote: ok ? q.slice(0, 200) : "", verified: ok };
    });
    const gaps = (out.gaps ?? []).filter((x) => String(x.concept ?? "").trim()).slice(0, 10).map((x) => {
      const q = String(x.quote ?? "").trim(), ok = found(q);
      if (q && !ok) unverified.push(`부족 ${x.concept}: "${q}"`);
      return { type: tab(x.type), concept: String(x.concept).trim().slice(0, 80), wrong: String(x.wrong ?? "").trim().slice(0, 300), right: String(x.right ?? "").trim().slice(0, 300), quote: ok ? q.slice(0, 200) : "", verified: ok };
    });
    // 메모리 갱신: 근거는 이번 정리의 부족했던 점(나아짐은 배운 것) 이름만 인정, 상태는 코드가(lib/memory.ts)
    const memory = await applyMemory(runId, goal.title, out.memory, gaps.map((g) => g.concept), learned.map((l) => l.concept));
    const rec: GoalRecord = { goal: goal.title, done: goal.done, status: goal.understood && goal.applied ? "마침" : "건너뜀", mode, from: goal.at, to: redo?.to ?? new Date().toISOString(),
      summary: String(out.summary ?? "").trim().slice(0, 600), steps: (out.steps ?? []).map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 10), learned, gaps, memory, at: new Date().toISOString() };
    await update<{ items: GoalRecord[] }>(file(runId), { items: [] }, (s) => { if (redo && s.items[redo.index]) s.items[redo.index] = rec; else s.items.push(rec); });
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
