// ESON Phase-0 capability probe (hand-written ES3 - must run before any
// polyfill or bundle touches the engine). No #target banner: the file is
// designed to run via app.DoJavaScript (COM tool), $.evalFile, or menu.
//
// Phases:
//   1. engine identity + route
//   2. JSON availability matrix (local scope / $.global / new Function /
//      reflection) BEFORE anything is loaded
//   3. source kernels (uneval / toSource / quote) + corpus source outputs
//   4. strict parse verdicts on valid/invalid/security fixtures (gate only -
//      no bundle needed) + probe42 no-side-effect check
//   5. inject vendored json2 -> record post-injection state
//   6. load dist/ESON.jsx -> caps + differential stringify + parse +
//      checked decode + trusted round-trip
//   7. write %TEMP%\eson-capability-report-<route>.json and return a summary
//
// Route comes from $.global.ESON_PROBE_ROUTE (set by the invoker): menu,
// dojavascript, evalfile, targetengine. The fresh-engine evidence is produced
// by probes/eson-fresh-engine-probe.jsx.
(function () {
  var route = '';
  try { route = String($.global.ESON_PROBE_ROUTE || ''); } catch (ignoreRoute) {}
  if (!route) route = 'menu';

  var R = {};
  function val(name, thunk) { try { R[name] = String(thunk()); } catch (e) { R[name] = 'ERR:' + String(e); } }

  // ---- resolve paths ------------------------------------------------------
  // Under app.DoJavaScript, $.fileName points at the Illustrator application
  // directory, not the script - so fall back to Folder.scripts and then to an
  // absolute path (the same convention the earlier json-capability-probe used).
  var ABS_SCRIPTS = 'C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts';
  var selfDir = '';
  try {
    var fn = File($.fileName);
    var candDir = fn.parent.fsName + '/eson';
    if (File(candDir + '/dist/ESON.jsx').exists) selfDir = candDir;
  } catch (ignoreFn) {}
  if (!selfDir) {
    try {
      var candDir2 = Folder.scripts.fsName + '/eson';
      if (File(candDir2 + '/dist/ESON.jsx').exists) selfDir = candDir2;
    } catch (ignoreSc) {}
  }
  if (!selfDir && File(ABS_SCRIPTS + '/eson/dist/ESON.jsx').exists) selfDir = ABS_SCRIPTS + '/eson';
  var bundlePath = selfDir + '/dist/ESON.jsx';
  var json2Path = '';
  try {
    var cand = selfDir + '/dist/vendor-eson.js';
    if (File(cand).exists) json2Path = cand;
  } catch (ignoreJ2) {}
  if (!json2Path && File(ABS_SCRIPTS + '/eson/dist/vendor-eson.js').exists) json2Path = ABS_SCRIPTS + '/eson/dist/vendor-eson.js';
  R['probe.selfDir'] = selfDir;
  R['probe.bundlePath'] = bundlePath;
  R['probe.json2Path'] = json2Path;

  // ---- phase 1: identity --------------------------------------------------
  R['route'] = route;
  val('dollar.version', function () { return $.version; });
  val('dollar.buildDate', function () { return $.buildDate; });
  val('dollar.engineName', function () { return $.engineName; });
  val('app.version', function () { return app.version; });
  val('BridgeTalk.type', function () { return typeof BridgeTalk; });

  // ---- phase 2: JSON availability BEFORE anything loads -------------------
  val('typeof JSON (local scope)', function () { return typeof JSON; });
  val('typeof $.global.JSON', function () { return typeof $.global.JSON; });
  val('eval("typeof JSON")', function () { return eval('typeof JSON'); });
  val('new Function("return typeof JSON")()', function () { return new Function('return typeof JSON')(); });
  try {
    var refl = $.global.reflect;
    R['reflect.find("JSON")'] = refl ? String(refl.find('JSON')) : 'null';
  } catch (e) { R['reflect.find("JSON")'] = 'ERR:' + String(e); }
  val('typeof uneval', function () { return typeof uneval; });
  val('typeof Object.prototype.toSource', function () { return typeof Object.prototype.toSource; });
  val('typeof Array.prototype.toSource', function () { return typeof Array.prototype.toSource; });
  val('typeof String.prototype.toSource', function () { return typeof String.prototype.toSource; });
  val('typeof String.prototype.quote', function () { return typeof String.prototype.quote; });
  val('typeof Object.defineProperty', function () { return typeof Object.defineProperty; });
  val('typeof Function.prototype.bind', function () { return typeof Function.prototype.bind; });
  val('typeof Array.prototype.indexOf', function () { return typeof Array.prototype.indexOf; });

  // ---- phase 3: kernels + corpus source outputs ---------------------------
  var K = { uneval: null, objectToSource: null, arrayToSource: null, stringToSource: null, quote: null };
  try { if (typeof uneval === 'function') K.uneval = uneval; } catch (e) {}
  try { if (typeof Object.prototype.toSource === 'function') K.objectToSource = Object.prototype.toSource; } catch (e) {}
  try { if (typeof Array.prototype.toSource === 'function') K.arrayToSource = Array.prototype.toSource; } catch (e) {}
  try { if (typeof String.prototype.toSource === 'function') K.stringToSource = String.prototype.toSource; } catch (e) {}
  try { if (typeof String.prototype.quote === 'function') K.quote = String.prototype.quote; } catch (e) {}
  var kernelProfile = [];
  if (K.uneval) kernelProfile.push('uneval');
  if (K.objectToSource) kernelProfile.push('objectToSource');
  if (K.arrayToSource) kernelProfile.push('arrayToSource');
  if (K.stringToSource) kernelProfile.push('stringToSource');
  if (K.quote) kernelProfile.push('quote');
  R['kernel.profile'] = kernelProfile.join('+') || 'none';

  var corpus = [];
  function addCorpus(name, value) { corpus.push({ name: name, value: value }); }
  addCorpus('null', null);
  addCorpus('true', true);
  addCorpus('zero', 0);
  addCorpus('negZero', -0);
  addCorpus('float', 1.5);
  addCorpus('bigExp', 1e21);
  addCorpus('nan', NaN);
  addCorpus('infinity', Infinity);
  addCorpus('emptyString', '');
  addCorpus('escapedString', 'a"b\\c\n');
  addCorpus('nulString', '\u0000');
  addCorpus('latin1', 'é');
  addCorpus('cjk', '日本語');
  addCorpus('lineSep', '\u2028');
  addCorpus('surrogatePair', '\ud83d\ude00');
  addCorpus('emptyArray', []);
  addCorpus('flatArray', [1, 2, 3]);
  var sparse = []; sparse[2] = 1;
  addCorpus('sparseArray', sparse);
  addCorpus('undefArray', [undefined]);
  addCorpus('nestedArrays', [[[]]]);
  addCorpus('emptyObject', {});
  addCorpus('flatObject', { a: 1 });
  addCorpus('spaceKey', { 'a b': 1 });
  addCorpus('numericKey', { 42: 'x' });
  addCorpus('undefProp', { u: undefined });
  addCorpus('fnProp', { f: function () { return 1; } });
  addCorpus('nested', { a: { b: [1, { c: null }] } });
  addCorpus('key1e3', { '1e3': 1 });
  addCorpus('keyNegZero', { '-0': 1 });
  addCorpus('keyControl', { 'a\u0000b': 1 });
  addCorpus('customToJSON', { toJSON: function () { return 'j'; } });
  addCorpus('customToSource', { x: 1, toSource: function () { return 'HACKED'; } });
  var settingsShape = { styleIndex: 0, bendPct: 35, hDistortPct: 0, vDistortPct: 0, showAdvanced: false, verticalAxis: false, preserveWidth: true, preserveHeight: false, anchorIndex: 0, hideOriginal: false, deleteOriginal: false, replaceOriginal: false, previewOpacity: 55, dielineSpotNames: ['CutContour', 'CutContour2', 'dieline'], svgWarpPath: '', svgBoundsPath: '' };
  addCorpus('settingsShape', settingsShape);
  addCorpus('profilesShape', [{ name: 'CutContour 1mm', params: { styleIndex: 1, bendPct: 20, hDistortPct: 0, vDistortPct: 0, showAdvanced: false, verticalAxis: false, preserveWidth: true, preserveHeight: false, anchorIndex: 0, hideOriginal: false, deleteOriginal: false, replaceOriginal: false, previewOpacity: 55 } }]);
  var deep = { leaf: 1 };
  for (var di = 0; di < 50; di++) deep = { next: deep };
  addCorpus('deep50', deep);
  var gv = {};
  if (typeof Object.defineProperty === 'function') {
    try { Object.defineProperty(gv, 'x', { get: function () { return 1; }, enumerable: true }); } catch (e) {}
  }
  addCorpus('getterObj', gv);

  function kernelSource(value) {
    if (K.uneval) return K.uneval(value);
    if (value !== null && typeof value === 'object') {
      var isArr = Object.prototype.toString.apply(value) === '[object Array]';
      if (isArr && K.arrayToSource) return K.arrayToSource.call(value);
      if (!isArr && K.objectToSource) return K.objectToSource.call(value);
    }
    if (typeof value === 'string' && K.stringToSource) return K.stringToSource.call(value);
    if (K.arrayToSource) {
      var s = K.arrayToSource.call([value]);
      if (typeof s === 'string' && s.length >= 2) return s.substring(1, s.length - 1);
    }
    return 'NO_KERNEL';
  }

  var corpusOut = [];
  var ci;
  for (ci = 0; ci < corpus.length; ci++) {
    var ce = corpus[ci];
    var src = 'ERR';
    try { src = kernelSource(ce.value); } catch (e) { src = 'ERR:' + String(e); }
    corpusOut.push({ name: ce.name, source: src });
  }
  R['corpus'] = corpusOut;

  // ---- phase 4: strict parse verdicts (gate, no bundle) -------------------
  var validF = ['null', 'true', 'false', '0', '-0', '1.5', '-2.5e-3', '1e5', '12345678901234567890', '""', '"x"', '"\\"\\\\\\/\\b\\f\\n\\r\\t"', '"\\u0041"', '{}', '[]', '{"a":1}', '[1,2,3]', '{"a":{"b":[1,2,{"c":null}]}}', '  { "a" : 1 }  ', '[null,true,false]', '{"":0}', '{"\\u0061":1}'];
  var invalidF = ['01', '-01', '1.', '.1', '1e', '1e+', '[1,]', '{"a":1,}', '{a:1}', "{'a':1}", 'undefined', 'NaN', 'Infinity', '/*x*/1', '({a:1})', '{"x":(sideEffect=1)}', '{"x":1} extra', '', '{', '"unterminated', '"bad\\x41"', '"bad\\u12g4"', '"bad\\v"', '1..2', '0x1', '+1', 'tru', 'nullx', '[,]', '{:}', '"\\u12"', 'true false', '00', '-00', '\uFEFF{}'];
  var securityF = ['{"a":1,"b":(probe42=42,"x")}', '{"x":(sideEffect=1)}', 'x=1', '{"a":1};globalX=1', '[1].push(99)', '{"x":new Date(0)}'];

  var verdicts = [];
  function gateOk(text) {
    var i2 = 0, n2 = text.length, depth = 0;
    function ws() { while (i2 < n2) { var c = text.charCodeAt(i2); if (c === 32 || c === 9 || c === 10 || c === 13) i2++; else return; } }
    function hex(c) { return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102); }
    function str() {
      i2++;
      while (i2 < n2) {
        var c = text.charCodeAt(i2);
        if (c === 34) { i2++; return true; }
        if (c === 92) {
          i2++;
          if (i2 >= n2) return false;
          var e = text.charAt(i2); i2++;
          if (e === '"' || e === '\\' || e === '/' || e === 'b' || e === 'f' || e === 'n' || e === 'r' || e === 't') continue;
          if (e === 'u') { for (var k = 0; k < 4; k++) { if (i2 >= n2 || !hex(text.charCodeAt(i2))) return false; i2++; } continue; }
          return false;
        }
        if (c < 32) return false;
        i2++;
      }
      return false;
    }
    function num() {
      if (text.charAt(i2) === '-') i2++;
      if (i2 >= n2) return false;
      var c = text.charAt(i2);
      if (c === '0') i2++;
      else if (c >= '1' && c <= '9') { while (i2 < n2 && text.charCodeAt(i2) >= 48 && text.charCodeAt(i2) <= 57) i2++; }
      else return false;
      if (i2 < n2 && text.charAt(i2) === '.') {
        i2++;
        var any = false;
        while (i2 < n2 && text.charCodeAt(i2) >= 48 && text.charCodeAt(i2) <= 57) { any = true; i2++; }
        if (!any) return false;
      }
      if (i2 < n2 && (text.charAt(i2) === 'e' || text.charAt(i2) === 'E')) {
        i2++;
        if (i2 < n2 && (text.charAt(i2) === '+' || text.charAt(i2) === '-')) i2++;
        var any2 = false;
        while (i2 < n2 && text.charCodeAt(i2) >= 48 && text.charCodeAt(i2) <= 57) { any2 = true; i2++; }
        if (!any2) return false;
      }
      return true;
    }
    function lit(w) { if (text.substr(i2, w.length) === w) { i2 += w.length; return true; } return false; }
    function val2() {
      if (i2 >= n2) return false;
      var c = text.charAt(i2);
      if (c === '{') return obj();
      if (c === '[') return arr();
      if (c === '"') return str();
      if (c === 't') return lit('true');
      if (c === 'f') return lit('false');
      if (c === 'n') return lit('null');
      if (c === '-' || (c >= '0' && c <= '9')) return num();
      return false;
    }
    function obj() {
      i2++; depth++;
      if (depth > 512) { depth--; return false; }
      ws();
      if (i2 >= n2) { depth--; return false; }
      if (text.charAt(i2) === '}') { i2++; depth--; return true; }
      for (;;) {
        ws();
        if (i2 >= n2 || text.charAt(i2) !== '"') { depth--; return false; }
        if (!str()) { depth--; return false; }
        ws();
        if (i2 >= n2 || text.charAt(i2) !== ':') { depth--; return false; }
        i2++;
        ws();
        if (!val2()) { depth--; return false; }
        ws();
        if (i2 >= n2) { depth--; return false; }
        var c = text.charAt(i2);
        if (c === ',') { i2++; continue; }
        if (c === '}') { i2++; depth--; return true; }
        depth--; return false;
      }
    }
    function arr() {
      i2++; depth++;
      if (depth > 512) { depth--; return false; }
      ws();
      if (i2 >= n2) { depth--; return false; }
      if (text.charAt(i2) === ']') { i2++; depth--; return true; }
      for (;;) {
        ws();
        if (!val2()) { depth--; return false; }
        ws();
        if (i2 >= n2) { depth--; return false; }
        var c = text.charAt(i2);
        if (c === ',') { i2++; continue; }
        if (c === ']') { i2++; depth--; return true; }
        depth--; return false;
      }
    }
    ws();
    if (!val2()) return false;
    ws();
    return i2 === n2;
  }

  var vj;
  for (vj = 0; vj < validF.length; vj++) verdicts.push({ name: 'valid-' + vj, text: validF[vj], jsGate: gateOk(validF[vj]) });
  for (vj = 0; vj < invalidF.length; vj++) verdicts.push({ name: 'invalid-' + vj, text: invalidF[vj], jsGate: gateOk(invalidF[vj]) });
  for (vj = 0; vj < securityF.length; vj++) verdicts.push({ name: 'security-' + vj, text: securityF[vj], jsGate: gateOk(securityF[vj]) });
  R['gateVerdicts'] = verdicts;

  // ---- phase 5: inject vendored json2 --------------------------------------
  var json2Loaded = false;
  try {
    if (json2Path && File(json2Path).exists) {
      var jf = new File(json2Path);
      jf.encoding = 'UTF-8';
      if (jf.open('r')) {
        var j2src = jf.read();
        jf.close();
        eval(j2src);
        json2Loaded = typeof JSON !== 'undefined' && typeof JSON.stringify === 'function';
      }
    }
  } catch (e) { R['json2.loadError'] = String(e); }
  R['json2.loaded'] = String(json2Loaded);
  R['afterJson2.typeof $.global.JSON'] = typeof $.global.JSON;
  R['afterJson2.typeof JSON'] = typeof JSON;

  // ---- phase 6: load the ESON bundle and run differential ------------------
  var bundleLoaded = false;
  var bundleError = '';
  try {
    if (File(bundlePath).exists) {
      var bf = new File(bundlePath);
      bf.encoding = 'UTF-8';
      if (bf.open('r')) {
        var bsrc = bf.read();
        bf.close();
        eval(bsrc);
        bundleLoaded = typeof ESON !== 'undefined' && typeof ESON.stringify === 'function';
      }
    }
  } catch (e) { bundleError = String(e); }
  R['bundle.loaded'] = String(bundleLoaded);
  R['bundle.error'] = bundleError;

  if (bundleLoaded) {
    try { R['eson.caps.json'] = JSON.stringify(ESON.capabilities().json); } catch (e) { R['eson.caps.json'] = 'ERR:' + String(e); }
    R['eson.caps.sourceProfile'] = ESON.capabilities().sourceProfile;

    // Differential reference is the private injected json2 (ESON_JSON2), not
    // the engine's global JSON (which may be a different polyfill left by
    // earlier probes - engine-state contamination is itself recorded).
    var globalJsonFingerprint = '';
    try { globalJsonFingerprint = String(JSON.stringify).substring(0, 60); } catch (e) {}
    R['globalJson.stringifyFingerprint'] = globalJsonFingerprint;

    var diff = [];
    var di2;
    for (di2 = 0; di2 < corpus.length; di2++) {
      var dce = corpus[di2];
      var mine = 'ERR';
      var theirs = 'ERR';
      var valueEqual = false;
      try { mine = ESON.stringify(dce.value); } catch (e) { mine = 'ERR:' + String(e); }
      try { theirs = ESON_JSON2.stringify(dce.value); } catch (e) { theirs = 'ERR:' + String(e); }
      if (mine.indexOf('ERR') !== 0 && theirs.indexOf('ERR') !== 0) {
        try {
          valueEqual = ESON.stringify(ESON.parse(mine)) === ESON.stringify(ESON.parse(theirs));
        } catch (e) { valueEqual = false; }
      }
      diff.push({ name: dce.name, eson: mine, json2: theirs, equal: mine === theirs, valueEqual: String(valueEqual) });
    }
    R['differential'] = diff;

    // enrich the phase-3 corpus with the reference output for live-verify
    var cv2;
    for (cv2 = 0; cv2 < corpusOut.length; cv2++) {
      try {
        corpusOut[cv2].json2Expected = ESON_JSON2.stringify(corpus[cv2].value);
      } catch (e) {
        corpusOut[cv2].json2Expected = 'ERR:' + String(e);
      }
    }
    R['corpus'] = corpusOut;

    var parseRes = [];
    var pv;
    for (pv = 0; pv < validF.length; pv++) {
      var pr = 'ERR';
      try { pr = 'ok:' + (ESON.parse(validF[pv]) !== undefined ? 'value' : 'value'); } catch (e) { pr = 'threw'; }
      parseRes.push({ name: 'valid-' + pv, eson: pr });
    }
    for (pv = 0; pv < invalidF.length; pv++) {
      try { ESON.parse(invalidF[pv]); parseRes.push({ name: 'invalid-' + pv, eson: 'accepted' }); }
      catch (e) { parseRes.push({ name: 'invalid-' + pv, eson: 'threw' }); }
    }
    for (pv = 0; pv < securityF.length; pv++) {
      try { ESON.parse(securityF[pv]); parseRes.push({ name: 'security-' + pv, eson: 'accepted' }); }
      catch (e) { parseRes.push({ name: 'security-' + pv, eson: 'threw' }); }
    }
    R['parseVerdicts'] = parseRes;
    var probe42 = 0;
    R['security.probe42AfterParse'] = String(probe42);
    R['security.globalXAfterParse'] = typeof $.global.globalX;
    // Trusted-lane contract: raw eval DOES execute. Proven deliberately.
    try { eval('({"a":1,"b":(probe42=42,"x")})'); R['rawEval.sideEffect'] = 'executed:' + probe42; }
    catch (e) { R['rawEval.sideEffect'] = 'threw:' + String(e); }

    var checkedRes = [];
    var cv = ['({a:1, b:[true, null, "x"]})', '({u:undefined, n:NaN, i:Infinity})', '[undefined, undefined, 1]', '({"a b":1})', '({42:"x"})', '({a:"\\v\\x41\\0"})', 'undefined', 'NaN', 'Infinity', '42', '"x"', '({a:1e3})'];
    for (pv = 0; pv < cv.length; pv++) {
      try { var cval = ESON.decodeSourceChecked(cv[pv]); checkedRes.push({ name: 'valid-' + pv, text: cv[pv], ok: 'ok' }); }
      catch (e) { checkedRes.push({ name: 'valid-' + pv, text: cv[pv], ok: 'threw:' + String(e) }); }
    }
    var civ = ['({f:(function () { return 1; })})', '(new Date(0))', '({a:1}).x', '({a:1});x=1', 'x=1', '(function(){return 1;})()', '({a:/re/})', '({a:this})', '({a:1}, {b:2})'];
    for (pv = 0; pv < civ.length; pv++) {
      try { ESON.decodeSourceChecked(civ[pv]); checkedRes.push({ name: 'invalid-' + pv, text: civ[pv], ok: 'accepted' }); }
      catch (e) { checkedRes.push({ name: 'invalid-' + pv, text: civ[pv], ok: 'threw' }); }
    }
    R['checkedVerdicts'] = checkedRes;

    var trustedRes = [];
    if (ESON.capabilities().sourceProfile !== 'none') {
      var tc = [settingsShape, 'a"b\\c\n', 1.5, [1, undefined, 2], { u: undefined, n: NaN }];
      for (pv = 0; pv < tc.length; pv++) {
        try {
          var enc = ESON.encodeSource(tc[pv]);
          var dec = ESON.decodeSourceTrusted(enc);
          trustedRes.push({ name: 'case-' + pv, enc: enc, ok: 'ok' });
        } catch (e) { trustedRes.push({ name: 'case-' + pv, ok: 'ERR:' + String(e) }); }
      }
    }
    R['trustedCodec'] = trustedRes;

    try { R['eson.benchmark'] = JSON.stringify(ESON.benchmark(50)); } catch (e) { R['eson.benchmark'] = 'ERR:' + String(e); }
  }

  // ---- phase 7: write report ----------------------------------------------
  var reportPath = '';
  try {
    var outPath = $.getenv('TEMP') + '/eson-capability-report-' + route + '.json';
    var f = new File(outPath);
    f.encoding = 'UTF-8';
    if (f.open('w')) {
      if (typeof JSON !== 'undefined' && typeof JSON.stringify === 'function') f.write(JSON.stringify(R));
      f.close();
      reportPath = outPath;
    }
  } catch (e) { reportPath = 'ERR:' + String(e); }
  R['reportFile'] = reportPath;

  var summary = {
    route: R['route'],
    engineName: R['dollar.engineName'],
    jsonBefore: R['typeof $.global.JSON'],
    kernelProfile: R['kernel.profile'],
    bundleLoaded: R['bundle.loaded'],
    reportFile: reportPath
  };
  return summary;
})();
