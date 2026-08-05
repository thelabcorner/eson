// A/B: charCodeAt trim loops vs the anchored-class regex trims (live engine).
(function () {
  var out = {};
  function save() {
    var rf = new File($.getenv('TEMP') + '/eson-quick.json');
    rf.encoding = 'UTF-8';
    rf.open('w');
    rf.write(JSON.stringify(out));
    rf.close();
  }

  function isStorageWhitespace(code) {
    return code === 32 || (code >= 9 && code <= 13) || code === 160 || code === 65279 ||
      code === 5760 || code === 6158 || (code >= 8192 && code <= 8202) ||
      code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288;
  }
  function trimLoop(value) {
    var text = String(value || '');
    var start = 0;
    var end = text.length;
    while (start < end && isStorageWhitespace(text.charCodeAt(start))) start++;
    while (end > start && isStorageWhitespace(text.charCodeAt(end - 1))) end--;
    return start === 0 && end === text.length ? text : text.substring(start, end);
  }
  var rx_trim = /^[\x09-\x0d \u00a0\ufeff\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\x09-\x0d \u00a0\ufeff\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;
  function trimRegex(value) {
    var text = String(value || '');
    var trimmed = text.replace(rx_trim, '');
    return trimmed.length === text.length ? text : trimmed;
  }

  var cases = [
    ['noTrim', 'CutContour 1mm'],
    ['trailing', 'CutContour 1mm   '],
    ['leadingTrailing', '  CutContour 1mm  '],
    ['wsPadded', '   \t\r\n  CutContour 1mm   \u3000  '],
    ['allWs', '     ']
  ];

  function timeLane(fn, warmup, iters) {
    var w;
    for (w = 0; w < warmup; w++) fn();
    var samples = [];
    var i;
    var t0, t1, d;
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
  var i;
  for (i = 0; i < cases.length; i++) {
    var c = cases[i][1];
    var okSame = String(trimLoop(c) === trimRegex(c));
    var loop = timeLane(function () { trimLoop(c); }, 5, 30);
    var rex = timeLane(function () { trimRegex(c); }, 5, 30);
    rows.push({ name: cases[i][0], bytes: c.length, loopUs: loop, regexUs: rex, same: okSame });
  }
  out.rows = rows;
  save();
})();
