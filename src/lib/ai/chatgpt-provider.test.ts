import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, readdir, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beginChatGptSignIn, chatGptAccessToken, credentialFor, finishChatGptSignIn, signOutChatGpt } from "./chatgpt-auth.ts";
import { chatgptBackend, readResponseStream, responseFailure, responseRequest } from "./chatgpt-provider.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
function jwt(nonce: string, clientId: string) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "https://auth.openai.com", aud: clientId, sub: "subject-1", email: "student@example.com",
    nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url")}`;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("동적 등록→서명 확인→서버 토큰 보관→갱신→로그아웃은 브라우저에 비밀을 주지 않는다", async (t) => {
  const previous = process.env.STUDY_FORGE_DATA_DIR;
  const previousKey = process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY;
  const data = await mkdtemp(path.join(os.tmpdir(), "sf-chatgpt-auth-"));
  process.env.STUDY_FORGE_DATA_DIR = data;
  process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY = "a".repeat(64);
  t.after(async () => { if (previous === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = previous;
    if (previousKey === undefined) delete process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY; else process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY = previousKey;
    await rm(data, { recursive: true, force: true }); });
  const started = await beginChatGptSignIn("local-experiment", "http://127.0.0.1:3101");
  const authorize = new URL(started.url);
  assert.equal(authorize.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(authorize.searchParams.get("redirect_uri"), "http://127.0.0.1:3101/api/auth/chatgpt/callback");
  assert.ok(authorize.searchParams.get("scope")?.includes("chatgpt.tokens.use.direct"));
  assert.ok(authorize.searchParams.get("ext_agent_host_id")?.startsWith("urn:uuid:"));
  assert.ok(!started.url.includes("secret-access"));
  const clientId = "oaiapp_test";
  const idToken = jwt(authorize.searchParams.get("nonce")!, clientId);
  let refreshCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("openid-configuration")) return json({ issuer: "https://auth.openai.com", jwks_uri: "https://auth.openai.com/.well-known/jwks.json", revocation_endpoint: "https://auth.openai.com/revoke" });
    if (url.endsWith("jwks.json")) return json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" }] });
    if (url.endsWith("/revoke")) return new Response(null, { status: 200 });
    if (url.endsWith("/oauth/token")) {
      const body = new URLSearchParams(String(init?.body));
      if (body.get("grant_type") === "refresh_token") { refreshCalls += 1; return json({ access_token: "refreshed-access", refresh_token: "refreshed-refresh", expires_in: 3600, scope: "openid chatgpt.tokens.use.direct" }); }
      assert.equal(body.get("client_id"), clientId);
      return json({ id_token: idToken, access_token: "secret-access", refresh_token: "secret-refresh", token_type: "Bearer", expires_in: 1,
        scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct" });
    }
    throw new Error(`Unexpected mock endpoint ${url}`);
  };
  const query = new URLSearchParams({ code: "one-time-code", state: started.state, client_id: clientId });
  const result = await finishChatGptSignIn(query, started.cookie, fetcher);
  assert.deepEqual(result, { uid: "local-experiment", email: "student@example.com", ready: true });
  await assert.rejects(finishChatGptSignIn(query, started.cookie, fetcher), /만료|일치/);
  assert.equal((await credentialFor("local-experiment"))?.accessToken, "secret-access");
  assert.equal(await chatGptAccessToken("local-experiment", fetcher), "refreshed-access");
  assert.equal(refreshCalls, 1);
  assert.deepEqual(await chatgptBackend.status({ uid: "local-experiment" }), {
    ready: true, message: "ChatGPT 계정으로 생성할 수 있어요.", account: { email: "student@example.com" },
  });
  const files = await readdir(path.join(data, "chatgpt-auth"));
  assert.ok(files.every((name) => !name.endsWith(".used")));
  for (const name of files) assert.ok(!(await readFile(path.join(data, "chatgpt-auth", name), "utf8")).includes("secret-access"));
  if (process.platform !== "win32") for (const name of files) assert.equal((await stat(path.join(data, "chatgpt-auth", name))).mode & 0o777, 0o600);
  assert.deepEqual(await signOutChatGpt("local-experiment", fetcher), { remoteRevoked: true });
  assert.equal((await credentialFor("local-experiment"))?.accessToken, undefined);
});

