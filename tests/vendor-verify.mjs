import vm from 'node:vm';
import { readFileSync, statSync } from 'node:fs';
const vendor = readFileSync('dist/vendor-eson.js', 'utf8');
console.log('vendor size:', statSync('dist/vendor-eson.js').size, 'bytes');

// 1. Fresh-create path: the vm context inherits the host's JSON, so shadow it
//    with undefined first (ExtendScript truly has no JSON).
const ctx1 = vm.createContext({});
vm.runInContext('JSON = undefined;\n' + vendor, ctx1, { timeout: 10000 });
const J = ctx1.JSON;
console.log('install-1: JSON defined:', typeof J === 'object', '| parse:', typeof J.parse, '| stringify:', typeof J.stringify);
console.log('round-trip:', J.stringify(J.parse('{"a":[1,true,null,"x"]}')) === '{"a":[1,true,null,"x"]}');
console.log('strict 01:', (() => { try { J.parse('[01]'); return 'ACCEPTED'; } catch (e) { return 'rejected'; } })());
console.log('strict 1.:', (() => { try { J.parse('[1.]'); return 'ACCEPTED'; } catch (e) { return 'rejected'; } })());
console.log('strict bare-key:', (() => { try { J.parse('{1:1}'); return 'ACCEPTED'; } catch (e) { return 'rejected'; } })());
console.log('strict trailing comma:', (() => { try { J.parse('[1,]'); return 'ACCEPTED'; } catch (e) { return 'rejected'; } })());
console.log('deep nest cap:', (() => { try { J.parse('['.repeat(600) + ']'.repeat(600)); return 'ACCEPTED'; } catch (e) { return 'rejected'; } })());
console.log('unicode 2028 round-trip:', (() => { const v = J.parse('"a\u2028b"'); return J.stringify(v); })());
console.log('ESON facade exposed:', typeof ctx1.ESON === 'object', '| parse:', typeof ctx1.ESON.parse);
console.log('ESON_JSON2 private:', typeof ctx1.ESON_JSON2 === 'object');

// 2. Pre-existing JSON object (COM wrapper semantics): attach onto it.
const ctx2 = vm.createContext({ JSON: {} });
vm.runInContext(vendor, ctx2, { timeout: 10000 });
console.log('install-2: attached onto existing:', typeof ctx2.JSON.parse === 'function' && typeof ctx2.JSON.stringify === 'function');

// 3. Existing parse/stringify (e.g. ExtendScript's broken native): the vendor
//    REPLACES them - the whole point is the strict ESON parser.
const ctx3 = vm.createContext({ JSON: { parse: (s) => 'NATIVE', stringify: () => 'NATIVE' } });
vm.runInContext(vendor, ctx3, { timeout: 10000 });
console.log('install-3: replaced:', (() => { try { return ctx3.JSON.parse('[01]') === 'NATIVE' ? 'NOT-REPLACED' : 'replaced'; } catch (e) { return 'replaced (rejects)'; } })());

// 4. Reviver works through the installed parse.
const ctx4 = vm.createContext({});
vm.runInContext('JSON = undefined;\n' + vendor, ctx4, { timeout: 10000 });
const rv = ctx4.JSON.parse('{"a":1,"b":2}', (k, v) => (k === 'a' ? 99 : v));
console.log('reviver:', JSON.stringify(rv) === '{"a":99,"b":2}');

console.log('VENDOR VERIFY OK');
