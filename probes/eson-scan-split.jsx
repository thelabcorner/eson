// Prototype: split the scan-walk into native regex rules + a reduced walk.
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
var t = j2.stringify(profilesPayload(150));
var rx_protect = /"([^"\\\x00-\x1f]|\\["\\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/g;
var rx_value_runs = /[^\[\]{},:@\t\n\r ]+/g;
var prot = t.replace(rx_protect, '@');
var struct = prot.replace(rx_value_runs, '_');

var rx_comma_rules = /(^|[\[{,])\s*,|,\s*[\]}]/;
var rx_value_bracket = /([^\[{,:\s])[\[{]/;
var rx_comma_combined = /(^|[\[{,])\s*,|,\s*[\]}]|([^\[{,:\s])[\[{]/;

function walkFull(s) {
  var n = s.length, depth = 0, justAfterSep = true, i, c, k;
  for (i = 0; i < n; i++) {
    c = s.charCodeAt(i);
    if (c === 91 || c === 123) { if (!justAfterSep) return false; depth++; justAfterSep = true; if (depth > 512) return false; }
    else if (c === 93 || c === 125) { depth--; if (depth < 0) return false; justAfterSep = false; }
    else if (c === 58) { justAfterSep = true; }
    else if (c === 44) {
      if (depth === 0) return false;
      if (justAfterSep) return false;
      k = i + 1;
      while (k < n && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9 || s.charCodeAt(k) === 10 || s.charCodeAt(k) === 13)) k++;
      if (k < n && (s.charCodeAt(k) === 93 || s.charCodeAt(k) === 125)) return false;
      justAfterSep = true;
    } else if (c === 32 || c === 9 || c === 10 || c === 13) { }
    else { justAfterSep = false; }
  }
  return true;
}
function walkReduced(s) {
  var n = s.length, depth = 0, i, c;
  for (i = 0; i < n; i++) {
    c = s.charCodeAt(i);
    if (c === 91 || c === 123) { depth++; if (depth > 512) return false; }
    else if (c === 93 || c === 125) { depth--; if (depth < 0) return false; }
    else if (c === 44 && depth === 0) return false;
  }
  return true;
}
function splitScan(s) {
  if (rx_comma_combined.test(s)) return false;
  return walkReduced(s);
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
rows.push({ name: 'walk-full', medianUs: timeLane(function () { walkFull(struct); }, 5, 40) });
rows.push({ name: 'regex-comma-rules', medianUs: timeLane(function () { rx_comma_rules.test(struct); }, 5, 40) });
rows.push({ name: 'regex-value-bracket', medianUs: timeLane(function () { rx_value_bracket.test(struct); }, 5, 40) });
rows.push({ name: 'regex-combined', medianUs: timeLane(function () { rx_comma_combined.test(struct); }, 5, 40) });
rows.push({ name: 'walk-reduced', medianUs: timeLane(function () { walkReduced(struct); }, 5, 40) });
rows.push({ name: 'split-scan-total', medianUs: timeLane(function () { splitScan(struct); }, 5, 40) });
rows.push({ name: 'scan-current-total', medianUs: timeLane(function () { walkFull(struct); }, 5, 40) });

var rf = new File($.getenv('TEMP') + '/eson-scan-split.json');
rf.encoding = 'UTF-8';
rf.open('w');
rf.write(JSON.stringify({ textBytes: t.length, structBytes: struct.length, sane: walkFull(struct) === splitScan(struct), rows: rows }));
rf.close();
