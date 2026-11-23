// Minimal Vitest-globals stand-in: describe/it/test/expect with the matchers DIRA LEARN's pure tests use.
import { isDeepStrictEqual, inspect } from 'node:util';
const results = { pass: 0, fail: 0, failures: [] };
const stack = [];
const queue = [];
globalThis.describe = (name, fn) => { stack.push(name); fn(); stack.pop(); };
globalThis.it = globalThis.test = (name, fn) => queue.push({ name: [...stack, name].join(' > '), fn });
const deepEq = (a, b) => isDeepStrictEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null))) && (a === undefined) === (b === undefined) || isDeepStrictEqual(a, b);
function matchers(actual, neg) {
  const chk = (ok, msg) => { if (neg ? ok : !ok) throw new Error((neg ? 'NOT ' : '') + msg); };
  return {
    toBe: (e) => chk(Object.is(actual, e), `expected ${inspect(actual)} toBe ${inspect(e)}`),
    toEqual: (e) => chk(deepEq(actual, e), `expected ${inspect(actual, { depth: 5 })} toEqual ${inspect(e, { depth: 5 })}`),
    toBeNull: () => chk(actual === null, `expected ${inspect(actual)} toBeNull`),
    toContain: (e) => chk(actual != null && actual.includes(e), `expected ${inspect(actual)} toContain ${inspect(e)}`),
    toHaveLength: (n) => chk(actual?.length === n, `expected length ${actual?.length} toHaveLength ${n}`),
    toMatch: (re) => chk(typeof re === 'string' ? String(actual).includes(re) : re.test(String(actual)), `expected ${inspect(actual)} toMatch ${re}`),
    toBeGreaterThan: (n) => chk(actual > n, `expected ${actual} > ${n}`),
    toThrow: (m) => { let threw = false, err; try { actual(); } catch (e) { threw = true; err = e; }
      chk(threw && (m === undefined || (m instanceof RegExp ? m.test(err.message) : String(err.message).includes(m))), `expected function toThrow ${m ?? ''}`); },
  };
}
globalThis.expect = (actual) => { const m = matchers(actual, false); m.not = matchers(actual, true); return m; };
export async function run(label) {
  for (const t of queue) {
    try { await t.fn(); results.pass++; } catch (e) { results.fail++; results.failures.push(`${t.name}: ${e.message}`); }
  }
  const tag = results.fail ? 'FAIL' : 'PASS';
  console.log(`${tag} ${label.padEnd(48)} ${results.pass}/${results.pass + results.fail}`);
  for (const f of results.failures) console.log('     - ' + f.slice(0, 400));
  process.exitCode = results.fail ? 1 : 0;
}
