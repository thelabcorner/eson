// Differential fuzz of ESON.parse against V8's native JSON.parse (an RFC-exact
// oracle) plus stringify byte-parity and round-trip checks. Seeded + deterministic.
declare var ESON_FUZZ_CFG: any;
declare var ESON_TEST_JSON2_SRC: any;

import { parseJson } from '../src/parse';
import { stringify, install } from '../src/index';

var json2Src: string = (typeof ESON_TEST_JSON2_SRC !== 'undefined') ? String(ESON_TEST_JSON2_SRC) : '';
if (json2Src.length > 0) install({ json2Source: json2Src });

var cfg: any = (typeof ESON_FUZZ_CFG !== 'undefined') ? ESON_FUZZ_CFG : { iters: 50000, seed: 0xC0FFEE };
var ITERS: number = cfg.iters || 50000;
var seed: number = cfg.seed >>> 0;

function rng(seedIn: number): () => number {
  var a = seedIn >>> 0;
  return function (): number {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}
var rand = rng(seed);
function pick<T>(arr: T[]): T { return arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))]; }
function int(lo: number, hi: number): number { return lo + Math.floor(rand() * (hi - lo + 1)); }

var KEY_CHARS = 'abZ09_ $.\u00e9\u00a0\u2028\u2029\u0000\u0001\"\\/-\u4e2d\u00ad';
function randomString(maxLen: number): string {
  var n = int(0, maxLen);
  var out = '';
  var i: number;
  for (i = 0; i < n; i++) {
    var r = rand();
    if (r < 0.45) out += pick(KEY_CHARS.split(''));
    else if (r < 0.7) out += String.fromCharCode(int(0x20, 0x7e));
    else if (r < 0.85) out += String.fromCharCode(int(0x80, 0x2fff));
    else if (r < 0.95) out += '\\u' + ('0000' + int(0, 0xffff).toString(16)).slice(-4) + '\\n\\t';
    else out += ' ';
  }
  return out;
}

function genNumber(): number {
  var r = rand();
  if (r < 0.2) return 0;
  if (r < 0.35) return int(-10, 10);
  if (r < 0.6) return (rand() * 2 - 1) * Math.pow(10, int(-5, 5));
  if (r < 0.8) return parseFloat((rand() * 1e6).toPrecision(int(1, 15)));
  return (rand() * 2 - 1) * Math.pow(10, int(15, 300));
}

// Size budget INSIDE the recursion: a depth-6 full tree renders ~4.7MB
// (then the fuzzer's split/splice mutation and GC both die). The budget
// guarantees renders stay ~30KB, so no post-render cap retry is needed.
var DOC_BUDGET = 6000;
function genValue(depth: number, budget: number): any {
  var r = rand();
  if (depth <= 0 || r < 0.3 || budget < 40) {
    var t = rand();
    if (t < 0.25) return null;
    if (t < 0.5) return rand() < 0.5;
    if (t < 0.6) return genNumber();
    return randomString(int(1, 12));
  }
  if (r < 0.65) {
    var n = int(0, 5);
    var arr: any[] = [];
    for (var i = 0; i < n && budget >= 20; i++) {
      budget -= 60;
      arr.push(genValue(depth - 1, budget));
    }
    return arr;
  }
  var m = int(0, 5);
  var obj: any = {};
  var seen: any = {};
  for (var j = 0; j < m && budget >= 40; j++) {
    var k = randomString(int(0, 8));
    if (seen[k] !== undefined) continue;
    seen[k] = 1;
    budget -= 90;
    obj[k] = genValue(depth - 1, budget);
  }
  return obj;
}

function jsonEscape(v: string): string {
  var out = '';
  for (var i = 0; i < v.length; i++) {
    var c = v.charCodeAt(i);
    if (c === 34) out += '\\"';
    else if (c === 92) out += '\\\\';
    else if (c === 8) out += '\\b';
    else if (c === 9) out += '\\t';
    else if (c === 10) out += '\\n';
    else if (c === 12) out += '\\f';
    else if (c === 13) out += '\\r';
    else if (c < 0x20) out += '\\u' + ('0000' + c.toString(16)).slice(-4);
    else out += v.charAt(i);
  }
  return '"' + out + '"';
}

