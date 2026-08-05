// Per-pass profiler for the ESON parse pre-scan: which pass dominates?
#target illustrator

$.evalFile(File('C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eson/dist/ESON.jsx'));

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

var j2 = ESON_JSON2;
var settings = j2.stringify(settingsPayload());
var profiles = j2.stringify(profilesPayload(150));
var keys = j2.stringify(keyHeavy(5000));

// ---- exact passes from validate.ts ----
var rx_two = /\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g;
var rx_three = /"[^"\\\x00-\x1f]*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+\-]?\d+)?/g;
var rx_four = /(?:^|:|,)(?:\s*\[)+/g;
var rx_one = /^[\],:{}\t\n\r ]*$/;
var rx_bare_key = /([\[{,])\s*[^"@\s[\]{},:]+:/;
var rx_bad_comma = /(^|[\[{,])\s*,/;
var rx_protect = /"(\\.|[^"\\])*"/g;
var rx_backslash_dangerous = /(?:^|[^\\])(?:\\\\)*\\[\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/;

function structuralText(text) {
  var n = 0;
  return text.replace(rx_protect, function () { n++; return '@' + n + '@'; });
}
function structuralTextFixed(text) {
  return text.replace(rx_protect, '@');
}
function numberBoundariesOk(sub) {
  var x = sub.replace(/([0-9])[eE][+\-]?\d+/g, '$1X');
  if (/(^|[^0-9.])0[0-9]/.test(x)) return false;
  if (/[^\[{,:\s]\s*-/.test(x)) return false;
  return true;
}
function topLevelCommaOk(text) {
  var n = text.length, depth = 0, inStr = false, i, c;
  for (i = 0; i < n; i++) {
    c = text.charCodeAt(i);
    if (inStr) { if (c === 92) i++; else if (c === 34) inStr = false; }
    else {
      if (c === 34) inStr = true;
      else if (c === 91 || c === 123) depth++;
      else if (c === 93 || c === 125) depth--;
      else if (c === 44 && depth === 0) return false;
    }
  }
  return true;
}
function depthOk(text) {
  var n = text.length, brackets = '', inStr = false, i, c;
  for (i = 0; i < n; i++) {
    c = text.charCodeAt(i);
    if (inStr) { if (c === 92) i++; else if (c === 34) inStr = false; }
    else {
      if (c === 34) inStr = true;
      else if (c === 91 || c === 123 || c === 93 || c === 125) brackets += text.charAt(i);
    }
  }
  var bn = brackets.length, depth = 0, j, b;
  for (j = 0; j < bn; j++) {
    b = brackets.charCodeAt(j);
    if (b === 91 || b === 123) { depth++; if (depth > 512) return false; }
    else { depth--; if (depth < 0) return false; }
  }
  return true;
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

function profile(label, text, fn, iters) {
  var w = Math.max(3, Math.floor(iters / 3));
  var med = timeLane(fn, w, iters);
  return { pass: label, bytes: text.length, medianUs: med };
}

var rows = [];
function run(text, iters) {
  rows.push(profile('protect-callback', text, function () { structuralText(text); }, iters));
  rows.push(profile('protect-fixed@', text, function () { structuralTextFixed(text); }, iters));
  rows.push(profile('numBoundaries', text, function () { numberBoundariesOk(structuralTextFixed(text)); }, iters));
  rows.push(profile('controls.test', text, function () { /[\x00-\x09\x0b\x0c\x0e-\x1f]/.test(text); }, iters));
  rows.push(profile('bs-danger.test', text, function () { rx_backslash_dangerous.test(text); }, iters));
  rows.push(profile('topComma.walk', text, function () { topLevelCommaOk(text); }, iters));
  rows.push(profile('depth.walk', text, function () { depthOk(text); }, iters));
  rows.push(profile('bareKey.test', text, function () { rx_bare_key.test(structuralTextFixed(text)); }, iters));
  rows.push(profile('badComma.test', text, function () { rx_bad_comma.test(structuralTextFixed(text)); }, iters));
  rows.push(profile('trailing.test', text, function () { /,\s*[\]}]/.test(structuralTextFixed(text)); }, iters));
  rows.push(profile('skeleton', text, function () {
    var sub = text.replace(rx_two, '@');
    var skel = sub.replace(rx_three, ']').replace(rx_four, '');
    rx_one.test(skel);
  }, iters));
}

run(settings, 60);
run(profiles, 15);
run(keys, 15);

var out = { rows: rows };
var rf = new File($.getenv('TEMP') + '/eson-prescan-profile.json');
rf.encoding = 'UTF-8';
rf.open('w');
rf.write(JSON.stringify(out));
rf.close();
