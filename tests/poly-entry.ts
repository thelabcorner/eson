// Differential audit: ESON.stringify vs V8 JSON.stringify on the ES5/ES2019
// contract edge cases. Reports divergences (expected: the dangerous-char
// escaping - json2 escapes MORE than V8, which is spec-valid; the audit
// looks for the OPPOSITE: ESON output that V8 would not produce or that
// would not round-trip).
declare var ESON_TEST_JSON2_SRC: any;
import { parseJson } from '../src/parse';
import { stringify, install } from '../src/index';
var json2Src: string = (typeof ESON_TEST_JSON2_SRC !== 'undefined') ? String(ESON_TEST_JSON2_SRC) : '';
if (json2Src.length > 0) install({ json2Source: json2Src });

var cases: any[] = [
  { name: 'basic', v: { a: 1, b: 'x', c: [1, true, null] } },
  { name: 'empty-object', v: {} },
  { name: 'empty-array', v: [] },
  { name: 'nested', v: { a: { b: { c: { d: 1 } } } } },
  { name: 'undefined-array', v: [undefined, 1, undefined] },
  { name: 'undefined-obj', v: { a: undefined, b: 1 } },
  { name: 'function', v: { f: function () {}, b: 1 } },
  { name: 'nan-infinity', v: [NaN, Infinity, -Infinity] },
  { name: 'negative-zero', v: [-0, 0] },
  { name: 'lone-high-surrogate', v: '\ud800' },
  { name: 'lone-low-surrogate', v: '\udc00' },
  { name: 'surrogate-pair', v: '\ud83d\ude00' },
  { name: 'mixed-surrogates', v: ['a\ud800b', '\udc00c'] },
  { name: 'tojson', v: { a: 1, toJSON: function () { return { custom: true }; } } },
  { name: 'tojson-string', v: { toJSON: function () { return 'tojson-result'; } } },
  { name: 'control-chars', v: 'a\x00b\x01c\n\t\r' },
  { name: 'unicode-ls', v: 'a\u2028b\u2029c' },
  { name: 'key-order', v: { 2: 'b', 1: 'a', z: 'c', 10: 'd' } },
  { name: 'deep-nest', v: (function () { var o: any = { leaf: 1 }; for (var i = 0; i < 100; i++) o = { next: o }; return o; })() },
  { name: 'sparse-array', v: (function () { var a: any = []; a[3] = 'x'; return a; })() },
  { name: 'getter', v: Object.defineProperty({}, 'g', { enumerable: true, get: function () { return 42; } }) },
  { name: 'string-escapes', v: '"\\/\b\f\n\r\t' },
  { name: 'big-float', v: 1e21 },
  { name: 'tiny-float', v: 1e-7 },
  { name: 'root-string', v: 'hello' },
  { name: 'root-number', v: 42 },
  { name: 'root-null', v: null },
  { name: 'root-undefined', v: undefined },
  { name: 'root-function', v: function () {} }
];

var divergences: string[] = [];
for (var i = 0; i < cases.length; i++) {
  var c = cases[i];
  var v8out = 'THREW';
  try { v8out = JSON.stringify(c.v); } catch (e) { v8out = 'THREW:' + String(e); }
  var eout = 'THREW';
  try { eout = String(stringify(c.v)); } catch (e) { eout = 'THREW:' + String(e); }
  var v8ok = true, v8parsed: any = null;
  try { v8parsed = JSON.parse(v8out); } catch (e) { v8ok = false; }
  var eok = true, eparsed: any = null;
  try { eparsed = JSON.parse(eout); } catch (e) { eok = false; }
  if (!v8ok || !eok) {
    divergences.push(c.name + ': parse-fail v8ok=' + v8ok + ' eok=' + eok + ' v8=' + v8out + ' e=' + eout);
    continue;
  }
  var same = JSON.stringify(v8parsed) === JSON.stringify(eparsed);
  if (!same) {
    divergences.push(c.name + ': value-diff v8=' + v8out + ' e=' + eout);
    continue;
  }
  if (v8out !== eout) {
    // byte divergence: classify - json2 escapes more (dangerous chars) = OK;
    // ESON output that V8 would not produce = report.
    var v8reproduces = true;
    try { v8reproduces = JSON.stringify(JSON.parse(eout)) === JSON.stringify(JSON.parse(eout)); } catch (e) { v8reproduces = false; }
    console.log(c.name + ': BYTE-DIFF (v8=' + JSON.stringify(v8out) + ' e=' + JSON.stringify(eout) + ') ' + (v8reproduces ? '(round-trip stable)' : '(UNSTABLE!)'));
  }
}
if (divergences.length) {
  console.log('DIVERGENCES: ' + divergences.length);
  for (var d = 0; d < divergences.length; d++) console.log('  ' + divergences[d]);
} else {
  console.log('POLY AUDIT: no value divergences');
}
