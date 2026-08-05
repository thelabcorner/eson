// Pack-loop microbench: the JSX-side packing cost for the packed transport.
(function () {
  var out = {};
  function settingsText() {
    return '{"styleIndex":0,"bendPct":35,"hDistortPct":0,"vDistortPct":0,"showAdvanced":false,"verticalAxis":false,"preserveWidth":true,"preserveHeight":false,"anchorIndex":0,"hideOriginal":false,"deleteOriginal":false,"replaceOriginal":false,"previewOpacity":55,"dielineSpotNames":["CutContour","CutContour2","dieline"],"svgWarpPath":"","svgBoundsPath":""}';
  }
  function profilesText(n) {
    var parts = [];
    var i;
    for (i = 0; i < n; i++) parts.push('{"name":"CutContour ' + (i + 1) + 'mm","params":{"styleIndex":1,"bendPct":' + (20 + (i % 40)) + ',"hDistortPct":0,"vDistortPct":0,"showAdvanced":false,"verticalAxis":false,"preserveWidth":true,"preserveHeight":false,"anchorIndex":0,"hideOriginal":false,"deleteOriginal":false,"replaceOriginal":false,"previewOpacity":55}}');
    return '[' + parts.join(',') + ']';
  }
  function pack(text) {
    var n = text.length;
    var d = Math.ceil(n / 3);
    var packs = [];
    var i;
    for (i = 0; i < d; i++) {
      var c0 = text.charCodeAt(i * 3);
      var c1 = i * 3 + 1 < n ? text.charCodeAt(i * 3 + 1) : 0;
      var c2 = i * 3 + 2 < n ? text.charCodeAt(i * 3 + 2) : 0;
      packs.push(c0 + c1 * 65536 + c2 * 4294967296);
    }
    return packs;
  }

  var texts = [
    { name: 'settings', t: settingsText() },
    { name: 'profiles6', t: profilesText(6) },
    { name: 'profiles150', t: profilesText(150) }
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
  for (i = 0; i < texts.length; i++) {
    var tx = texts[i];
    var med = timeLane(function () { pack(tx.t); }, 3, 15);
    rows.push({ payload: tx.name, bytes: tx.t.length, packUs: med });
  }
  out.rows = rows;

  var rf = new File($.getenv('TEMP') + '/eson-quick.json');
  rf.encoding = 'UTF-8';
  rf.open('w');
  rf.write(JSON.stringify(out));
  rf.close();
})();
