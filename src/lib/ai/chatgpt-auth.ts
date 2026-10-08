import { createCipheriv, createDecipheriv, createHash, createPublicKey, randomBytes, randomUUID, verify, constants } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ModelError } from "./model.ts";

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const root = () => path.join(process.env.STUDY_FORGE_DATA_DIR?.trim() || path.join(process.cwd(), ".study-forge-data"), "chatgpt-auth");
const idFor = (uid: string) => createHash("sha256").update(uid).digest("hex");
const accountPath = (uid: string) => path.join(root(), `account-${idFor(uid)}.json`);
const pendingPath = (state: string) => path.join(root(), `pending-${idFor(state)}.json`);
const hostPath = () => path.join(root(), "host.json");
const random = () => randomBytes(32).toString("base64url");

function storageKey(): Buffer | null {
  const raw = process.env.STUDY_FORGE_CHATGPT_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (process.platform === "win32" || process.env.NODE_ENV === "production") {
      throw new ModelError("not_configured", "ChatGPT 토큰 저장용 32바이트 암호화 키가 필요해요.");
    }
    return null;
  }
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new ModelError("not_configured", "ChatGPT 토큰 암호화 키는 64자리 16진수여야 해요.");
  return Buffer.from(raw, "hex");
}

function encodeStored(value: unknown) {
  const plain = JSON.stringify(value);
  const key = storageKey();
  if (!key) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}
