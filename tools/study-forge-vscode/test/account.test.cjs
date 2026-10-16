/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { AccountClient, ACCOUNT_KEY, SECRET_KEY, serverOrigin } = require('../account-client');
const jwt = (uid) => `fixture.${Buffer.from(JSON.stringify({ sub: uid })).toString('base64url')}.fixture`;
const json = (value, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(value) });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const secrets = new Map(), metadata = new Map(), calls = [];
  let now = 1000, uid = 'fixture-user', gate;
  const client = new AccountClient({ callbackUri: 'vscode://study-forge-local.study-forge-vscode/firebase-auth', now: () => now,
    secrets: { get: async (key) => secrets.get(key), store: async (key, value) => { secrets.set(key, value); }, delete: async (key) => { secrets.delete(key); } },
    globalState: { get: (key) => metadata.get(key), update: async (key, value) => { if (value === undefined) metadata.delete(key); else metadata.set(key, value); } },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (gate) await gate.promise;
      if (url.includes('/exchange')) return json({ customToken: 'fixture-custom', firebaseApiKey: 'fixture-public-api-key', uid, email: 'fixture@example.invalid' });
      if (url.includes('signInWithCustomToken')) return json({ idToken: jwt(uid), refreshToken: 'fixture-refresh', expiresIn: '3600' });
      if (url.includes('securetoken')) return json({ id_token: jwt(uid), refresh_token: 'fixture-rotated', expires_in: '3600', user_id: uid });
      return json({ state: { ownerUid: uid, revision: 0, entries: [] } });
    },
  });
  return { client, secrets, metadata, calls, setNow: (value) => { now = value; }, setUid: (value) => { uid = value; }, setGate: (value) => { gate = value; } };
}
async function callback(client) { const url = new URL(await client.begin('https://fixture.invalid')); return client.callbackUri + '?' + new URLSearchParams({ code: 'fixture-code', state: url.searchParams.get('state') }); }

test('계정 연결: S256·state, refresh만 SecretStorage, 재접속 갱신 및 API 범위', async () => {
  const f = fixture(), url = new URL(await f.client.begin('https://fixture.invalid'));
  assert.equal(url.pathname, '/vscode-connect'); assert.equal(url.searchParams.get('callbackUri'), f.client.callbackUri);
  assert.ok(url.searchParams.get('state').length >= 22); assert.equal(url.searchParams.has('verifier'), false);
  await f.client.complete(f.client.callbackUri + '?' + new URLSearchParams({ code: 'fixture-code', state: url.searchParams.get('state') }));
  const proof = JSON.parse(f.calls[0].options.body);
  assert.match(proof.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(createHash('sha256').update(proof.verifier).digest('base64url'), url.searchParams.get('challenge'));
  assert.deepEqual([...f.secrets], [[SECRET_KEY, 'fixture-refresh']]);
  assert.equal(JSON.stringify([...f.metadata]).includes('fixture-refresh'), false); assert.equal(JSON.stringify(f.client.snapshot()).includes(jwt('fixture-user')), false);
  assert.ok(f.calls.every((call) => call.options.redirect === 'error' && !call.url.includes('fixture-custom') && !call.url.includes('fixture-refresh')));
  await f.client.request('/api/learner-memory'); assert.match(f.calls.at(-1).options.headers.Authorization, /^Bearer /);
  await assert.rejects(f.client.request('/api/study-projects'), /없는 API/);
  await assert.rejects(f.client.request('/api/learner-memory/../../api/analyze'), /없는 API/);
  f.client.token = null; await Promise.all([f.client.idToken(), f.client.idToken()]);
  assert.equal(f.calls.filter((c) => c.url.includes('securetoken')).length, 1); assert.equal(f.secrets.get(SECRET_KEY), 'fixture-rotated');
  const resumed = new AccountClient({ secrets: f.client.secrets, globalState: f.client.globalState, callbackUri: f.client.callbackUri, fetcher: f.client.fetcher });
  await resumed.restore(); assert.equal(resumed.identity.uid, 'fixture-user'); assert.equal(resumed.token, null);
  await resumed.idToken(); assert.equal(f.calls.filter((c) => c.url.includes('securetoken')).length, 2);
  await resumed.disconnect(); assert.equal(f.secrets.size, 0); assert.equal(f.metadata.has(ACCOUNT_KEY), false);
});
test('잘못된 callback·state·TTL·중복 응답과 취소 후 연결 응답 거부', async () => {
  for (const mode of ['state', 'expired', 'cancel', 'duplicate']) {
    const f = fixture(); const uri = await callback(f.client);
    if (mode === 'state') await assert.rejects(f.client.complete(uri.replace(/state=[^&]+/, 'state=wrong')), /일치/);
    if (mode === 'expired') { f.setNow(400000); await assert.rejects(f.client.complete(uri), /만료/); }
    if (mode === 'cancel') { await f.client.disconnect(); await assert.rejects(f.client.complete(uri), /만료/); }
    if (mode === 'duplicate') { await f.client.complete(uri); await assert.rejects(f.client.complete(uri), /만료/); }
    if (mode !== 'duplicate') assert.equal(f.calls.length, 0);
  }
  const f = fixture(); const uri = await callback(f.client);
  await assert.rejects(f.client.complete(uri.replace('firebase-auth', 'other')), /주소/); assert.equal(f.calls.length, 0);
  assert.throws(() => serverOrigin('http://untrusted.invalid'), /HTTPS/);
});
test('연결/기억/refresh in-flight 도중 계정전환 시 이전 응답·credential 저장 차단', async () => {
  const f = fixture(); const uri = await callback(f.client), gate = deferred(); f.setGate(gate);
  const completing = f.client.complete(uri); await f.client.disconnect(); gate.resolve();
  await assert.rejects(completing, /폐기/); assert.equal(f.secrets.size, 0);
  f.setGate(null); await f.client.complete(await callback(f.client));
  const memoryGate = deferred(); f.setGate(memoryGate);
  const reading = f.client.request('/api/learner-memory'); await new Promise((resolve) => setImmediate(resolve));
  await f.client.disconnect(); memoryGate.resolve(); await assert.rejects(reading, /폐기/);
  f.setGate(null); await f.client.complete(await callback(f.client)); f.client.token = null;
  const refreshGate = deferred(); f.setGate(refreshGate);
  const refreshing = f.client.idToken(); await new Promise((resolve) => setImmediate(resolve));
  await f.client.disconnect(); refreshGate.resolve(); await assert.rejects(refreshing, /폐기/); assert.equal(f.secrets.size, 0);
});
test('UID 불일치·네트워크 오류에서 토큰을 저장하거나 오류 본문을 노출하지 않음', async () => {
  const f = fixture(); const uri = await callback(f.client), original = f.client.fetcher;
  f.client.fetcher = async (url, options) => url.includes('signInWithCustomToken') ? json({ idToken: jwt('other'), refreshToken: 'fixture-secret', expiresIn: 3600 }) : original(url, options);
  await assert.rejects(f.client.complete(uri), /계정/); assert.equal(f.secrets.size, 0);
  f.client.fetcher = async () => { throw new Error('fixture-secret must not escape'); };
  await assert.rejects(f.client.complete(await callback(f.client)), (error) => !error.message.includes('fixture-secret'));
});
