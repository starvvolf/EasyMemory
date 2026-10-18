/* eslint-disable @typescript-eslint/no-require-imports */
const { randomUUID, createHash } = require('node:crypto');
const { SECTION_KEYS } = require('./summary');

// Local evidence references only. Existing order is immutable; timestamps never reorder it.
function indexEvidence(session) {
  session.evidenceIndex ||= [];
  const known = new Map(session.evidenceIndex.map((entry) => [entry.id, entry]));
  const add = (id, kind, content) => {
    const contentHash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    const prior = known.get(id);
    if (prior && (prior.kind !== kind || prior.contentHash !== contentHash)) throw new Error('기존 원문 근거가 변경되어 계정 저장을 중단했습니다.');
    if (!prior) { const entry = { id, kind, contentHash }; session.evidenceIndex.push(entry); known.set(id, entry); }
  };
  for (const code of session.codeSnapshots || []) add(code.id, 'code', { language: code.language, text: code.text });
  for (const message of session.messages) if (message.status !== 'pending') add(message.id, 'message', { role: message.role, text: message.text, context: message.context });
  return session.evidenceIndex;
}
function recordSnapshot(session) {
  if (!session.summary) throw new Error('현재 세션을 먼저 정리하세요.');
  return { recordId: session.id, summary: {
    throughMessageId: session.summary.throughMessageId, updatedAt: session.summary.updatedAt, automatic: session.summary.automatic,
    sections: SECTION_KEYS.flatMap((key) => session.summary.sections[key]), learnerMemoryCandidates: session.summary.learnerMemoryCandidates || [],
  }, evidenceIndex: structuredClone(indexEvidence(session)) };
}
class MemoryClient {
  constructor(account) { this.account = account; this.state = null; this.generation = account.generation; }
  clear() { this.state = null; this.generation = this.account.generation; }
  snapshot() { if (this.generation !== this.account.generation) this.clear(); return this.state; }
  accept(result, generation, uid) {
    this.account.assertCurrent(generation, uid);
    if (!result?.state || result.state.ownerUid !== uid || !Number.isSafeInteger(result.state.revision) || !Array.isArray(result.state.entries)) throw new Error('계정 기억 응답을 확인하지 못했습니다.');
    if (this.generation === generation && this.state && result.state.revision < this.state.revision) return this.state;
    this.state = result.state; this.generation = generation; return this.state;
  }
  async load() {
    const generation = this.account.generation, uid = this.account.identity?.uid;
    return this.accept(await this.account.request('/api/learner-memory'), generation, uid);
  }
  async apply(session) {
    const generation = this.account.generation, identity = this.account.identity;
    if (!identity || session.accountLink?.uid !== identity.uid || session.accountLink?.serverUrl !== identity.serverUrl) return;
    const record = recordSnapshot(session);
    if (!this.snapshot()) await this.load();
    this.account.assertCurrent(generation, identity.uid);
    const result = await this.account.request('/api/learner-memory', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record, expectedRevision: this.state.revision, operationId: randomUUID() }) });
    return this.accept(result, generation, identity.uid);
  }
  async edit(target, change) {
    const generation = this.account.generation, uid = this.account.identity?.uid;
    if (!this.snapshot()) await this.load();
    this.account.assertCurrent(generation, uid);
    const result = await this.account.request('/api/learner-memory', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, change, expectedRevision: this.state.revision, operationId: randomUUID() }) });
    return this.accept(result, generation, uid);
  }
  async context(domain, topics) {
    if (!this.account.identity || !topics?.length) return undefined;
    if (!['algorithm', 'cs', 'opic', 'report'].includes(domain) || !Array.isArray(topics) || topics.length > 20
      || topics.some((topic) => typeof topic !== 'string' || !topic.trim() || topic.length > 100)) throw new Error('이번 질문의 기억 참고 주제를 확인하세요.');
    const params = new URLSearchParams({ domain }); topics.forEach((topic) => params.append('topic', topic));
    const result = await this.account.request('/api/learner-memory/context?' + params);
    if (result?.kind !== 'learner-memory-user-data' || !Array.isArray(result.entries) || result.entries.length > 5 || JSON.stringify(result).length > 2400) throw new Error('기억 참고 응답을 확인하지 못했습니다.');
    return result;
  }
}
module.exports = { MemoryClient, indexEvidence, recordSnapshot };
