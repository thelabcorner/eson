#target illustrator
// ESON example 05: the eval-free lane -- decodeSourceChecked (full build).
//
// For caches and payloads that may be corrupted or misrouted: decodes the
// source-literal subset (what toSource emits for DATA: identifier keys,
// parens, undefined, NaN, Infinity, JS escapes) with NO eval. Anything
// executable -- functions, new, calls, member access -- throws SyntaxError
// before it can run.
//
// How to run: File > Scripts > Other Script..., or
//   python ILLUSTRATOR_COM_TOOL.py eval --file examples/05-eval-free-lane.jsx
// Report: %TEMP%\esonexample-05-report.json + last-statement value.

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
// The engine reports the rejection as Error (message "unsafe or malformed
// source"); assert on rejection, not on the exact error name.
function rejectsExecutable(text) {
  try { ESON.decodeSourceChecked(text); return false; } catch (e) { return true; }
}

// --- data subset accepted (no eval anywhere) --------------------------------
var v = ESON.decodeSourceChecked('({a:1, b:[true, null, "x"], u:undefined, n:NaN})');
check('data-a', v.a === 1);
check('data-b', v.b.length === 3 && v.b[2] === 'x');
check('data-u', v.u === undefined);
check('data-n', typeof v.n === 'number' && v.n !== v.n);

// --- executable payloads rejected before they can run -----------------------
check('rejects-function', rejectsExecutable('({f:(function(){return 1;})})'), 'function literal');
check('rejects-new', rejectsExecutable('({d:new Date(0)})'), 'new expression');
check('rejects-call', rejectsExecutable('({a:1}) .toString()'), 'member access / call');
check('rejects-assignment', rejectsExecutable('({a:(probe42=42)})'), 'assignment side effect');

// --- typical use: safe decode of a persisted cache entry --------------------
var cached = '({tone:"warm", levels:[2,5,1], expires:NaN})';
var decoded = ESON.decodeSourceChecked(cached);
check('cache-use', decoded.tone === 'warm' && decoded.levels.join(',') === '2,5,1', 'cache entry decoded without eval');

// --- report ---------------------------------------------------------------
var __report = ESON.stringify(out, null, 2);
$.writeln('ESON example 05: ' + (out.ok ? 'PASS' : 'FAIL'));
$.writeln(__report);
var __rf = new File($.getenv('TEMP') + '/esonexample-05-report.json');
__rf.encoding = 'UTF-8';
__rf.open('w');
__rf.write(__report);
__rf.close();
__report;
