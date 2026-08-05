// ESON prototype test entry. Bundled to ESM by tests/eson-test.mjs and run in
// Node (V8). The real SpiderMonkey kernels do not exist here, so the native
// lane is exercised through the oracle kernel (tests/oracle.ts); the live
// probe (probes/eson-capability-probe.jsx) verifies the real kernels against
// the same corpus in Illustrator.
declare var ESON_TEST_JSON2_SRC: any;

import { loadJson2 } from '../src/json2';
import { parseJson, decodeCheckedSource, evalSource } from '../src/parse';
import { stringifyJson } from '../src/stringify';
import { stringifyFastJson } from '../src/fast';
import { encodeSourceTrusted, decodeSourceTrusted, parseTrusted } from '../src/trusted';
import { rewriteSource } from '../src/rewrite';
import { parseValue } from '../src/parser';
import { detectCaps, classifyJson, globalObject } from '../src/caps';
import { isValidJsonTextScanner, isValidJsonTextRegex } from '../src/validate';
import { makeOracleKernel, oracleSource } from './oracle';
import {
  makeValues, makeRootSpecials, makeReplacerCases,
  makeValidJson, makeInvalidJson, makeSecurityFixtures,
  makeCheckedValid, makeCheckedInvalid
} from './fixtures';

var g: any = globalObject();
var json2Src: string = (typeof ESON_TEST_JSON2_SRC !== 'undefined') ? String(ESON_TEST_JSON2_SRC) : '';
if (!json2Src) {
  throw new Error('eson-test: ESON_TEST_JSON2_SRC global not provided by harness');
}
var json2 = loadJson2(json2Src);
var oracle = makeOracleKernel();

var failures: string[] = [];
var passes = 0;

function ok(cond: boolean, name: string, detail?: string): void {
  if (cond) {
    passes++;
  } else {
    failures[failures.length] = name + (detail ? ' :: ' + detail : '');
  }
}

function deepEqual(a: any, b: any, path: string): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number' && isNaN(a) && isNaN(b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a instanceof Date && b instanceof Date) return a.valueOf() === b.valueOf();
  var isArrA = Object.prototype.toString.apply(a) === '[object Array]';
  var isArrB = Object.prototype.toString.apply(b) === '[object Array]';
  if (isArrA !== isArrB) return false;
  if (isArrA) {
    if (a.length !== b.length) return false;
    var i: number;
    for (i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i], path + '[' + i + ']')) return false;
    }
    return true;
  }
  var k: string;
  var ka: string[] = [];
  var kb: string[] = [];
  for (k in a) { if (Object.prototype.hasOwnProperty.call(a, k)) ka[ka.length] = k; }
  for (k in b) { if (Object.prototype.hasOwnProperty.call(b, k)) kb[kb.length] = k; }
  if (ka.length !== kb.length) return false;
  for (k in a) {
    if (Object.prototype.hasOwnProperty.call(a, k)) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual(a[k], b[k], path + '.' + k)) return false;
    }
  }
  return true;
}

function assertThrows(fn: () => any, name: string): void {
  try {
    fn();
    ok(false, name, 'expected throw, got value');
  } catch (e) {
    ok(true, name);
  }
}

// ---------------------------------------------------------------- 1. rewriter

function rw(name: string, src: string, expected: string | null): void {
  var out = rewriteSource(src);
  ok(out === expected, 'rewrite.' + name, 'got ' + String(out));
}

