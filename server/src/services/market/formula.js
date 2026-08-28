/**
 * A tiny arithmetic evaluator, so the pricing rule can live in configuration.
 *
 * The requirement is that the formula be configurable rather than hardcoded.
 * The obvious implementation is `eval`, and it is the wrong one: the formula
 * arrives from an environment variable that an operator — or anything that can
 * write one — controls, and eval would turn a pricing setting into arbitrary
 * code execution inside the API process.
 *
 * So this parses and evaluates a fixed grammar and nothing else:
 *
 *   numbers, + - * / ( ), unary minus
 *   min(a, b, …), max(a, b, …), round(x), floor(x), ceil(x), abs(x)
 *   the named variables the caller supplies, and nothing more
 *
 * An unknown name is an error, not zero. A formula that references a variable
 * this system does not compute is a formula whose author expected something
 * else to happen, and silently substituting 0 would produce a confident price
 * from a misunderstanding.
 */

const FUNCS = {
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  round: (x) => Math.round(x),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
  abs: (x) => Math.abs(x),
};

function tokenize(src) {
  const out = [];
  const re = /\s*(\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|[()+\-*/,])/y;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`unexpected character at ${i}: ${JSON.stringify(src.slice(i, i + 8))}`);
    out.push(m[1]);
    i = re.lastIndex;
  }
  return out;
}

/** Recursive descent: expr → term (('+'|'-') term)*, term → unary (('*'|'/') unary)* */
export function evaluateFormula(source, vars = {}) {
  const t = tokenize(String(source || ''));
  let pos = 0;
  const peek = () => t[pos];
  const eat = (x) => { if (t[pos] !== x) throw new Error(`expected ${x}, found ${t[pos] ?? 'end of formula'}`); pos += 1; };

  function primary() {
    const tok = peek();
    if (tok === undefined) throw new Error('formula ends unexpectedly');
    if (tok === '(') { pos += 1; const v = expr(); eat(')'); return v; }
    if (tok === '-') { pos += 1; return -primary(); }
    if (tok === '+') { pos += 1; return primary(); }
    if (/^\d/.test(tok)) { pos += 1; return Number(tok); }
    if (/^[A-Za-z_]/.test(tok)) {
      pos += 1;
      if (peek() === '(') {
        const fn = FUNCS[tok];
        if (!fn) throw new Error(`unknown function "${tok}"`);
        eat('(');
        const args = [];
        if (peek() !== ')') { args.push(expr()); while (peek() === ',') { pos += 1; args.push(expr()); } }
        eat(')');
        return fn(...args);
      }
      if (!(tok in vars)) {
        throw new Error(`unknown variable "${tok}" — available: ${Object.keys(vars).sort().join(', ')}`);
      }
      const v = Number(vars[tok]);
      if (!Number.isFinite(v)) throw new Error(`variable "${tok}" is not a finite number`);
      return v;
    }
    throw new Error(`unexpected token "${tok}"`);
  }

  function unary() { return primary(); }

  function term() {
    let v = unary();
    for (;;) {
      if (peek() === '*') { pos += 1; v *= unary(); }
      else if (peek() === '/') {
        pos += 1;
        const d = unary();
        if (d === 0) throw new Error('division by zero in formula');
        v /= d;
      } else return v;
    }
  }

  function expr() {
    let v = term();
    for (;;) {
      if (peek() === '+') { pos += 1; v += term(); }
      else if (peek() === '-') { pos += 1; v -= term(); }
      else return v;
    }
  }

  const value = expr();
  if (pos !== t.length) throw new Error(`unexpected trailing "${t.slice(pos).join(' ')}"`);
  if (!Number.isFinite(value)) throw new Error('formula did not produce a finite number');
  return value;
}

/** Check a formula without pricing anything — used by the admin before saving. */
export function validateFormula(source, sampleVars) {
  try { return { ok: true, value: evaluateFormula(source, sampleVars) }; }
  catch (err) { return { ok: false, error: err.message }; }
}
