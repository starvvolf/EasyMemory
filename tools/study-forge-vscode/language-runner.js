/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { isDeepStrictEqual } = require('node:util');
const { ExampleRunner } = require('./example-runner');
const { validateExecution, validateValue, analyzeSource } = require('./execution-contract');
const { buildWrapper } = require('./function-wrappers');
const { runtimeEnv } = require('./local-runtimes');

class LanguageRunner extends ExampleRunner {
  async runSource({ source, language, execution, examples, runtime }, onResult = () => {}, limits = {}) {
    if (this.running) throw new Error('이미 예제를 실행 중입니다.');
    const cases = validateExecution(language, source, execution, examples);
    if (!runtime?.available) throw new Error(runtime?.reason || '런타임 확인이 필요합니다.');
    if (source.length > 100000) throw new Error('단일 소스 파일은 100,000자 이내여야 합니다.');
    this.running = true; this.cancelled = false;
    let directory;
    const results = [];
    try {
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'study-forge-run-'));
      const plan = await createPlan({ source, language, execution, cases, runtime, directory });
      if (this.cancelled) return results;
      if (plan.compile) {
        const compilation = await this.runOne({ input: '', expectedOutput: '' }, plan.compile, { timeoutMs: 10000, outputBytes: 65536 });
        if (compilation.exitCode !== 0 || ['timeout', 'stopped', 'output-limit', 'error', 'termination-error'].includes(compilation.status)) {
          const result = { ...compilation, ...examples[0], stage: 'compile', status: compilation.status === 'failed' ? 'error' : compilation.status,
            stderr: `컴파일 단계: ${compilation.stderr || compilation.actualOutput}` };
          results.push(result); onResult(result); return results;
        }
      }
      for (let index = 0; index < cases.length; index++) {
        if (this.cancelled) break;
        const example = cases[index], resultPath = path.join(directory, `result-${index}.json`);
        const launch = { ...plan.launch, args: [...plan.launch.args, ...(execution.mode === 'function' ? [String(index), resultPath] : [])] };
        let result = await this.runOne({ ...example, input: execution.mode === 'function' ? '' : example.input }, launch, limits);
        result = { ...result, input: example.input, stage: 'run' };
        if (execution.mode === 'function' && result.exitCode === 0 && ['passed', 'failed'].includes(result.status)) {
          const stdout = result.actualOutput;
          try {
            const size = (await fs.stat(resultPath)).size;
            const budget = Math.max(64, Math.min(limits.outputBytes ?? 65536, 262144));
            if (size + Buffer.byteLength(stdout) + Buffer.byteLength(result.stderr) > budget) { result = { ...result, stdout, actualOutput: '', status: 'output-limit', stderr: '반환값과 실행 출력의 합계가 출력 제한을 초과했습니다.' }; }
            else {
              const actualOutput = await fs.readFile(resultPath, 'utf8');
              const actual = JSON.parse(actualOutput); validateValue(actual, execution.function.returnType, '실제 반환값');
              result = { ...result, stdout, actualOutput, status: isDeepStrictEqual(actual, example.expected) ? 'passed' : 'failed' };
            }
          } catch (error) { result = { ...result, stdout, status: 'error', stderr: `반환값 확인 실패: ${error.message}` }; }
        }
        results.push(result); onResult(result);
      }
      return results;
    } finally {
      this.running = false; this.stopCurrent = null;
      if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

async function createPlan({ source, language, execution, cases, runtime, directory }) {
  const env = runtimeEnv(), base = { cwd: directory, env };
  if (language === 'python') {
    await fs.writeFile(path.join(directory, 'submission.py'), source, 'utf8');
    if (execution.mode === 'function') {
      await fs.writeFile(path.join(directory, 'harness.py'), buildWrapper(language, execution.function, cases), 'utf8');
      await fs.writeFile(path.join(directory, 'arguments.json'), JSON.stringify(cases.map((c) => c.args)), 'utf8');
    }
    return { launch: { ...base, command: runtime.python, args: ['-I', '-X', 'utf8', path.join(directory, execution.mode === 'function' ? 'harness.py' : 'submission.py')] } };
  }
  if (language === 'java') {
    const className = analyzeSource(language, source).className || execution.mainClass;
    const sourceFile = path.join(directory, `${className}.java`);
    await fs.writeFile(sourceFile, source, 'utf8');
    const sourceFiles = [sourceFile];
    if (execution.mode === 'function') {
      const harness = path.join(directory, 'StudyForgeHarness.java');
      await fs.writeFile(harness, buildWrapper(language, execution.function, cases), 'utf8'); sourceFiles.push(harness);
    }
    return { compile: { ...base, command: runtime.javac, args: ['-encoding', 'UTF-8', '-proc:none', '-implicit:none', '-classpath', directory, '-sourcepath', directory, '-d', directory, ...sourceFiles] },
      launch: { ...base, command: runtime.java, args: ['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', '-cp', directory, execution.mode === 'function' ? 'StudyForgeHarness' : execution.mainClass] } };
  }
  const sourceFile = path.join(directory, 'Submission.cs'); await fs.writeFile(sourceFile, source, 'utf8');
  const encodingFile = path.join(directory, 'StudyForgeEncoding.cs');
  await fs.writeFile(encodingFile, 'internal static class StudyForgeEncoding { [System.Runtime.CompilerServices.ModuleInitializer] internal static void Init() { System.Console.InputEncoding = new System.Text.UTF8Encoding(false); System.Console.OutputEncoding = new System.Text.UTF8Encoding(false); } }', 'utf8');
  const sourceFiles = [sourceFile, encodingFile];
  if (execution.mode === 'function') {
    const harness = path.join(directory, 'StudyForgeHarness.cs');
    await fs.writeFile(harness, buildWrapper(language, execution.function, cases), 'utf8'); sourceFiles.push(harness);
  }
  const referenceFile = path.join(directory, 'references.rsp');
  const refs = (await fs.readdir(runtime.references)).filter((file) => file.endsWith('.dll')).sort();
  await fs.writeFile(referenceFile, refs.map((file) => `-r:"${path.join(runtime.references, file)}"`).join('\n'), 'utf8');
  await fs.writeFile(path.join(directory, 'Submission.runtimeconfig.json'), JSON.stringify({ runtimeOptions: { tfm: runtime.tfm, framework: { name: 'Microsoft.NETCore.App', version: runtime.runtimeVersion } } }), 'utf8');
  return { compile: { ...base, command: runtime.dotnet, args: ['exec', runtime.compiler, '-noconfig', '-nostdlib+', '-nologo', '-target:exe', `-out:${path.join(directory, 'Submission.dll')}`, `@${referenceFile}`,
    ...(execution.mode === 'function' ? ['-main:StudyForgeHarness'] : []), ...sourceFiles] },
    launch: { ...base, command: runtime.dotnet, args: [path.join(directory, 'Submission.dll')] } };
}
module.exports = { LanguageRunner, createPlan };
