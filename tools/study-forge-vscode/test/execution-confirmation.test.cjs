/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeSource, confirmExecution, validateExecution, starter } = require('../execution-contract');

for (const language of ['python', 'java', 'csharp']) for (const mode of ['stdio', 'function']) {
  test(`${language}/${mode}: 본문·주석 수정은 확인 유지, 호출 계약·대상·예제 변경은 재확인`, () => {
    const source = starter(language, mode), analysis = analyzeSource(language, source);
    const examples = [{ input: mode === 'function' ? '[1,2]' : '1 2', expectedOutput: '3' }];
    const config = confirmExecution(language, source, { mode, mainClass: analysis.className, function: analysis.candidates[0] }, examples, '/fixture/one');
    const edited = source.replace(' + ', ' - ') + (language === 'python' ? '# comment\n' : '// comment\n');
    assert.doesNotThrow(() => validateExecution(language, edited, config, examples, '/fixture/one'));
    assert.throws(() => validateExecution(language, edited, config, examples, '/fixture/two'), /다시 확인/);
    assert.throws(() => validateExecution(language, edited, config, [{ ...examples[0], expectedOutput: '4' }], '/fixture/one'), /다시 확인/);
    assert.throws(() => validateExecution(language, edited, { ...config, mode: mode === 'function' ? 'stdio' : 'function' }, examples, '/fixture/one'));
    if (mode === 'function') {
      for (const changed of [source.replace('solution', 'renamed'), source.replace(/a: int|int a/, language === 'python' ? 'a: str' : 'long a'), source.replace(/b: int|int b/, language === 'python' ? 'c: int' : 'int c')]) {
        assert.throws(() => validateExecution(language, changed, config, examples, '/fixture/one'), /확인/);
      }
      const mapping = structuredClone(config); mapping.function.returnType = 'long';
      assert.throws(() => validateExecution(language, source, mapping, examples, '/fixture/one'), /확인/);
      if (language === 'python') {
        const helper = 'def helper(x: int) -> int:\n    return x\n';
        assert.doesNotThrow(() => validateExecution(language, helper + edited, config, examples, '/fixture/one'), 'helper insertion must not change selected function identity');
        const untyped = 'def solution(a, b):\n    return a+b\n';
        const mapped = { mode, function: { ...analyzeSource(language, untyped).candidates[0], parameters: [{ name: 'a', type: 'long' }, { name: 'b', type: 'long' }], returnType: 'long' } };
        const confirmed = confirmExecution(language, untyped, mapped, examples);
        assert.doesNotThrow(() => validateExecution(language, untyped.replace('a+b', 'a-b'), confirmed, examples));
        assert.throws(() => validateExecution(language, untyped.replace('a, b', 'a: int, b'), confirmed, examples), /다시 확인/);
      } else {
        assert.throws(() => validateExecution(language, source.replace('public int solution', 'public static int solution'), config, examples, '/fixture/one'), /확인/);
      }
    } else if (language !== 'python') {
      assert.throws(() => validateExecution(language, source.replace(/class (Main|Program)/, 'class Other'), config, examples, '/fixture/one'), /다시 확인/);
    }
  });
}
