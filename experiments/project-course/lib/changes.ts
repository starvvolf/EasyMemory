// 바뀐 코드 알려 주기(11/12 사용자 "바뀐 부분 알려주는 거 좋은 거 같아"):
// 튜터가 마지막으로 본 뒤 바뀐 코드를 코드가 그 차례 맥락에 붙인다. 튜터가 읽을지 정하지 않아도 되고(FPS 실습 시뮬: "됐다"에 출력만 보고
// 파일을 안 읽음), 매번 통째로 보내지도 않는다(바뀐 게 없으면 아무것도 안 붙임). Claude Code가 읽은 파일이 바뀌면 바뀐 부분을 알려 주는 방식.
// 재료: 저장본(goal-record.ts savesOf) + VS Code에서 저장 안 한 열린 파일(bridge.ts, 고친 상태일 때만 내용이 옴).
// 본 것: .data/goals/<run>.seen.json — 파일마다 튜터에게 마지막으로 보낸 내용.
import path from "node:path";
import { DATA, read, update } from "./store.ts";

const SMALL = 150;        // 이 줄 수까지는 통째로
const MAX_CHARS = 12_000; // 한 차례에 붙이는 양
const seenFile = (runId: string) => path.join(DATA, "goals", `${runId}.seen.json`);
type Seen = { files: Record<string, string> };
export type Now = { file: string; text: string; saved: boolean };

/** 지금 코드: 파일마다 마지막 저장본, 열린 파일이 저장 안 한 상태면 그 내용 */
export async function currentCode(runId: string, open?: { file: string | null; dirty?: boolean; text?: string | null } | null): Promise<Now[]> {
  const saves = await (await import("./goal-record.ts")).savesOf(runId);
  const by = new Map<string, Now>();
  for (const s of saves) by.set(s.file, { file: s.file, text: s.text, saved: true });
  if (open?.file && open.dirty && typeof open.text === "string") by.set(open.file, { file: open.file, text: open.text, saved: false });
  return [...by.values()];
}

const numberedAll = (t: string) => t.split(/\r?\n/).map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n");

/** 붙일 글. skip: 이번 차례에 튜터가 따로 읽을 파일(저장 확인)은 붙이지 않고 본 것으로만 친다 */
export function changeNote(now: Now[], seen: Record<string, string>, lineDiff: (a: string, b: string) => string[]) {
  const parts: string[] = [];
  const next = { ...seen };
  let size = 0;
  for (const n of now) {
    if (seen[n.file] === n.text) continue;
    const lines = n.text.split(/\r?\n/).length;
    const head = `[지난번 뒤 바뀐 코드 — ${n.file}, ${n.saved ? "저장됨" : "저장 안 함(실행하면 아직 예전 코드로 돌아요)"}]`;
    const body = lines <= SMALL || seen[n.file] === undefined
      ? numberedAll(n.text).split("\n").slice(0, SMALL * 2).join("\n")
      : `바뀐 줄(+ 더함, - 뺌)\n${lineDiff(seen[n.file], n.text).join("\n")}`;
    const block = `${head}\n${body}`;
    if (size + block.length > MAX_CHARS) { parts.push(`[지난번 뒤 바뀐 코드 — ${n.file}] (길어서 생략, 필요하면 read로)`); continue; }
    size += block.length; parts.push(block); next[n.file] = n.text;
  }
  return { text: parts.join("\n\n"), seen: next };
}

/** 이번 차례에 붙일 바뀐 코드(없으면 빈 글)를 만들고 본 것으로 기록한다 */
export async function changesForTurn(runId: string, open?: Parameters<typeof currentCode>[1], skip?: string) {
  const now = await currentCode(runId, open);
  if (!now.length) return "";
  const { lineDiff } = await import("./goal-record.ts");
  let out = "";
  await update<Seen>(seenFile(runId), { files: {} }, (s) => {
    const shown = now.filter((n) => n.file !== skip);
    const r = changeNote(shown, s.files, lineDiff);
    s.files = r.seen;
    for (const n of now) if (n.file === skip) s.files[n.file] = n.text; // 튜터가 직접 읽는 저장 확인 차례
    out = r.text;
  });
  return out;
}
export const seenOf = async (runId: string) => (await read<Seen>(seenFile(runId), { files: {} })).files;