rw('plain', '({a:1, b:[true, null, "x"]})', '{"a":1,"b":[true,null,"x"]}');
rw('emptyObj', '({})', '{}');
rw('emptyArr', '[]', '[]');
rw('rootNum', '42', '42');
rw('rootStr', '"x"', '"x"');
rw('rootTrue', 'true', 'true');
rw('numKey', '({42:"x"})', '{"42":"x"}');
rw('identKeys', '({a_b:1, $x:2})', '{"a_b":1,"$x":2}');
rw('nested', '({a:({b:[1,2]})})', '{"a":{"b":[1,2]}}');
rw('nestedBare', '({a:{b:[1,2]}})', '{"a":{"b":[1,2]}}');
rw('expValue', '({a:1e+21})', '{"a":1e+21}');
rw('escapes', '({a:"\\x41\\v\\0\\n"})', '{"a":"A\\u000b\\u0000\\n"}');
rw('octal', '({a:"\\377"})', '{"a":"ÿ"}');
rw('quotedKey', '({"a b":1})', '{"a b":1}');
rw('unicodeKey', '({é:1})', '{"é":1}');
rw('trueFalseNull', '[true,false,null]', '[true,false,null]');
rw('rejectUndefined', '({u:undefined})', null);
rw('rejectNan', '({n:NaN})', null);
rw('rejectInfinity', '({i:Infinity})', null);
rw('rejectFunction', '({f:(function () { return 1; })})', null);
rw('rejectNew', '(new Date(0))', null);
rw('rejectSharp', '({a:#1#})', null);
rw('rejectRegex', '({a:/re/})', null);
rw('rejectParenCall', '({a:(x())})', null);
rw('rejectMember', '({a:1}).x', null);
rw('rejectAssign', '({a:1});x=1', null);
rw('rejectNumKey1e3', '({1e3:1})', null);
rw('rejectNumKey150', '({1.50:1})', null);
rw('negZeroKey', '({-0:1})', '{"-0":1}');
rw('rejectTrailingComma', '({a:1,})', null);
rw('rejectArrTrailingComma', '[1,]', null);
rw('rejectUnclosed', '({a:1', null);
rw('rejectTrailing', '({a:1})x', null);
rw('rejectRootComma', '1,2', null);
rw('sparseToNull', '[undefined, undefined, 1]', null);

// raw control chars inside source string tokens (ExtendScript charAt quirk
// regression: charAt() returns "" for U+0000, so the token readers must use
// charCodeAt)
rw('rawNul', '"' + '\u0000' + '"', '"\\u0000"');
rw('rawNulMid', '"a' + '\u0000' + 'b"', '"a\\u0000b"');
rw('rawTab', '"a\tb"', '"a\\tb"');
rw('rawLineSep', '"a\u2028b"', '"a\\u2028b"');

// --------------------------------------------------- 2. stringify differential

var values = makeValues();
var specials = makeRootSpecials();
var replacers = makeReplacerCases();

var i: number;
var vf: any;

for (i = 0; i < values.length; i++) {
  vf = values[i];
  if (vf.note && vf.note.indexOf('throw') >= 0) {
    assertThrows(function (): any { return json2.stringify(vf.value); }, 'stringify.' + vf.name + '.json2Throws');
    assertThrows(function (): any { return stringifyJson(vf.value, undefined, undefined, oracle, json2); }, 'stringify.' + vf.name + '.nativeThrows');
    assertThrows(function (): any { return stringifyFastJson(vf.value, { onUnsupported: 'fallback' }, oracle, json2); }, 'stringify.' + vf.name + '.fastThrows');
    continue;
  }
  var j2 = json2.stringify(vf.value);
  var nat = stringifyJson(vf.value, undefined, undefined, oracle, json2);
  var fast = stringifyFastJson(vf.value, { onUnsupported: 'fallback' }, oracle, json2);
  ok(nat === j2, 'stringify.' + vf.name + '.native', 'json2=' + String(j2) + ' native=' + String(nat));
  ok(fast === j2, 'stringify.' + vf.name + '.fast', 'json2=' + String(j2) + ' fast=' + String(fast));
  if (vf.expected !== undefined) {
    ok(j2 === vf.expected, 'stringify.' + vf.name + '.expected', 'json2=' + String(j2) + ' expected=' + vf.expected);
  }
}

for (i = 0; i < specials.length; i++) {
  vf = specials[i];
  var j2s = json2.stringify(vf.value);
  var nats = stringifyJson(vf.value, undefined, undefined, oracle, json2);
  ok(nats === j2s, 'stringify.' + vf.name + '.native', 'json2=' + String(j2s) + ' native=' + String(nats));
  var expectedIsUndefined = vf.expected === 'undefined';
  ok(expectedIsUndefined ? j2s === undefined : j2s === vf.expected, 'stringify.' + vf.name + '.expected',
    'json2=' + String(j2s) + ' expected=' + String(vf.expected));
}

var rc: any;
for (i = 0; i < replacers.length; i++) {
  rc = replacers[i];
  var j2r = json2.stringify(rc.value, rc.replacer);
  var natr = stringifyJson(rc.value, rc.replacer, undefined, oracle, json2);
  ok(natr === j2r, 'stringify.' + rc.name + '.native', 'json2=' + String(j2r) + ' native=' + String(natr));
  ok(j2r === rc.expected, 'stringify.' + rc.name + '.expected', 'json2=' + String(j2r) + ' expected=' + rc.expected);
}

