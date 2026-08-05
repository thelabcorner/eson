// JSON-as-transport demonstration: ESON.stringify -> pack -> native validate
// -> kTypeString return -> ESON.parse. The ExternalObject string marshalling
// is bypassed entirely; JSON text rides in packed doubles; ESON decodes the
// returned text on the JSX side.
(function () {
  var out = {};
  function save() {
    var rf = new File($.getenv('TEMP') + '/eson-quick.json');
    rf.encoding = 'UTF-8';
    rf.open('w');
    rf.write(JSON.stringify(out));
    rf.close();
  }

  // load the ESON engine
  var f = new File('C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eson/dist/ESON.jsx');
  f.encoding = 'UTF-8';
  f.open('r');
  eval(f.read());
  f.close();
  out.esonLoaded = 'yes';

  var nativeDir = 'C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eson/native/build';
  ExternalObject.searchFolders = nativeDir + ';' + ExternalObject.searchFolders;
  var lib = new ExternalObject('lib:ESONJsonP');
  out.dllLoaded = 'yes';
  save();

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
  function stage(packs, len) {
    var args = [len];
    var i;
    for (i = 0; i < packs.length; i++) args.push(packs[i]);
    try {
      lib.stagePacked.apply(lib, args);
      return 'ok';
    } catch (e) {
      return 'hostError:' + String(e); // the C completes despite the host error
    }
  }

  // ---- round trip 1: settings object -> JSON -> packed -> native -> ESON.parse
  var settings = { styleIndex: 0, bendPct: 35, hDistortPct: 0, vDistortPct: 0, showAdvanced: false, verticalAxis: false, preserveWidth: true, preserveHeight: false, anchorIndex: 0, hideOriginal: false, deleteOriginal: false, replaceOriginal: false, previewOpacity: 55, dielineSpotNames: ['CutContour', 'CutContour2', 'dieline'], svgWarpPath: '', svgBoundsPath: '' };
  var json = ESON.stringify(settings);
  out.jsonBytes = json.length;
  out.stringifyUs = 'see benchmark (~105-141 us depending on payload)';
  var packs = pack(json);
  out.stage1 = stage(packs, json.length);
  var returned = lib.evalJson();
  out.returnedIsString = String(typeof returned === 'string');
  var parsed = ESON.parse(returned);
  out.roundtripOk = String(parsed !== null && typeof parsed === 'object' && parsed.bendPct === 35 && parsed.dielineSpotNames.length === 3);
  out.parsedBend = parsed.bendPct;
  save();

  // ---- round trip 2: invalid JSON - the native gate rejects before the
  // text can ever be evaluated
  var bad = '01';
  var bp = pack(bad);
  out.stage2 = stage(bp, bad.length);
  var badReturn = lib.evalJson();
  out.badReturn = String(badReturn);
  var badParseThrew = false;
  try { ESON.parse(badReturn); } catch (e) { badParseThrew = true; }
  out.badParseThrew = String(badParseThrew);
  save();

  // ---- round trip 3: executable payload - must never reach any evaluator
  var evil = '{"a":1,"b":(probe42=42,"x")}';
  var ep = pack(evil);
  out.stage3 = stage(ep, evil.length);
  var evilReturn = lib.evalJson();
  out.evilReturn = String(evilReturn);
  out.probe42After = typeof probe42;
  save();

  // ---- timing: the full JSON-transport round trip (with the pack cached)
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
  // cold: pack every time
  var cold = timeLane(function () {
    var p = pack(json);
    stage(p, json.length);
    var r = lib.evalJson();
    ESON.parse(r);
  }, 1, 5);
  out.coldRoundtripUs = cold;
  // warm: pre-packed doubles reused
  var warm = timeLane(function () {
    stage(packs, json.length);
    var r2 = lib.evalJson();
    ESON.parse(r2);
  }, 3, 10);
  out.warmRoundtripUs = warm;
  save();

  try { lib.unload(); } catch (e) {}
  out.done = 'yes';
  save();
})();
