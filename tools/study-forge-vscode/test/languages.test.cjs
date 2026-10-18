/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { analyzeSource, confirmExecution, validateExecution, starter } = require('../execution-contract');
const { detectRuntime } = require('../local-runtimes');
const { LanguageRunner: BaseRunner, createPlan } = require('../language-runner');
class LanguageRunner extends BaseRunner {
  runSource(input, ...rest) {
    return super.runSource({ ...input, execution: confirmExecution(input.language, input.source, input.execution, input.examples) }, ...rest);
  }
}
const { buildWrapper } = require('../function-wrappers');
const settings = { python: process.env.STUDY_FORGE_TEST_PYTHON, dotnet: process.env.STUDY_FORGE_TEST_DOTNET, java: process.env.STUDY_FORGE_TEST_JAVA, javac: process.env.STUDY_FORGE_TEST_JAVAC };
const runtimePromises = Object.fromEntries(['python', 'csharp', 'java'].map((lang) => [lang, detectRuntime(lang, settings)]));
function execution(language, source, mode) { const a = analyzeSource(language, source); return { mode, mainClass: a.className, function: a.candidates[0], confirmedHash: a.hash }; }
const echo = {
  python: 'import sys\nsys.stdout.write(sys.stdin.read())\n',
  java: 'public class Main { public static void main(String[] a) throws Exception { System.out.print(new String(System.in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)); } }',
  csharp: 'using System; public class Program { public static void Main() { Console.Write(Console.In.ReadToEnd()); } }',
};
function functionSource(lang, type, body) {
  if (lang === 'python') return `def solution(value: ${type}) -> ${type}:\n    ${body}\n`;
  return `public class Solution { public ${type} solution(${type} value) { ${body} } }`;
}

test('호출 계약: 모호한 후보를 자동 선택/확정하지 않고 복잡 타입·JSON 모호성 거부', () => {
  const source = 'def one(x):\n    return x\ndef two(x: list[int]) -> list[int]:\n    return x\n';
  const analysis = analyzeSource('python', source); assert.equal(analysis.candidates.length, 2);
  assert.equal(analysis.candidates[0].parameters[0].type, '');
  let config = execution('python', source, 'function');
  assert.throws(() => validateExecution('python', source, config, []), /확인/);
  config.function = analysis.candidates[1];
  assert.throws(() => confirmExecution('python', source, config, [{ input: '[1,2]', expectedOutput: '[1,2]' }]), /인자/);
  const examples = [{ input: '[[1,2]]', expectedOutput: '[1,2]' }];
  config = confirmExecution('python', source, config, examples);
  assert.equal(validateExecution('python', source + '#changed', config, examples).length, 1);
  assert.throws(() => validateExecution('python', source, config, []), /다시 확인/);
  assert.match(analyzeSource('java', 'package p; public class A {}').reason, /package/);
});

