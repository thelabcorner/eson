// JSON-as-transport demonstration on the REBUILT ABI (canonical tags
// 4/123/125, documented long prototypes, _s signatures, malloc+free):
//
//   String channel (tier 1, the ArcFitEso-verified path): the DLL receives
//   the whole JSON text once and returns a verdict/string once. The JSX
//   side never touches a per-unit primitive - this is the "replace
//   charCodeAt" win (whole-workload-native measured 4,800-11,900x).
//
//   Packed fallback (kept for reference): JSON text rides in packed doubles
//   (3 UTF-16 units per IEEE-754 double) - the transport that worked even
//   when string args did not bind on the OLD ESONJson ABI.
//
//   kTypeScript (125) returns: evalJson now uses the verified tag - the host
//   evaluates the validated text and returns the VALUE directly. Auto-eval
//   cost is superlinear (~2-4 K units interactive envelope); do not build
//   bulk-read pipelines on it. NOTE: the host evaluates the text as a
//   STATEMENT, so JSON object literals ({"a":1}) cannot auto-eval (block-
//   label parse error; the C validator rejects parenthesized text). Arrays,
//   scalars and strings round-trip fine - object payloads go through the
//   string channel (validateText + ESON.parse), which is the primary path.
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
  var lib = new ExternalObject('lib:ESONJson');
  out.dllLoaded = 'yes';
  out.abiGeneration = String(Number(lib.version(0)));
  save();

  // ---- tier 1: string channel - the verified whole-workload-native path ----
  var settings = { styleIndex: 0, bendPct: 35, hDistortPct: 0, vDistortPct: 0, showAdvanced: false, verticalAxis: false, preserveWidth: true, preserveHeight: false, anchorIndex: 0, hideOriginal: false, deleteOriginal: false, replaceOriginal: false, previewOpacity: 55, dielineSpotNames: ['CutContour', 'CutContour2', 'dieline'], svgWarpPath: '', svgBoundsPath: '' };
  var json = ESON.stringify(settings);
  out.jsonBytes = json.length;

  // round trip A: native gate verdict + ESON.parse of the SAME text
  out.gateVerdict = String(Number(lib.validateText(json)));
  var parsed = ESON.parse(json);
  out.stringLaneOk = String(parsed !== null && typeof parsed === 'object' && parsed.bendPct === 35 && parsed.dielineSpotNames.length === 3);
  out.parsedBend = parsed.bendPct;

  // round trip B: native escapeDirect -> ESON.parse of the quoted escaped text
  // escapeDirect emits a JS-source-escaped string (quotes become \" etc.),
  // which is NOT valid JSON on its own - the correct round trip re-quotes it:
  // ESON.parse('"' + escaped + '"') === original JSON string.
  var escaped = lib.escapeDirect(json);
  out.escapeReturnedString = String(typeof escaped === 'string');
  out.escapeOk = String(typeof escaped === 'string' && ESON.parse('"' + escaped + '"') === json);
  save();

  // invalid + executable payloads: the native gate must reject both
  out.badVerdict = String(Number(lib.validateText('01')));
  var evil = '{"a":1,"b":(probe42=42,"x")}';
  out.evilVerdict = String(Number(lib.validateText(evil)));
  save();

  // ---- packed fallback: 3 units per double (the old-DLL transport) ---------
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

  // kTypeScript (125) auto-eval limitation: the host evaluates the validated
  // text AS A STATEMENT, so a JSON OBJECT literal ({"a":1}) is a block-label
  // parse error and the C validator rejects parenthesized text - object
  // payloads therefore round-trip ONLY through the string channel above. The
  // packed channel demonstrably round-trips array/scalar/string payloads
  // (valid statements):
  var arrayJson = '["CutContour","CutContour2","dieline"]';
  var ap = pack(arrayJson);
  out.stageArr = stage(ap, arrayJson.length);
  var arrReturn = lib.evalJson();
  out.evalJsonArrType = typeof arrReturn;
  out.roundtripPackedOk = String(arrReturn !== null && typeof arrReturn === 'object' && arrReturn.length === 3 && arrReturn[0] === 'CutContour');

  var numJson = '42';
  var np = pack(numJson);
  out.stageNum = stage(np, numJson.length);
  var numReturn = lib.evalJson();
  out.evalJsonNum = String(numReturn); // 42
  out.roundtripPackedNum = String(numReturn === 42);

  var bp = pack('01');
  out.stage2 = stage(bp, 2);
  var badReturn = lib.evalJson();
  out.badEvalJson = String(badReturn); // undefined: rejected before eval
  var ep = pack(evil);
  out.stage3 = stage(ep, evil.length);
  var evilReturn = lib.evalJson();
  out.evilEvalJson = String(evilReturn);
  out.probe42After = typeof probe42;
  save();

  // ---- timing ----
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
  // string channel: gate + parse (cold, no memo)
  var sLane = timeLane(function () {
    Number(lib.validateText(json));
    ESON.parse(json + ' ');
  }, 1, 5);
  out.stringLaneUs = sLane;
  // packed: pack every time + stage + evalJson auto-eval of an ARRAY payload
  // (object literals are not auto-eval statements - see the note above)
  var cold = timeLane(function () {
    var p = pack(arrayJson);
    stage(p, arrayJson.length);
    var r = lib.evalJson();
    if (r === undefined) throw new Error('native rejected valid input');
  }, 1, 5);
  out.coldPackedUs = cold;
  save();

  try { lib.unload(); } catch (e) {}
  out.done = 'yes';
  save();
})();
