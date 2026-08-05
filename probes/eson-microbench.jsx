// ESON primitive microbenchmark v2 - bounded live-run profile.
// Measures the cost of every candidate primitive at ArcFit-relevant sizes.
// Iteration counts are capped so a single lane cannot exceed ~3 seconds.
(function () {
  var R = {};

  function makeSettingsText() {
    return '{"styleIndex":0,"bendPct":35,"hDistortPct":0,"vDistortPct":0,"showAdvanced":false,"verticalAxis":false,"preserveWidth":true,"preserveHeight":false,"anchorIndex":0,"hideOriginal":false,"deleteOriginal":false,"replaceOriginal":false,"previewOpacity":55,"dielineSpotNames":["CutContour","CutContour2","dieline"],"svgWarpPath":"","svgBoundsPath":""}';
  }
  function makeProfilesText(n) {
    var parts = [];
    var i;
    for (i = 0; i < n; i++) parts.push('{"name":"CutContour ' + (i + 1) + 'mm","params":{"styleIndex":1,"bendPct":' + (20 + (i % 40)) + ',"hDistortPct":0,"vDistortPct":0,"showAdvanced":false,"verticalAxis":false,"preserveWidth":true,"preserveHeight":false,"anchorIndex":0,"hideOriginal":false,"deleteOriginal":false,"replaceOriginal":false,"previewOpacity":55}}');
    return '[' + parts.join(',') + ']';
  }
  function bigText(size) {
    var chunk = '{"k":"The quick brown fox 0123456789 e","n":1.5},';
    var s = '';
    while (s.length < size) s += chunk;
    return '[' + s.substring(0, s.length - 1) + ']';
  }

  var payloads = [
    { name: 'settings', text: makeSettingsText() },
    { name: 'profiles6', text: makeProfilesText(6) },
    { name: 'profiles150', text: makeProfilesText(150) },
    { name: 'big32k', text: bigText(32768) }
  ];
  var pi;
  for (pi = 0; pi < payloads.length; pi++) payloads[pi].size = payloads[pi].text.length;

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

  var lanes = {
    'charCodeAt-loop': function (t) {
      var sum = 0;
      var i;
      for (i = 0; i < t.length; i++) sum += t.charCodeAt(i);
      return sum;
    },
    'indexOf': function (t) { return t.indexOf('{'); },
    'replace-callback': function (t) {
      return t.replace(/"[^"\\\x00-\x1f]*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+\-]?\d+)?/g, function (m) { return ']'; });
    },
    'regex-test-simple': function (t) { return /[A-Za-z]/.test(t); },
    'regex-one-gate': function (t) {
      return /^(?:"(?:[^"\\\x00-\x1f]|\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+\-]?\d+)?(?![\d.])|true|false|null|[\],:{}\s])*$/.test(t);
    },
    'regex-4pass-json2': function (t) {
      var rx_one = /^[\],:{}\s]*$/;
      var rx_two = /\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g;
      var rx_three = /"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g;
      var rx_four = /(?:^|:|,)(?:\s*\[)+/g;
      rx_two.lastIndex = 0; rx_three.lastIndex = 0; rx_four.lastIndex = 0;
      return rx_one.test(t.replace(rx_two, '@').replace(rx_three, ']').replace(rx_four, ''));
    },
    'eval': function (t) { return eval('(' + t + ')'); },
    'substring-scan': function (t) {
      var i = 0;
      var count = 0;
      while (i < t.length) {
        var j = t.indexOf(',', i);
        if (j < 0) break;
        count++;
        i = j + 1;
      }
      return count;
    },
    'concat-1k': function () {
      var s = '';
      var i;
      for (i = 0; i < 1024; i++) s += 'a';
      return s.length;
    }
  };

  var rows = [];
  var laneNames = ['charCodeAt-loop', 'indexOf', 'replace-callback', 'regex-test-simple', 'regex-one-gate', 'regex-4pass-json2', 'eval', 'substring-scan'];
  function checkpoint() {
    try {
      R['rows'] = rows;
      var outPath = $.getenv('TEMP') + '/eson-microbench.json';
      var f = new File(outPath);
      f.encoding = 'UTF-8';
      if (f.open('w')) {
        f.write(JSON.stringify(R));
        f.close();
      }
    } catch (e) {}
  }
  var li;
  for (li = 0; li < laneNames.length; li++) {
    var ln = laneNames[li];
    var fn = lanes[ln];
    for (pi = 0; pi < payloads.length; pi++) {
      var pl = payloads[pi];
      var big = pl.size > 100000;
      var med = timeLane(function () { fn(pl.text); }, big ? 1 : 3, big ? 3 : 15);
      rows.push({ lane: ln, payload: pl.name, bytes: pl.size, medianUs: med });
      checkpoint();
    }
  }
  var concatMed = timeLane(lanes['concat-1k'], 3, 15);
  rows.push({ lane: 'concat-1k', payload: '1024-appends', bytes: 1024, medianUs: concatMed });
  checkpoint();

  R['rows'] = rows;

  var reportPath = '';
  try {
    var outPath = $.getenv('TEMP') + '/eson-microbench.json';
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
