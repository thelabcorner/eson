#target illustrator
// ESON example 06: the certified fast lane -- stringifyFast (full build).
//
// stringifyFast is for caller-warranted inert data: plain objects and
// arrays of JSON-supported primitives. A preflight walk catches violations
// and reports a path; options.onUnsupported decides what happens then:
//   "fallback" (default) -> strict stringify of the whole value
//   "throw"              -> Error with the offending path
// Cycles always throw TypeError, regardless of the option.
//
// How to run: File > Scripts > Other Script..., or
//   python ILLUSTRATOR_COM_TOOL.py eval --file examples/06-fast-lane.jsx
// Report: %TEMP%\esonexample-06-report.json + last-statement value.

// --- bootstrap: facade build ----------------------------------------------
var __esonDist = $.getenv('ESON_DIST');
if (!__esonDist) {
  __esonDist = File(decodeURI($.fileName)).parent.parent.fsName.replace(/\\/g, '/') + '/dist';
}
var __vendor = new File(__esonDist + '/ESON.jsx');
if (!__vendor.exists) {
  $.writeln('ESON build not found at ' + __vendor.fsName + ' -- run "npm run build" in the eson repo first.');
  throw new Error('ESON build not found: ' + __vendor.fsName);
}
$.evalFile(__vendor);

var out = { ok: true, checks: [], build: 'ESON.jsx (full build)' };
function check(name, ok, detail) {
  out.checks.push({ name: name, ok: !!ok, detail: detail });
  if (!ok) out.ok = false;
}

// --- fast path: inert data ------------------------------------------------
var inert = { a: 1, b: [true, null, 'x'], c: 'line\u2028sep' };
var fast = ESON.stringifyFast(inert);
var strict = ESON.stringify(inert);
check('fast-equals-strict', fast === strict, fast);
check('fast-output', fast === '{"a":1,"b":[true,null,"x"],"c":"line\\u2028sep"}');

// --- fallback: non-inert value, default onUnsupported -----------------------
var mixed = { a: 1, d: new Date(0) }; // Date is not inert
var fb = ESON.stringifyFast(mixed);
check('fallback-equals-strict', fb === ESON.stringify(mixed), 'Date fell back to the strict lane');

// --- throw: same value, explicit contract -----------------------------------
var threwWithPath = false;
var pathMessage = '';
try { ESON.stringifyFast(mixed, { onUnsupported: 'throw' }); }
catch (e) {
  threwWithPath = true;
  pathMessage = String(e.message);
}
check('throw-on-unsupported', threwWithPath, pathMessage);
check('throw-reports-path', pathMessage.indexOf('d') >= 0, 'message names the offending path');

// --- cycles always throw ----------------------------------------------------
var cyc = { a: 1 };
cyc.self = cyc;
var threwCycle = false;
var cycleMsg = '';
try { ESON.stringifyFast(cyc); }
catch (e) { threwCycle = String(e.message).indexOf('circular') >= 0; cycleMsg = String(e.message); }
check('cycle-throws', threwCycle, cycleMsg);

// --- report ---------------------------------------------------------------
var __report = ESON.stringify(out, null, 2);
$.writeln('ESON example 06: ' + (out.ok ? 'PASS' : 'FAIL'));
$.writeln(__report);
var __rf = new File($.getenv('TEMP') + '/esonexample-06-report.json');
__rf.encoding = 'UTF-8';
__rf.open('w');
__rf.write(__report);
__rf.close();
__report;
