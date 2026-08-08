// ESON live benchmark (ExtendScript). Loads dist/ESON.jsx + the ESONJson.dll
// ExternalObject case, cross-checks correctness, and measures the §12 lane
// matrix with $.hiresTimer. Writes %TEMP%\eson-benchmark-report.json.
//
// Run via ILLUSTRATOR_COM_TOOL.py eval --file (single eval: bundle + bench),
// or from the Scripts menu.
(function () {
  var R = {};
  function val(name, thunk) { try { R[name] = String(thunk()); } catch (e) { R[name] = 'ERR:' + String(e); } }

  // ---- paths ---------------------------------------------------------------
  var ABS_SCRIPTS = 'C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts';
  var selfDir = '';
  try {
    var candDir = File($.fileName).parent.fsName + '/eson';
    if (File(candDir + '/dist/ESON.jsx').exists) selfDir = candDir;
  } catch (e) {}
  if (!selfDir) {
    try {
      var candDir2 = Folder.scripts.fsName + '/eson';
      if (File(candDir2 + '/dist/ESON.jsx').exists) selfDir = candDir2;
    } catch (e) {}
  }
  if (!selfDir && File(ABS_SCRIPTS + '/eson/dist/ESON.jsx').exists) selfDir = ABS_SCRIPTS + '/eson';
  var bundlePath = selfDir + '/dist/ESON.jsx';
  var nativeDir = selfDir + '/native/build';
  R['bundlePath'] = bundlePath;
  R['nativeDir'] = nativeDir;

  // ---- load bundle ---------------------------------------------------------
  var bundleLoaded = false;
  try {
    var bf = new File(bundlePath);
    bf.encoding = 'UTF-8';
    if (bf.exists && bf.open('r')) {
      eval(bf.read());
      bf.close();
      bundleLoaded = typeof ESON !== 'undefined' && typeof ESON.stringify === 'function';
    }
  } catch (e) { R['bundle.error'] = String(e); }
  R['bundle.loaded'] = String(bundleLoaded);
  if (!bundleLoaded) return R;
  try { $.global.ESON = ESON; $.global.ESON_JSON2 = ESON_JSON2; } catch (e) {}
  R['eson.caps'] = JSON.stringify(ESON.capabilities());

  // ---- load the JSON2 reference (differential lanes; ESON_JSON2 has no
  // parse anymore - it is a stringify-only slice) ---------------------------
  try {
    var jf = new File(selfDir + '/dist/json2-reference.jsx');
    jf.encoding = 'UTF-8';
    if (jf.exists && jf.open('r')) {
      eval(jf.read());
      jf.close();
      R['json2.ref.loaded'] = String(typeof JSON2 !== 'undefined' && typeof JSON2.parse === 'function');
    } else {
      R['json2.ref.loaded'] = 'missing';
    }
  } catch (e) { R['json2.ref.loaded'] = 'ERR:' + String(e); }

  // ---- load native DLL -----------------------------------------------------
  var lib = null;
  var nativeLoaded = false;
  var nativeError = '';
  try {
    var prev = ExternalObject.searchFolders;
    ExternalObject.searchFolders = nativeDir + ';' + (prev || '');
    // Round-2 build (canonical ABI, version 2) is ESONJson.dll; the round-1
    // lettered artifacts (ESONJsonFinal/P/T/U/V) are the retired ABI and are
    // only loaded as an explicit fallback for historical comparisons.
    var libName = 'lib:ESONJson';
    lib = new ExternalObject(libName);
    if (lib && Number(lib.version(0)) < 2) {
      // stale round-1 ESONJson.dll on disk - fall back to the lettered
      // round-1 artifact and record it
      var prevLib = lib;
      lib = null;
      try { prevLib.unload(); } catch (e) {}
      libName = ExternalObject.search('lib:ESONJsonFinal') ? 'lib:ESONJsonFinal' : 'lib:ESONJsonP';
      lib = new ExternalObject(libName);
      R['native.dllBuild'] = libName;
    } else {
      R['native.dllBuild'] = libName + ' (ABI gen ' + String(Number(lib.version(0))) + ')';
    }
    if (lib && Number(lib.version(0)) >= 1 && Number(lib.ping(0)) === 42) nativeLoaded = true;
    else if (lib) nativeError = 'smoke failed (version/ping)';
  } catch (e) { nativeError = String(e); }
  R['native.loaded'] = String(nativeLoaded);
  R['native.error'] = nativeError;
  R['native.abi'] = '{}';

  // ---- payloads ------------------------------------------------------------
  function settingsShape() {
    return { styleIndex: 0, bendPct: 35, hDistortPct: 0, vDistortPct: 0, showAdvanced: false, verticalAxis: false, preserveWidth: true, preserveHeight: false, anchorIndex: 0, hideOriginal: false, deleteOriginal: false, replaceOriginal: false, previewOpacity: 55, dielineSpotNames: ['CutContour', 'CutContour2', 'dieline'], svgWarpPath: '', svgBoundsPath: '' };
  }
  function profilesShape(n) {
    var out = [];
    var i;
    for (i = 0; i < n; i++) {
      out.push({ name: 'CutContour ' + (i + 1) + 'mm', params: { styleIndex: 1, bendPct: 20 + (i % 40), hDistortPct: 0, vDistortPct: 0, showAdvanced: false, verticalAxis: false, preserveWidth: true, preserveHeight: false, anchorIndex: 0, hideOriginal: false, deleteOriginal: false, replaceOriginal: false, previewOpacity: 55 } });
    }
    return out;
  }
  function bigText(size) {
    var chunk = '{"k":"The quick brown fox 0123456789 \\n é 日本語","n":1.5},';
    var s = '';
    while (s.length < size) s += chunk;
    return '[' + s.substring(0, s.length - 1) + ']';
  }

  var payloads = [];
  var settings = settingsShape();
  var profiles6 = profilesShape(6);
  var profiles150 = profilesShape(150);
  payloads.push({ name: 'settings', value: settings, text: ESON_JSON2.stringify(settings) });
  payloads.push({ name: 'profiles6', value: profiles6, text: ESON_JSON2.stringify(profiles6) });
  payloads.push({ name: 'profiles150', value: profiles150, text: ESON_JSON2.stringify(profiles150) });

  // control-heavy string for escape lanes: 4 KB for the looped drain (the
  // per-byte drain makes 256 KB take minutes per pass - itself the finding),
  // plus a single 256 KB one-shot drain sample
  var controlString = '';
  var ci;
  for (ci = 0; ci < 400; ci++) controlString += 'a"b\\c\nd\te\u0001f\u2028g\x7f\u0080é';
  var bigControlString = '';
  for (ci = 0; ci < 20000; ci++) bigControlString += 'a"b\\c\nd\te\u0001f\u2028g\x7f\u0080é';
  bigControlString = bigControlString.substring(0, 262144);

  // ---- correctness cross-checks -------------------------------------------
  var checks = [];
  function check(name, ok, detail) { checks.push({ name: name, ok: String(ok), detail: String(detail) }); }

  // ESON vs JSON2 stringify on payloads
  var pi;
  for (pi = 0; pi < payloads.length; pi++) {
    var pv = payloads[pi];
    check('stringify.' + pv.name, ESON.stringify(pv.value) === ESON_JSON2.stringify(pv.value), ESON.stringify(pv.value) === ESON_JSON2.stringify(pv.value) ? 'equal' : 'DIFF');
  }
  // parse round-trip on payloads
  for (pi = 0; pi < payloads.length; pi++) {
    var pp = payloads[pi];
    var esonParsed;
    var j2Parsed;
    var pe = '';
    var je = '';
    try { esonParsed = ESON.parse(pp.text); } catch (e) { pe = String(e); }
    try { j2Parsed = JSON2.parse(pp.text); } catch (e) { je = String(e); }
    var sameShape = !pe && !je && ESON.stringify(esonParsed) === ESON.stringify(j2Parsed);
    check('parse.' + pp.name, sameShape, 'esonErr=' + pe + ' j2Err=' + je);
  }
  // invalid corpus verdict parity: ESON.parse vs json2 (native gate verdicts
  // run post-checkpoint - some ExternalObject methods throw host errors that
  // bypass JavaScript try/catch, so no native calls may happen here)
  var invalidF = ['01', '-01', '1.', '.1', '1e', '1e+', '[1,]', '{"a":1,}', '{a:1}', "{'a':1}", 'undefined', 'NaN', 'Infinity', '/*x*/1', '({a:1})', '{"x":(sideEffect=1)}', '{"x":1} extra', '"bad\\x41"', '"bad\\u12g4"', '"bad\\v"', '1..2', '0x1', '+1', 'tru', 'nullx', '[,]', '"\\u12"', '00', '-00', '\uFEFF{}'];
  var esonMismatch = 0;
  var j2Mismatch = 0;
  for (ci = 0; ci < invalidF.length; ci++) {
    var t = invalidF[ci];
    var esonThrows = false;
    var j2Throws = false;
    try { ESON.parse(t); } catch (e) { esonThrows = true; }
    try { JSON2.parse(t); } catch (e) { j2Throws = true; }
    if (!esonThrows) esonMismatch++;
    if (!j2Throws) j2Mismatch++;
  }
  check('gate.parity.eson', String(esonMismatch) + ' invalid accepted by ESON', esonMismatch === 0 ? 'ok' : 'mismatch');
  check('gate.parity.json2', String(j2Mismatch) + ' invalid accepted by JSON2 (documented permissiveness)', j2Mismatch === 0 ? 'strict' : 'permissive-as-expected');
  R['checks'] = checks;

  // ---- timing --------------------------------------------------------------
  function nowUs() { return $.hiresTimer; }
  function timeLane(fn, warmup, iters) {
    var w;
    for (w = 0; w < warmup; w++) fn();
    var samples = [];
    var i;
    var t0, t1, d;
    for (i = 0; i < iters; i++) {
      t0 = nowUs();
      fn();
      t1 = nowUs();
      d = t1 - t0;
      // 32-bit hiresTimer wraps every ~35.8 min; a sample that crossed the
      // wrap is garbage (negative or >10 s) and is rejected, not adjusted.
      if (d < 0 || d > 10000000) continue;
      samples.push(d);
    }
    if (!samples.length) samples.push(-1);
    samples.sort(function (a, b) { return a - b; });
    return { median: samples[Math.floor(samples.length / 2)], min: samples[0], p95: samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] };
  }

  var rows = [];
  function row(lane, payload, st, bytes) {
    rows.push({ lane: lane, payload: payload, medianUs: st.median, minUs: st.min, p95Us: st.p95, bytes: bytes });
  }

  var WARM = 3;
  var ITERS = 20;
  var BIG_ITERS = 8;
  var MEDIUM = 12;

  function itersFor(name) {
    if (name === 'profiles150') return MEDIUM;
    return ITERS;
  }

  // (native lanes run post-checkpoint, gated on the binding preflight)

  for (pi = 0; pi < payloads.length; pi++) {
    var pl = payloads[pi];
    var bytes = pl.text.length;
    var it = itersFor(pl.name);

    var s1 = timeLane(function () { ESON_JSON2.stringify(pl.value); }, WARM, it);
    row('json2.stringify', pl.name, s1, bytes);
    var s2 = timeLane(function () { ESON.stringify(pl.value); }, WARM, it);
    row('eson.stringify', pl.name, s2, bytes);
    var s3 = timeLane(function () { ESON.stringifyFast(pl.value); }, WARM, it);
    row('eson.stringifyFast', pl.name, s3, bytes);
    if (typeof pl.value.toSource === 'function' || (pl.value && typeof pl.value === 'object')) {
      var s4 = timeLane(function () { try { pl.value.toSource(); } catch (e) {} }, WARM, it);
      row('raw.toSource', pl.name, s4, bytes);
    }

    var p1 = timeLane(function () { JSON2.parse(pl.text); }, WARM, it);
    row('json2.parse', pl.name, p1, bytes);
    // COLD parse: unique text per iteration (a growing whitespace suffix) so
    // the verdict memo (8-entry) never hits - the lane measures the cold
    // pre-scan + eval. The memo would otherwise make every iteration ~3-43us.
    var _coldCi = 0;
    var p2 = timeLane(function () {
      var pad = new Array((_coldCi++) % 9 + 1).join(' ');
      ESON.parse(pl.text + pad);
    }, WARM, it);
    row('eson.parse.cold', pl.name, p2, bytes);
    var p2m = timeLane(function () { ESON.parse(pl.text); }, WARM, it);
    row('eson.parse.memo', pl.name, p2m, bytes);
    if (pl.name !== 'bigText') {
      var p3 = timeLane(function () { eval('(' + pl.text + ')'); }, WARM, it);
      row('raw.eval', pl.name, p3, bytes);
    }
  }

  // trusted codec (requires a kernel)
  if (ESON.capabilities().sourceProfile !== 'none') {
    var t1 = timeLane(function () {
      var enc = ESON.encodeSource(settings);
      ESON.decodeSourceTrusted(enc);
    }, WARM, ITERS);
    row('eson.trustedRoundtrip', 'settings', t1, 0);
  }

  R['rows'] = rows;

  // ---- checkpoint: persist the JSX results before the risky native section --
  // (some ExternalObject methods throw host errors that BYPASS JavaScript
  // try/catch entirely on this build - all native calls happen after this
  // checkpoint so a mid-eval failure cannot lose the JSX measurements)
  function writeReport() {
    try {
      var outPath = $.getenv('TEMP') + '/eson-benchmark-report.json';
      var f = new File(outPath);
      f.encoding = 'UTF-8';
      if (f.open('w')) {
        f.write(JSON.stringify(R));
        f.close();
        return outPath;
      }
    } catch (e) {}
    return '';
  }
  writeReport();

  // ---- native section (post-checkpoint; uncatchable host errors can still
  // kill the eval here, but the JSX results are already persisted) ------------
  var nativeInfo = {};
  if (nativeLoaded) {
    // Live per-method binding probe. The OLD ESONJson ABI (void* exports,
    // reconstructed tags 1/4/8, _a signatures) left stage/validateStaged/
    // escapedBytes/validateText unbound in BOTH live sessions. The rebuilt
    // DLL follows the verified ArcFitEso prototype (canonical tags 4/123/125,
    // documented `long fn(TaggedData*, long, TaggedData*)` prototypes, _s
    // signatures, malloc + ESFreeMem=free) whose every method bound on the
    // same host - but binding is still per-DLL-build: probe each method,
    // record the result, and gate the lanes on what actually bound.
    var probe = function (name, fn) {
      try {
        fn();
        return 'ok';
      } catch (e) { return 'ERR:' + String(e); }
    };
    var bindings = {
      ping: probe('ping', function () { lib.ping(0); }),
      version: probe('version', function () { lib.version(0); }),
      stage: probe('stage', function () { lib.stage('{"a":1}'); }),
      validateStaged: probe('validateStaged', function () { lib.validateStaged(0); }),
      escapeStaged: probe('escapeStaged', function () { lib.escapeStaged(0); }),
      nextByte: probe('nextByte', function () { lib.nextByte(0); }),
      escapeDirect: probe('escapeDirect', function () { lib.escapeDirect('a"b'); }),
      validateText: probe('validateText', function () { lib.validateText('{"a":1}'); }),
      packBytes: probe('packBytes', function () { lib.packBytes('ab'); }),
      unpackBytes: probe('unpackBytes', function () { lib.unpackBytes('ab'); }),
      hexEncode: probe('hexEncode', function () { lib.hexEncode('ab'); }),
      crc32: probe('crc32', function () { lib.crc32('abc'); }),
      stagePacked: probe('stagePacked', function () { lib.stagePacked(3, 0x61, 0x62, 0x63); }),
      validatePacked: probe('validatePacked', function () { lib.validatePacked(0); })
    };
    R['native.bindings'] = JSON.stringify(bindings);
    R['native.bindingEvidence'] = 'per-method live probe on the rebuilt ABI (canonical tags 4/123/125, long prototypes, _s signatures, malloc+free). Old-DLL binding failures tracked the DLL build; ArcFitEso-prototype methods bound on the same host.';
    writeReport();

    var reliable = function (name) { return String(bindings[name]).indexOf('ok') === 0; };
    var strOk = reliable('validateText') && reliable('packBytes') && reliable('unpackBytes') &&
                reliable('escapeDirect') && reliable('stage');

    // boundary microbenchmark - the only universally-safe lane
    var b1 = timeLane(function () { Number(lib.ping(0)); }, WARM, ITERS);
    row('native.ping', 'boundary', b1, 0);
    R['rows'] = rows;
    writeReport();

    if (!strOk) {
      rows.push({ lane: 'native.validate', payload: 'all', medianUs: -1, minUs: -1, p95Us: -1, bytes: 0, skipped: 'string methods unbound on this DLL build (binding is per-DLL-build; rebuild with a fresh DLL name)' });
      rows.push({ lane: 'nativeGate+eval', payload: 'all', medianUs: -1, minUs: -1, p95Us: -1, bytes: 0, skipped: 'string methods unbound on this DLL build' });
      rows.push({ lane: 'native.escape+drain', payload: 'all', medianUs: -1, minUs: -1, p95Us: -1, bytes: 0, skipped: 'string methods unbound on this DLL build' });
      rows.push({ lane: 'native.packed.read', payload: 'all', medianUs: -1, minUs: -1, p95Us: -1, bytes: 0, skipped: 'packBytes unbound on this DLL build' });
      rows.push({ lane: 'native.packed.write', payload: 'all', medianUs: -1, minUs: -1, p95Us: -1, bytes: 0, skipped: 'packBytes unbound on this DLL build' });
    } else {
      // Tier 1: whole-workload-native gate. validateText = ONE crossing; the
      // C validator replaces the charCodeAt scanner walk entirely
      // (ArcFitEso measured whole-workload-native at 4,800-11,900x).
      for (pi = 0; pi < payloads.length; pi++) {
        var nv = payloads[pi];
        var nbytes = nv.text.length;
        var nv1 = timeLane(function () { Number(lib.validateText(nv.text)); }, WARM, itersFor(nv.name));
        row('native.validate', nv.name, nv1, nbytes);
        // native gate + engine eval = the tier-1 replacement for pre-scan + eval
        var nv2 = timeLane(function () {
          if (Number(lib.validateText(nv.text)) === 0) eval('(' + nv.text + ')');
        }, WARM, itersFor(nv.name));
        row('nativeGate+eval', nv.name, nv2, nbytes);
      }
      // native verdict parity spot-check vs the JSX gate on the invalid corpus
      // (NOT the JSONTestSuite corpus - the native validator has no corpus
      // parity evidence yet; that is the gate before it could ever front eval)
      var nativeRejected = 0;
      for (ci = 0; ci < invalidF.length; ci++) {
        var nt = invalidF[ci];
        try { if (Number(lib.validateText(nt)) !== 0) nativeRejected++; }
        catch (e) { nativeRejected = -999; break; }
      }
      nativeInfo.verdictParity = String(nativeRejected) + '/' + String(invalidF.length) + ' invalid rejected natively (JSX gate: ' + String(esonMismatch) + ' accepted)';
      check('native.verdict-parity', String(nativeRejected) === String(invalidF.length), nativeInfo.verdictParity);

      // escape: single-call string channel vs the legacy byte-drain
      var e1 = timeLane(function () { lib.escapeDirect(controlString); }, WARM, MEDIUM);
      row('native.escapeDirect', 'control-4k', e1, controlString.length);
      var e2 = timeLane(function () {
        lib.stage(controlString);
        lib.escapeStaged(0);
        var n = Number(lib.escapedBytes(0));
        var b = '', i2;
        for (i2 = 0; i2 < n && i2 < 4096; i2++) b += String.fromCharCode(Number(lib.nextByte(0)));
      }, WARM, MEDIUM);
      row('native.escape+drain', 'control-4k', e2, controlString.length);

      // Tier 2: packed 2-bytes-per-char channel vs the charCodeAt loops
      // (ASCII payload only: a packed pair whose second byte is 0xD8-0xDF
      // would hit the UTF-8 surrogate window and cannot round-trip)
      var asciiText = payloads[1].text; // profiles6 - pure ASCII
      var kk;
      var readLoop = function () {
        var s = 0;
        for (kk = 0; kk < asciiText.length; kk++) s += asciiText.charCodeAt(kk);
        return s;
      };
      var packedReadLoop = function () {
        var p = lib.packBytes(asciiText);
        var s = 0, c;
        for (kk = 0; kk < p.length; kk++) { c = p.charCodeAt(kk); s += (c & 255) + (c >> 8); }
        return s;
      };
      var r1 = timeLane(readLoop, WARM, MEDIUM);
      row('native.packed.read', 'profiles6', r1, asciiText.length);
      var r2 = timeLane(packedReadLoop, WARM, MEDIUM);
      row('native.packed.read.packed', 'profiles6', r2, asciiText.length);

      var writeSrc = payloads[1].text.substring(0, 16384);
      var writeLoop = function () {
        var out = [], q;
        for (q = 0; q < writeSrc.length; q++) out.push(String.fromCharCode(writeSrc.charCodeAt(q)));
        return out.join('');
      };
      var packedWriteLoop = function () {
        var out = [], q;
        for (q = 0; q + 1 < writeSrc.length; q += 2) {
          out.push(String.fromCharCode((writeSrc.charCodeAt(q) & 0xFF) | ((writeSrc.charCodeAt(q + 1) & 0xFF) << 8)));
        }
        if (q < writeSrc.length) out.push(String.fromCharCode(writeSrc.charCodeAt(q) & 0xFF));
        return lib.unpackBytes(out.join(''));
      };
      var w1 = timeLane(writeLoop, WARM, MEDIUM);
      row('native.packed.write', '16k', w1, writeSrc.length);
      var w2 = timeLane(packedWriteLoop, WARM, MEDIUM);
      row('native.packed.write.packed', '16k', w2, writeSrc.length);

      // packed numeric fallback (3 units per double) - the transport that
      // worked even when string args did not bind on the old DLL build
      if (reliable('stagePacked') && reliable('validatePacked')) {
        var stText = payloads[0].text;
        var stPacks = [];
        for (kk = 0; kk < stText.length; kk += 3) {
          stPacks.push(stText.charCodeAt(kk) +
            (kk + 1 < stText.length ? stText.charCodeAt(kk + 1) * 65536 : 0) +
            (kk + 2 < stText.length ? stText.charCodeAt(kk + 2) * 4294967296 : 0));
        }
        var pv1 = timeLane(function () {
          var args = [stText.length].concat(stPacks);
          lib.stagePacked.apply(lib, args);
          return Number(lib.validatePacked(0));
        }, WARM, MEDIUM);
        row('native.packed16.gate', 'settings', pv1, stText.length);
      }
    }
    R['native.abi'] = JSON.stringify(nativeInfo);
    R['rows'] = rows;
    writeReport();
    try { lib.unload(); } catch (e) {}
  }

  // ---- write report --------------------------------------------------------
  var reportPath = writeReport();
  R['reportFile'] = reportPath;

  var summary = {
    bundleLoaded: bundleLoaded,
    nativeLoaded: nativeLoaded,
    kernelProfile: ESON.capabilities().sourceProfile,
    checkFailures: (function () { var n = 0, i; for (i = 0; i < checks.length; i++) if (checks[i].ok !== 'true') n++; return n; })(),
    rows: rows,
    reportFile: reportPath
  };
  return summary;
})();
