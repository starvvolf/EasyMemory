/* eslint-disable @typescript-eslint/no-require-imports */
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function bounded(value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error(`${label}: ${max.toLocaleString()}자 이내로 입력하세요.`);
  }
  return value;
}

function normalizeProblem(input) {
  const title = bounded(input.title, '문제 제목', 200, true);
  const text = bounded(input.text, '문제 본문', 50000);
  const sourceUrl = bounded(input.sourceUrl || '', '원문 링크', 2000);
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) throw new Error('원문 링크는 http/https 주소여야 합니다.');
  if (sourceUrl) new URL(sourceUrl);
  if (!Array.isArray(input.images) || input.images.length > 5) throw new Error('그림은 최대 5개입니다.');
  const images = input.images.map((image) => {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl || '');
    if (!match || Buffer.byteLength(match[2], 'base64') > 3 * 1024 * 1024) {
      throw new Error('그림은 PNG/JPEG/WebP, 개당 3MB 이하여야 합니다.');
    }
    const bytes = Buffer.from(match[2], 'base64');
    const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : match[1] === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) throw new Error('그림 파일 형식이 내용과 일치하지 않습니다.');
    return { id: randomUUID(), mime: `image/${match[1]}`, dataUrl: image.dataUrl };
  });
  if (!text.trim() && !images.length) throw new Error('문제 본문 또는 그림을 등록하세요.');
  if (!Array.isArray(input.examples) || input.examples.length > 20) throw new Error('예제는 최대 20개입니다.');
  const examples = input.examples.map((example) => ({
    id: randomUUID(),
    input: bounded(example.input, '예제 입력', 10000),
    expectedOutput: bounded(example.expectedOutput, '기대 출력', 10000),
  }));
  return { title, text, sourceUrl, images, examples };
}

class LearningStore {
  constructor(directory) { this.directory = directory; this.state = { schemaVersion: 1, sessions: [], activeSessionId: null }; this.queue = Promise.resolve(); }
  async load() {
    try {
      const value = JSON.parse(await fs.readFile(path.join(this.directory, 'learning.json'), 'utf8'));
      if (value.schemaVersion !== 1 || !Array.isArray(value.sessions)) throw new Error('지원하지 않는 학습 기록 형식입니다.');
      this.state = value;
      for (const session of value.sessions) for (const message of session.messages) {
        if (message.status === 'pending') message.status = 'interrupted';
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this.state;
  }
  active() { return this.state.sessions.find((session) => session.id === this.state.activeSessionId); }
  async save() {
    const snapshot = JSON.stringify(this.state, null, 2);
    const operation = this.queue.catch(() => {}).then(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const temporary = path.join(this.directory, `learning-${randomUUID()}.tmp`);
      await fs.writeFile(temporary, snapshot, { mode: 0o600 });
      await fs.rename(temporary, path.join(this.directory, 'learning.json'));
    });
    this.queue = operation;
    return operation;
  }
  async create(problem) {
    const normalized = normalizeProblem(problem);
    const now = new Date().toISOString();
    const session = { id: randomUUID(), problem: normalized, messages: [], codeSnapshots: [], summaryAutoEnabled: false, createdAt: now, updatedAt: now };
    this.state.sessions.push(session);
    this.state.activeSessionId = session.id;
    await this.save();
    return session;
  }
  async select(id) {
    if (!this.state.sessions.some((session) => session.id === id)) throw new Error('문제를 찾지 못했습니다.');
    this.state.activeSessionId = id;
    await this.save();
  }
}

function questionContext(session, question, code, failures) {
  bounded(question, '질문', 10000, true);
  if (code) bounded(code.text, '선택 코드', 30000, true);
  const context = { problem: session.problem, ...(code ? { code } : {}), ...(failures?.length ? { failures } : {}) };
  const payload = JSON.stringify({ question, referenceMaterial: context });
  if (payload.length > 25 * 1024 * 1024) throw new Error('질문 문맥이 너무 큽니다.');
  return context;
}

module.exports = { LearningStore, normalizeProblem, questionContext };
