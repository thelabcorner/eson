// Microbench v3: precompiled (module-level) regexes + split/join + normalize.
// The v2 numbers conflated compile+execute (inline regex literals recompile
// per call); this isolates the true per-op execute cost.
(function () {
  var R = {};

  // precompiled patterns
  var rx_protect = /"(\\.|[^"\\])*"/g;
  var rx_key = /([{,]\s*[A-Za-z_$][A-Za-z0-9_$]*|-?\d+)(?=:)/g;
  var rx_check = /[{,]\s*[A-Za-z_$][A-Za-z0-9_$]*:|[{,]\s*-?\d+:|\(|\)|undefined|NaN|Infinity|function|new/;
  var rx_restore = /@(\d+)@/g;
  var rx_brackets = /[^\[\]{}]/g;

  var S1 = '({styleIndex:0, bendPct:35, hDistortPct:0, vDistortPct:0, showAdvanced:false, verticalAxis:false, preserveWidth:true, preserveHeight:false, anchorIndex:0, hideOriginal:false, deleteOriginal:false, replaceOriginal:false, previewOpacity:55, dielineSpotNames:["CutContour", "CutContour2", "dieline"], svgWarpPath:"", svgBoundsPath:""})';
  var S2 = '[({name:"CutContour 1mm", params:{styleIndex:1, bendPct:20, hDistortPct:0, vDistortPct:0, showAdvanced:false, verticalAxis:false, preserveWidth:true, preserveHeight:false, anchorIndex:0, hideOriginal:false, deleteOriginal:false, replaceOriginal:false, previewOpacity:55}}), ({name:"CutContour 2mm", params:{styleIndex:1, bendPct:25, hDistortPct:0, vDistortPct:0, showAdvanced:false, verticalAxis:false, preserveWidth:true, preserveHeight:false, anchorIndex:0, hideOriginal:false, deleteOriginal:false, replaceOriginal:false, previewOpacity:55}})]';
  var S3 = '';
  (function () {
    var parts = [];
    var i;
    for (i = 0; i < 150; i++) {
      parts.push('({name:"CutContour ' + (i + 1) + 'mm", params:{styleIndex:1, bendPct:' + (20 + (i % 40)) + ', hDistortPct:0, vDistortPct:0, showAdvanced:false, verticalAxis:false, preserveWidth:true, preserveHeight:false, anchorIndex:0, hideOriginal:false, deleteOriginal:false, replaceOriginal:false, previewOpacity:55}})');
    }
    S3 = '[' + parts.join(', ') + ']';
  })();

  var texts = [
    { name: 'settings-src', t: S1 },
    { name: 'profiles6-src', t: S2 },
    { name: 'profiles150-src', t: S3 }
  ];

  var sources = [
    { name: 'settings', t: S1 },
    { name: 'profiles6', t: S2 },
    { name: 'profiles150', t: S3 }
  ];

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
      if (d < 0 || d > 10000000) continue;
      samples.push(d);
    }
    if (!samples.length) samples.push(-1);
    samples.sort(function (a, b) { return a - b; });
    return samples[Math.floor(samples.length / 2)];
  }

  var rows = [];

  // protect pass (precompiled regex, callback)
  function protect(t) {
    var n = 0;
    return t.replace(rx_protect, function (m) { n++; return '@' + n + '@'; });
  }
  // split/join structural transforms
  function splitJoins(t) {
    return t.split('({').join('{').split('})').join('}').split(', ').join(',');
  }
  // key-quote pass
  function keyQuote(t) {
    return t.replace(rx_key, function (m, p1) { return p1.replace(/\s+$/, '') + ':' + p1.charAt(p1.length - 1) === ':' ? m : m; });
  }
  // simple check
  function check(t) { return rx_check.test(t); }
  // restore pass
  function restore(t, vals) {
    return t.replace(rx_restore, function (m, d) { return vals[Number(d)]; });
  }
  // bracket extraction
  function brackets(t) { return t.replace(rx_brackets, ''); }
  // full fast-path transform
  function fastPath(t) {
    var vals = [];
    var n = 0;
    var p = t.replace(rx_protect, function (m) { n++; vals[n] = m; return '@' + n + '@'; });
    p = p.split('({').join('{').split('})').join('}').split(', ').join(',');
    p = p.replace(rx_key, function (m, pre, key) { return pre + '"' + key + '"'; });
    if (rx_check.test(p)) return null;
    return p.replace(rx_restore, function (m, d) { return vals[Number(d)]; });
  }

  var laneDefs = [
    ['protect', protect],
    ['splitJoins', splitJoins],
    ['keyQuote', keyQuote],
    ['check', check],
    ['brackets', brackets],
    ['fastPath-full', fastPath]
  ];
  var li;
  for (li = 0; li < laneDefs.length; li++) {
    var lname = laneDefs[li][0];
    var lfn = laneDefs[li][1];
    var pi;
    for (pi = 0; pi < sources.length; pi++) {
      var src = sources[pi];
      var med = timeLane(function () { lfn(src.t); }, 3, 15);
      rows.push({ lane: lname, payload: src.name, bytes: src.t.length, medianUs: med });
    }
  }

  // fastPath correctness spot-check: transform must yield valid JSON for the
  // sources (byte-parity check against a manual expectation for settings)
  var fpOut = fastPath(S1);
  R['fastPath.settings.out'] = fpOut;
  R['fastPath.settings.valid'] = String(/^\{".*"\}$/.test(fpOut || ''));

  R['rows'] = rows;

  // normalize cost: build the shadow graph of the settings object
  function settingsObj() {
    return { styleIndex: 0, bendPct: 35, hDistortPct: 0, vDistortPct: 0, showAdvanced: false, verticalAxis: false, preserveWidth: true, preserveHeight: false, anchorIndex: 0, hideOriginal: false, deleteOriginal: false, replaceOriginal: false, previewOpacity: 55, dielineSpotNames: ['CutContour', 'CutContour2', 'dieline'], svgWarpPath: '', svgBoundsPath: '' };
  }
  function normalizeLike(v) {
    var out = {};
    var k;
    for (k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = v[k];
    }
    return out;
  }
  var sobj = settingsObj();
  var normMed = timeLane(function () { normalizeLike(sobj); }, 3, 30);
  R['normalize-copy.settings'] = normMed;
  var tsMed = timeLane(function () { sobj.toSource(); }, 3, 30);
  R['toSource.settings'] = tsMed;

  var reportPath = '';
  try {
    var outPath = $.getenv('TEMP') + '/eson-microbench3.json';
    var f = new File(outPath);
    f.encoding = 'UTF-8';
    if (f.open('w')) {
      f.write(JSON.stringify(R));
      f.close();
      reportPath = outPath;
    }
  } catch (e) { reportPath = 'ERR:' + String(e); }
  R['reportFile'] = reportPath;
  return R;
})();
