// Per-pass profiler v2: the NEW merged pre-scan passes.
#target illustrator

$.evalFile(File('C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eson/dist/ESON.jsx'));
$.evalFile(File('C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eson/dist/json2-reference.jsx'));

function settingsPayload() {
  return {
    bend: 45, hDistort: 0, vDistort: 0, rotate: 0, preserveWidth: true,
    preserveHeight: false, anchorIndex: 0, hideOriginal: false,
    deleteOriginal: false, replaceOriginal: false, previewOpacity: 55
  };
}
function profilesPayload(n) {
  var out = {};
  for (var i = 0; i < n; i++) {
    out['p' + i] = { bend: i * 0.5, hDistort: 0, vDistort: 0, rotate: 0, flags: [true, false, i % 2 === 0], name: 'profile ' + i + ' \u00e9\u00a0' };
  }
  return out;
}
function keyHeavy(n) {
  var o = {};
  for (var i = 0; i < n; i++) o['field_' + i] = i;
  return o;
}

var j2 = JSON2;
var settings = j2.stringify(settingsPayload());
var profiles = j2.stringify(profilesPayload(150));
var keys = j2.stringify(keyHeavy(5000));

var rx_protect = /"(\\.|[^"\\])*"/g;
var rx_exponent = /([0-9])[eE][+\-]?\d+/g;
var rx_positional = /([\[{,])\s*[^"@\s[\]{},:]+:|(^|[^0-9.])0[0-9]|[^\[{,:\s]\s*-|\.(\s*[,\]}:]|[eE]|$)/;
var rx_dangerous = /[\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
var rx_backslash_dangerous = /(?:^|[^\\])(?:\\\\)*\\[\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/;
var rx_two = /\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g;
var rx_three = /"[^"\\\x00-\x1f]*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+\-]?\d+)?/g;
var rx_four = /(?:^|:|,)(?:\s*\[)+/g;
var rx_one = /^[\],:{}\t\n\r ]*$/;

var rx_value_runs = /[^\[\]{},@\t\n\r ]+/g;
function structuralScanOk(prot) {
  var struct = prot.replace(rx_value_runs, '_');
  var n = struct.length, depth = 0, justAfterSep = true, i, c, k;
  for (i = 0; i < n; i++) {
    c = struct.charCodeAt(i);
    if (c === 91 || c === 123) { depth++; justAfterSep = true; if (depth > 512) return false; }
    else if (c === 93 || c === 125) { depth--; if (depth < 0) return false; justAfterSep = false; }
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
function preScanNew(text) {
  if (/[\x00-\x09\x0b\x0c\x0e-\x1f]/.test(text)) return 'controls';
  if (rx_backslash_dangerous.test(text)) return 'bs-danger';
  var prot = text.replace(rx_protect, '@');
  var x = prot.replace(rx_exponent, '$1X');
  if (rx_positional.test(x)) return 'positional';
  if (!structuralScanOk(prot)) return 'scan';
  return 'PASS';
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
function run(text, iters) {
  rows.push({ pass: 'protect', bytes: text.length, medianUs: timeLane(function () { text.replace(rx_protect, '@'); }, 3, iters) });
  rows.push({ pass: 'mask', bytes: text.length, medianUs: timeLane(function () { text.replace(rx_exponent, '$1X'); }, 3, iters) });
  rows.push({ pass: 'positional', bytes: text.length, medianUs: timeLane(function () { rx_positional.test(text); }, 3, iters) });
  rows.push({ pass: 'controls', bytes: text.length, medianUs: timeLane(function () { /[\x00-\x09\x0b\x0c\x0e-\x1f]/.test(text); }, 3, iters) });
  rows.push({ pass: 'bs-danger', bytes: text.length, medianUs: timeLane(function () { rx_backslash_dangerous.test(text); }, 3, iters) });
  rows.push({ pass: 'scan', bytes: text.length, medianUs: timeLane(function () { structuralScanOk(text); }, 3, iters) });
  rows.push({ pass: 'preScan-total', bytes: text.length, medianUs: timeLane(function () {
    if (/[\x00-\x09\x0b\x0c\x0e-\x1f]/.test(text)) return false;
    if (rx_backslash_dangerous.test(text)) return false;
    var prot = text.replace(rx_protect, '@');
    var x = prot.replace(rx_exponent, '$1X');
    if (rx_positional.test(x)) return false;
    return structuralScanOk(prot);
  }, 3, iters) });
  rows.push({ pass: 'skeleton', bytes: text.length, medianUs: timeLane(function () {
    var sub = text.replace(rx_two, '@');
    var skel = sub.replace(rx_three, ']').replace(rx_four, '');
    rx_one.test(skel);
  }, 3, iters) });
  rows.push({ pass: 'sanitize-test', bytes: text.length, medianUs: timeLane(function () { rx_dangerous.lastIndex = 0; rx_dangerous.test(text); }, 3, iters) });
  rows.push({ pass: 'sanitize-full', bytes: text.length, medianUs: timeLane(function () { rx_dangerous.lastIndex = 0; if (rx_dangerous.test(text)) { text.replace(rx_dangerous, function (a) { return '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4); }); } }, 3, iters) });
  rows.push({ pass: 'parseJson-inline', bytes: text.length, medianUs: timeLane(function () {
    var raw = String(text);
    if (/[\x00-\x09\x0b\x0c\x0e-\x1f]/.test(raw)) return false;
    if (rx_backslash_dangerous.test(raw)) return false;
    var prot = raw.replace(rx_protect, '@');
    var x = prot.replace(rx_exponent, '$1X');
    if (rx_positional.test(x)) return false;
    if (!structuralScanOk(prot)) return false;
    rx_dangerous.lastIndex = 0;
    var s2 = rx_dangerous.test(raw) ? raw.replace(rx_dangerous, function (a) { return '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4); }) : raw;
    return j2.parse(s2, undefined);
  }, 3, iters) });
  rows.push({ pass: 'eson.parse', bytes: text.length, medianUs: timeLane(function () { ESON.parse(text); }, 3, iters) });
  rows.push({ pass: 'json2.parse', bytes: text.length, medianUs: timeLane(function () { j2.parse(text); }, 3, iters) });
}

run(settings, 60);
run(profiles, 12);
run(keys, 12);

var rf = new File($.getenv('TEMP') + '/eson-prescan2.json');
rf.encoding = 'UTF-8';
rf.open('w');
rf.write(JSON.stringify({ verdicts: { settings: preScanNew(settings), profiles: preScanNew(profiles), keys: preScanNew(keys) }, rows: rows }));
rf.close();
