// 목표 하나가 끝날 때 정리(11/5 사용자 "각 목표가 끝나면 쭉 대화 기록 받아서 정리하는 걸로. 질문 단위가 아니라. 학습자가 어떤 절차를 거쳐서 뭘 배웠는지").
// [다음으로]를 누르면 그 목표가 시작된 뒤의 대화 전체를 한 번 보내 ① 한 줄 정리 ② 학습자가 거친 과정(순서) ③ 배운 개념(뜻 · 어떻게 만났나 · 학습자 말 근거)을 받는다.
// 근거 구절은 코드가 그 목표 동안의 학습자 말과 대조한다(없으면 근거 없음으로 남김). 받은 것 · 버린 것 · 원문 답을 모두 기록한다.
import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import { DATA, read, update } from "./store.ts";
import { aiJson, S } from "./ai.ts";

export type GoalRecord = {
  goal: string; done: string; status: "마침" | "건너뜀"; mode: string | null; from: string; to: string;
  summary: string; steps: string[]; learned: { concept: string; meaning: string; how: string; quote: string; verified: boolean }[]; at: string;
};
type Msg = { role: string; text: string; at: string };
const file = (runId: string) => path.join(DATA, "goals", `${runId}.records.json`);
const logFile = () => path.join(DATA, "goals", "records.log.jsonl");
export const recordsOf = async (runId: string) => (await read<{ items: GoalRecord[] }>(file(runId), { items: [] })).items;

export const SYSTEM_RECORD = `학습 목표 하나 동안 나눈 대화를 읽고, 학습자가 어떤 과정을 거쳐 무엇을 배웠는지 정리한다.
summary: 이 목표에서 학습자가 한 일과 도달한 곳을 2~3문장으로.
steps: 학습자가 거친 과정을 일어난 순서대로 3~8개. 각각 짧은 한 구절(예: "리스트 인덱스 예측 질문에 답함", "빈 리스트 pop이 오류인지 예측해 맞힘", "튜터가 만든 파일을 실행해 봄", "너무 쉽다고 해서 괄호 검사로 넘어감").
learned: 이 목표에서 학습자가 만난 개념마다 concept(다른 곳에서도 통하는 일반 이름), meaning(대화에서 설명된 뜻 한 문장), how(학습자가 그 개념을 어떻게 만났는지 한 구절: 설명을 들음 · 예측해 맞힘/틀림 · 직접 써 봄 · 헷갈려 물어봄 등), quote(그게 드러난 학습자 말을 글자 그대로, 없으면 빈 글).
학습자의 말과 행동에서 드러난 것을 기준으로 쓰고, 튜터가 말만 하고 지나간 것은 뺀다.`;
const SCHEMA = S.obj({ summary: S.str, steps: S.arr(S.str), learned: S.arr(S.obj({ concept: S.str, meaning: S.str, how: S.str, quote: S.str })) });
const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

/** 목표 하나를 정리한다. messages: 그 대화 전체(at 포함), since: 목표가 시작된 시각 */
export async function recordGoal(runId: string, goal: { title: string; done: string; understood: boolean; applied: boolean; at: string }, mode: string | null, messages: Msg[], show: (m: Msg) => string) {
  const seg = messages.filter((m) => m.at >= goal.at);
  const log: Record<string, unknown> = { at: new Date().toISOString(), runId, goal: goal.title, messages: seg.length };
  const t0 = Date.now();
  try {
    if (!seg.some((m) => m.role === "user")) { log.skipped = "학습자 말 없음"; return null; }
    const text = seg.map(show).filter(Boolean).join("\n\n").slice(-60000);
    const user = `[목표] ${goal.title}\n[완료 조건] ${goal.done}\n[결과] ${goal.understood && goal.applied ? "이해 · 적용까지 하고 마침" : `건너뜀(이해 ${goal.understood ? "✓" : "–"}, 적용 ${goal.applied ? "✓" : "–"})`}\n\n[이 목표 동안의 대화]\n${text}`;
    const out = await aiJson<{ summary: string; steps: string[]; learned: { concept: string; meaning: string; how: string; quote: string }[] }>("goal-record", SYSTEM_RECORD, user, SCHEMA);
    const learnerText = seg.filter((m) => m.role === "user").map((m) => norm(m.text));
    const unverified: string[] = [];
    const learned = (out.learned ?? []).filter((x) => String(x.concept ?? "").trim()).slice(0, 12).map((x) => {
      const q = String(x.quote ?? "").trim();
      // 한 글자 답("3")은 그 말 전체와 같을 때만, 두 글자 이상은 그 말 안에 있으면 근거로 인정
      const ok = q.length >= 1 && learnerText.some((t) => (q.length >= 2 ? t.includes(norm(q)) : t === norm(q)));
      if (q && !ok) unverified.push(`${x.concept}: "${q}"`);
      return { concept: String(x.concept).trim().slice(0, 80), meaning: String(x.meaning ?? "").trim().slice(0, 300), how: String(x.how ?? "").trim().slice(0, 120), quote: ok ? q.slice(0, 200) : "", verified: ok };
    });
    const rec: GoalRecord = { goal: goal.title, done: goal.done, status: goal.understood && goal.applied ? "마침" : "건너뜀", mode, from: goal.at, to: new Date().toISOString(),
      summary: String(out.summary ?? "").trim().slice(0, 600), steps: (out.steps ?? []).map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 10), learned, at: new Date().toISOString() };
    await update<{ items: GoalRecord[] }>(file(runId), { items: [] }, (s) => { s.items.push(rec); });
    Object.assign(log, { ms: Date.now() - t0, chars: user.length, raw: out, unverified });
    return rec;
  } catch (e) {
    Object.assign(log, { ms: Date.now() - t0, error: (e as Error).message });
    return null;
  } finally {
    await mkdir(path.dirname(logFile()), { recursive: true }).catch(() => {});
    await appendFile(logFile(), JSON.stringify(log) + "\n").catch(() => {});
  }
}
