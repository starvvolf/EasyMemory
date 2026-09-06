/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash } = require('node:crypto');
const TYPES = ['int', 'long', 'double', 'bool', 'string', 'int[]', 'long[]', 'double[]', 'bool[]', 'string[]'];
const LANGUAGES = ['python', 'csharp', 'java'];
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
function sourceHash(source) { return createHash('sha256').update(source).digest('hex'); }
function cleanCode(source) {
  // Discovery only. Never execute/import source to discover a signature.
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\n]*/g, (text) => text.replace(/[^\n]/g, ' '));
}
function mapType(raw) {
  const text = (raw || '').replace(/\s/g, '');
  const aliases = { int: 'int', long: 'long', float: 'double', double: 'double', bool: 'bool', boolean: 'bool', str: 'string', string: 'string', String: 'string' };
  if (aliases[text]) return aliases[text];
  if (text.endsWith('[]') && aliases[text.slice(0, -2)]) return aliases[text.slice(0, -2)] + '[]';
  const list = /^(?:list|List)\[(\w+)\]$/.exec(text);
  return list && aliases[list[1]] ? aliases[list[1]] + '[]' : '';
}
function analyzeSource(language, source) {
  const hash = sourceHash(source);
  if (!LANGUAGES.includes(language)) return { hash, candidates: [], reason: 'Python, C#, Java만 지원합니다.' };
  const code = cleanCode(source), candidates = [];
  const convertType = (raw) => language !== 'python' && /\bfloat\b/.test(raw || '') ? '' : mapType(raw);
  const classes = [...code.matchAll(/\b(?:public\s+)?(?:static\s+)?class\s+([A-Za-z_]\w*)/g)].map((m) => m[1]);
  const reason = language !== 'python' && (/\b(?:package|namespace)\s/.test(code) || classes.length > 1)
    ? '현재는 package/namespace 없는 단일 클래스만 지원합니다.' : '';
  const pattern = language === 'python' ? /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^:\n]+))?\s*:/gm
    : /\bpublic\s+(static\s+)?([A-Za-z_]\w*(?:\s*\[\])?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
  for (const match of code.matchAll(pattern)) {
    const name = language === 'python' ? match[1] : match[3];
    if (name === 'main' || name === 'Main') continue;
    const rawParams = language === 'python' ? match[2] : match[4];
    let unsupportedReason = '';
    const parameters = rawParams.trim() ? rawParams.split(',').map((part) => {
      const bits = language === 'python' ? /^\s*([A-Za-z_]\w*)\s*(?::\s*([^=]+))?\s*$/.exec(part)
        : /^\s*([A-Za-z_]\w*(?:\s*\[\])?)\s+([A-Za-z_]\w*)\s*$/.exec(part);
      if (!bits) { unsupportedReason = '기본값, 가변 인자, ref/out, 제네릭 인자는 지원하지 않습니다.'; return { name: part.trim(), type: '' }; }
      const rawType = bits[language === 'python' ? 2 : 1], type = convertType(rawType);
      if (rawType?.trim() && !type) unsupportedReason = `인자 자료형 ${rawType.trim()}은 현재 지원하지 않습니다.`;
      return { name: bits[language === 'python' ? 1 : 2], type };
    }) : [];
    const rawReturn = language === 'python' ? match[3] : match[2], returnType = convertType(rawReturn);
    if (rawReturn?.trim() && !returnType) unsupportedReason = `반환 자료형 ${rawReturn.trim()}은 현재 지원하지 않습니다.`;
    candidates.push({ sourceIndex: candidates.length, name, className: language === 'python' ? '' : classes[0] || '', isStatic: language === 'python' || Boolean(match[1]),
      parameters, returnType, unsupportedReason });
  }
  return { hash, candidates, className: classes[0] || '', reason,
    note: '후보는 정적 텍스트 분석입니다. 호출 이름·인자 순서·타입을 확인/수정해야 실행할 수 있습니다.' };
}
function validateValue(value, type, label) {
  if (!TYPES.includes(type)) throw new Error(`${label}: 지원하지 않는 자료형입니다.`);
  if (type.endsWith('[]')) {
    if (!Array.isArray(value) || value.length > 10000) throw new Error(`${label}: 1차원 배열(최대 10,000개)이 필요합니다.`);
    value.forEach((item, index) => validateValue(item, type.slice(0, -2), `${label}[${index}]`)); return;
  }
  const valid = type === 'string' ? typeof value === 'string'
    : type === 'bool' ? typeof value === 'boolean'
      : type === 'double' ? typeof value === 'number' && Number.isFinite(value)
        : Number.isSafeInteger(value) && (type === 'long' || (value >= -2147483648 && value <= 2147483647));
  if (!valid) throw new Error(`${label}: ${type} 값이 필요합니다. 정수는 안전 정수 범위, int는 32비트 범위입니다.`);
}
function validateExecution(language, source, execution, examples) {
  const analysis = analyzeSource(language, source);
  if (!LANGUAGES.includes(language)) throw new Error(analysis.reason);
  if (!execution || !['stdio', 'function'].includes(execution.mode) || execution.confirmedHash !== analysis.hash) throw new Error('현재 코드의 실행 형식과 예제를 먼저 확인하세요. 코드가 바뀌면 다시 확인해야 합니다.');
  if (analysis.reason) throw new Error(analysis.reason);
  if (execution.mode === 'stdio') {
    if (language === 'java' && !identifier.test(execution.mainClass || '')) throw new Error('실행할 Java main 클래스 이름을 확인하세요.');
    return examples;
  }
  const fn = execution.function;
  if (analysis.candidates[fn?.sourceIndex]?.unsupportedReason) throw new Error(analysis.candidates[fn.sourceIndex].unsupportedReason);
  if (!fn || !identifier.test(fn.name) || (language !== 'python' && !identifier.test(fn.className || ''))
    || !Array.isArray(fn.parameters) || fn.parameters.length > 12 || !TYPES.includes(fn.returnType) || typeof fn.isStatic !== 'boolean') throw new Error('함수/클래스 이름, 반환 타입, 정적 여부를 확인하세요.');
  for (const param of fn.parameters) if (!identifier.test(param.name) || !TYPES.includes(param.type)) throw new Error('인자 이름과 지원 자료형을 확인하세요.');
  return examples.map((example, index) => {
    let args, expected;
    try { args = JSON.parse(example.input); expected = JSON.parse(example.expectedOutput); } catch { throw new Error(`예제 ${index + 1}: 입력은 인자 JSON 배열, 기대 출력은 JSON 값으로 입력하세요.`); }
    if (!Array.isArray(args) || args.length !== fn.parameters.length) throw new Error(`예제 ${index + 1}: 인자는 순서대로 ${fn.parameters.length}개가 필요합니다. 배열 인자 하나는 [[1,2]]처럼 입력합니다.`);
    fn.parameters.forEach((param, i) => validateValue(args[i], param.type, `예제 ${index + 1} ${param.name}`));
    validateValue(expected, fn.returnType, `예제 ${index + 1} 기대 출력`);
    return { ...example, args, expected };
  });
}
function starter(language, mode) {
  const templates = {
    python: { stdio: 'a, b = map(int, input().split())\nprint(a + b)\n', function: 'def solution(a: int, b: int) -> int:\n    return a + b\n' },
    csharp: { stdio: 'using System;\npublic class Program {\n    public static void Main() {\n        var parts = Console.ReadLine()!.Split();\n        Console.WriteLine(int.Parse(parts[0]) + int.Parse(parts[1]));\n    }\n}\n', function: 'public class Solution {\n    public int solution(int a, int b) {\n        return a + b;\n    }\n}\n' },
    java: { stdio: 'import java.util.Scanner;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        System.out.println(in.nextInt() + in.nextInt());\n    }\n}\n', function: 'public class Solution {\n    public int solution(int a, int b) {\n        return a + b;\n    }\n}\n' },
  };
  if (!templates[language]?.[mode]) throw new Error('지원하지 않는 기본 코드 형식입니다.');
  return templates[language][mode];
}
module.exports = { TYPES, LANGUAGES, analyzeSource, sourceHash, validateExecution, validateValue, starter };