for (const language of ['python', 'csharp', 'java']) {
  for (const mode of ['stdio', 'function']) {
    test(`${language}/${mode}: 정상·오답·문자열/배열/공백 비교`, async (t) => {
      const runtime = await runtimePromises[language]; if (!runtime.available) { t.skip(runtime.reason); return; }
      const runner = new LanguageRunner();
      const source = mode === 'stdio' ? echo[language] : functionSource(language, language === 'python' ? 'list[str]' : language === 'java' ? 'String[]' : 'string[]', language === 'python' ? 'return value' : 'return value;');
      const cases = mode === 'stdio' ? [{ input: ' a  b\n한글\n', expectedOutput: ' a  b\n한글\n' }, { input: 'x ', expectedOutput: 'x' }]
        : [{ input: '[ [" a ", "한글\\n문자", "\\\"\\\\"] ]', expectedOutput: '[" a ","한글\\n문자","\\\"\\\\"]' }, { input: '[["x "]]', expectedOutput: '["x"]' }];
      const results = await runner.runSource({ source, language, execution: execution(language, source, mode), examples: cases, runtime });
      assert.deepEqual(results.map((r) => r.status), ['passed', 'failed'], JSON.stringify(results));
    });
    test(`${language}/${mode}: 실행 오류·시간초과·취소`, async (t) => {
      const runtime = await runtimePromises[language]; if (!runtime.available) { t.skip(runtime.reason); return; }
      const runner = new LanguageRunner();
      const programs = {
        python: { stdio: 'raise RuntimeError("fixture error")', function: 'def solution(value: int) -> int:\n    raise RuntimeError("fixture error")\n' },
        java: { stdio: 'public class Main { public static void main(String[] a) { throw new RuntimeException("fixture error"); } }', function: 'public class Solution { public int solution(int value) { throw new RuntimeException("fixture error"); } }' },
        csharp: { stdio: 'public class Program { public static void Main() { throw new System.Exception("fixture error"); } }', function: 'public class Solution { public int solution(int value) { throw new System.Exception("fixture error"); } }' },
      };
      const source = programs[language][mode], cases = [{ input: mode === 'stdio' ? '' : '[1]', expectedOutput: '1' }];
      const failure = await runner.runSource({ source, language, execution: execution(language, source, mode), examples: cases, runtime });
      assert.equal(failure[0].status, 'error', JSON.stringify(failure)); assert.match(failure[0].stderr, /fixture error/);
      const hanging = language === 'python' ? source.replace('raise RuntimeError("fixture error")', 'while True: pass')
        : source.replace(/throw new (?:RuntimeException|System.Exception)\("fixture error"\);/, 'while(true) {}');
      const input = { source: hanging, language, execution: execution(language, hanging, mode), examples: [...cases, ...cases], runtime };
      const timeout = await runner.runSource(input, undefined, { timeoutMs: 300 }); assert.equal(timeout[0].status, 'timeout', JSON.stringify(timeout));
      let timer; const cancelled = await runner.runSource(input, undefined, { onSpawn: () => { timer = setTimeout(() => runner.stop(), 150); } }); clearTimeout(timer);
      assert.equal(cancelled[0].status, 'stopped'); assert.equal(cancelled.length, 1);
    });
  }
  test(`${language}: 기본코드 전체프로그램/함수, 구문 오류와 원본 무수정`, async (t) => {
    const runtime = await runtimePromises[language]; if (!runtime.available) { t.skip(runtime.reason); return; }
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-original-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
    const runner = new LanguageRunner();
    for (const mode of ['stdio', 'function']) {
      const source = starter(language, mode), original = path.join(root, `original-${mode}.txt`); await fs.writeFile(original, source);
      const results = await runner.runSource({ source, language, execution: execution(language, source, mode), examples: [{ input: mode === 'stdio' ? '1 2\n' : '[1,2]', expectedOutput: '3' }], runtime });
      assert.equal(results[0].status, 'passed', JSON.stringify(results)); assert.equal(await fs.readFile(original, 'utf8'), source);
      const invalid = source + '\nthis is invalid syntax !!!';
      const broken = await runner.runSource({ source: invalid, language, execution: execution(language, invalid, mode), examples: [{ input: mode === 'stdio' ? '1 2\n' : '[1,2]', expectedOutput: '3' }], runtime });
      assert.equal(broken[0].status, 'error', JSON.stringify(broken));
    }
  });
  test(`${language}: 함수형 기본자료형/배열과 출력 제한`, async (t) => {
    const runtime = await runtimePromises[language]; if (!runtime.available) { t.skip(runtime.reason); return; }
    const runner = new LanguageRunner();
    for (const [type, value] of [['int[]', [1, -2, 3]], ['long', 9007199254740991], ['double[]', [0.5, -2.25]], ['bool[]', [true, false]], ['string', ' quotes " \\ \n 한글 ']]) {
      const pythonType = type.endsWith('[]') ? `list[${{ long: 'int', double: 'float', bool: 'bool', int: 'int', string: 'str' }[type.slice(0, -2)]}]` : { long: 'int', double: 'float', string: 'str' }[type] || type;
      const nativeType = language === 'python' ? pythonType : language === 'java' ? type.replace('bool', 'boolean').replace('string', 'String') : type;
      const source = functionSource(language, nativeType, language === 'python' ? 'return value' : 'return value;');
      const config = execution(language, source, 'function');
      // Python int annotation cannot distinguish 32-bit/64-bit; the user mapping is explicit.
      if (type === 'long' && language === 'python') { config.function.parameters[0].type = 'long'; config.function.returnType = 'long'; }
      const result = await runner.runSource({ source, language, execution: config, examples: [{ input: JSON.stringify([value]), expectedOutput: JSON.stringify(value) }], runtime });
      assert.equal(result[0].status, 'passed', JSON.stringify(result));
    }
    const source = language === 'python' ? 'while True: print("x"*8192, flush=True)' : language === 'java' ? 'public class Main { public static void main(String[] args) { while(true) System.out.print("x".repeat(8192)); } }' : 'public class Program { public static void Main() { while(true) System.Console.Write(new string(\'x\',8192)); } }';
    const result = await runner.runSource({ source, language, execution: execution(language, source, 'stdio'), examples: [{ input: '', expectedOutput: '' }], runtime }, undefined, { outputBytes: 1024 });
    assert.equal(result[0].status, 'output-limit', JSON.stringify(result)); assert.ok(result[0].actualOutput.length <= 1024);
    const returnsLarge = functionSource(language, language === 'python' ? 'str' : language === 'java' ? 'String' : 'string', language === 'python' ? 'return value * 10000' : language === 'java' ? 'return value.repeat(10000);' : 'return new string(\'x\',10000);');
    const large = await runner.runSource({ source: returnsLarge, language, execution: execution(language, returnsLarge, 'function'), examples: [{ input: '["x"]', expectedOutput: '"x"' }], runtime }, undefined, { outputBytes: 1024 });
    assert.equal(large[0].status, 'output-limit', JSON.stringify(large));
  });
}

test('C# 계획은 SDK csc와 명시 소스만 사용: 프로젝트/restore/빌드 이벤트 없음', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-csharp-plan-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const refs = path.join(directory, 'refs'); await fs.mkdir(refs); await fs.writeFile(path.join(refs, 'System.Runtime.dll'), 'fixture');
  const source = starter('csharp', 'function'), config = confirmExecution('csharp', source, execution('csharp', source, 'function'), [{ input: '[1,2]', expectedOutput: '3' }]);
  const cases = validateExecution('csharp', source, config, [{ input: '[1,2]', expectedOutput: '3' }]);
  const plan = await createPlan({ source, language: 'csharp', execution: config, cases, directory,
    runtime: { dotnet: 'dotnet', compiler: '/sdk/csc.dll', references: refs, tfm: 'net8.0', runtimeVersion: '8.0.0' } });
  assert.equal(plan.compile.args[0], 'exec'); assert.ok(plan.compile.args.includes('-noconfig')); assert.ok(plan.compile.args.includes('-nostdlib+'));
  assert.equal(plan.compile.args.some((arg) => /\.csproj|restore|build/i.test(arg)), false);
  assert.match(buildWrapper('csharp', config.function, cases), /new Solution\(\)\.solution\(1,2\)/);
});
