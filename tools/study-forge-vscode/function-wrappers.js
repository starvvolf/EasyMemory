function nativeType(type, language) {
  const array = type.endsWith('[]'), base = array ? type.slice(0, -2) : type;
  const mapped = language === 'java' ? { string: 'String', bool: 'boolean' }[base] || base : base;
  return mapped + (array ? '[]' : '');
}
function literal(value, type, language) {
  if (type.endsWith('[]')) return `new ${nativeType(type, language)} {${value.map((v) => literal(v, type.slice(0, -2), language)).join(',')}}`;
  if (type === 'string') {
    const b64 = Buffer.from(value, 'utf8').toString('base64');
    return language === 'java' ? `new String(java.util.Base64.getDecoder().decode("${b64}"), java.nio.charset.StandardCharsets.UTF_8)`
      : `System.Text.Encoding.UTF8.GetString(System.Convert.FromBase64String("${b64}"))`;
  }
  if (type === 'long') return `${value}L`;
  if (type === 'double') return `${value}d`;
  return String(value);
}
function buildWrapper(language, fn, examples) {
  if (language === 'python') return `import json, sys, pathlib, importlib.util
spec = importlib.util.spec_from_file_location("submission", pathlib.Path(__file__).with_name("submission.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
cases = json.loads(pathlib.Path(__file__).with_name("arguments.json").read_text(encoding="utf-8"))
result = getattr(module, ${JSON.stringify(fn.name)})(*cases[int(sys.argv[1])])
pathlib.Path(sys.argv[2]).write_text(json.dumps(result, ensure_ascii=True, allow_nan=False), encoding="utf-8")
`;
  const call = (example) => `${fn.isStatic ? fn.className : `new ${fn.className}()`}.${fn.name}(${example.args.map((v, i) => literal(v, fn.parameters[i].type, language)).join(',')})`;
  if (language === 'csharp') return `using System;
public class StudyForgeHarness {
  public static void Main(string[] args) {
    ${nativeType(fn.returnType, language)} result;
    switch(int.Parse(args[0])) {
      ${examples.map((example, i) => `case ${i}: result = ${call(example)}; break;`).join('\n')}
      default: throw new ArgumentException("Unknown example");
    }
    System.IO.File.WriteAllText(args[1], System.Text.Json.JsonSerializer.Serialize(result), new System.Text.UTF8Encoding(false));
  }
}
`;
  return `import java.nio.file.*;
import java.nio.charset.StandardCharsets;
public class StudyForgeHarness {
  public static void main(String[] args) throws Exception {
    ${nativeType(fn.returnType, language)} result;
    switch(Integer.parseInt(args[0])) {
      ${examples.map((example, i) => `case ${i}: result = ${call(example)}; break;`).join('\n')}
      default: throw new IllegalArgumentException("Unknown example");
    }
    Files.writeString(Path.of(args[1]), json(result), StandardCharsets.UTF_8);
  }
  static String json(Object value) {
    if(value == null) return "null";
    if(value instanceof String) {
      StringBuilder out = new StringBuilder(); out.append((char)34);
      for(char c : ((String)value).toCharArray()) {
        if(c == 34 || c == 92) { out.append((char)92); out.append(c); }
        else if(c < 32) { out.append((char)92); out.append('u'); out.append(String.format("%04x",(int)c)); }
        else out.append(c);
      }
      return out.append((char)34).toString();
    }
    if(value.getClass().isArray()) {
      StringBuilder out = new StringBuilder("[");
      for(int i=0; i<java.lang.reflect.Array.getLength(value); i++) { if(i>0) out.append(','); out.append(json(java.lang.reflect.Array.get(value,i))); }
      return out.append(']').toString();
    }
    if(value instanceof Double && !Double.isFinite((Double)value)) throw new IllegalArgumentException("Non-finite return value");
    return value.toString();
  }
}
`;
}
module.exports = { buildWrapper, nativeType, literal };
