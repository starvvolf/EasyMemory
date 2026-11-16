// 실습 정리를 앱 화면 없이 돌린다(11/16): 실습 기록을 실습 서버 없이 바로 읽어(lib/library.ts) 정리 → <데이터>/practice-notes/<실습>.json, 카드는 기억 저장소에.
// 실행: node --experimental-strip-types tools/practice-notes/run.ts <실습 id>   (AI 1번)
// 데이터 폴더 STUDY_FORGE_DATA_DIR(없으면 ./data), 실습 데이터 PC_DATA_DIR(없으면 <데이터>/course), 로그인은 앱과 같은 ChatGPT 로그인.
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const DATA = path.resolve(root, process.env.STUDY_FORGE_DATA_DIR || "data");
process.env.STUDY_FORGE_DATA_DIR = DATA;
process.env.STUDY_FORGE_AUTH_DIR ||= DATA;
process.env.PC_DATA_DIR ||= path.join(DATA, "course");
process.env.STUDY_FORGE_MODEL_PROVIDER ||= "chatgpt";
if (!process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY) {
  const keyFile = path.join(os.homedir(), ".study-forge", "chatgpt-token-key");
  if (existsSync(keyFile)) process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY = readFileSync(keyFile, "utf8").trim();
}
const runId = process.argv[2];
if (!runId) { console.log("실습 id를 주세요."); process.exit(1); }
const { libraryRun } = await import("../../experiments/project-course/lib/library.ts");
const lib = await libraryRun(runId);
console.log(`${lib.title || runId}: 목표 ${lib.goals?.length ?? 0}개 · 기록 ${(lib.scenes ?? []).reduce((n: number, c: { events: unknown[] }) => n + c.events.length, 0)}개`);
console.log("ChatGPT에 한 번 보내요(gpt-6.1-terra · medium). 1분 안팎 걸려요...");
const t0 = Date.now();
const { makeNotes } = await import("../../src/lib/scene/practice-notes.ts");
const out = await makeNotes(runId, undefined, { title: lib.title, scenes: lib.scenes as never });
const n = out.notes;
console.log(`끝났어요: ${Math.round((Date.now() - t0) / 1000)}초`);
console.log(`만든 것: ${n.made}`);
console.log(`목차: ${n.layers.map((l) => `${l.name} (${l.items.length})`).join(" → ")}`);
console.log(`카드: ${n.layers.reduce((k, l) => k + l.items.filter((x) => x.card?.q).length, 0)}장 · 따라가기 ${n.traces?.length ?? 0}개`);
console.log(`저장: ${path.join(DATA, "practice-notes", `${runId}.json`)} — 3번판 앱의 기억 → 도서관 → 이 실습에서 보여요.`);
