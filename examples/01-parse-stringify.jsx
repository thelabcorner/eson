#target illustrator
// ESON example 01: strict JSON.parse / JSON.stringify as a drop-in for the
// global JSON object (runtime build).
//
// Demonstrates: vendor install (global JSON becomes ESON), strict parse,
// reviver support, exact stringify output, pretty printing, and the
// verdict memo (repeat parses of identical text are ~385x faster).
//
// How to run: File > Scripts > Other Script... and pick this file, or
//   python ILLUSTRATOR_COM_TOOL.py eval --file examples/01-parse-stringify.jsx
// The report is written to %TEMP%\esonexample-01-report.json and returned as
// the script's last-statement value.

// --- bootstrap: resolve the ESON build relative to this script ------------
// `$.fileName` is URI-style and may contain %20 -- decode before use.
// Override the location with the ESON_DIST env var when running a copy of
// this example from outside the repo.
var __esonDist = $.getenv('ESON_DIST');
if (!__esonDist) {
  __esonDist = File(decodeURI($.fileName)).parent.parent.fsName.replace(/\\/g, '/') + '/dist';
}
var __vendor = new File(__esonDist + '/vendor-eson-runtime.js');
if (!__vendor.exists) {
  $.writeln('ESON build not found at ' + __vendor.fsName + ' -- run "npm run build" in the eson repo first.');
  throw new Error('ESON build not found: ' + __vendor.fsName);
}
$.evalFile(__vendor); // installs ESON as the global JSON object

var out = { ok: true, checks: [], build: 'vendor-eson-runtime.js' };
function check(name, ok, detail) {
  out.checks.push({ name: name, ok: !!ok, detail: detail });
  if (!ok) out.ok = false;
}

// the vendor install footer replaced global JSON.parse / stringify with ESON's
check('global-json-is-eson', typeof JSON === 'object' && JSON.parse === ESON.parse && JSON.stringify === ESON.stringify);

// --- parse ----------------------------------------------------------------
var cfg = JSON.parse('{"name":"warp-config","bend":35,"flags":[true,null,"x"]}');
check('parse-basics', cfg.name === 'warp-config' && cfg.bend === 35 && cfg.flags[1] === null);

// malformed input THROWS instead of parsing wrong:
var rejects = (function (text) {
  try { JSON.parse(text); return false; } catch (e) { return true; }
});
check('strict-leading-zero', rejects('[01]'), 'json2 accepts [01] as 1');

// reviver, JSON.parse-compatible:
var rev = JSON.parse('{"a":1,"b":2}', function (key, val) {
  return key === 'a' ? 99 : val;
});
check('reviver', rev.a === 99 && rev.b === 2);

// verdict memo: repeat parses of the same text skip the pre-scan + eval
var memoText = '{"memo":1,"list":[1,2,3]}';
JSON.parse(memoText);
var t0 = $.hiresTimer;
JSON.parse(memoText);
check('memo-hit-fast', ($.hiresTimer - t0) < 10000, 'repeat parse bypasses pre-scan and eval');

// --- stringify ------------------------------------------------------------
var text = JSON.stringify({ a: 1, b: [true, null, 'x'] });
check('stringify-exact', text === '{"a":1,"b":[true,null,"x"]}');

var pretty = JSON.stringify({ a: 1 }, null, 2);
check('stringify-pretty', pretty.indexOf('\n  "a"') >= 0, 'pretty printer emits indented lines');

check('stringify-top-undefined', JSON.stringify(undefined) === undefined);
check('stringify-nonfinite-null', JSON.stringify({ n: 1 / 0 }) === '{"n":null}');

// --- report ---------------------------------------------------------------
// console + %TEMP% file; the last-statement value is what automation reads.
var __report = JSON.stringify(out, null, 2);
$.writeln('ESON example 01: ' + (out.ok ? 'PASS' : 'FAIL'));
$.writeln(__report);
var __rf = new File($.getenv('TEMP') + '/esonexample-01-report.json');
__rf.encoding = 'UTF-8';
__rf.open('w');
__rf.write(__report);
__rf.close();
__report;
