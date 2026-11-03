// AI 채팅 실험방(11/3 사용자 "말투부터 하는 짓까지 맘에 안 들어서 직접 실험"):
// ① 튜터 프롬프트에 덧붙일 지시를 사용자가 직접 적는다(.data/control/prompt-extra.json) — 모든 튜터 차례의 맥락 끝에 붙는다
// ② 실험용 진행 기록 하나로 튜터와 대화한다
// ③ 지금 프롬프트가 어떻게 조립돼 모델에 가는지, 마지막으로 실제 간 것을 그대로 보여 준다(.data/prompts/ 기록에서)
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DATA, read, update } from "./store.ts";

const EXTRA = () => path.join(DATA, "control", "prompt-extra.json");
const LAB = () => path.join(DATA, "control", "lab.json");
type Extra = { extra: string; at?: string };

export const getExtra = async () => (await read<Extra>(EXTRA(), { extra: "" })).extra ?? "";
export async function setExtra(text: string) {
  await update<Extra>(EXTRA(), { extra: "" }, () => ({ extra: String(text ?? "").slice(0, 8000), at: new Date().toISOString() }));
  return getExtra();
}
/** 튜터 맥락 끝에 붙일 한 덩어리(비었으면 빈 글) */
export async function extraBlock() {
  const t = (await getExtra()).trim();
  return t ? `[추가 지시 — 사용자가 실험방에서 직접 적음, 다른 지시보다 먼저 따른다]\n${t}` : "";
}

export const labRun = async () => (await read<{ runId?: string }>(LAB(), {})).runId ?? null;
export async function setLabRun(runId: string) { await update<{ runId?: string }>(LAB(), {}, () => ({ runId })); }

/** 지금 프롬프트를 조립하는 방식(코드 그대로를 말로) */
export const PIPELINE = [
  { step: "1. 고정 지시문 (매번 같음, 맨 앞)", what: "튜터 역할·말투·도구 쓰는 법·가르치는 순서. lib/oc-engine.ts의 SYSTEM. OpenCode가 덧붙이는 자체 안내는 shapeRequest가 잘라 내고 '작업 폴더' 한 줄만 남긴다." },
  { step: "2. 도구 목록", what: "읽기 · 실제 요청 보내기 · 코드 조각 돌리기 · 자동 확인 + 학습 도구(코스·진도·과제·기록 보기, 관찰 남기기). [막혔어요] 중이면 막힘 도구 3개가 더 붙는다." },
  { step: "3. 대화 (진행 기록 하나에 하나, 이어 씀)", what: "첫 차례: [코스]·[이번 단계](가르칠 것 · 고칠 곳 · 미리 말하지 않을 것) + 앞부분(6,000자 넘으면 요약) + [최근 대화]. 다음 차례부터는 지난 질문 뒤에 화면에 나온 것만 덧붙인다(캐시가 맞게). 입력이 24,000토큰을 넘으면 요약을 들고 새 대화." },
  { step: "4. 이번 차례 맥락 (매번 맨 뒤)", what: "[학습자 상태](배경 · 레벨 · 막힘 · 고친 파일 · 편집기 오류 · 내 말로) · [개념] · [기초] · [지금 위치](단계·걸음) · [지금 화면](버튼) · 고른 코드 · [막혔어요] 중이면 그 칸 규칙 · 그리고 아래 '추가 지시'." },
  { step: "5. 필요한 파일", what: "질문에 나온 이름이 정의된 파일과 고칠 파일을 줄 번호와 함께. 지난번과 같으면 다시 안 붙인다." },
  { step: "6. 학습자 말", what: "[학습자 질문] …" },
  { step: "7. 보내기 설정", what: "모델 gpt-6.1-terra · 생각 강도 지정 안 함(서버 기본) · 답 길이 medium · 생각 요약 auto · session-id 헤더(캐시)." },
  { step: "8. 답 뒤 코드가 하는 일", what: "글자를 흘려 보여 주기 · 정답 줄이 나왔는지 감지(나오면 '정답 보고 고침') · 프로젝트 노트에 남기기 · 사용량 기록." },
];

async function latest(dir: string, suffix: string, runId: string | null, n = 40) {
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(suffix)).sort().reverse().slice(0, n);
  for (const f of files) {
    try {
      const j = JSON.parse(await readFile(path.join(dir, f), "utf8"));
      if (!runId || j.runId === runId || j._run === runId) return { name: f.replace(/\.json$/, ""), j };
    } catch { /* */ }
  }
  return null;
}

/** 마지막으로 모델에 실제로 간 것: 지시문(다듬은 뒤) · 이번 차례 글 · 답 · 대화 길이 */
export async function lastPrompt(runId: string | null) {
  const dir = path.join(DATA, "prompts");
  const turn = await latest(dir, "-tutor-turn.json", runId);
  const req = await latest(dir, "-tutor-request.json", runId);
  const answer = turn ? await readFile(path.join(dir, `${turn.name}.answer.txt`), "utf8").catch(() => "") : "";
  const input = Array.isArray(req?.j?.input) ? req!.j.input : [];
  return {
    at: turn?.name.slice(0, 15) ?? null,
    instructions: typeof req?.j?.instructions === "string" ? req!.j.instructions : "",
    tools: Array.isArray(req?.j?.tools) ? req!.j.tools.map((t: { name?: string; function?: { name?: string } }) => t.name ?? t.function?.name).filter(Boolean) : [],
    settings: req ? { model: req.j.model, reasoning: req.j.reasoning ?? null, text: req.j.text ?? null } : null,
    messages: input.length,
    turn: turn?.j?.text ?? "",
    turnNo: turn?.j?.turn ?? null,
    answer,
  };
}
