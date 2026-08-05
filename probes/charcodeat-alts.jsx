// charCodeAt-alternative benchmark: walk mechanisms, span protect, map escape.
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
var clean = 'plain ASCII text with no escapes 0123456789 abcdefghijklmnopqrstuvwxyz';
var settings = j2.stringify({ bend: 45, hDistort: 0, name: 'CutContour 1mm \u00e9', flags: [true, false] });
var profiles = j2.stringify(profilesPayload(150));
var escHeavy = '"' + new Array(300).join('\\u0001\\t\\n"') + '"';

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

// ---- 1. walk mechanisms over the structural string ----
var rx_value_runs = /[^\[\]{},:@\t\n\r ]+/g;
var struct = profiles.replace(/"(\\.|[^"\\])*"/g, '@').replace(rx_value_runs, '_');

function walkCharCodeAt(s) {
  var n = s.length, d = 0, f = true, i, c;
  for (i = 0; i < n; i++) {
    c = s.charCodeAt(i);
    if (c === 91 || c === 123) { d++; f = true; }
    else if (c === 93 || c === 125) { d--; f = false; }
    else if (c === 44) { f = true; }
    else if (c === 58) { f = true; }
    else if (c === 32 || c === 9 || c === 10 || c === 13) { }
    else { f = false; }
  }
  return d;
}
function walkCharAt(s) {
  var n = s.length, d = 0, f = true, i, ch;
  for (i = 0; i < n; i++) {
    ch = s.charAt(i);
    if (ch === '[' || ch === '{') { d++; f = true; }
    else if (ch === ']' || ch === '}') { d--; f = false; }
    else if (ch === ',') { f = true; }
    else if (ch === ':') { f = true; }
    else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { }
    else { f = false; }
  }
  return d;
}
var ASCII = '';
for (var ai = 0; ai < 128; ai++) ASCII += String.fromCharCode(ai);
function walkCharAtIndex(s) {
  var n = s.length, d = 0, f = true, i, ch;
  for (i = 0; i < n; i++) {
    ch = s.charAt(i);
    if (ASCII.indexOf(ch) === 91 || ASCII.indexOf(ch) === 123) { d++; f = true; }
    else if (ASCII.indexOf(ch) === 93 || ASCII.indexOf(ch) === 125) { d--; f = false; }
    else if (ASCII.indexOf(ch) === 44) { f = true; }
    else if (ASCII.indexOf(ch) === 58) { f = true; }
    else if (ASCII.indexOf(ch) === 32 || ASCII.indexOf(ch) === 9 || ASCII.indexOf(ch) === 10 || ASCII.indexOf(ch) === 13) { }
    else { f = false; }
  }
  return d;
}
rows.push({ name: 'walk.charCodeAt', bytes: struct.length, medianUs: timeLane(function () { walkCharCodeAt(struct); }, 3, 15) });
rows.push({ name: 'walk.charAt', bytes: struct.length, medianUs: timeLane(function () { walkCharAt(struct); }, 3, 15) });
rows.push({ name: 'walk.charAt+ASCII.indexOf', bytes: struct.length, medianUs: timeLane(function () { walkCharAtIndex(struct); }, 3, 15) });

// ---- 2. protect: regex vs indexOf span scanner ----
var rx_protect = /"(\\.|[^"\\])*"/g;
function protectRegex(t) { return t.replace(rx_protect, '@'); }
function protectSpan(t) {
  var n = t.length, pieces = [], cnt = 0, i = 0, q, s, e;
  while (i < n) {
    q = t.indexOf('"', i);
    if (q < 0) { pieces[cnt++] = t.substring(i); break; }
    pieces[cnt++] = t.substring(i, q);
    s = q + 1;
    while (s < n) {
      if (t.charCodeAt(s) === 92) { s += 2; }
      else if (t.charAt(s) === '"') { break; }
      else { s++; }
    }
    pieces[cnt++] = '@';
    i = s + 1;
  }
  return pieces.join('');
}
rows.push({ name: 'protect.regex', bytes: profiles.length, medianUs: timeLane(function () { protectRegex(profiles); }, 3, 10) });
rows.push({ name: 'protect.span', bytes: profiles.length, medianUs: timeLane(function () { protectSpan(profiles); }, 3, 10) });

// ---- 3. escape: json2 callback (charCodeAt) vs map+indexOf vs whole-escape ----
var rx_escapable = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
var meta = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
var CTRL = '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f';
var HEX2 = ['00','01','02','03','04','05','06','07','08','09','0a','0b','0c','0d','0e','0f','10','11','12','13','14','15','16','17','18','19','1a','1b','1c','1d','1e','1f'];
function quoteCharCodeAt(s) {
  if (!rx_escapable.test(s)) return '"' + s + '"';
  return '"' + s.replace(rx_escapable, function (a) {
    var c = meta[a];
    return typeof c === 'string' ? c : '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
  }) + '"';
}
function quoteMapIndex(s) {
  if (!rx_escapable.test(s)) return '"' + s + '"';
  return '"' + s.replace(rx_escapable, function (a) {
    var c = meta[a];
    if (typeof c === 'string') return c;
    return '\\u00' + HEX2[CTRL.indexOf(a)];
  }) + '"';
}
function quoteWholeEscape(s) {
  if (!rx_escapable.test(s)) return '"' + s + '"';
  var e = escape(s);
  var out = '"', i = 0, n = e.length, ch;
  while (i < n) {
    ch = e.charAt(i);
    if (ch === '%') {
      if (e.charAt(i + 1) === 'u') { out += '\\u' + e.substring(i + 2, i + 6); i += 6; }
      else { out += '\\u00' + e.substring(i + 1, i + 3); i += 3; }
    } else {
      if (ch === '"') out += '\\"';
      else if (ch === '\\') out += '\\\\';
      else out += ch;
      i++;
    }
  }
  return out + '"';
}
rows.push({ name: 'escape.charCodeAt-cb', bytes: escHeavy.length, medianUs: timeLane(function () { quoteCharCodeAt(escHeavy); }, 3, 8) });
rows.push({ name: 'escape.map+indexOf-cb', bytes: escHeavy.length, medianUs: timeLane(function () { quoteMapIndex(escHeavy); }, 3, 8) });
rows.push({ name: 'escape.whole-string', bytes: escHeavy.length, medianUs: timeLane(function () { quoteWholeEscape(escHeavy); }, 3, 8) });
rows.push({ name: 'escape.clean-cc', bytes: clean.length, medianUs: timeLane(function () { quoteCharCodeAt(clean); }, 3, 8) });
rows.push({ name: 'escape.clean-whole', bytes: clean.length, medianUs: timeLane(function () { quoteWholeEscape(clean); }, 3, 8) });

var rf = new File($.getenv('TEMP') + '/charcodeat-alts.json');
rf.encoding = 'UTF-8';
rf.open('w');
rf.write(JSON.stringify({ rows: rows, sane: protectRegex(profiles) === protectSpan(profiles) && quoteCharCodeAt(escHeavy) === quoteMapIndex(escHeavy) && quoteCharCodeAt(escHeavy) === quoteWholeEscape(escHeavy) }));
rf.close();
