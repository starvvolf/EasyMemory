// One click to finish: stop the local server (only ours, on port 3000) and send this computer's data to RecallerData.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function ours() {
  try { return (await (await fetch("http://127.0.0.1:3000/api/local-experiment/status", { signal: AbortSignal.timeout(1500) })).json()).active === true; }
  catch { return false; }
}

console.log("① 앱 끄기");
if (await ours()) {
  if (process.platform === "win32") {
    const lines = (spawnSync("netstat", ["-ano"], { encoding: "utf8" }).stdout ?? "").split(/\r?\n/);
    const pids = [...new Set(lines.filter((line) => /[:.]3000\s/.test(line) && /LISTENING/i.test(line)).map((line) => line.trim().split(/\s+/).at(-1)).filter(Boolean))];
    for (const pid of pids) spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
  } else {
    spawnSync("sh", ["-c", "kill $(lsof -t -iTCP:3000 -sTCP:LISTEN) 2>/dev/null"], { stdio: "ignore" });
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  console.log(await ours() ? "   앱이 아직 켜져 있어요. 창을 직접 닫아 주세요." : "   껐어요.");
} else console.log("   켜진 앱이 없어요.");

console.log("② 데이터 올리기");
const result = spawnSync(process.execPath, [path.join(root, "scripts", "recaller-sync.mjs"), "push"], { stdio: "inherit" });
process.exit(result.status ?? 1);
