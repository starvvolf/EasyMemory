// A separate Next development instance for the approved offline UI verification.
import { createServer } from "node:http";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reuseAt = process.argv.indexOf("--data-dir");
let dataRoot;
if (reuseAt >= 0) {
  const supplied = process.argv[reuseAt + 1];
  if (!supplied || !existsSync(supplied)) throw new Error("Existing verification data directory required.");
  dataRoot = realpathSync(supplied);
  if (path.dirname(dataRoot).toLowerCase() !== realpathSync(tmpdir()).toLowerCase() ||
    !path.basename(dataRoot).startsWith("study-forge-verification-11-")) {
    throw new Error("Only isolated Verification 11 temporary data can be reused.");
  }
} else dataRoot = mkdtempSync(path.join(tmpdir(), "study-forge-verification-11-"));
Object.assign(process.env, {
  STUDY_FORGE_VERIFICATION_11: "1",
  STUDY_FORGE_DATA_DIR: dataRoot,
  STUDY_FORGE_LOCAL_EXPERIMENT: "1",
  STUDY_FORGE_LOCAL_EXPERIMENT_BIND: "127.0.0.1",
  STUDY_FORGE_AUTO_EXECUTOR: "1",
  STUDY_FORGE_MODEL_PROVIDER: "fake",
});
const bootstrap = new URL("./verification-11-fixture-bootstrap.mjs", import.meta.url).href;
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --import=${bootstrap}`.trim();
await import(bootstrap);
const { default: next } = await import("next");
// Next's custom development router reloads config independently of app.conf.
// The test process supplies the serialized config to keep dev artifacts isolated.
const { default: configModule } = await import("next/dist/server/config.js");
const loadConfig = configModule.default ?? configModule;
const config = await loadConfig("phase-development-server", projectRoot);
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify({ ...config, distDir: ".next-verification-11" });
const app = next({ dev: true, dir: projectRoot, hostname: "127.0.0.1", port: 3112, turbopack: true });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer((request, response) => {
  if (request.url?.startsWith("/api/auth/chatgpt/")) {
    response.writeHead(403, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Verification uses the fake model." }));
    return;
  }
  void handle(request, response);
});
server.listen(3112, "127.0.0.1", () => {
  console.log(`Verification 11: http://127.0.0.1:3112/study`);
  console.log(`Isolated fixture data: ${dataRoot}`);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  server.close();
  void app.close().finally(() => process.exit(0));
});
