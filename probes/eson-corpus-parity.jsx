// Full JSONTestSuite verdict parity: the ExternalObject-accelerated parse
// (gate ON) vs the certified JSX parse (gate OFF), case by case, live in
// Illustrator. Exercises the exact product wiring - ESON.parse with the
// native gate enabled - not a direct DLL call.
//
// This is the per-DLL-build certification the README's security posture
// requires before the native gate is trusted to front eval():
//   - y_ must-accept: accelerated verdict must equal the JSX verdict
//   - n_ must-reject: if JSX rejects, accelerated must reject too (a native
//     false-accept here is the security-critical failure). If JSX accepts
//     and accelerated rejects, that is a strictness divergence (safer
//     direction) - recorded, not a failure.
//   - i_ implementation-defined: verdicts recorded, not gated.
//
// Corpus: the JSONTestSuite clone used by tests/json-suite.mjs
// (default %TEMP%\JSONTestSuite\JSONTestSuite-master\test_parsing, override
// with the ESON_SUITE_DIR env var). Report:
// %TEMP%\eson-corpus-parity.json
(function () {
  var out = { ok: true, groups: {}, mismatches: [], strictnessDivergences: [], i_verdicts: [] };
  function save() {
    var f = new File($.getenv('TEMP') + '/eson-corpus-parity.json');
    f.encoding = 'UTF-8';
    if (f.open('w')) { f.write(JSON.stringify(out, null, 2)); f.close(); }
  }
  function parseOk(text) {
    try { ESON.parse(text); return true; } catch (e) { return false; }
  }

  // ---- load ESON (full build) ---------------------------------------------
  // $.fileName is empty when run via COM eval --file; fall back to the
  // Scripts folder and the known absolute path.
  var ABS_SCRIPTS = 'C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts';
  var root = '';
  try {
    var cand = File($.fileName).parent.parent.fsName.replace(/\\/g, '/');
    if (File(cand + '/dist/ESON.jsx').exists) root = cand;
  } catch (e) {}
  if (!root) {
    try {
      var cand2 = Folder.scripts.fsName + '/eson';
      if (File(cand2 + '/dist/ESON.jsx').exists) root = cand2;
    } catch (e) {}
  }
  if (!root && File(ABS_SCRIPTS + '/eson/dist/ESON.jsx').exists) root = ABS_SCRIPTS + '/eson';
  if (!root) {
    out.ok = false;
    out.error = 'ESON build not found';
    save();
    return out;
  }
  $.evalFile(new File(root + '/dist/ESON.jsx'));
  out.eson = 'loaded';

  // ---- corpus ----------------------------------------------------------------
  var suiteDir = $.getenv('ESON_SUITE_DIR') || ($.getenv('TEMP') + '/JSONTestSuite/JSONTestSuite-master/test_parsing');
  var dir = new Folder(suiteDir);
  if (!dir.exists) {
    out.ok = false;
    out.error = 'corpus not found at ' + suiteDir;
    save();
    return out;
  }
  var files = [];
  var allFiles = dir.getFiles();
  var i0;
  for (i0 = 0; i0 < allFiles.length; i0++) {
    var c0 = allFiles[i0].name.charAt(0);
    if (c0 === 'y' || c0 === 'n' || c0 === 'i') files[files.length] = allFiles[i0];
  }
  if (!files.length) {
    out.ok = false;
    out.error = 'no corpus files under ' + suiteDir;
    save();
    return out;
  }

  // ---- pass 1: JSX authority (gate OFF; the certified path) ----------------
  // Use the LEXICAL ESON from the bundle just loaded - $.global.ESON can
  // hold a STALE instance from an earlier eval in a persistent target
  // engine (reproduced live: a pre-fix bundle instance hung where the
  // fresh bundle did not). Overwrite the global so later code is safe too.
  try { $.global.ESON = ESON; } catch (e) {}
  out.esonType = String(typeof ESON) + '/global:' + String(typeof $.global.ESON);
  out.stage = 'pass1-start';
  save();
  var jsxAccepts = {};
  var texts = {};
  var i2;
  for (i2 = 0; i2 < files.length; i2++) {
    var f = files[i2];
    var text = '';
    f.encoding = 'UTF-8';
    out.stage = 'p1:read:' + f.name;
    save();
    try {
      if (f.open('r')) { text = f.read(); f.close(); }
    } catch (e) { text = ''; }
    if (text === '') continue;
    out.stage = 'p1:parse:' + f.name;
    save();
    texts[f.name] = text;
    jsxAccepts[f.name] = parseOk(text);
  }
  out.stage = 'pass1-done';
  save();

  // ---- pass 2: accelerated (gate ON) ----------------------------------------
  // A trailing space keeps each case cold: identical text would otherwise
  // hit the verdict memo and never reach the gate.
  var nativeDir = $.getenv('ESON_NATIVE_DIR') || (root + '/native/build');
  out.stage = 'pass1-done';
  save();
  var caps = ESON.enableNativeGate({ dir: nativeDir });
  out.enable = caps.native;
  out.stage = 'enabled:' + String(caps.native.enabled);
  save();
  if (!caps.native.enabled) {
    out.ok = false;
    out.error = 'native gate failed to enable: ' + caps.native.reason;
    save();
    return out;
  }

  var groups = { y: 0, n: 0, i: 0 };
  var jsxYes = { y: 0, n: 0, i: 0 };
  var nativeYes = { y: 0, n: 0, i: 0 };
  var names = [];
  for (var k in texts) {
    if (Object.prototype.hasOwnProperty.call(texts, k)) names[names.length] = k;
  }
  // Checkpoint after every file: an uncatchable host error can kill the eval
  // at any point (documented ExternalObject failure class), so the last
  // processed file must always be recoverable from the report.
  var lastFile = '';
  for (i2 = 0; i2 < names.length; i2++) {
    var fn = names[i2];
    var group = fn.charAt(0);
    var jv = jsxAccepts[fn];
    out.stage = 'p2:' + fn;
    save();
    var nv = parseOk(texts[fn] + ' '); // gate ON via ESON.parse
    lastFile = fn;
    groups[group] = groups[group] + 1;
    if (jv) jsxYes[group] = jsxYes[group] + 1;
    if (nv) nativeYes[group] = nativeYes[group] + 1;

    if (group === 'y' && jv !== nv) {
      out.mismatches.push({ file: fn, jsx: jv, nativeVerdict: nv });
    }
    if (group === 'n') {
      if (!jv && nv) out.mismatches.push({ file: fn, jsx: jv, nativeVerdict: nv }); // false-accept
      else if (jv && !nv) out.strictnessDivergences.push({ file: fn, nativeVerdict: nv }); // stricter
    }
    if (group === 'i') {
      out.i_verdicts.push({ file: fn, jsx: jv, nativeVerdict: nv });
    }
    out.lastFile = lastFile;
    save();
  }

  out.groups = { files: groups, jsxAccepts: jsxYes, nativeAccepts: nativeYes };
  out.ok = out.mismatches.length === 0;
  ESON.disableNativeGate();
  save();
  return out;
})();
