/* eslint-disable @typescript-eslint/no-require-imports */
const { randomBytes, createHash } = require('node:crypto');
const SECRET_KEY = 'studyForge.firebaseRefreshToken';
const ACCOUNT_KEY = 'studyForge.firebaseAccount';
const stale = () => new Error('계정 연결이 변경되어 이전 응답을 폐기했습니다.');
function serverOrigin(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Study Forge 서버 주소를 확인하세요.'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:'
    && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('서버 주소는 HTTPS 또는 로컬 개발 서버의 기본 주소여야 합니다.');
  return url.origin;
}
function tokenSubject(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub; } catch { return undefined; }
}
// No response bodies or transport exception messages reach UI/logs: they may contain credentials.
async function requestJson(fetcher, url, options) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(url, { ...options, redirect: 'error', signal: controller.signal });
    if (!response.ok) { const error = new Error(response.status === 409 ? '계정 기억이 다른 곳에서 변경되었습니다. 새로 읽은 뒤 다시 저장하세요.' : `계정 요청에 실패했습니다 (${response.status}).`); error.status = response.status; throw error; }
    const text = await response.text();
    if (text.length > 1024 * 1024) throw new Error('계정 응답 크기 제한을 초과했습니다.');
    return JSON.parse(text);
  } catch (error) {
    if (Number.isInteger(error.status)) throw error;
    throw new Error('계정 요청을 완료하지 못했습니다. 연결 상태를 확인하세요.');
  } finally { clearTimeout(timer); }
}
class AccountClient {
  constructor({ secrets, globalState, callbackUri, fetcher = fetch, now = Date.now, onChange = () => {} }) {
    Object.assign(this, { secrets, globalState, callbackUri, fetcher, now, onChange });
    this.generation = 0; this.queue = Promise.resolve(); this.identity = null; this.pending = null; this.token = null; this.refreshing = null;
  }
  snapshot() { return { account: this.identity ? { uid: this.identity.uid, email: this.identity.email, serverUrl: this.identity.serverUrl } : null, connecting: Boolean(this.pending), generation: this.generation }; }
  enqueue(work) { const next = this.queue.catch(() => {}).then(work); this.queue = next; return next; }
  assertCurrent(generation, uid) { if (generation !== this.generation || (uid && uid !== this.identity?.uid)) throw stale(); }
  async restore() {
    const generation = this.generation;
    await this.enqueue(async () => {
      const saved = this.globalState.get(ACCOUNT_KEY);
      const refresh = await this.secrets.get(SECRET_KEY); this.assertCurrent(generation);
      if (saved && refresh && typeof saved.uid === 'string' && typeof saved.firebaseApiKey === 'string') {
        this.identity = { ...saved, serverUrl: serverOrigin(saved.serverUrl) }; this.onChange(this.snapshot());
      }
    });
  }
  async disconnect() {
    ++this.generation; this.pending = null; this.token = null; this.identity = null; this.refreshing = null;
    this.onChange(this.snapshot());
    await this.enqueue(async () => { await this.secrets.delete(SECRET_KEY); await this.globalState.update(ACCOUNT_KEY, undefined); });
  }
  async begin(serverUrl) {
    const origin = serverOrigin(serverUrl);
    await this.disconnect();
    const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.pending = { verifier, state, serverUrl: origin, generation: this.generation, expiresAt: this.now() + 300000 };
    const url = new URL('/vscode-connect', origin);
    url.search = new URLSearchParams({ callbackUri: this.callbackUri, challenge, state }).toString();
    this.onChange(this.snapshot()); return url.toString();
  }
  async complete(uri) {
    let url; try { url = new URL(uri); } catch { throw new Error('계정 연결 응답이 올바르지 않습니다.'); }
    const expected = new URL(this.callbackUri);
    if (url.protocol !== expected.protocol || url.host !== expected.host || url.pathname !== expected.pathname || url.hash || url.username || url.password) throw new Error('계정 연결 수신 주소가 일치하지 않습니다.');
    const pending = this.pending; this.pending = null; this.onChange(this.snapshot());
    if (!pending || pending.generation !== this.generation || pending.expiresAt <= this.now() || url.searchParams.get('state') !== pending.state
      || url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length !== 1
      || [...url.searchParams.keys()].some((key) => !['state', 'code'].includes(key))) throw new Error('계정 연결 요청이 만료되었거나 일치하지 않습니다. 다시 연결하세요.');
    const code = url.searchParams.get('code');
    if (!code || code.length > 2048) throw new Error('계정 연결 코드가 올바르지 않습니다.');
    const generation = pending.generation;
    const linked = await requestJson(this.fetcher, pending.serverUrl + '/api/auth/vscode-link/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, state: pending.state, verifier: pending.verifier }),
    });
    this.assertCurrent(generation);
    if (typeof linked.customToken !== 'string' || typeof linked.firebaseApiKey !== 'string' || !linked.firebaseApiKey
      || typeof linked.uid !== 'string' || !linked.uid || typeof linked.email !== 'string') throw new Error('계정 연결 응답 형식을 확인하지 못했습니다.');
    const tokens = await requestJson(this.fetcher, `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(linked.firebaseApiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: linked.customToken, returnSecureToken: true }),
    });
    this.assertCurrent(generation);
    await this.acceptTokens(generation, { uid: linked.uid, email: linked.email, firebaseApiKey: linked.firebaseApiKey, serverUrl: pending.serverUrl }, tokens.idToken, tokens.refreshToken, tokens.expiresIn);
    return this.snapshot();
  }
  async acceptTokens(generation, identity, idToken, refreshToken, expiresIn) {
    const seconds = Number(expiresIn);
    if (typeof idToken !== 'string' || tokenSubject(idToken) !== identity.uid || typeof refreshToken !== 'string' || !refreshToken || !Number.isFinite(seconds) || seconds <= 0) throw new Error('연결 계정과 인증 응답이 일치하지 않습니다.');
    await this.enqueue(async () => {
      this.assertCurrent(generation);
      await this.secrets.store(SECRET_KEY, refreshToken); this.assertCurrent(generation);
      await this.globalState.update(ACCOUNT_KEY, identity); this.assertCurrent(generation);
      this.identity = identity; this.token = { value: idToken, expiresAt: this.now() + seconds * 1000 }; this.onChange(this.snapshot());
    });
  }
  async idToken() {
    const identity = this.identity, generation = this.generation;
    if (!identity) throw new Error('Study Forge 계정을 먼저 연결하세요.');
    if (this.token && this.token.expiresAt > this.now() + 60000) return this.token.value;
    if (this.refreshing) return this.refreshing;
    const operation = (async () => {
      const refreshToken = await this.secrets.get(SECRET_KEY); this.assertCurrent(generation, identity.uid);
      if (!refreshToken) throw new Error('Study Forge 계정을 다시 연결하세요.');
      const result = await requestJson(this.fetcher, `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(identity.firebaseApiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
      });
      this.assertCurrent(generation, identity.uid);
      if (result.user_id !== identity.uid) throw new Error('갱신 계정이 일치하지 않습니다.');
      await this.acceptTokens(generation, identity, result.id_token, result.refresh_token, result.expires_in);
      this.assertCurrent(generation, identity.uid); return this.token.value;
    })();
    this.refreshing = operation;
    try { return await operation; } finally { if (this.refreshing === operation) this.refreshing = null; }
  }
  async request(resource, options = {}) {
    // These credentials must never be reused for legacy project or AI APIs.
    if (!/^\/api\/learner-memory(?:\/context)?(?:\?[^#]*)?$/.test(resource)) throw new Error('이 계정 연결로 사용할 수 없는 API입니다.');
    const generation = this.generation, uid = this.identity?.uid, origin = this.identity?.serverUrl;
    const token = await this.idToken(); this.assertCurrent(generation, uid);
    const result = await requestJson(this.fetcher, origin + resource, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
    this.assertCurrent(generation, uid); return result;
  }
}
module.exports = { AccountClient, serverOrigin, ACCOUNT_KEY, SECRET_KEY };
