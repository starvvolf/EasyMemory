import { spawn } from "node:child_process";
import path from "node:path";

const child = spawn(process.execPath, [
  path.join(process.cwd(), "node_modules/next/dist/bin/next"),
  "dev",
  "--hostname",
  "127.0.0.1",
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    STUDY_FORGE_LOCAL_EXPERIMENT: "1",
    STUDY_FORGE_LOCAL_EXPERIMENT_BIND: "127.0.0.1",
  },
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