test("계정과 서명 조건이 틀리면 로그인 토큰을 저장하지 않는다", async (t) => {
  const previous = process.env.STUDY_FORGE_DATA_DIR;
  const previousKey = process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY;
  const data = await mkdtemp(path.join(os.tmpdir(), "sf-chatgpt-reject-"));
  process.env.STUDY_FORGE_DATA_DIR = data;
  process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY = "b".repeat(64);
  t.after(async () => { if (previous === undefined) delete process.env.STUDY_FORGE_DATA_DIR; else process.env.STUDY_FORGE_DATA_DIR = previous;
    if (previousKey === undefined) delete process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY; else process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY = previousKey;
    await rm(data, { recursive: true, force: true }); });
  const started = await beginChatGptSignIn("local-experiment", "http://127.0.0.1:3101");
  const invalid = jwt("wrong-nonce", "oaiapp_test");
  const fetcher: typeof fetch = async (input) => String(input).endsWith("oauth/token")
    ? json({ id_token: invalid, access_token: "secret", refresh_token: "secret", token_type: "Bearer", scope: "chatgpt.tokens.use.direct" })
    : String(input).endsWith("openid-configuration") ? json({ issuer: "https://auth.openai.com", jwks_uri: "https://auth.openai.com/.well-known/jwks.json" })
      : json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256" }] });
  await assert.rejects(finishChatGptSignIn(new URLSearchParams({ state: started.state, code: "code", client_id: "oaiapp_test" }), started.cookie, fetcher), /신원 확인/);
  assert.equal(await credentialFor("local-experiment"), null);
});

test("Responses 요청은 독립 입력·비저장·스트리밍을 사용하고 완료 이벤트만 성공이다", async () => {
  const body = responseRequest({ purpose: "test", system: "rule", user: "context", caller: { uid: "u" }, model: "gpt-6-sol", effort: "medium", json: true });
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.instructions, "rule");
  assert.deepEqual(body.input, [{ role: "user", content: "context" }]);
  assert.deepEqual(body.text, { format: { type: "json_object" } });
  assert.ok(!JSON.stringify(body).includes("previous_response_id"));
  const encode = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(encode.encode('data: {"type":"response.output_text.delta","delta":"{\\"ok\\":"}\n\n'));
    controller.enqueue(encode.encode('data: {"type":"response.output_text.delta","delta":"true}"}\n\n'));
    controller.enqueue(encode.encode('data: {"type":"response.completed","response":{"model":"gpt-6-sol","usage":{"input_tokens":12,"output_tokens":4}}}\n\n'));
    controller.close();
  } });
  assert.deepEqual(await readResponseStream(stream), { text: '{"ok":true}', model: "gpt-6-sol", usage: { inputTokens: 12, outputTokens: 4 } });
  await assert.rejects(readResponseStream(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encode.encode('data: {"type":"response.output_text.delta","delta":"partial"}\n\n')); controller.close(); } })), /완료되지/);
});

test("한도·로그인·지원 불가 오류는 구분한다", () => {
  assert.equal(responseFailure(429, { error: { code: "subscription_sharing_usage_limit_exceeded" } }).code, "usage_limit");
  assert.equal(responseFailure(401, { detail: "invalid" }).code, "login_required");
  assert.equal(responseFailure(400, { error: { code: "subscription_sharing_unsupported_capability" } }).code, "not_configured");
  assert.equal(responseFailure(503, { error: { code: "subscription_sharing_usage_unavailable" } }).code, "transient");
});