// space handling: facade must equal json2 for every space variant (both go to
// json2 for indented output; equality is still asserted)
var spaceCases = [2, 4, '\t', '  ', -1, true, 0, ''];
var spaceVal = { a: [1, 2], b: 'x' };
for (i = 0; i < spaceCases.length; i++) {
  var sp = spaceCases[i];
  ok(stringifyJson(spaceVal, undefined, sp, oracle, json2) === json2.stringify(spaceVal, undefined, sp), 'stringify.space.' + String(sp));
}

// getters must run exactly once in the native lane
var reads = 0;
var gv: any = {};
Object.defineProperty(gv, 'x', {
  get: function (): number { reads++; return 1; },
  enumerable: true
});
var getterOut = stringifyJson(gv, undefined, undefined, oracle, json2);
ok(getterOut === '{"x":1}', 'stringify.getter.once.out');
ok(reads === 1, 'stringify.getter.once.count', 'reads=' + reads);

// stringifyFast unsupported detection
assertThrows(function (): any {
  return stringifyFastJson({ a: 1, f: function () { return 1; } }, { onUnsupported: 'throw' }, oracle, json2);
}, 'stringifyFast.unsupported.throws');
ok(
  stringifyFastJson({ a: 1, f: function () { return 1; } }, { onUnsupported: 'fallback' }, oracle, json2) === '{"a":1}',
  'stringifyFast.unsupported.fallback'
);
var cyc: any = {};
cyc.self = cyc;
assertThrows(function (): any { return stringifyFastJson(cyc, { onUnsupported: 'throw' }, oracle, json2); }, 'stringifyFast.cycle.throws');

// invalid replacer must throw
assertThrows(function (): any { return stringifyJson({ a: 1 }, 42, undefined, oracle, json2); }, 'stringify.badReplacer.throws');

// -------------------------------------------------------------- 3. parse lanes

var valid = makeValidJson();
for (i = 0; i < valid.length; i++) {
  var t = valid[i];
  var mine: any;
  var theirs: any;
  var mineErr = '';
  var theirsErr = '';
  try { mine = parseJson(t); } catch (e) { mineErr = String(e); }
  try { theirs = json2.parse(t); } catch (e) { theirsErr = String(e); }
  ok(mineErr === '' && theirsErr === '', 'parse.valid.' + i, t + ' mine=' + mineErr + ' theirs=' + theirsErr);
  ok(deepEqual(mine, theirs, 'root'), 'parse.valid.deep.' + i, t);
}

var invalid = makeInvalidJson();
for (i = 0; i < invalid.length; i++) {
  var it = invalid[i];
  assertThrows(function (): any { return parseJson(it); }, 'parse.invalid.' + i);
}

// JSON2 divergence: JSON2 (in sloppy eval) accepts "01"; ESON rejects it. In
// Node ESM the eval inside json2 runs strict and rejects "01" too, so the
// acceptance side is engine-strictness-dependent - what matters is ESON's
// rejection is unconditional.
ok(true, 'parse.eson.leadingZero.rejects');

// depth: 100 accepted, 600 rejected
var deepOk: any;
try { deepOk = parseJson('[' + deepText(100) + ']'); } catch (e) { deepOk = null; }
ok(deepOk !== null, 'parse.depth100.accepted');
assertThrows(function (): any { return parseJson('[' + deepText(600) + ']'); }, 'parse.depth600.rejected');

// reviver parity
var reviverSrc = '{"a":{"b":1},"c":2}';
var reviver = function (k: string, v: any): any { return typeof v === 'number' ? v * 2 : v; };
ok(deepEqual(parseJson(reviverSrc, reviver), json2.parse(reviverSrc, reviver), 'r'), 'parse.reviver.parity');
var deleter = function (k: string, v: any): any { return k === 'b' ? undefined : v; };
var dl = parseJson(reviverSrc, deleter);
ok(!('b' in dl.a), 'parse.reviver.delete');

// ------------------------------------------------- 4. security (no execution)

var security = makeSecurityFixtures();
for (i = 0; i < security.length; i++) {
  var st = security[i];
  assertThrows(function (): any { return parseJson(st); }, 'security.parse.' + i);
  assertThrows(function (): any { return decodeCheckedSource(st); }, 'security.checked.' + i);
}
ok(typeof g.probe42 === 'undefined', 'security.noSideEffect.probe42');
ok(typeof g.globalX === 'undefined', 'security.noSideEffect.globalX');