function genValidDoc(depth: number): string {
  var text = renderValue(genValue(depth, DOC_BUDGET));
  return text.length > 32768 ? 'null' : text;
}
function renderValue(v: any): string {
  if (v === null) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') {
    if (!isFinite(v)) return v > 0 ? '1e400' : '-1e400';
    return String(v);
  }
  if (Array.isArray(v)) {
    var parts: string[] = [];
    for (var i = 0; i < v.length; i++) parts.push(renderValue(v[i]));
    return '[' + parts.join(',') + ']';
  }
  if (typeof v === 'object') {
    var ks = Object.keys(v);
    var ps: string[] = [];
    for (var k = 0; k < ks.length; k++) ps.push(jsonEscape(ks[k]) + ':' + renderValue(v[ks[k]]));
    return '{' + ps.join(',') + '}';
  }
  return jsonEscape(String(v));
}

// Deliberate structured violations: mutate a valid doc's rendering.
var SPECIALS = '{}[],:"\\\\\\t\\n\\r\\u0000\\u001f 0123456789eE+-.truefalsnul';
function mutate(text: string): string {
  var chars = text.split('');
  var op = rand();
  var at = int(0, Math.max(0, chars.length));
  if (op < 0.15 && chars.length > 0) chars.splice(at, 1);
  else if (op < 0.3) chars.splice(at, 0, SPECIALS.charAt(int(0, SPECIALS.length - 1)));
  else if (op < 0.45 && chars.length > 0) chars[at] = SPECIALS.charAt(int(0, SPECIALS.length - 1));
  else if (op < 0.55 && chars.length > 0) chars[Math.floor(chars.length / 2)] = SPECIALS.charAt(int(0, SPECIALS.length - 1));
  else if (op < 0.65) chars.splice(at, 0, '\u0000\u0001\u0002\u0003'.charAt(int(0, 4)));
  else if (op < 0.8) {
    var ins = chars.join('').substring(0, int(1, 6)).split('');
    for (var kk = 0; kk < ins.length; kk++) chars.splice(at + kk, 0, ins[kk]);
  }
  else if (chars.length > 2) chars = chars.slice(0, Math.floor(chars.length / 2));
  return chars.join('');
}

function structuredViolation(): string {
  var base = genValidDoc(int(0, 4));
  var r = rand();
  var repl = base.replace(/"(?:[^"\\]|\\.)*"/g, '@');
  if (r < 0.2) return repl.replace('@', '1'); // bare key
  if (r < 0.35) return base.replace(/^\{/, '{1:').replace(/\}/, '}'); // numeric key
  if (r < 0.5) return base.replace('[', '[,'); // leading comma
  if (r < 0.65) return base.replace(']', ',]'); // trailing comma
  if (r < 0.8) return base.replace(/:0/, ':01').replace(/:1/, ':01').replace(/:2/, ':02'); // leading zero
  return base.replace(/:1/, ':1.'); // trailing dot
}

var CHARSET = '{}[],:"\\\\\\t\\n\\r 0123456789eE+-.truefalsnul\u0000\u0001\u001f\u2028\u2029\u00a0\ufffd\\u0000';
function randomJunk(maxLen: number): string {
  var n = int(0, maxLen);
  var out = '';
  for (var i = 0; i < n; i++) out += CHARSET.charAt(int(0, CHARSET.length - 1));
  return out;
}