function decodeStored(value: string) {
  if (!value.startsWith("v1:")) {
    if (storageKey()) throw new ModelError("login_required", "암호화되지 않은 ChatGPT 연결 기록은 사용할 수 없어요.");
    return value;
  }
  const [, iv, tag, encrypted] = value.split(":");
  const key = storageKey();
  if (!key || !iv || !tag || !encrypted) throw new ModelError("login_required", "ChatGPT 연결 기록을 복호화할 수 없어요.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new ModelError("login_required", "ChatGPT 연결 기록을 복호화할 수 없어요."); }
}

export function chatGptStorageReady() {
  try { storageKey(); return true; } catch { return false; }
}

export type ChatGptCredential = {
  uid: string; subject: string; email?: string; clientId: string; hostId: string;
  accessToken?: string; refreshToken?: string; idToken?: string; scopes: string[]; expiresAt: number;
};
type Pending = { uid: string; state: string; nonce: string; verifier: string; redirectUri: string; cookie: string; expiresAt: number; previousClientId?: string; previousSubject?: string };
type TokenReply = { access_token?: string; refresh_token?: string; id_token?: string; token_type?: string; scope?: string; expires_in?: number };

async function protectedWrite(file: string, value: unknown) {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, encodeStored(value), { mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
  await chmod(file, 0o600);
}
async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(decodeStored(await readFile(file, "utf8"))) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function hostId() {
  const current = await readJson<{ id: string }>(hostPath());
  if (current?.id?.startsWith("urn:uuid:")) return current.id;
  const id = `urn:uuid:${randomUUID()}`;
  await protectedWrite(hostPath(), { id });
  return id;
}
export async function credentialFor(uid: string) { return readJson<ChatGptCredential>(accountPath(uid)); }

/** Only a 127.0.0.1 callback is accepted by this OSS/local flow. */
export async function beginChatGptSignIn(uid: string, origin: string) {
  const callback = new URL("/api/auth/chatgpt/callback", origin);
  if (callback.protocol !== "http:" || callback.hostname !== "127.0.0.1") throw new ModelError("not_configured", "ChatGPT 계정 연결은 현재 127.0.0.1 로컬 실행에서만 지원해요.");
  const previous = await credentialFor(uid);
  const state = random(), nonce = random(), verifier = random(), cookie = random();
  const pending: Pending = { uid, state, nonce, verifier, redirectUri: callback.href, cookie, expiresAt: Date.now() + 10 * 60_000,
    ...(previous ? { previousClientId: previous.clientId, previousSubject: previous.subject } : {}) };
  await protectedWrite(pendingPath(state), pending);
  const url = new URL(`${ISSUER}/api/accounts/authorize`);
  url.search = new URLSearchParams({
    client_id: previous?.clientId ?? "dynamic_agent_client",
    ...(previous ? {} : { agent_name_hint: "Study Forge" }),
    ext_agent_host_id: await hostId(), response_type: "code", redirect_uri: callback.href,
    scope: SCOPES, resource: RESOURCE, state, nonce,
    code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }).toString();
  return { url: url.href, cookie, state };
}

function parseTokenError(body: unknown) {
  if (!body || typeof body !== "object") return "unknown";
  const object = body as { error?: unknown };
  if (typeof object.error === "string") return object.error;
  if (object.error && typeof object.error === "object" && "code" in object.error && typeof object.error.code === "string") return object.error.code;
  return "unknown";
}

async function tokenReply(fetcher: typeof fetch, params: URLSearchParams): Promise<{ response: Response; tokens: TokenReply }> {
  let response: Response;
  try {
    response = await fetcher(`${ISSUER}/api/accounts/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params });
  } catch { throw new ModelError("transient", "ChatGPT 로그인 서버에 연결하지 못했어요."); }
  try { return { response, tokens: await response.json() as TokenReply }; }
  catch { throw new ModelError("transient", "ChatGPT 로그인 서버 응답을 읽지 못했어요."); }
}

/** Signed ID-token validation, intentionally restricted to published JWKS and supported JWT signature algorithms. */
export async function verifyChatGptIdToken(token: string, clientId: string, nonce: string, fetcher: typeof fetch = fetch) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new ModelError("login_required", "ChatGPT 신원 확인에 실패했어요.");
  let header: { alg?: string; kid?: string }, payload: { iss?: string; aud?: string | string[]; exp?: number; iat?: number; nonce?: string; sub?: string; email?: string };
  try { header = JSON.parse(Buffer.from(parts[0], "base64url").toString()); payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()); }
  catch { throw new ModelError("login_required", "ChatGPT 신원 확인에 실패했어요."); }
  if (!header.kid || !["RS256", "PS256", "ES256"].includes(header.alg ?? "")) throw new ModelError("login_required", "지원하지 않는 ChatGPT 신원 서명입니다.");
  const discovery = await fetcher(`${ISSUER}/.well-known/openid-configuration`);
  if (!discovery.ok) throw new ModelError("transient", "ChatGPT 신원 확인 서버에 연결하지 못했어요.");
  const metadata = await discovery.json() as { issuer?: string; jwks_uri?: string };
  if (metadata.issuer !== ISSUER || !metadata.jwks_uri?.startsWith(`${ISSUER}/`)) throw new ModelError("login_required", "ChatGPT 신원 제공자를 확인하지 못했어요.");
  const response = await fetcher(metadata.jwks_uri);
  if (!response.ok) throw new ModelError("transient", "ChatGPT 서명 정보를 가져오지 못했어요.");
  const { keys } = await response.json() as { keys?: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }> };
  const jwk = keys?.find((key) => key.kid === header.kid && (!key.alg || key.alg === header.alg) && (!key.use || key.use === "sig"));
  if (!jwk) throw new ModelError("login_required", "ChatGPT 신원 서명을 확인하지 못했어요.");
  let valid = false;
  try {
    const key = createPublicKey({ key: jwk as unknown as Record<string, string>, format: "jwk" });
    const options = header.alg === "PS256" ? { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }
      : header.alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" as const } : key;
    valid = verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), options, Buffer.from(parts[2], "base64url"));
  } catch { /* invalid key or signature */ }
  const now = Date.now() / 1000;
  if (!valid || payload.iss !== ISSUER || !(Array.isArray(payload.aud) ? payload.aud.includes(clientId) : payload.aud === clientId) ||
    !payload.exp || payload.exp < now - 5 || !payload.iat || payload.iat > now + 5 || payload.nonce !== nonce || !payload.sub) {
    throw new ModelError("login_required", "ChatGPT 신원 확인에 실패했어요.");
  }
  return { subject: payload.sub, email: payload.email };
}

export async function finishChatGptSignIn(query: URLSearchParams, browserCookie: string | undefined, fetcher: typeof fetch = fetch) {
  const state = query.get("state");
  if (!state || !/^[A-Za-z0-9_-]{32,100}$/.test(state)) throw new ModelError("login_required", "로그인 요청 상태가 올바르지 않아요.");
  const file = pendingPath(state);
  const pending = await readJson<Pending>(file);
  if (!pending || pending.expiresAt < Date.now() || pending.cookie !== browserCookie || pending.state !== state) throw new ModelError("login_required", "로그인 요청이 만료되었거나 일치하지 않아요.");
  // Rename consumes the transaction before exchanging the one-time code; a repeated callback cannot reuse it.
  await rename(file, `${file}.used`);
  await unlink(`${file}.used`);
  if (query.has("error")) throw new ModelError("login_required", "ChatGPT 연결을 승인하지 않았어요.");
  const code = query.get("code");
  const clientId = pending.previousClientId ?? query.get("client_id");
  if (!code || !clientId || clientId === "dynamic_agent_client" || (pending.previousClientId && query.get("client_id") && query.get("client_id") !== clientId)) {
    throw new ModelError("login_required", "ChatGPT 클라이언트 등록이 완료되지 않았어요.");
  }
  const { response, tokens } = await tokenReply(fetcher, new URLSearchParams({ grant_type: "authorization_code", client_id: clientId,
    code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri, resource: RESOURCE }));
  if (!response.ok) throw new ModelError(parseTokenError(tokens) === "invalid_grant" ? "login_required" : "transient", "ChatGPT 로그인 코드를 교환하지 못했어요.");
  if (!tokens.id_token || !tokens.access_token || !tokens.refresh_token || tokens.token_type?.toLowerCase() !== "bearer") throw new ModelError("login_required", "ChatGPT가 필요한 로그인 정보를 주지 않았어요.");
  const identity = await verifyChatGptIdToken(tokens.id_token, clientId, pending.nonce, fetcher);
  if (pending.previousSubject && pending.previousSubject !== identity.subject) throw new ModelError("login_required", "이전에 연결한 ChatGPT 계정과 달라요.");
  const scopes = (tokens.scope ?? "").split(/\s+/).filter(Boolean);
  const credential: ChatGptCredential = { uid: pending.uid, subject: identity.subject, email: identity.email, clientId, hostId: await hostId(),
    accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token, scopes,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 };
  await protectedWrite(accountPath(pending.uid), credential);
  return { uid: pending.uid, email: identity.email, ready: scopes.includes("chatgpt.tokens.use.direct") };
}

const refreshes = new Map<string, Promise<string>>();
export async function chatGptAccessToken(uid: string, fetcher: typeof fetch = fetch): Promise<string> {
  const current = await credentialFor(uid);
  if (!current?.refreshToken || !current.accessToken || !current.scopes.includes("chatgpt.tokens.use.direct")) throw new ModelError("login_required", "ChatGPT로 로그인하고 플랜 사용을 승인해 주세요.");
  if (current.expiresAt > Date.now() + 5 * 60_000) return current.accessToken;
  const pending = refreshes.get(uid);
  if (pending) return pending;
  const task = (async () => {
    const { response, tokens } = await tokenReply(fetcher, new URLSearchParams({ grant_type: "refresh_token", client_id: current.clientId,
      refresh_token: current.refreshToken!, resource: RESOURCE }));
    if (!response.ok) {
      const code = parseTokenError(tokens);
      if (["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"].includes(code)) {
        await protectedWrite(accountPath(uid), { ...current, accessToken: undefined, refreshToken: undefined, idToken: undefined });
        throw new ModelError("login_required", "ChatGPT 연결이 만료되어 다시 로그인해야 해요.");
      }
      throw new ModelError("transient", "ChatGPT 로그인 갱신에 실패했어요.");
    }
    if (!tokens.access_token || !tokens.refresh_token) throw new ModelError("login_required", "ChatGPT 갱신 응답이 불완전해요.");
    const updated = { ...current, accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      ...(tokens.id_token ? { idToken: tokens.id_token } : {}),
      scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : current.scopes,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 };
    await protectedWrite(accountPath(uid), updated);
    return tokens.access_token;
  })();
  refreshes.set(uid, task);
  try { return await task; } finally { refreshes.delete(uid); }
}

export async function signOutChatGpt(uid: string, fetcher: typeof fetch = fetch) {
  const current = await credentialFor(uid);
  if (!current) return { remoteRevoked: true };
  let remoteRevoked = !current.refreshToken;
  if (current.refreshToken) {
    try {
      const discovery = await fetcher(`${ISSUER}/.well-known/openid-configuration`);
      const metadata = await discovery.json() as { revocation_endpoint?: string };
      if (metadata.revocation_endpoint?.startsWith(`${ISSUER}/`)) {
        const reply = await fetcher(metadata.revocation_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: current.refreshToken, token_type_hint: "refresh_token", client_id: current.clientId }) });
        remoteRevoked = reply.ok;
      }
    } catch { /* local sign-out still removes credentials */ }
  }
  await protectedWrite(accountPath(uid), { ...current, accessToken: undefined, refreshToken: undefined, idToken: undefined });
  return { remoteRevoked };
}