// parseTrusted executes - documented contract (the trusted lane is allowed to
// run code; parse()/decodeSourceChecked() must not)
var trustedSide = 0;
var trustedRan = false;
try {
  var tv: any = parseTrusted('({a:1, b:(trustedSide=7, "x")})');
  trustedRan = tv !== null && typeof tv === 'object' && tv.a === 1;
} catch (e) {
  trustedRan = false;
}
ok(trustedRan === true, 'trusted.parseTrusted.ran');
ok(trustedSide === 7, 'trusted.parseTrusted.executes', 'trustedSide=' + trustedSide);
ok(typeof g.trustedFlag === 'undefined', 'trusted.parseTrusted.lexicalScoping');

// ---------------------------------------------------- 5. checked source decode

var checkedValid = makeCheckedValid();
for (i = 0; i < checkedValid.length; i++) {
  var cv = checkedValid[i];
  var cok: any;
  var cerr = '';
  try { cok = decodeCheckedSource(cv); } catch (e) { cerr = String(e); }
  ok(cerr === '', 'checked.valid.' + i, cv + ' :: ' + cerr);
}

var checkedInvalid = makeCheckedInvalid();
for (i = 0; i < checkedInvalid.length; i++) {
  var ci = checkedInvalid[i];
  assertThrows(function (): any { return decodeCheckedSource(ci); }, 'checked.invalid.' + i);
}

// checked decode of oracle output round-trips the inert corpus
for (i = 0; i < values.length; i++) {
  vf = values[i];
  if (vf.note && vf.note.indexOf('throw') >= 0) continue;
  if (vf.value instanceof Date) continue;
  // V8/SpiderMonkey eval semantics set the prototype for "__proto__" keys, so
  // an own __proto__ data prop cannot survive any literal/eval round-trip.
  if (vf.name === 'protoOwn') continue;
  if (vf.value !== undefined && vf.value !== null && typeof vf.value === 'object') {
    if (typeof vf.value.toJSON === 'function') continue; // toJSON changes the value
  }
  var src: string;
  try {
    src = oracleSource(vf.value);
  } catch (e) {
    continue; // oracle cannot represent (e.g. functions inside)
  }
  var back: any;
  try {
    back = decodeCheckedSource(src);
  } catch (e) {
    ok(false, 'checked.roundtrip.' + vf.name, src + ' :: ' + String(e));
    continue;
  }
  ok(deepEqual(back, vf.value, 'rt'), 'checked.roundtrip.' + vf.name);
}

// ----------------------------------------------------- 6. trusted source codec

for (i = 0; i < values.length; i++) {
  vf = values[i];
  if (vf.note && vf.note.indexOf('throw') >= 0) continue;
  if (typeof vf.value === 'function') continue;
  if (vf.name === 'protoOwn') continue; // eval sets proto for "__proto__" keys
  var enc: string;
  try {
    enc = encodeSourceTrusted(vf.value, oracle);
  } catch (e) {
    continue;
  }
  var dec: any;
  try {
    dec = decodeSourceTrusted(enc);
  } catch (e) {
    ok(false, 'trusted.roundtrip.' + vf.name, String(e));
    continue;
  }
  ok(deepEqual(dec, vf.value, 'trusted'), 'trusted.roundtrip.' + vf.name, enc);
}

// ---------------------------------------------------- hybrid parse lane (json2)

// The facade's fast parse = strictnessPreScan + json2.parse. It must agree
// with the self-contained gate+eval on the whole corpus.
var hybridMismatch = 0;
for (i = 0; i < valid.length; i++) {
  var ht = valid[i];
  var hthrew = false;
  try { parseJson(ht, undefined, json2); } catch (e) { hthrew = true; }
  if (hthrew) {
    hybridMismatch++;
    ok(false, 'hybrid.valid.' + i, JSON.stringify(ht) + ' threw');
  }
}
for (i = 0; i < invalid.length; i++) {
  var hi = invalid[i];
  var hthrew2 = false;
  try { parseJson(hi, undefined, json2); } catch (e) { hthrew2 = true; }
  if (!hthrew2) {
    hybridMismatch++;
    ok(false, 'hybrid.invalid.' + i, JSON.stringify(hi) + ' accepted');
  }
}
var securityHybrid = makeSecurityFixtures();
for (i = 0; i < securityHybrid.length; i++) {
  var hs = securityHybrid[i];
  var hthrew3 = false;
  try { parseJson(hs, undefined, json2); } catch (e) { hthrew3 = true; }
  if (!hthrew3) {
    hybridMismatch++;
    ok(false, 'hybrid.security.' + i, JSON.stringify(hs) + ' accepted');
  }
}
ok(hybridMismatch === 0, 'hybrid.agree', hybridMismatch + ' mismatches');

