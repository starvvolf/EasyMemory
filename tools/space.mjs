// 용량 큰 것 위치 (2026-11-05, 사용자 "쓸데없는데 용량을 많이 차지하는 것들의 위치를 파악해서 언제든 지울 수 있게"):
// measures the folders that grow on a PC and says what each is and whether it is safe to delete. It never deletes.
//   node tools/space.mjs            표로 보기
//   node tools/space.mjs --json     기계가 읽을 꼴
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function dataDir() {
  try {
    const line = readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/).find((l) => /^\s*STUDY_FORGE_DATA_DIR\s*=/.test(l));
    const v = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
    if (v) return path.resolve(root, v);
  } catch { /* none */ }
  return path.resolve(root, "..", "RecallerData");
}
function size(p) {
  let s; try { s = statSync(p); } catch { return 0; }
  if (!s.isDirectory()) return s.size;
  let n = 0; let list = []; try { list = readdirSync(p); } catch { return 0; }
  for (const e of list) n += size(path.join(p, e));
  return n;
}
const data = dataDir();
// safe: 지워도 다시 만들어짐 · ask: 지우면 실험 결과가 사라짐(필요하면 먼저 보관) · keep: 앱이 씀
const places = [
  [".next", "safe", "앱 서버 빌드 캐시. 다음에 켤 때 다시 만들어요(처음 켜기가 1~2분 느려져요)"],
  [".next-engine", "safe", "엔진 실험 서버(3002) 빌드 캐시"],
  ...(existsSync(root) ? readdirSync(root).filter((e) => e.startsWith(".next-lab-")).map((e) => [e, "safe", "실험 서버 빌드 캐시"]) : []),
  ["node_modules", "safe", "패키지. 지우면 다음에 켤 때 다시 받아요(1~3분)"],
  [".pnpm-store", "safe", "pnpm 패키지 저장소(지금은 npm을 써요)"],
  ["desktop/node_modules", "safe", "Electron 앱 패키지. 지우면 Recaller 앱.cmd가 다시 받아요"],
  ["experiments/project-course/node_modules", "safe", "실습 코스 패키지"],
  ["experiments/project-course/.node24", "safe", "실습 코스용 Node 24. 지우면 다시 받아요"],
  ["experiments/project-course/.codex-sdk", "safe", "실습 코스용 Codex SDK. 지우면 다시 받아요"],
  ["experiments/project-course/.data", "ask", "실습 코스 서버 기록(대화·로그). 실습 데이터 사본은 RecallerData에도 있어요"],
  ["tmp/engine-data", "ask", "엔진 실험 서버 데이터(PDF 실행 기록)"],
  ...(existsSync(path.join(root, "tmp")) ? readdirSync(path.join(root, "tmp")).filter((e) => /^lab-|^prompt-review|^claude-a$/.test(e)).map((e) => [`tmp/${e}`, "ask", "실험 서버·프롬프트 점검 기록"]) : []),
  ["tmp", "ask", "tmp 전체(위 tmp/… 포함, 로그·옮기기용 압축 등)"],
  ["lab/question-gen/out", "ask", "문제 만들기 실험 결과(강의 내용 포함, 깃에 안 올라감)"],
  [".data", "safe", "PC 작업 합치기 때 생긴 patch·bundle"],
  [".study-forge-data", "keep", "ChatGPT 로그인(chatgpt-auth)이 들어 있어요. 지우면 다시 로그인해야 해요"],
  [path.relative(root, data), "keep", "앱 데이터(RecallerData). 지우지 말고 scripts/recaller-data.mjs archive로 보관하세요"],
  [path.join(path.relative(root, data), "보관"), "ask", "보관한 실험 데이터. git 기록에도 남아 있어요"],
  [path.join(path.relative(root, data), "code", "problems"), "keep", "알고리즘 문제와 숨은 테스트(문제 하나 30~39MB까지)"],
  ["../../Public/Documents/ESTsoft/CreatorTemp/recaller-integration", "ask", "옛 작업 폴더(10/31 전). 예전 테스트 데이터가 있어요"],
];
const rows = places.map(([rel, kind, what]) => ({ path: rel, full: path.resolve(root, rel), kind, what, bytes: existsSync(path.resolve(root, rel)) ? size(path.resolve(root, rel)) : null }))
  .filter((r) => r.bytes !== null).sort((a, b) => b.bytes - a.bytes);
if (process.argv.includes("--json")) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
const label = { safe: "지워도 됨", ask: "확인 후", keep: "남김" };
console.log(`Recaller 용량 (${root})\n`);
for (const r of rows) console.log(`${(r.bytes / 1048576).toFixed(0).padStart(7)}MB  ${label[r.kind].padEnd(5)}  ${r.path}\n           ${r.what}`);
console.log(`\n합계 ${(rows.filter((r) => r.kind === "safe").reduce((n, r) => n + r.bytes, 0) / 1048576).toFixed(0)}MB는 지워도 다시 만들어져요. 이 도구는 아무것도 지우지 않아요.`);
