// 막힌 순간(2026-11-11 사용자 "누가 썼나랑 막힌 순간 녹화 … 진행해 봐"):
// 오류 · 틀림 판정 · [너무 어려워요]부터 성공 · 맞음 · 넘어감까지를 한 장면으로 묶는다. 실습에서 사람이 기억하는 건 막혔다 푼 순간이라, 복기 한 장 · 복습 문제의 재료가 된다.
// 새로 받는 데이터는 없다 — 이미 들어오는 것(터미널 명령 · 판정 · 버튼 · 타임라인 한 칸)을 보고 여닫는 장부만 둔다. 전부 코드(AI 없음).
// "무엇을 바꿔서 풀렸나"는 저장하지 않고 볼 때 계산한다(시작 · 끝 시각의 저장본 차이, goal-record.ts의 저장본).
import path from "node:path";
import { DATA, read, update } from "./store.ts";

export type How = "혼자 풂" | "힌트 받고 풂" | "코드를 보고 풂" | "튜터가 고쳐 줌" | "안 풀고 넘어감";
export type Moment = {
  id: string; goal: string; openedAt: string; closedAt?: string;
  /** 무엇으로 시작됐나 */
  by: "오류" | "판정" | "어려워요";
  /** 시작 장면: 명령 · 오류 글 / 판정에서 빠진 곳 / 고른 이유 */
  command?: string; error?: string; gap?: string; reasons?: string;
  /** 그 사이 학습자가 한 말(원문, 최대 5개) */
  said: string[];
  /** 그 사이 받은 도움: 튜터 답 횟수 · 답에 코드가 있었나 · 튜터가 고친 파일 */
  help: { replies: number; code: boolean; edits: string[] };
  /** 다시 해 본 횟수(오류 명령 · 틀림 판정) */
  tries: number;
  how?: How; endCommand?: string;
};
type State = { moments: Moment[] };