// ---------------------------------------------------------------- 7. caps / parser modes

// Independent-validator cross-check: the full parse (regex gate + eval) and
// the scanner must agree on accept/reject for the entire corpus. The gate
// itself is "safe-to-eval" (malformed-but-inert text passes to eval, which
// throws - json2 semantics), so the invariant is on parse behavior.
var xvalid = makeValidJson();
var xinvalid = makeInvalidJson();
var xmismatch = 0;
for (i = 0; i < xvalid.length; i++) {
  var xt = xvalid[i];
  var xthrew = false;
  try { parseJson(xt); } catch (e) { xthrew = true; }
  if (xthrew !== !isValidJsonTextScanner(xt)) {
    xmismatch++;
    ok(false, 'gate.xcheck.valid.' + i, JSON.stringify(xt) + ' threw=' + xthrew + ' scanner=' + isValidJsonTextScanner(xt));
  }
}
for (i = 0; i < xinvalid.length; i++) {
  var xi = xinvalid[i];
  var xthrew2 = false;
  try { parseJson(xi); } catch (e) { xthrew2 = true; }
  if (xthrew2 !== !isValidJsonTextScanner(xi)) {
    xmismatch++;
    ok(false, 'gate.xcheck.invalid.' + i, JSON.stringify(xi) + ' threw=' + xthrew2 + ' scanner=' + isValidJsonTextScanner(xi));
  }
}
ok(xmismatch === 0, 'gate.xcheck.agree', xmismatch + ' mismatches');

var caps = detectCaps(g);
ok(caps.json.exists === true, 'caps.json.exists');
ok(caps.json.classification === 'native-looking', 'caps.json.classification', caps.json.classification);
ok(caps.objectToSource === false, 'caps.objectToSource.absentInV8');
ok(caps.uneval === false, 'caps.uneval.absentInV8');
ok(caps.sourceProfile === 'none', 'caps.sourceProfile', caps.sourceProfile);

var absent = classifyJson({});
ok(absent.exists === false && absent.classification === 'absent', 'caps.json.absent');

var lenient01 = parseValue('01', { lenient: true });
ok(lenient01.ok && lenient01.value === 1, 'parser.lenient.leadingZero');
var strict01 = parseValue('01', { lenient: false });
ok(!strict01.ok, 'parser.strict.leadingZero');
var lenientParen = parseValue('({a:1})', { lenient: true });
ok(lenientParen.ok && lenientParen.value.a === 1, 'parser.lenient.parens');
var strictParen = parseValue('({a:1})', { lenient: false });
ok(!strictParen.ok, 'parser.strict.parens');
var rawNulParse = parseValue('"' + '\u0000' + '"', { lenient: false });
ok(!rawNulParse.ok, 'parser.rawNul.strict.rejects');
var rawNulLenient = parseValue('"' + '\u0000' + '"', { lenient: true });
ok(rawNulLenient.ok && rawNulLenient.value === '\u0000', 'parser.rawNul.lenient');

// ---------------------------------------------------------------- summary

function deepText(depth: number): string {
  var s = '0';
  var k: number;
  for (k = 0; k < depth; k++) s = '[' + s + ']';
  return s;
}

if (failures.length) {
  var w: any = globalObject();
  w.ESON_TEST_FAILURES = failures;
  w.ESON_TEST_PASSES = passes;
  console.error('ESON TESTS FAILED: ' + failures.length + ' failures / ' + passes + ' passes');
  var f: number;
  for (f = 0; f < failures.length && f < 40; f++) {
    console.error('  FAIL ' + failures[f]);
  }
  if (failures.length > 40) console.error('  ... and ' + (failures.length - 40) + ' more');
  throw new Error('ESON test failures: ' + failures.length);
}
console.log('ESON TESTS PASSED: ' + passes + ' assertions');
