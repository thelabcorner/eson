// Optimization-scientist profile: CURRENT pre-scan per-pass costs + CoV.
#target illustrator

$.evalFile(File('C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eson/dist/ESON.jsx'));
var j2 = ESON_JSON2;

function profilesPayload(n) {
  var out = {};
  for (var i = 0; i < n; i++) {
    out['p' + i] = { bend: i * 0.5, hDistort: 0, vDistort: 0, rotate: 0, flags: [true, false, i % 2 === 0], name: 'profile ' + i + ' \u00e9\u00a0' };
  }
  return out;
}
var profiles = j2.stringify(profilesPayload(150));

var rx_controls_scan = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
var rx_protect = /"([^"\\\x00-\x1f]|\\["\\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/g;
var rx_allowed_charset = /[^\[\]{},:@\t\n\r 0-9eE+\-.A-Za-z]/;
var rx_exponent = /([0-9])[eE][+\-]?\d+/g;
var rx_positional = /([\[{,])\s*[^"@\s[\]{},:]+:|(^|[^0-9.])0[0-9]|[^\[{,:\s]\s*-|-\D|\+|(^|[^0-9])\.|\.(\s*[,\]}:]|[eE]|$)/;
var rx_ident_strip = /true|false|null|[^A-Za-z]/g;
var rx_value_runs = /[^\[\]{},:@\t\n\r ]+/g;
function structuralScanOk(prot) {
  var struct = prot.replace(rx_value_runs, '_');
  var n = struct.length, depth = 0, justAfterSep = true, i, c, k;
  for (i = 0; i < n; i++) {
    c = struct.charCodeAt(i);
    if (c === 91 || c === 123) { if (!justAfterSep) return false; depth++; justAfterSep = true; if (depth > 512) return false; }
    else if (c === 93 || c === 125) { depth--; if (depth < 0) return false; justAfterSep = false; }
    else if (c === 58) { justAfterSep = true; }
    else if (c === 44) {
      if (depth === 0) return false;
      if (justAfterSep) return false;
      k = i + 1;
      while (k < n && (struct.charCodeAt(k) === 32 || struct.charCodeAt(k) === 9 || struct.charCodeAt(k) === 10 || struct.charCodeAt(k) === 13)) k++;
      if (k < n && (struct.charCodeAt(k) === 93 || struct.charCodeAt(k) === 125)) return false;
      justAfterSep = true;
    } else if (c === 32 || c === 9 || c === 10 || c === 13) { }
    else { justAfterSep = false; }
  }
  return true;
}

function timeLane(fn, warmup, iters) {
  var w;
  for (w = 0; w < warmup; w++) fn();
  var samples = [], i, t0, t1, d, sum = 0, mean, varSum = 0;
  for (i = 0; i < iters; i++) {
    t0 = $.hiresTimer;
    fn();
    t1 = $.hiresTimer;
    d = t1 - t0;
    if (d < 0 || d > 10000000) continue;
    samples.push(d);
    sum += d;
  }
  mean = sum / samples.length;
  for (i = 0; i < samples.length; i++) varSum += (samples[i] - mean) * (samples[i] - mean);
  samples.sort(function (a, b) { return a - b; });
  var stdev = Math.sqrt(varSum / samples.length);
  return {
    median: samples[Math.floor(samples.length / 2)],
    mean: mean,
    stdev: stdev,
    cov: stdev / mean * 100,
    n: samples.length
  };
}

var t = profiles;
var prot = t.replace(rx_protect, '@');
var x = prot.replace(rx_exponent, '$1#');

var rows = [];
function row(name, fn) {
  var r = timeLane(fn, 5, 30);
  rows.push({ pass: name, medianUs: Math.round(r.median), covPct: r.cov.toFixed(1), n: r.n });
}
row('controls', function () { rx_controls_scan.test(t); });
row('protect', function () { t.replace(rx_protect, '@'); });
row('charset', function () { rx_allowed_charset.test(prot); });
row('mask', function () { prot.replace(rx_exponent, '$1#'); });
row('positional', function () { rx_positional.test(x); });
row('ident', function () { x.replace(rx_ident_strip, '').length; });
row('scan-collapse', function () { prot.replace(rx_value_runs, '_'); });
row('scan-walk', function () { structuralScanOk(prot); });
row('preScan-total', function () {
  if (rx_controls_scan.test(t)) return false;
  var p = t.replace(rx_protect, '@');
  if (rx_allowed_charset.test(p)) return false;
  var xx = p.replace(rx_exponent, '$1#');
  if (rx_positional.test(xx)) return false;
  if (xx.replace(rx_ident_strip, '').length > 0) return false;
  return structuralScanOk(p);
});
row('eson.parse.cold', function () { ESON.parse(t + new Array(1).join(' ')); });

var rf = new File($.getenv('TEMP') + '/eson-profile-current.json');
rf.encoding = 'UTF-8';
rf.open('w');
rf.write(JSON.stringify({ bytes: t.length, rows: rows }));
rf.close();
