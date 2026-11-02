// AI 호출 기록(11/3, 사용자 "우리 에이전트한테 실제로 쥐어 주는 컨텍스트 그대로 ChatGPT에 줘 보기"):
// 모델에 실제로 보낸 것(지시문 · 대화 · 도구 · 강도)과 받은 답을 .data/prompts/에 남긴다. 깃에 안 올라간다. 끄기 PC_PROMPT_LOG=0
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA } from "./store.ts";

let seq = 0;
const on = () => process.env.PC_PROMPT_LOG !== "0";
const dir = () => path.join(DATA, "prompts");
const stamp = () => new Date(Date.now() + 9 * 3600_000).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

/** 요청 하나를 파일 하나로. 돌려주는 이름으로 답을 덧붙인다 */
export async function logPrompt(kind: string, body: unknown): Promise<string | null> {
  if (!on()) return null;
  try {
    await mkdir(dir(), { recursive: true });
    const name = `${stamp()}-${String(++seq).padStart(3, "0")}-${kind}`;
    await writeFile(path.join(dir(), `${name}.json`), JSON.stringify(body, null, 1));
    return name;
  } catch { return null; }
}
export async function logAnswer(name: string | null, answer: unknown) {
  if (!name) return;
  try { await appendFile(path.join(dir(), `${name}.answer.txt`), typeof answer === "string" ? answer : JSON.stringify(answer, null, 1)); } catch { /* 기록 실패는 무시 */ }
}
