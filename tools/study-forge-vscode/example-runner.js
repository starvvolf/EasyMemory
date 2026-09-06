/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

// Adapters are trusted extension code, never problem text, AI output, or shell strings.
class ExampleRunner {
  constructor() { this.running = false; this.cancelled = false; this.stopCurrent = null; }
  stop() { this.cancelled = true; this.stopCurrent?.('stopped'); }
  async run(examples, launch, onResult = () => {}, limits = {}) {
    if (this.running) throw new Error('예제를 이미 실행 중입니다.');
    if (!launch || typeof launch.command !== 'string' || !Array.isArray(launch.args)) throw new Error('실행 언어와 형식이 아직 연결되지 않았습니다.');
    this.running = true; this.cancelled = false;
    const results = [];
    try {
      for (const example of examples) {
        if (this.cancelled) break;
        const result = await this.runOne(example, launch, limits);
        results.push(result); onResult(result);
      }
      return results;
    } finally { this.running = false; this.stopCurrent = null; }
  }
  runOne(example, launch, limits) {
    const timeoutMs = Math.max(10, Math.min(limits.timeoutMs ?? 3000, 10000));
    const outputBytes = Math.max(64, Math.min(limits.outputBytes ?? 65536, 262144));
    return new Promise((resolve) => {
      const child = spawn(launch.command, launch.args, {
        cwd: launch.cwd, env: launch.env, shell: false, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '', bytes = 0, reason = null, settled = false;
      const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
      const terminate = (status) => { if (reason) return; reason = status; killTree(child); };
      this.stopCurrent = terminate;
      const timer = setTimeout(() => terminate('timeout'), timeoutMs);
      const append = (name, chunk) => {
        const remaining = Math.max(0, outputBytes - bytes);
        bytes += chunk.length;
        const text = decoders[name].write(chunk.subarray(0, remaining));
        if (name === 'stdout') stdout += text; else stderr += text;
        if (bytes > outputBytes) terminate('output-limit');
      };
      child.stdout.on('data', (chunk) => append('stdout', chunk));
      child.stderr.on('data', (chunk) => append('stderr', chunk));
      const finish = (code, error) => {
        if (settled) return; settled = true; clearTimeout(timer); this.stopCurrent = null;
        stdout += decoders.stdout.end(); stderr += decoders.stderr.end();
        if (error) stderr = String(error.message).slice(0, outputBytes);
        const normalize = (value) => value.replace(/\r\n/g, '\n').replace(/\n$/, '');
        const status = reason || (error || code !== 0 ? 'error' : normalize(stdout) === normalize(example.expectedOutput) ? 'passed' : 'failed');
        resolve({ ...example, status, actualOutput: stdout, stderr, exitCode: code });
      };
      child.on('error', (error) => finish(null, error));
      child.on('close', (code) => finish(code));
      child.stdin.on('error', () => {}); // Programs can exit without consuming all stdin.
      child.stdin.end(example.input);
      if (this.cancelled) terminate('stopped');
    });
  }
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
    killer.on('exit', (code) => { if (code !== 0) child.kill(); });
    const fallback = setTimeout(() => { child.kill(); killer.kill(); }, 1000);
    child.once('close', () => clearTimeout(fallback));
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

// Deliberately empty until the first language and stdin/solution contract are agreed.
function resolveLanguageLaunch() { return null; }
module.exports = { ExampleRunner, resolveLanguageLaunch };
