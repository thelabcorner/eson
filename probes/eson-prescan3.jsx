// Per-pass profiler v3: the eval-only pre-scan's new checks.
#target illustrator

$.evalFile(File('C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eson/dist/ESON.jsx'));
$.evalFile(File('C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eson/dist/json2-reference.jsx'));

var j2 = JSON2;
function profilesPayload(n) {
  var out = {};
  for (var i = 0; i < n; i++) {
    out['p' + i] = { bend: i * 0.5, hDistort: 0, vDistort: 0, rotate: 0, flags: [true, false, i % 2 === 0], name: 'profile ' + i + ' \u00e9\u00a0' };
  }
  return out;
}
var profiles = j2.stringify(profilesPayload(150));

var rx_controls_scan = /[\x00-\x09\x0b\x0c\x0e-\x1f]/;
var rx_js_escape = /(?:^|[^\\])(?:\\\\)*\\[^"\\\/bfnrtu]/;
var rx_allowed_charset = /[^\[\]{},:@\t\n\r 0-9eE\-.A-Za-z]/;
var rx_leading_dot = /(^|[^0-9])\./;
var rx_ident_strip = /true|false|null|[^A-Za-z]/g;
var rx_protect = /"(\\.|[^"\\])*"/g;
var rx_exponent = /([0-9])[eE][+\-]?\d+/g;
var rx_positional = /([\[{,])\s*[^"@\s[\]{},:]+:|(^|[^0-9.])0[0-9]|[^\[{,:\s]\s*-|-\D|\.(\s*[,\]}:]|[eE]|$)/;
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
function preScanFull(text) {
  if (rx_controls_scan.test(text)) return false;
  if (rx_js_escape.test(text)) return false;
  var prot = text.replace(rx_protect, '@');
  if (rx_allowed_charset.test(prot)) return false;
  if (rx_leading_dot.test(prot)) return false;
  var x = prot.replace(rx_exponent, '$1X');
  if (rx_positional.test(x)) return false;
  if (x.replace(rx_ident_strip, '').length > 0) return false;
  return structuralScanOk(prot);
}

function timeLane(fn, warmup, iters) {
  var w;
  for (w = 0; w < warmup; w++) fn();
  var samples = [], i, t0, t1, d;
  for (i = 0; i < iters; i++) {
    t0 = $.hiresTimer;
    fn();
    t1 = $.hiresTimer;
    d = t1 - t0;
    if (d < 0 || d > 10000000) continue;
    samples.push(d);
  }
  samples.sort(function (a, b) { return a - b; });
  return samples[Math.floor(samples.length / 2)];
}

var rows = [];
var t = profiles;
rows.push({ pass: 'controls', medianUs: timeLane(function () { rx_controls_scan.test(t); }, 3, 12) });
rows.push({ pass: 'js-escape', medianUs: timeLane(function () { rx_js_escape.test(t); }, 3, 12) });
rows.push({ pass: 'protect', medianUs: timeLane(function () { t.replace(rx_protect, '@'); }, 3, 12) });
rows.push({ pass: 'allowed-set', medianUs: timeLane(function () { var p = t.replace(rx_protect, '@'); rx_allowed_charset.test(p); }, 3, 12) });
rows.push({ pass: 'leading-dot', medianUs: timeLane(function () { var p = t.replace(rx_protect, '@'); rx_leading_dot.test(p); }, 3, 12) });
rows.push({ pass: 'mask+positional', medianUs: timeLane(function () { var p = t.replace(rx_protect, '@'); var x = p.replace(rx_exponent, '$1X'); rx_positional.test(x); }, 3, 12) });
rows.push({ pass: 'identifier', medianUs: timeLane(function () { var p = t.replace(rx_protect, '@'); var x = p.replace(rx_exponent, '$1X'); x.replace(rx_ident_strip, '').length; }, 3, 12) });
rows.push({ pass: 'scan', medianUs: timeLane(function () { var p = t.replace(rx_protect, '@'); structuralScanOk(p); }, 3, 12) });
rows.push({ pass: 'preScan-total', medianUs: timeLane(function () { preScanFull(t); }, 3, 12) });
rows.push({ pass: 'eson.parse', medianUs: timeLane(function () { ESON.parse(t); }, 3, 12) });
rows.push({ pass: 'json2.parse', medianUs: timeLane(function () { j2.parse(t); }, 3, 12) });
rows.push({ pass: 'raw.eval', medianUs: timeLane(function () { eval('(' + t + ')'); }, 3, 12) });

var rf = new File($.getenv('TEMP') + '/eson-prescan3.json');
rf.encoding = 'UTF-8';
rf.open('w');
rf.write(JSON.stringify({ bytes: t.length, verdict: preScanFull(t), rows: rows }));
rf.close();
