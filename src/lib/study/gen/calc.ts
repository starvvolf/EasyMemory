// 계산 확인 (Recaller 심화 문제, 2026-10-24): every step of a worked solution carries an expression and the value it
// claims; this evaluates the expression and compares. Numbers, + − × ÷ ^, parentheses, vectors (a, b, c) and a few
// functions only. No eval: a hand-written parser, so model text is never run as code.

export type Value = number | number[];

const FUNCS: Record<string, (...a: Value[]) => Value> = {
  sqrt: (x) => Math.sqrt(num(x)), abs: (x) => Math.abs(num(x)), round: (x) => Math.round(num(x)),
  sin: (x) => Math.sin(num(x)), cos: (x) => Math.cos(num(x)), tan: (x) => Math.tan(num(x)),
  sind: (x) => Math.sin(num(x) * Math.PI / 180), cosd: (x) => Math.cos(num(x) * Math.PI / 180), tand: (x) => Math.tan(num(x) * Math.PI / 180),
  atan2: (y, x) => Math.atan2(num(y), num(x)), min: (...a) => Math.min(...a.map(num)), max: (...a) => Math.max(...a.map(num)),
  dot: (a, b) => { const u = vec(a), v = vec(b, u.length); return u.reduce((s, x, i) => s + x * v[i], 0); },
  cross: (a, b) => { const u = vec(a, 3), v = vec(b, 3); return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]].map((x) => x + 0); },
  norm: (a) => Math.hypot(...vec(a)), log: (x) => Math.log(num(x)), exp: (x) => Math.exp(num(x)),
};
const CONSTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E };

function num(v: Value): number { if (typeof v !== "number") throw new Error("숫자가 와야 할 자리에 벡터가 있어요."); return v; }
function vec(v: Value, n?: number): number[] {
  if (!Array.isArray(v)) throw new Error("벡터가 와야 할 자리에 숫자가 있어요.");
  if (n !== undefined && v.length !== n) throw new Error(`벡터 길이가 ${n}이 아니에요.`);
  return v;
}
function op(a: Value, b: Value, f: (x: number, y: number) => number, name: string): Value {
  if (typeof a === "number" && typeof b === "number") return f(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (name === "*" || name === "/") throw new Error("벡터끼리는 dot()이나 cross()로 곱해요.");
    if (a.length !== b.length) throw new Error("길이가 다른 벡터끼리 더하거나 뺄 수 없어요.");
    return a.map((x, i) => f(x, b[i]));
  }
  if (name === "+" || name === "-") throw new Error("숫자와 벡터는 더하거나 뺄 수 없어요.");
  if (Array.isArray(a)) return a.map((x) => f(x, b as number));
  if (name === "/") throw new Error("숫자를 벡터로 나눌 수 없어요.");
  return (b as number[]).map((y) => f(a, y));
}

/** Text as models write it (×, ·, −, ², unicode fractions are not supported) into tokens. */
function tokens(src: string) {
  const s = src.replace(/[−–]/g, "-").replace(/[×·∙]/g, "*").replace(/÷/g, "/").replace(/²/g, "^2").replace(/³/g, "^3").replace(/\s+/g, "");
  const out: string[] = [];
  for (let i = 0; i < s.length;) {
    const rest = s.slice(i);
    const m = /^(\d+\.?\d*(?:e[-+]?\d+)?|\.\d+)/i.exec(rest) ?? /^([A-Za-zπ_][A-Za-z0-9_]*)/.exec(rest);
    if (m) { out.push(m[1]); i += m[1].length; continue; }
    if ("+-*/^(),".includes(s[i])) { out.push(s[i]); i++; continue; }
    throw new Error(`읽을 수 없는 글자 '${s[i]}'`);
  }
  return out;
}