const file = (runId: string) => path.join(DATA, "moments", `${runId}.json`);
const now = () => new Date().toISOString();
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const normCmd = (c: string) => c.replace(/\s+/g, " ").trim().toLowerCase();
const openOf = (s: State) => s.moments.find((m) => !m.closedAt);
/** 오류 글에서 알맹이 한 줄: 마지막 "XxxError: …" 줄, 없으면 끝의 안 빈 줄 */
// 터미널 프롬프트 줄(PS C:\…>, (base) PS …>, C:\…>, user@host:~$)은 오류 줄이 아니다(11/12 실습 시뮬: 오류 칸에 프롬프트가 찍힘)
const PROMPT = /^(\([\w.-]+\)\s*)?(PS\s+\S.*>|[A-Za-z]:\\[^>]*>|[\w.-]+@[\w.-]+:.*[$#]|[$#>])?\s*$/; // conda 이름만 따로 찍힌 줄 "(base)"도
export function errorLine(out: string) {
  const lines = String(out ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !PROMPT.test(l));
  const rev = [...lines].reverse();
  const hit = rev.find((l) => /\b\w*(Error|Exception)\b[:\s]|not recognized|not found|No such file|Traceback|could not be|does not exist|\bNo \S.*\bfound\b/i.test(l) && !/^Traceback/i.test(l));
  if (hit) return clip(hit, 240);
  // Gradle · Maven: "What went wrong:" 다음 줄, 없으면 Caused by · FAILURE 줄
  const ww = lines.findIndex((l) => /^\*?\s*What went wrong:?/i.test(l));
  if (ww >= 0 && lines[ww + 1]) return clip(lines[ww + 1], 240);
  return clip(rev.find((l) => /^Caused by\b|FAILURE|BUILD FAILED|\bfailed\b/i.test(l)) ?? lines.at(-1) ?? "", 240);
}
function howOf(m: Moment): How {
  return m.help.edits.length ? "튜터가 고쳐 줌" : m.help.code ? "코드를 보고 풂" : m.help.replies > 0 ? "힌트 받고 풂" : "혼자 풂";
}
const goalOf = async (runId: string) => { const g = await (await import("./goals.ts")).goalsOf(runId).catch(() => null); return g?.current?.title ?? g?.long?.text ?? ""; };
async function open(runId: string, by: Moment["by"], start: Partial<Moment>) {
  const goal = await goalOf(runId);
  await update<State>(file(runId), { moments: [] }, (s) => {
    const o = openOf(s);
    if (o) { o.tries += 1; if (start.error) o.error = start.error; if (start.gap) o.gap = start.gap; return; } // 이미 막혀 있으면 같은 장면에 덧붙인다
    s.moments.push({ id: `m${s.moments.length + 1}`, goal, openedAt: now(), by, said: [], help: { replies: 0, code: false, edits: [] }, tries: 1, ...start });
    if (s.moments.length > 200) s.moments.splice(0, s.moments.length - 200);
  });
}
async function close(runId: string, solved: boolean, endCommand?: string) {
  await update<State>(file(runId), { moments: [] }, (s) => {
    const o = openOf(s); if (!o) return;
    o.closedAt = now(); o.how = solved ? howOf(o) : "안 풀고 넘어감"; if (endCommand) o.endCommand = endCommand;
  });
}

/** 학습자가 터미널에서 돌린 명령: 실패면 열고(이미 열렸으면 한 번 더), 열려 있는 장면의 그 명령이 성공하면 닫는다 */
export async function onCommand(runId: string, command: string, code: number | null, out: string) {
  const cmd = clip(command, 300); if (!cmd || code === null) return;
  if (code !== 0) return open(runId, "오류", { command: cmd, error: errorLine(out) });
  const s = await read<State>(file(runId), { moments: [] }), o = openOf(s);
  if (o?.by === "오류" && o.command && normCmd(o.command) === normCmd(cmd)) await close(runId, true, cmd);
}
/** [해 봤어요] 판정: 틀림 · 일부면 열고, 맞음이면 열려 있는 장면을 닫는다 */
export async function onVerdict(runId: string, verdict: string, gap: string) {
  if (verdict === "incorrect" || verdict === "partial") return open(runId, "판정", { gap: clip(gap, 240) });
  if (verdict === "correct") return close(runId, true);
}
/** [너무 어려워요] */
export const onHard = (runId: string, reasons: string) => open(runId, "어려워요", { reasons: clip(reasons, 240) });
/** [다음으로] · 학습 종료: 열려 있으면 안 풀고 넘어간 것 */
export const onLeave = (runId: string) => close(runId, false);
/** 보충을 다 하고 돌아옴: 어려워요로 연 장면이면 풀린 것 */
export async function onSupportDone(runId: string) {
  const o = openOf(await read<State>(file(runId), { moments: [] }));
  if (o?.by === "어려워요") await close(runId, true);
}
/** 타임라인 한 칸이 닫힐 때: 열려 있는 장면에 학습자 말 · 받은 도움을 보탠다 */
export async function onStep(runId: string, step: { trigger: { kind: string; text?: string }; reply: string; tools: string[] }) {
  const s = await read<State>(file(runId), { moments: [] }); if (!openOf(s)) return;
  await update<State>(file(runId), { moments: [] }, (x) => {
    const o = openOf(x); if (!o) return;
    if (step.trigger.kind === "message" && step.trigger.text && o.said.length < 5) o.said.push(clip(step.trigger.text, 200));
    if (step.reply) { o.help.replies += 1; if (/```/.test(step.reply)) o.help.code = true; }
    for (const t of step.tools) { const m = /^파일을 고쳤어요:\s*(.+)$/.exec(t); if (m && !o.help.edits.includes(m[1])) o.help.edits.push(m[1].slice(0, 120)); }
  });
}

export async function momentsOf(runId: string) { return (await read<State>(file(runId), { moments: [] })).moments; }
/** 화면 · 복기용: 장면마다 걸린 시간과 "무엇을 바꿔서 풀렸나"(시작 직전 저장본 → 끝 직전 저장본의 차이, 파일마다 최대 12줄)를 계산해 붙인다 */
export async function momentsView(runId: string) {
  const ms = await momentsOf(runId);
  if (!ms.length) return { moments: [] };
  const GR = await import("./goal-record.ts");
  const saves = await GR.savesOf(runId).catch(() => []);
  return { moments: ms.map((m) => {
    const end = m.closedAt ?? now();
    const files = [...new Set(saves.filter((s) => s.at > m.openedAt && s.at <= end).map((s) => s.file))];
    const changed = m.closedAt && m.how !== "안 풀고 넘어감" ? files.map((f) => {
      const before = [...saves].reverse().find((s) => s.file === f && s.at <= m.openedAt)?.text ?? "";
      const after = [...saves].reverse().find((s) => s.file === f && s.at <= end)?.text ?? "";
      return { file: f, diff: GR.lineDiff(before, after).slice(0, 12) };
    }).filter((c) => c.diff.length).slice(0, 3) : [];
    return { ...m, seconds: Math.max(0, Math.round((Date.parse(end) - Date.parse(m.openedAt)) / 1000)), changed };
  }) };
}
