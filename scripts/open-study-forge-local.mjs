import { spawn } from "node:child_process";
import { connect } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statusUrl = "http://127.0.0.1:3000/api/local-experiment/status";

async function activeServer() {
  try {
    const response = await fetch(statusUrl, { signal: AbortSignal.timeout(1_500), cache: "no-store" });
    if (!response.ok) return false;
    return (await response.json()).active === true;
  } catch {
    return false;
  }
}

async function portOccupied() {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: 3000 });
    socket.setTimeout(800);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });
}

if (!(await activeServer())) {
  if (await portOccupied()) {
    console.error("3000번 포트에 다른 서버가 있습니다. 기존 서버를 확인한 뒤 다시 실행하세요. 프로세스를 자동 종료하지 않았습니다.");
    process.exitCode = 1;
  } else {
    const child = spawn(process.execPath, [path.join(projectRoot, "scripts/run-local-experiment.mjs")], {
      cwd: projectRoot,
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    child.unref();
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (await activeServer()) { ready = true; break; }
    }
    if (!ready) {
      console.error("로컬 실험 서버가 20초 안에 준비되지 않았습니다. 서버 로그를 확인하세요.");
      process.exitCode = 1;
    }
  }
}

if (!process.exitCode) console.log("Study Forge 로컬 실험 서버가 준비됐습니다.");