export function evaluate(src: string, vars: Record<string, Value> = {}): Value {
  const t = tokens(src);
  let i = 0;
  const peek = () => t[i];
  const take = (x?: string) => { const v = t[i++]; if (x !== undefined && v !== x) throw new Error(`'${x}'가 있어야 해요.`); return v; };
  const expr = (): Value => {
    let v = term();
    while (peek() === "+" || peek() === "-") { const o = take(); const r = term(); v = op(v, r, o === "+" ? (a, b) => a + b : (a, b) => a - b, o); }
    return v;
  };
  const term = (): Value => {
    let v = unary();
    for (;;) {
      if (peek() === "*" || peek() === "/") { const o = take(); const r = unary(); v = op(v, r, o === "*" ? (a, b) => a * b : (a, b) => { if (b === 0) throw new Error("0으로 나눴어요."); return a / b; }, o); }
      // Implicit multiplication: 2(3+1), 2pi, (a)(b).
      else if (peek() === "(" || (peek() !== undefined && /^[A-Za-zπ_\d.]/.test(peek()!))) { const r = unary(); v = op(v, r, (a, b) => a * b, "*"); }
      else return v;
    }
  };
  const unary = (): Value => {
    if (peek() === "-") { take(); const v = unary(); return typeof v === "number" ? -v : v.map((x) => -x); }
    if (peek() === "+") { take(); return unary(); }
    return power();
  };
  const power = (): Value => {
    const base = primary();
    if (peek() === "^") { take(); return Math.pow(num(base), num(unary())); }
    return base;
  };
  const primary = (): Value => {
    const tok = take();
    if (tok === undefined) throw new Error("식이 끝나지 않았어요.");
    if (/^(\d|\.)/.test(tok)) return Number(tok);
    if (tok === "(") {
      const items = [expr()];
      while (peek() === ",") { take(); items.push(expr()); }
      take(")");
      if (items.length === 1) return items[0];
      return items.map(num);
    }
    if (/^[A-Za-zπ_]/.test(tok)) {
      if (peek() === "(" && FUNCS[tok]) {
        take("(");
        const args: Value[] = peek() === ")" ? [] : [expr()];
        while (peek() === ",") { take(); args.push(expr()); }
        take(")");
        return FUNCS[tok](...args);
      }
      if (tok in vars) return vars[tok];
      if (tok in CONSTS) return CONSTS[tok];
      throw new Error(`모르는 이름 '${tok}'`);
    }
    throw new Error(`'${tok}' 자리가 이상해요.`);
  };
  const v = expr();
  if (i < t.length) throw new Error(`'${t[i]}' 뒤를 읽지 못했어요.`);
  return v;
}

/** Tolerance from how the claimed value is written: "0.30" allows ±0.005, "4" allows ±0.5e-6 relative. */
function tolerance(written: string) {
  const d = /\.(\d+)/.exec(written)?.[1].length;
  return d !== undefined ? 0.5 * Math.pow(10, -d) + 1e-9 : 1e-6;
}
/** A claimed value as models write it: "$(0,0,2)$", "\\left(1, 2\\right)", "0.30 " → plain text the calculator reads. */
export function plainValue(claimed: string) {
  return claimed.replace(/\$/g, "").replace(/\\[dt]frac/g, "\\frac").replace(/\\sqrt\s*(\d+(?:\.\d+)?)/g, "sqrt($1)").replace(/\\mathbf\{([^{}]*)\}/g, "$1").replace(/\\left|\\right|\\,|\\!|\\;/g, "").replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)").replace(/\\sqrt\{([^{}]+)\}/g, "sqrt($1)").replace(/\\cdot|\\times/g, "*").trim();
}
export function sameValue(got: Value, claimedRaw: string): boolean {
  const claimed = plainValue(claimedRaw);
  let want: Value;
  try { want = evaluate(claimed); } catch { return false; }
  const tol = tolerance(claimed);
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 1e-9);
  if (typeof got === "number" && typeof want === "number") return close(got, want);
  if (Array.isArray(got) && Array.isArray(want)) return got.length === want.length && got.every((x, k) => close(x, want[k] as number));
  return false;
}

export type Step = { what: string; expr: string; value: string; name?: string | null };
export type StepCheck = { index: number; ok: boolean; got?: string; problem?: string };
/**
 * Checks a worked solution step by step. A step may name its result (name: "z1") and later steps use it. Steps with
 * no expression (a judgement in words) are skipped here; the blind solve checks those.
 */
export function checkSteps(steps: Step[]): StepCheck[] {
  const vars: Record<string, Value> = {};
  const show = (v: Value) => Array.isArray(v) ? `(${v.map((x) => +x.toFixed(6)).join(", ")})` : String(+v.toFixed(6));
  return steps.map((s, index) => {
    if (!s.expr.trim()) return { index, ok: true };
    try {
      const got = evaluate(s.expr, vars);
      if (s.name?.trim()) vars[s.name.trim()] = got;
      return sameValue(got, s.value) ? { index, ok: true, got: show(got) } : { index, ok: false, got: show(got), problem: `${index + 1}단계: ${s.expr} = ${show(got)}인데 ${s.value}라고 적었어요.` };
    } catch (error) {
      return { index, ok: false, problem: `${index + 1}단계 식을 계산하지 못했어요: ${error instanceof Error ? error.message : String(error)}` };
    }
  });
}
