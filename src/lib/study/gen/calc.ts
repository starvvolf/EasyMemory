// 계산 확인 (Recaller 심화 문제, 2026-10-24): every step of a worked solution carries an expression and the value it
// claims; this evaluates the expression and compares. General math only — numbers, + − × ÷ ^, parentheses, vectors
// (a, b, c), matrices ((a, b), (c, d)) as rows, comparisons — and nothing of any one subject: a formula of the material
// (a projection, an interest rate, a pH) is defined by the solution itself as a step `f(x, y)` and then called.
// No eval: a hand-written parser, so model text is never run as code.

export type Value = number | number[] | number[][];
type Mat = number[][];

const isMat = (v: Value): v is Mat => Array.isArray(v) && Array.isArray(v[0]);
const isVec = (v: Value): v is number[] => Array.isArray(v) && !Array.isArray(v[0]);
function mat(v: Value): Mat { if (!isMat(v)) throw new Error("행렬이 와야 할 자리예요."); return v; }
const eye = (n: number): Mat => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
function matmul(a: Mat, b: Mat): Mat {
  if (a[0].length !== b.length) throw new Error(`${a.length}×${a[0].length} 행렬과 ${b.length}×${b[0].length} 행렬은 곱할 수 없어요.`);
  return a.map((row) => b[0].map((_, j) => row.reduce((s, x, k) => s + x * b[k][j], 0) + 0));
}
function matvec(a: Mat, v: number[]): number[] {
  if (a[0].length !== v.length) throw new Error(`${a.length}×${a[0].length} 행렬에 길이 ${v.length} 벡터를 곱할 수 없어요.`);
  return a.map((row) => row.reduce((s, x, k) => s + x * v[k], 0) + 0);
}
function det(a: Mat): number {
  if (a.length !== a[0].length) throw new Error("정사각 행렬이 아니에요.");
  if (a.length === 1) return a[0][0];
  return a[0].reduce((s, x, j) => s + (j % 2 ? -1 : 1) * x * det(a.slice(1).map((r) => r.filter((_, k) => k !== j))), 0);
}
function inverse(a: Mat): Mat {
  const n = a.length;
  if (n !== a[0].length) throw new Error("정사각 행렬이 아니에요.");
  const m = a.map((r, i) => [...r, ...eye(n)[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) throw new Error("역행렬이 없어요.");
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c]; m[c] = m[c].map((x) => x / d);
    for (let r = 0; r < n; r++) if (r !== c) { const f = m[r][c]; m[r] = m[r].map((x, k) => x - f * m[c][k]); }
  }
  return m.map((r) => r.slice(n).map((x) => x + 0));
}
// Exact zeros and ones at right angles (cosd(90) is 0, not 6e-17), so matrices built from them compare cleanly.
const clean = (x: number) => (Math.abs(x) < 1e-12 ? 0 : Math.abs(x - 1) < 1e-12 ? 1 : Math.abs(x + 1) < 1e-12 ? -1 : x);

const FUNCS: Record<string, (...a: Value[]) => Value> = {
  sqrt: (x) => Math.sqrt(num(x)), abs: (x) => Math.abs(num(x)), round: (x) => Math.round(num(x)),
  sin: (x) => Math.sin(num(x)), cos: (x) => Math.cos(num(x)), tan: (x) => Math.tan(num(x)),
  sind: (x) => clean(Math.sin(num(x) * Math.PI / 180)), cosd: (x) => clean(Math.cos(num(x) * Math.PI / 180)), tand: (x) => clean(Math.tan(num(x) * Math.PI / 180)),
  atan2: (y, x) => Math.atan2(num(y), num(x)), min: (...a) => Math.min(...a.map(num)), max: (...a) => Math.max(...a.map(num)),
  dot: (a, b) => { const u = vec(a), v = vec(b, u.length); return u.reduce((s, x, i) => s + x * v[i], 0); },
  cross: (a, b) => { const u = vec(a, 3), v = vec(b, 3); return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]].map((x) => x + 0); },
  norm: (a) => Math.hypot(...vec(a)), log: (x) => Math.log(num(x)), exp: (x) => Math.exp(num(x)),
  // Matrices (rows): transpose, det, inv, eye(n).
  transpose: (a) => { const m = mat(a); return m[0].map((_, j) => m.map((r) => r[j])); }, det: (a) => det(mat(a)), inv: (a) => inverse(mat(a)), eye: (n) => eye(num(n)),
  // Joining: join((1, 2), 1) → (1, 2, 1); join(M, row) adds a row.
  join: (a, b) => { if (isMat(a)) { const r = vec(b, a[0].length); return [...a, r]; } return [...vec(a), ...(typeof b === "number" ? [b] : vec(b))]; },
  // Judgements as numbers (1 true, 0 false), for steps like clipping tests: lt(x, xmin), and(a, b), pick(cond, a, b).
  lt: (a, b) => +(num(a) < num(b)), le: (a, b) => +(num(a) <= num(b) + 1e-9), gt: (a, b) => +(num(a) > num(b)), ge: (a, b) => +(num(a) >= num(b) - 1e-9), eq: (a, b) => +(Math.abs(num(a) - num(b)) < 1e-9),
  and: (...a) => +a.every((x) => num(x) !== 0), or: (...a) => +a.some((x) => num(x) !== 0), not: (a) => +(num(a) === 0), pick: (cond, a, b) => (num(cond) !== 0 ? a : b),
  // Parts: row(M, i) and col(M, j) from 1, at(v, i) from 1.
  row: (m, i) => mat(m)[num(i) - 1], col: (m, j) => mat(m).map((r) => r[num(j) - 1]), at: (v, i) => vec(v)[num(i) - 1],
};
const CONSTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E };

