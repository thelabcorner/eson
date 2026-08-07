#target illustrator
// ESON example 02: the strictness tour -- where json2 is permissive and
// ESON rejects (runtime build).
//
// json2 accepts all of these invalid JSON documents; ESON rejects each one.
// Same engine, same payloads, verified live. Also shown: tricky inputs that
// are VALID JSON and must keep parsing.
//
// How to run: File > Scripts > Other Script..., or
//   python ILLUSTRATOR_COM_TOOL.py eval --file examples/02-strict-parse.jsx
// Report: %TEMP%\esonexample-02-report.json + last-statement value.

// --- bootstrap (see 01-parse-stringify.jsx for the same loader) -----------
var __esonDist = $.getenv('ESON_DIST');
if (!__esonDist) {
  __esonDist = File(decodeURI($.fileName)).parent.parent.fsName.replace(/\\/g, '/') + '/dist';
}
var __vendor = new File(__esonDist + '/vendor-eson-runtime.js');
if (!__vendor.exists) {
  $.writeln('ESON build not found at ' + __vendor.fsName + ' -- run "npm run build" in the eson repo first.');
  throw new Error('ESON build not found: ' + __vendor.fsName);
}
$.evalFile(__vendor);

var out = { ok: true, checks: [] };
function check(name, ok, detail) {
  out.checks.push({ name: name, ok: !!ok, detail: detail });
  if (!ok) out.ok = false;
}
function rejects(text) {
  try { JSON.parse(text); return false; } catch (e) { return true; }
}

// --- the json2 permissive holes, closed by ESON ----------------------------
var invalidInputs = [
  ['leading-zero',        '[01]'],
  ['trailing-dot',        '[1.]'],
  ['exponent-no-digits',  '[1.e5]'],
  ['bare-numeric-key',    '{1:1}'],
  ['trailing-comma',      '{"a":1,}'],
  ['raw-control-char',    '"a' + String.fromCharCode(9) + 'b"'],
  ['top-level-comma',     '1,2'],
  ['member-access-dot',   '[3[4]]'],
  ['object-member-dot',   '{}.false']
];
var i;
for (i = 0; i < invalidInputs.length; i++) {
  var entry = invalidInputs[i];
  check(entry[0], rejects(entry[1]), 'rejects ' + entry[1]);
}

// nesting depth cap (RFC 8259 practice; >512 rejected):
var deep = new Array(601).join('[') + new Array(601).join(']');
check('depth-cap', rejects(deep), '600 levels rejected');
check('depth-legal', !rejects(new Array(101).join('[') + new Array(101).join(']')), '100 levels still parses');

// --- valid JSON that must KEEP parsing (regression fodder) -----------------
check('braces-in-string', JSON.stringify(JSON.parse('{"a}":"b"}')) === '{"a}":"b"}');
check('exponents', JSON.parse('[1e5,-2.5e-3,1E+2]')[0] === 100000);
check('escaped-u2028', JSON.stringify(JSON.parse('"\\u2028y"')) === '"\\u2028y"', 'line separator sanitized');
check('surrogate-pair', JSON.stringify(JSON.parse('"\\ud83d\\ude00"')) === '"\ud83d\ude00"', 'well-formed pair kept raw');
check('escaped-backslash', JSON.stringify(JSON.parse('"\\\\\\u00ad"')) === '"\\\\\\u00ad"');

// --- report ---------------------------------------------------------------
var __report = JSON.stringify(out, null, 2);
$.writeln('ESON example 02: ' + (out.ok ? 'PASS' : 'FAIL'));
$.writeln(__report);
var __rf = new File($.getenv('TEMP') + '/esonexample-02-report.json');
__rf.encoding = 'UTF-8';
__rf.open('w');
__rf.write(__report);
__rf.close();
__report;
