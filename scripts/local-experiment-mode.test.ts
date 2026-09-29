import assert from "node:assert/strict";
import test from "node:test";
import {
  isLocalExperimentApiPath,
  isLocalExperimentRequest,
  isSameOriginExperimentMutation,
  localExperimentStatusPayload,
} from "../src/lib/local-experiment-mode.ts";

const enabled = {
  NODE_ENV: "development",
  STUDY_FORGE_LOCAL_EXPERIMENT: "1",
  STUDY_FORGE_LOCAL_EXPERIMENT_BIND: "127.0.0.1",
};

test("local mode requires explicit switch and loopback launch and request", () => {
  const local = new Request("http://127.0.0.1:3000/api/mcp-runs", { headers: { host: "127.0.0.1:3000" } });
  assert.equal(isLocalExperimentRequest(local, enabled), true);
  assert.equal(isLocalExperimentRequest(local, { ...enabled, STUDY_FORGE_LOCAL_EXPERIMENT: undefined }), false);
  assert.equal(isLocalExperimentRequest(local, { ...enabled, STUDY_FORGE_LOCAL_EXPERIMENT_BIND: "0.0.0.0" }), false);
  assert.equal(isLocalExperimentRequest(local, { ...enabled, NODE_ENV: "production" }), false);
  assert.equal(isLocalExperimentRequest(new Request("http://localhost:3000/api/mcp-runs", { headers: { host: "localhost:3000" } }), enabled), false);
  assert.equal(isLocalExperimentRequest(new Request("http://192.168.1.2:3000/api/mcp-runs", { headers: { host: "192.168.1.2:3000" } }), enabled), false);
  assert.equal(isLocalExperimentRequest(new Request("http://127.0.0.1:3000/api/mcp-runs", { headers: { host: "external.example" } }), enabled), false);
  assert.equal(isLocalExperimentRequest(new Request("http://127.0.0.1:3000/api/mcp-runs", { headers: { host: "127.0.0.1:3000", "x-forwarded-host": "127.0.0.1" } }), enabled), true);
  assert.equal(isLocalExperimentRequest(new Request("http://localhost:3000/api/mcp-runs", { headers: { host: "127.0.0.1:3000", "x-forwarded-host": "127.0.0.1:3000" } }), enabled), true);
  assert.equal(isLocalExperimentRequest(new Request("http://127.0.0.1:3000/api/mcp-runs", { headers: { host: "127.0.0.1:3000", "x-forwarded-host": "external.example" } }), enabled), false);
});

test("status exposes only this server PID and project root on an enabled loopback request", () => {
  const runtime = { serverPid: 53972, projectRoot: "C:\\fixed\\study-forge" };
  const local = new Request("http://127.0.0.1:3000/api/local-experiment/status", { headers: { host: "127.0.0.1:3000" } });
  assert.deepEqual(localExperimentStatusPayload(local, runtime, enabled), {
    active: true,
    mode: "local-experiment",
    serverPid: 53972,
    projectRoot: "C:\\fixed\\study-forge",
  });
  const external = new Request("http://127.0.0.1:3000/api/local-experiment/status", { headers: { host: "external.example" } });
  for (const payload of [
    localExperimentStatusPayload(local, runtime, { ...enabled, STUDY_FORGE_LOCAL_EXPERIMENT: undefined }),
    localExperimentStatusPayload(local, runtime, { ...enabled, NODE_ENV: "production" }),
    localExperimentStatusPayload(external, runtime, enabled),
  ]) {
    assert.deepEqual(payload, { active: false, mode: "local-experiment" });
    assert.equal("serverPid" in payload, false);
    assert.equal("projectRoot" in payload, false);
  }
});

test("local access is limited to experiment endpoints and same-origin writes", () => {
  assert.equal(isLocalExperimentApiPath("/api/mcp-runs/example"), true);
  assert.equal(isLocalExperimentApiPath("/api/mcp-experiment-requests/example"), true);
  assert.equal(isLocalExperimentApiPath("/api/personalization-lab/example"), true);
  assert.equal(isLocalExperimentApiPath("/api/study-executor"), true);
  assert.equal(isLocalExperimentApiPath("/api/codex/status"), false);
  assert.equal(isLocalExperimentApiPath("/api/codex/models"), false);
  assert.equal(isLocalExperimentApiPath("/api/codex/login"), false);
  assert.equal(isLocalExperimentApiPath("/api/codex/chat"), false);
  assert.equal(isLocalExperimentApiPath("/api/user-data/decks"), false);
  assert.equal(isLocalExperimentApiPath("/api/codex/private"), false);
  assert.equal(isSameOriginExperimentMutation(new Request("http://localhost:3000/api/mcp-runs", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } })), true);
  assert.equal(isSameOriginExperimentMutation(new Request("http://127.0.0.1:3000/api/mcp-runs", { method: "POST", headers: { origin: "https://external.example" } })), false);
  assert.equal(isSameOriginExperimentMutation(new Request("http://127.0.0.1:3000/api/mcp-runs", { method: "POST" })), false);
});
