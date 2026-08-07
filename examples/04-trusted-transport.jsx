#target illustrator
// ESON example 04: trusted transport -- preserve undefined, NaN, Infinity,
// dates and functions (full build: dist/ESON.jsx).
//
// The trusted lane (encodeSource / decodeSourceTrusted) round-trips values
// plain JSON cannot represent, in ~26 us. It is executable source text, so
// feed it only to decodeSourceTrusted. ESON.jsx is the facade-only build:
// it leaves the global JSON object alone.
//
// How to run: File > Scripts > Other Script..., or
//   python ILLUSTRATOR_COM_TOOL.py eval --file examples/04-trusted-transport.jsx
// Report: %TEMP%\esonexample-04-report.json + last-statement value.

// --- bootstrap: facade build (does NOT replace the global JSON object) -----
var __esonDist = $.getenv('ESON_DIST');
if (!__esonDist) {
  __esonDist = File(decodeURI($.fileName)).parent.parent.fsName.replace(/\\/g, '/') + '/dist';
}
var __vendor = new File(__esonDist + '/ESON.jsx');
if (!__vendor.exists) {
  $.writeln('ESON build not found at ' + __vendor.fsName + ' -- run "npm run build" in the eson repo first.');
  throw new Error('ESON build not found: ' + __vendor.fsName);
}
$.evalFile(__vendor); // ESON facade only; global JSON untouched

var out = { ok: true, checks: [], build: 'ESON.jsx (full build)' };
function check(name, ok, detail) {
  out.checks.push({ name: name, ok: !!ok, detail: detail });
  if (!ok) out.ok = false;
}

// --- capabilities first: gate encodeSource on a source kernel ---------------
var caps = ESON.capabilities();
out.caps = {
  sourceProfile: caps.sourceProfile,
  jsonClassification: caps.json.classification,
  globalJsonPresent: caps.engine.globalJsonPresent
};
check('facade-available', typeof ESON.encodeSource === 'function' && typeof ESON.decodeSourceTrusted === 'function');
check('source-kernel-present', caps.sourceProfile !== 'none', caps.sourceProfile);

// global JSON untouched by the facade build (a host may have none at all):
check('facade-leaves-json-alone', typeof JSON === 'undefined' || (JSON.parse && JSON.parse !== ESON.parse));

if (caps.sourceProfile !== 'none') {
  // values plain JSON cannot represent:
  var state = {
    tag: 'A',
    n: NaN,
    inf: Infinity,
    u: undefined,
    d: new Date(0),
    f: function () { return 1; },
    sparse: []
  };
  state.sparse[2] = 'x'; // sparse array: length 3, [0] and [1] are holes

  var encoded = ESON.encodeSource(state);
  out.encodedBytes = encoded.length;
  var back = ESON.decodeSourceTrusted(encoded);

  check('roundtrip-tag', back.tag === 'A');
  check('roundtrip-nan', typeof back.n === 'number' && back.n !== back.n);
  check('roundtrip-infinity', back.inf === Infinity);
  check('roundtrip-undefined', back.u === undefined);
  check('roundtrip-date', back.d instanceof Date && back.d.getTime() === 0);
  check('roundtrip-function', typeof back.f === 'function' && back.f() === 1);
  check('roundtrip-sparse', back.sparse.length === 3 && back.sparse[0] === undefined && back.sparse[2] === 'x');
}

// --- report ---------------------------------------------------------------
var __report = ESON.stringify(out, null, 2);
$.writeln('ESON example 04: ' + (out.ok ? 'PASS' : 'FAIL'));
$.writeln(__report);
var __rf = new File($.getenv('TEMP') + '/esonexample-04-report.json');
__rf.encoding = 'UTF-8';
__rf.open('w');
__rf.write(__report);
__rf.close();
__report;
