/**
 * No code refers to a name that was never declared or imported.
 *
 * A ReferenceError in a React render does not degrade, it blanks the page —
 * and nothing here would notice: the build does not check names, and the
 * server tests never render a page. It has happened three times:
 *
 *   - the product page read `related` after the fetch that set it was removed,
 *     and every product page rendered an empty body;
 *   - the product page read `wasPrice`, which a half-finished change never
 *     defined — every product page again;
 *   - the Discord bot called seven ticket helpers (ticketType, parseTopic, …)
 *     it never imported, so opening, claiming and closing a ticket each died
 *     on the first line that touched one. For seven weeks.
 *
 * So every module in the storefront, the API and the bot is parsed, and every
 * name it uses must be declared in it, imported into it, or be a real global
 * of the place it runs. A new browser or Node API is added to the list below.
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/* The parser comes with the storefront's build (Vite's React plugin). The
   server's own dependencies do not include it, so it is borrowed from there. */
let parse, traverse;
try {
  const req = createRequire(join(root, 'package.json'));
  ({ parse } = req('@babel/parser'));
  traverse = req('@babel/traverse').default;
} catch (e) {
  console.log(`  ❌ @babel/parser is not installed at the repository root (npm install there): ${e.message}`);
  process.exit(1);
}

/* What the language itself provides, everywhere. */
const LANGUAGE = [
  'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'DataView', 'Date', 'Error', 'EvalError', 'Float32Array',
  'Float64Array', 'Infinity', 'Int8Array', 'Int16Array', 'Int32Array', 'Intl', 'JSON', 'Map', 'Math', 'NaN',
  'Number', 'Object', 'Promise', 'Proxy', 'RangeError', 'ReferenceError', 'Reflect', 'RegExp', 'Set', 'String',
  'Symbol', 'SyntaxError', 'TypeError', 'URIError', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array',
  'Uint32Array', 'WeakMap', 'WeakRef', 'WeakSet', 'decodeURI', 'decodeURIComponent', 'encodeURI',
  'encodeURIComponent', 'globalThis', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'undefined',
];
/* What both a browser and Node give a module. */
const COMMON = [
  'AbortController', 'AbortSignal', 'Blob', 'FormData', 'Headers', 'Request', 'Response', 'TextDecoder',
  'TextEncoder', 'URL', 'URLSearchParams', 'atob', 'btoa', 'clearInterval', 'clearTimeout', 'console',
  'crypto', 'fetch', 'performance', 'queueMicrotask', 'setInterval', 'setTimeout', 'structuredClone',
];
const BROWSER = [
  'AudioContext', 'CustomEvent', 'Element', 'Event', 'File', 'FileReader', 'FontFace', 'HTMLElement', 'Image',
  'IntersectionObserver', 'MediaRecorder', 'MediaStream', 'MutationObserver', 'OfflineAudioContext',
  'OffscreenCanvas', 'ResizeObserver', 'alert', 'cancelAnimationFrame', 'confirm', 'createImageBitmap',
  'devicePixelRatio', 'document', 'getComputedStyle', 'history', 'innerHeight', 'innerWidth', 'localStorage',
  'location', 'matchMedia', 'navigator', 'prompt', 'requestAnimationFrame', 'screen', 'sessionStorage', 'window',
  /* Read only behind `typeof process !== 'undefined'` in modules the server
     shares (content/seo.js, lib/legalIdentity.js). */
  'process',
];
const NODE = ['Buffer', 'process', 'global'];

const AREAS = [
  { dir: 'src', globals: new Set([...LANGUAGE, ...COMMON, ...BROWSER]) },
  { dir: 'server/src', globals: new Set([...LANGUAGE, ...COMMON, ...NODE]) },
  { dir: 'discord/src', globals: new Set([...LANGUAGE, ...COMMON, ...NODE]) },
];

const filesIn = (dir) => {
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      if (f === 'node_modules') continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(jsx?|mjs)$/.test(f)) out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
};

for (const { dir, globals } of AREAS) {
  console.log(`\n— ${dir} —`);
  const files = filesIn(join(root, dir));
  const unknown = [];
  let unreadable = 0;
  for (const file of files) {
    let ast;
    try {
      ast = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    } catch (e) {
      unreadable++;
      unknown.push(`${relative(root, file)}: does not parse (${e.message})`);
      continue;
    }
    traverse(ast, {
      Program(path) {
        for (const name of Object.keys(path.scope.globals)) {
          if (!globals.has(name)) unknown.push(`${relative(root, file)}: ${name}`);
        }
      },
    });
  }
  ok(`${files.length} modules read`, files.length > 10 && unreadable === 0, `${unreadable} did not parse`);
  ok('every name used is declared, imported or a real global', unknown.length === 0, `\n      ${unknown.join('\n      ')}`);
}

console.log('\n— No object literal repeats a key —');
{
  /* In an object literal the second of two equal keys silently replaces the
     first. The e-mail template upgrade list had nine ids twice, which threw
     away four of the old bodies it existed to recognise. */
  const dupes = [];
  for (const { dir } of AREAS) {
    for (const file of filesIn(join(root, dir))) {
      let ast;
      try { ast = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] }); } catch { continue; }
      traverse(ast, {
        ObjectExpression(path) {
          const seen = new Map();
          for (const p of path.node.properties) {
            if ((p.type !== 'ObjectProperty' && p.type !== 'ObjectMethod') || p.computed) continue;
            const key = p.key.type === 'Identifier' ? p.key.name : String(p.key.value);
            const kind = p.type === 'ObjectMethod' ? p.kind : 'value';
            const prev = seen.get(key);
            if (prev && !(prev !== 'value' && kind !== 'value' && prev !== kind)) {
              dupes.push(`${relative(root, file)}:${p.loc.start.line} '${key}'`);
            }
            seen.set(key, kind);
          }
        },
      });
    }
  }
  ok('no object literal in the storefront, the API or the bot defines a key twice', dupes.length === 0,
    `\n      ${dupes.join('\n      ')}`);
}

console.log('\n— The check catches what it is for —');
{
  const found = (code) => {
    const names = [];
    traverse(parse(code, { sourceType: 'module', plugins: ['jsx'] }), {
      Program(path) { names.push(...Object.keys(path.scope.globals)); },
    });
    return names;
  };
  ok('a value used in JSX but never defined', found('export const P = () => <b>{wasPrice && 1}</b>;').includes('wasPrice'));
  ok('a helper called but never imported', found('export function f(t) { return isOwnedBy(t, 1); }').includes('isOwnedBy'));
  ok('…while an imported one is fine', !found("import { isOwnedBy } from './x.js'; isOwnedBy(1);").includes('isOwnedBy'));
}

console.log(`\n${fail ? '❌' : '✅'} undeclared-names: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
