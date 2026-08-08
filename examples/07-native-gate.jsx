#target illustrator
// ESON example 07: the two paths - JSX-only (default) vs the
// ExternalObject-accelerated gate (full build only, opt-in).
//
// Path 1 (JSX-only): every build, every ExtendScript host. parse() runs the
// certified pre-scan + sanitize + eval. No dependencies.
// Path 2 (native): ESON.enableNativeGate({ dir }) loads the ESONJson.dll,
// self-certifies verdict parity on a bundled corpus, and only then routes
// parse()'s cold path through the DLL's validateText. Measured ~14-17x
// faster cold parse on Illustrator 30.6.0; the certified regex gate stays
// the fallback (gate unavailable -> pre-scan).
//
// How to run: File > Scripts > Other Script... and pick this file, or
//   python ILLUSTRATOR_COM_TOOL.py eval --file examples/07-native-gate.jsx
// The report is written to %TEMP%\esonexample-07-report.json and returned as
// the script's last-statement value.

// --- bootstrap: resolve the ESON build relative to this script ------------
// `$.fileName` is URI-style and may contain %20 -- decode before use, and it
// is empty when run via COM eval --file, so fall back to the Scripts folder
// and the known absolute path. Override with the ESON_DIST env var.
var __esonRoot = '';
try {
  var __cand = File(decodeURI($.fileName)).parent.parent.fsName.replace(/\\/g, '/');
  if (File(__cand + '/dist/ESON.jsx').exists) __esonRoot = __cand;
} catch (e) {}
if (!__esonRoot) {
  try {
    var __cand2 = Folder.scripts.fsName + '/eson';
    if (File(__cand2 + '/dist/ESON.jsx').exists) __esonRoot = __cand2;
  } catch (e) {}
}
if (!__esonRoot) __esonRoot = 'C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eson';
var __esonDist = $.getenv('ESON_DIST') || (__esonRoot + '/dist');
var __bundle = new File(__esonDist + '/ESON.jsx'); // full build: has the gate
if (!__bundle.exists) {
  $.writeln('ESON build not found at ' + __bundle.fsName + ' -- run "npm run build" in the eson repo first.');
  throw new Error('ESON build not found: ' + __bundle.fsName);
}
$.evalFile(__bundle);

var out = { ok: true, checks: [], build: 'ESON.jsx' };
function check(name, ok, detail) {
  out.checks.push({ name: name, ok: !!ok, detail: detail });
  if (!ok) out.ok = false;
}
function rejects(text) {
  try { ESON.parse(text); return false; } catch (e) { return true; }
}

// --- path 1: JSX-only (the default; the gate is OFF until enabled) --------
var caps0 = ESON.capabilities();
check('path1-default-off', caps0.native.enabled === false, JSON.stringify(caps0.native));
check('path1-strict', ESON.parse('{"a":[1,true,null]}').a[2] === null);
check('path1-rejects', rejects('[01]') && rejects('{"x":(sideEffect=1)}'));

// --- path 2: enable the ExternalObject gate --------------------------------
var __nativeDir = $.getenv('ESON_NATIVE_DIR') || (__esonRoot + '/native/build');
var __caps = ESON.enableNativeGate({ dir: __nativeDir });
out.native = __caps.native;
check('path2-enabled', __caps.native.enabled === true, JSON.stringify(__caps.native));
check('path2-certified', __caps.native.certified > 0, 'parity cases certified at enable');

// the accelerated parse must agree with the JSX-only verdicts
var __valid = '{"styleIndex":0,"bendPct":35,"preserveWidth":true,"dielineSpotNames":["CutContour","dieline"],"n":1.5e3,"items":[1,true,null,"x"]}';
var __parsed = ESON.parse(__valid);
check('path2-parse', __parsed.bendPct === 35 && __parsed.items[2] === null);
check('path2-rejects', rejects('[01]') && rejects('{"a":1,}') && rejects('undefined'));

// timing: cold parse, JSX-only vs accelerated (hiresTimer, median of 11)
function __medianUs(fn, iters) {
  var samples = [], i, t0, t1, d;
  for (i = 0; i < 3; i++) fn(); // warmup
  for (i = 0; i < iters; i++) {
    t0 = $.hiresTimer;
    fn();
    t1 = $.hiresTimer;
    d = t1 - t0;
    if (d >= 0 && d <= 10000000) samples.push(d);
  }
  samples.sort(function (a, b) { return a - b; });
  return samples.length ? samples[Math.floor(samples.length / 2)] : -1;
}
var __big = '';
while (__big.length < 40000) __big += '{"k":"The quick brown fox 0123456789","n":1.5},';
__big = '[' + __big.substring(0, __big.length - 1) + ']';

// cold parse medians: gate OFF (JSX-only) vs gate ON (native). Unique text
// per iteration (growing whitespace suffix) so the verdict memo never hits.
var __pad = 0;
ESON.disableNativeGate();
var __jsxOnlyUs = __medianUs(function () {
  ESON.parse(__big + new Array((++__pad) % 9 + 1).join(' '));
}, 11);
var __pad2 = 0;
ESON.enableNativeGate({ dir: __nativeDir });
var __nativeUs = __medianUs(function () {
  ESON.parse(__big + new Array((++__pad2) % 9 + 1).join(' '));
}, 11);
out.timing = { jsxOnlyUs: __jsxOnlyUs, nativeGateUs: __nativeUs, bytes: __big.length };
check('path2-faster', __nativeUs > 0 && __nativeUs < __jsxOnlyUs, 'native=' + __nativeUs + 'us jsx-only=' + __jsxOnlyUs + 'us');

// --- teardown ---------------------------------------------------------------
ESON.disableNativeGate();
check('teardown-disabled', ESON.capabilities().native.enabled === false);

var __report = JSON.stringify(out, null, 2);
$.writeln('ESON example 07: ' + (out.ok ? 'PASS' : 'FAIL'));
$.writeln(__report);
var __rf = new File($.getenv('TEMP') + '/esonexample-07-report.json');
__rf.encoding = 'UTF-8';
__rf.open('w');
__rf.write(__report);
__rf.close();
__report;