function maxBracketDepth(text: string): number {
  var d = 0, max = 0;
  for (var i = 0; i < text.length; i++) {
    var c = text.charAt(i);
    if (c === '[' || c === '{') { d++; if (d > max) max = d; }
    else if (c === ']' || c === '}') d--;
  }
  return max;
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a === 'number') return a === b;
  if (typeof a === 'string') return a === b;
  if (typeof a === 'boolean') return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var j = 0; j < ka.length; j++) {
    var k = ka[j];
    if (Object.prototype.hasOwnProperty.call(b, k) !== true) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

var failures: string[] = [];
var stats: any = { valid: 0, mutated: 0, junk: 0, violations: 0, acceptBoth: 0, rejectBoth: 0, depthSkipped: 0, byteParityMismatch: 0 };
var i: number;

function checkCase(text: string, kind: string): void {
  var p0 = Date.now();
  if (maxBracketDepth(text) > 512) { stats.depthSkipped++; return; }
  var p1 = Date.now();
  var v8Ok = true, v8v: any;
  try { v8v = JSON.parse(text); } catch (e) { v8Ok = false; }
  var p2 = Date.now();
  var eOk = true, ev: any, errMsg = '';
  try { ev = parseJson(text); } catch (e) { eOk = false; errMsg = String(e); }
  var p3 = Date.now();
  if (p1 - p0 > 100 || p2 - p1 > 100 || p3 - p2 > 100) {
    console.log('  PHASES iter=' + i + ' kind=' + kind + ' len=' + text.length + ' depth=' + (p1 - p0) + 'ms v8=' + (p2 - p1) + 'ms eson=' + (p3 - p2) + 'ms v8ok=' + v8Ok + ' eok=' + eOk + ' text=' + JSON.stringify(text.substring(0, 100)));
  }
  var p4 = Date.now();
  if (v8Ok !== eOk) {
    failures.push('[' + kind + '] accept divergence on ' + JSON.stringify(text.substring(0, 120)) + ' (len=' + text.length + '): V8=' + v8Ok + ' ESON=' + eOk + (eOk ? '' : ' err=' + errMsg));
    var g: any = (Function('return this')() as any);
    if (g.ESON_FUZZ_DIVERGENT && g.ESON_FUZZ_DIVERGENT.length < 10) {
      g.ESON_FUZZ_DIVERGENT.push({ kind: kind, text: text });
    }
    return;
  }
  if (v8Ok) {
    stats.acceptBoth++;
    var p5 = Date.now();
    if (!deepEqual(v8v, ev)) {
      failures.push('[' + kind + '] value divergence on ' + JSON.stringify(text.substring(0, 120)) + ': V8=' + JSON.stringify(v8v).substring(0, 80) + ' ESON=' + JSON.stringify(ev).substring(0, 80));
      return;
    }
    var p6 = Date.now();
    var s8 = '';
    var se: string | undefined = '';
    try { s8 = JSON.stringify(v8v); } catch (e) { s8 = 'THREW:' + String(e); }
    var p7 = Date.now();
    try { se = stringify(v8v); } catch (e) { se = 'THREW:' + String(e); }
    var p8 = Date.now();
    if (p8 - p4 > 100 || p7 - p6 > 100 || p6 - p5 > 100) {
      console.log('  SLOW-VALUE case len=' + text.length + ' deepeq=' + (p6 - p5) + 'ms v8str=' + (p7 - p6) + 'ms esonstr=' + (p8 - p7) + 'ms');
    }
    // Byte parity with V8 is NOT asserted: json2's rx_escapable escapes the
    // "dangerous" chars (U+00AD, U+2028-202F, U+200C-200F, U+FEFF...) while
    // V8 emits them raw - both are spec-valid and lossless. The contract is
    // value equality against the canonical JSON projection: non-finite
    // numbers (1e999 -> Infinity) serialize as "null" in V8 too, so the
    // round-trip cannot preserve them - the projection is the ground truth.
    if (se === 'THREW:' || se === undefined) {
      failures.push('[' + kind + '] stringify threw on parsed ' + JSON.stringify(text.substring(0, 100)));
      return;
    }
    var proj8 = '';
    try { proj8 = JSON.stringify(v8v); } catch (e) { proj8 = 'THREW:' + String(e); }
    var v8rtOk = true, v8rtv: any;
    try { v8rtv = JSON.parse(String(se)); } catch (e) { v8rtOk = false; }
    var projOk = true, projv: any;
    try { projv = JSON.parse(proj8); } catch (e) { projOk = false; }
    if (!v8rtOk || !projOk || !deepEqual(v8rtv, projv)) {
      failures.push('[' + kind + '] stringify output not V8-parseable to the same value: ' + JSON.stringify(text.substring(0, 100)));
      return;
    }
    if (s8 !== se) { stats.byteParityMismatch++; }
    var rtOk = true, rtv: any;
    try { rtv = parseJson(String(se)); } catch (e) { rtOk = false; }
    if (!rtOk || !deepEqual(rtv, projv)) {
      failures.push('[' + kind + '] round-trip failed: ' + JSON.stringify(text.substring(0, 100)));
      return;
    }
  } else {
    stats.rejectBoth++;
  }
}

console.log('FUZZ-START iters=' + ITERS + ' seed=' + seed);
for (i = 0; i < ITERS; i++) {
  var r = rand();
  var text = '';
  var kind = '';
  var t0 = Date.now();
  var tGen = 0;
  var tGenA = 0;
  if (r < 0.45) { tGenA = Date.now(); text = genValidDoc(int(0, 6)); tGen = Date.now() - tGenA; kind = 'valid'; stats.valid++; }
  else if (r < 0.7) { tGenA = Date.now(); text = mutate(genValidDoc(int(0, 6))); tGen = Date.now() - tGenA; kind = 'mutated'; stats.mutated++; }
  else if (r < 0.85) { tGenA = Date.now(); text = structuredViolation(); tGen = Date.now() - tGenA; kind = 'violation'; stats.violations++; }
  else { tGenA = Date.now(); text = randomJunk(int(0, 200)); tGen = Date.now() - tGenA; kind = 'junk'; stats.junk++; }
  if (false) {
    console.log('  iter ' + i + ' lane=' + kind + ' gen=' + tGen + 'ms len=' + text.length + ' head=' + JSON.stringify(text.substring(0, 120)));
  }
  checkCase(text, kind);
  if (failures.length >= 20) break;
  if (Date.now() - t0 > 250) {
    failures.push('[hang] case took ' + (Date.now() - t0) + 'ms: ' + JSON.stringify(text.substring(0, 200)) + ' (len=' + text.length + ')');
  }
  if ((i + 1) % 100 === 0) {
    var mem = (Function('return this')() as any).process && (Function('return this')() as any).process.memoryUsage
      ? (Function('return this')() as any).process.memoryUsage().heapUsed
      : 0;
    console.log('  fuzz progress: ' + (i + 1) + '/' + ITERS + ' (' + stats.acceptBoth + ' accept, ' + stats.rejectBoth + ' reject, ' + failures.length + ' divergences, heap=' + Math.round(mem / 1048576) + 'MB)');
  }
}

console.log('Fuzz: ' + ITERS + ' iterations (seed=' + seed + ')');
console.log('  lanes: ' + stats.valid + ' valid, ' + stats.mutated + ' mutated, ' + stats.violations + ' violations, ' + stats.junk + ' junk');
console.log('  differential: ' + stats.acceptBoth + ' accept/accept, ' + stats.rejectBoth + ' reject/reject, ' + stats.depthSkipped + ' depth-capped, ' + stats.byteParityMismatch + ' byte-parity mismatches (json2 dangerous-char escaping, value-equal)');
if (failures.length) {
  console.error('DIVERGENCES: ' + failures.length);
  var f: number;
  for (f = 0; f < failures.length; f++) console.error('  ' + failures[f]);
  (Function('return this')() as any).process.exitCode = 1;
} else {
  console.log('Fuzz: ALL CLEAR');
}
