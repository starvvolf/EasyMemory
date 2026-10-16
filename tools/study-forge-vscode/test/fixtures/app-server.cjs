/* eslint-disable @typescript-eslint/no-require-imports */
const readline = require('node:readline');
const mode = process.argv[2];
const send = (data) => process.stdout.write(`${JSON.stringify(data)}\n`);
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (!request.method || request.id === undefined) return;
  let result = {};
  if (request.method === 'account/read') result = { account: { type: mode === 'apikey' ? 'apiKey' : 'chatgpt' } };
  if (request.method === 'account/login/start') result = { type: request.params.type, loginId: 'login-1', authUrl: 'https://auth.openai.com/fixture' };
  if (request.method.startsWith('thread/')) {
    if (request.params.sandbox !== 'read-only' || request.params.approvalPolicy !== 'never') throw new Error('unsafe thread');
    result = { thread: { id: request.params.threadId || 'thread-1' } };
  }
  if (request.method === 'turn/start') {
    if (request.params.sandboxPolicy.type !== 'readOnly') throw new Error('unsafe turn');
    const threadId = request.params.threadId;
    result = { turn: { id: 'turn-1' } };
    if (mode !== 'hang') {
      // Intentionally deliver completion before the turn/start RPC response.
      send({ method: 'item/commandExecution/requestApproval', id: 'approval-1', params: { threadId, turnId: 'turn-1' } });
      send({ method: 'item/agentMessage/delta', params: { threadId, turnId: 'turn-1', delta: '모의 설명' } });
      send({ method: 'item/completed', params: { threadId, turnId: 'turn-1', item: { type: 'agentMessage', id: 'message-1', text: '모의 설명' } } });
      send({ method: 'turn/completed', params: { threadId, turn: { id: 'turn-1', status: 'completed' } } });
    }
  }
  send({ id: request.id, result });
});