function num(v: Value): number { if (typeof v !== "number") throw new Error("숫자가 와야 할 자리에 벡터가 있어요."); return v; }
function vec(v: Value, n?: number): number[] {
  if (!isVec(v)) throw new Error(typeof v === "number" ? "벡터가 와야 할 자리에 숫자가 있어요." : "벡터가 와야 할 자리에 행렬이 있어요.");
  if (n !== undefined && v.length !== n) throw new Error(`벡터 길이가 ${n}이 아니에요.`);
  return v;
}
function op(a: Value, b: Value, f: (x: number, y: number) => number, name: string): Value {
  if (typeof a === "number" && typeof b === "number") return f(a, b);
  if (isMat(a) || isMat(b)) {
    if (name === "*" && isMat(a) && isMat(b)) return matmul(a, b);
    if (name === "*" && isMat(a) && isVec(b)) return matvec(a, b);
    if (isMat(a) && isMat(b)) { if (a.length !== b.length || a[0].length !== b[0].length) throw new Error("크기가 다른 행렬끼리 더하거나 뺄 수 없어요."); return a.map((r, i) => r.map((x, j) => f(x, b[i][j]))); }
    if (typeof b === "number" && (name === "*" || name === "/")) return mat(a).map((r) => r.map((x) => f(x, b)));
    if (typeof a === "number" && name === "*") return mat(b).map((r) => r.map((x) => f(a, x)));
    throw new Error("이 행렬 계산은 할 수 없어요 (행렬×행렬, 행렬×벡터, 수×행렬만).");
  }
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
    if (s[i] === "[" || s[i] === "]") { out.push(s[i] === "[" ? "(" : ")"); i++; continue; }
    throw new Error(`읽을 수 없는 글자 '${s[i]}'`);
  }
  return out;
}

/** A function a solution defines from the material: `T(tx, ty)` with its body as an expression of the parameters. */
export type Fn = { params: string[]; body: string };
export type Fns = Record<string, Fn>;

export function evaluate(src: string, vars: Record<string, Value> = {}, fns: Fns = {}, depth = 0): Value {
  if (depth > 20) throw new Error("정의한 함수가 너무 깊게 서로를 불러요.");
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
    if (peek() === "-") { take(); const v = unary(); return typeof v === "number" ? -v : isMat(v) ? v.map((r) => r.map((x) => -x + 0)) : v.map((x) => -x + 0); }
    if (peek() === "+") { take(); return unary(); }
    return power();
  };
  const power = (): Value => {
    const base = primary();
    if (peek() === "^") {
      take();
      if (isMat(base)) { const k = num(unary()); let m = eye(base.length); for (let n = 0; n < k; n++) m = matmul(m, base); return m; }
      return Math.pow(num(base), num(unary()));
    }
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
      // Rows of the same length make a matrix: ((1, 0), (0, 1)).
      if (items.every(isVec)) { const rows = items as number[][]; if (rows.some((r) => r.length !== rows[0].length)) throw new Error("행렬의 행 길이가 달라요."); return rows; }
      return items.map(num);
    }
    if (/^[A-Za-zπ_]/.test(tok)) {
      if (peek() === "(" && (fns[tok] || FUNCS[tok])) {
        take("(");
        const args: Value[] = peek() === ")" ? [] : [expr()];
        while (peek() === ",") { take(); args.push(expr()); }
        take(")");
        const fn = fns[tok];
        if (fn) {
          if (args.length !== fn.params.length) throw new Error(`${tok}는 값 ${fn.params.length}개를 받아요.`);
          return evaluate(fn.body, { ...vars, ...Object.fromEntries(fn.params.map((p, k) => [p, args[k]])) }, fns, depth + 1);
        }
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
  // LaTeX matrices: \begin{pmatrix} 1 & 0 \\ 0 & 1 \end{pmatrix} → ((1, 0), (0, 1)).
  claimed = claimed.replace(/\\begin\{[pbv]?matrix\}([\s\S]*?)\\end\{[pbv]?matrix\}/g, (_, body: string) => `(${body.split(/\\\\/).map((r) => r.trim()).filter(Boolean).map((r) => `(${r.split("&").map((x) => x.trim()).join(",")})`).join(",")})`);
  return claimed.replace(/\$/g, "").replace(/\\[dt]frac/g, "\\frac").replace(/\\sqrt\s*(\d+(?:\.\d+)?)/g, "sqrt($1)").replace(/\\mathbf\{([^{}]*)\}/g, "$1").replace(/\\left|\\right|\\,|\\!|\\;/g, "").replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)").replace(/\\sqrt\{([^{}]+)\}/g, "sqrt($1)").replace(/\\cdot|\\times/g, "*").trim();
}
export function sameValue(got: Value, claimedRaw: string): boolean {
  const claimed = plainValue(claimedRaw);
  let want: Value;
  try { want = evaluate(claimed); } catch { return false; }
  const tol = tolerance(claimed);
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 1e-9);
  if (typeof got === "number" && typeof want === "number") return close(got, want);
  if (isMat(got) && isMat(want)) return got.length === want.length && got.every((r, i) => r.length === want[i].length && r.every((x, j) => close(x, want[i][j])));
  if (isVec(got) && isVec(want)) return got.length === want.length && got.every((x, k) => close(x, want[k]));
  return false;
}

