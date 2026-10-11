/**
 * Every control a customer can reach has a name a screen reader can say.
 *
 * An icon-only button ("✕", a pencil, a copy icon) reads as "button"; a switch
 * drawn from two divs reads as "button" with no state; an input whose visible
 * <label> sits beside it rather than pointing at it reads as "edit text". The
 * store-credit switch at checkout, the six boxes of the login code and the
 * rename field for a signed-in device were all like that.
 *
 * Parsed, not rendered: every <button>, link, <input>, <select> and <textarea>
 * in the customer-facing pages and components must carry text, an aria-label
 * (or labelledby / title), or a <label> that wraps it or points at it. A
 * placeholder does not count — it disappears the moment someone types. An
 * element hidden from assistive technology (aria-hidden, a duplicate link
 * with tabIndex -1) is exempt. The admin console is not covered here.
 *
 * A switch must also say whether it is on: role="switch" with aria-checked.
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let parse, traverse;
try {
  const req = createRequire(join(root, 'package.json'));
  ({ parse } = req('@babel/parser'));
  traverse = req('@babel/traverse').default;
} catch (e) {
  console.log(`  ❌ @babel/parser is not installed at the repository root (npm install there): ${e.message}`);
  process.exit(1);
}

const files = [];
const walk = (p) => {
  if (statSync(p).isDirectory()) { for (const f of readdirSync(p)) walk(join(p, f)); return; }
  if (/\.jsx$/.test(p)) files.push(p);
};
walk(join(root, 'src', 'pages'));
walk(join(root, 'src', 'components'));
const customerFacing = files.filter((f) => !/\/(pages|components)\/admin\//.test(f) && !/Admin[A-Z]?\w*\.jsx$/.test(f));

const nameOf = (n) => (n.type === 'JSXIdentifier' ? n.name
  : n.type === 'JSXMemberExpression' ? `${n.object.name}.${n.property.name}` : '?');
const attr = (el, name) => el.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === name);
const attrValue = (el, name) => {
  const a = attr(el, name);
  if (!a) return undefined;
  if (!a.value) return true;
  if (a.value.type === 'StringLiteral') return a.value.value;
  if (a.value.type === 'JSXExpressionContainer') {
    const x = a.value.expression;
    if (x.type === 'NumericLiteral' || x.type === 'StringLiteral' || x.type === 'BooleanLiteral') return x.value;
    if (x.type === 'UnaryExpression' && x.operator === '-' && x.argument.type === 'NumericLiteral') return -x.argument.value;
    return '{expr}';
  }
  return undefined;
};
/* Does anything inside render text? An expression may (t(...), a value); a
   lower-case element is looked into; a capitalised component is an icon
   unless its name says it carries words. */
const hasText = (el) => {
  for (const c of el.children || []) {
    if (c.type === 'JSXText' && /[\p{L}\p{N}]/u.test(c.value)) return true;
    if (c.type === 'JSXExpressionContainer' && c.expression.type !== 'JSXEmptyExpression') return true;
    if (c.type === 'JSXElement') {
      const n = nameOf(c.openingElement.name);
      if (attrValue(c, 'aria-hidden') === 'true' || attrValue(c, 'aria-hidden') === true) continue;
      if (/^[a-z]/.test(n)) {
        if (n === 'img' && typeof attrValue(c, 'alt') === 'string' && attrValue(c, 'alt') !== '') return true;
        if (hasText(c)) return true;
      } else if (/Mark|Label|Text|Badge|Logo|Trans/.test(n)) return true;
    }
    if (c.type === 'JSXFragment' && hasText(c)) return true;
  }
  return false;
};

const unnamed = [];
const switches = [];
for (const f of customerFacing) {
  const ast = parse(readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
  const labelFor = new Set();
  traverse(ast, { JSXElement(p) {
    if (nameOf(p.node.openingElement.name) === 'label') { const h = attrValue(p.node, 'htmlFor'); if (typeof h === 'string') labelFor.add(h); }
  } });
  traverse(ast, { JSXElement(p) {
    const el = p.node;
    const n = nameOf(el.openingElement.name);
    const where = `${relative(root, f)}:${el.loc.start.line}`;
    const hidden = attrValue(el, 'aria-hidden') === 'true' || attrValue(el, 'aria-hidden') === true;
    if (hidden) return;
    const named = attr(el, 'aria-label') || attr(el, 'aria-labelledby') || attr(el, 'title');
    const inLabel = !!p.findParent((q) => q.isJSXElement() && nameOf(q.node.openingElement.name) === 'label');
    if (['button', 'a', 'Link', 'NavLink'].includes(n)) {
      if (!named && !hasText(el) && !(n === 'button' && inLabel)) unnamed.push(`${where} ${n}`);
      /* A button whose look flips on a boolean and that has no words of its
         own is a switch: two widths, a knob that moves left or right. */
      const cls = attr(el, 'className');
      const knob = (el.children || []).some((c) => c.type === 'JSXElement' && nameOf(c.openingElement.name) === 'span'
        && /left-5|translate-x-5/.test(readFileSync(f, 'utf8').slice(c.start, c.end)));
      if (n === 'button' && cls && knob) switches.push({ where, ok: attrValue(el, 'role') === 'switch' && !!attr(el, 'aria-checked') });
    }
    if (['input', 'select', 'textarea'].includes(n)) {
      const type = attrValue(el, 'type');
      if (['hidden', 'submit', 'button'].includes(type)) return;
      const id = attrValue(el, 'id');
      if (!named && !(typeof id === 'string' && labelFor.has(id)) && !inLabel) unnamed.push(`${where} ${n}${typeof type === 'string' ? `[${type}]` : ''}`);
    }
  } });
}

console.log('\n— Names —');
ok(`${customerFacing.length} customer-facing files read`, customerFacing.length > 50);
ok('every button, link and field has a name', unnamed.length === 0, `\n      ${unnamed.join('\n      ')}`);

console.log('\n— Switches —');
ok(`the switches drawn as buttons were found (${switches.length})`, switches.length >= 3, String(switches.length));
ok('…and every one says it is a switch and whether it is on', switches.every((s) => s.ok),
  switches.filter((s) => !s.ok).map((s) => s.where).join(', '));

console.log('\n— The login code —');
{
  const login = readFileSync(join(root, 'src', 'pages', 'Login.jsx'), 'utf8');
  ok('the six boxes are one named group', /role="group" aria-label=\{t\('ui\.codeGroup'/.test(login));
  ok('…and each box says which digit it is', /aria-label=\{t\('ui\.codeDigit', 'Digit \{n\} of 6', \{ n: i \+ 1 \}\)\}/.test(login));
}

console.log(`\n${fail ? '❌' : '✅'} control-names: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