/** A value as a person writes it: fractions with small denominators (3/2, -1/6), else at most four decimals. */
export function formatValue(v: Value): string {
  if (Array.isArray(v)) return `(${(v as Array<number | number[]>).map((x) => formatValue(x as Value)).join(", ")})`;
  const x = Math.abs(v) < 1e-12 ? 0 : v;
  if (Number.isInteger(Math.round(x * 1e9) / 1e9) && Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
  for (let q = 2; q <= 64; q++) { const p = Math.round(x * q); if (Math.abs(x - p / q) < 1e-9) return `${p}/${q}`; }
  return String(+x.toFixed(4));
}

export type Step = { what: string; expr: string; value: string; name?: string | null };
const DEFINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)\s*$/;
/** The names and functions a solution's steps define, in order (a step named `f(x)` defines f; others name a value). */
export function stepScope(steps: Step[]) {
  const vars: Record<string, Value> = {};
  const fns: Fns = {};
  /** Each step's computed value (undefined for definitions, judgements in words, and steps that did not compute). */
  const values: Array<Value | undefined> = [];
  for (const s of steps) {
    const def = DEFINE.exec(s.name ?? "");
    if (def && s.expr.trim()) { fns[def[1]] = { params: def[2].split(",").map((p) => p.trim()).filter(Boolean), body: s.expr }; values.push(undefined); continue; }
    let got: Value | undefined;
    if (s.expr.trim()) { try { got = evaluate(s.expr, vars, fns); } catch { /* reported by checkSteps */ } }
    if (got !== undefined && s.name?.trim()) vars[s.name.trim()] = got;
    values.push(got);
  }
  return { vars, fns, values };
}
export type StepCheck = { index: number; ok: boolean; got?: string; problem?: string };
/**
 * Checks a worked solution step by step. A step may name its result (name: "z1") and later steps use it. Steps with
 * no expression (a judgement in words) are skipped here; the blind solve checks those.
 */
export function checkSteps(steps: Step[]): StepCheck[] {
  const vars: Record<string, Value> = {};
  const fns: Fns = {};
  const show = (v: Value): string => isMat(v) ? `(${v.map((r) => show(r)).join(", ")})` : Array.isArray(v) ? `(${v.map((x) => +x.toFixed(6)).join(", ")})` : String(+v.toFixed(6));
  return steps.map((s, index) => {
    if (!s.expr.trim()) return { index, ok: true };
    // A definition is checked where it is used (and by the blind solve against the source), not on its own.
    const def = DEFINE.exec(s.name ?? "");
    if (def) {
      const params = def[2].split(",").map((p) => p.trim()).filter(Boolean);
      if (params.some((p) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p))) return { index, ok: false, problem: `${index + 1}단계: 매개변수 이름이 이상해요 (${def[2]}).` };
      fns[def[1]] = { params, body: s.expr };
      return { index, ok: true };
    }
    try {
      const got = evaluate(s.expr, vars, fns);
      if (s.name?.trim()) vars[s.name.trim()] = got;
      // Left blank, the value is the calculator's to write (filled in afterwards), so there is nothing to compare.
      if (!s.value.trim()) return { index, ok: true, got: show(got) };
      // A named constant set up from the material ("Q = ((4/5, -3/5, 0), …)", value "정의") has nothing to compare.
      if (/^(정의|define)$/i.test(s.value.trim()) && s.name?.trim()) return { index, ok: true, got: show(got) };
      return sameValue(got, s.value) ? { index, ok: true, got: show(got) } : { index, ok: false, got: show(got), problem: `${index + 1}단계: ${s.expr} = ${show(got)}인데 ${s.value}라고 적었어요.` };
    } catch (error) {
      return { index, ok: false, problem: `${index + 1}단계 식을 계산하지 못했어요: ${error instanceof Error ? error.message : String(error)}` };
    }
  });
}
