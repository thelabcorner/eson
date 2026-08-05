// Packed numeric transport + kTypeScript return experiment.
//
// stagePacked(len, p0, p1, ...): each double carries 3 UTF-16 code units in
// its low 48 bits (integers exact through 53 bits). evalJson validates the
// packed text natively and returns it as kTypeScript - the host evaluates it
// and the caller receives the constructed value directly (no drain, no JSX
// eval). validatePacked returns the validator code for diagnostics.
(function () {
  var out = {};
  function save() {
    var rf = new File($.getenv('TEMP') + '/eson-quick.json');
    rf.encoding = 'UTF-8';
    rf.open('w');
    rf.write(JSON.stringify(out));
    rf.close();
  }
  function t(name, fn) {
    try { out[name] = 'ok:' + String(fn()); }
    catch (e) { out[name] = 'ERR:' + String(e); }
    save();
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

  var nativeDir = 'C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eson/native/build';
  ExternalObject.searchFolders = nativeDir + ';' + ExternalObject.searchFolders;
  var lib = new ExternalObject('lib:ESONJsonP');
  out.loaded = 'yes';
  out.version = String(Number(lib.version(0)));
  out.ping = String(Number(lib.ping(0)));
  save();

  var settingsText = '{"styleIndex":0,"bendPct":35,"hDistortPct":0,"vDistortPct":0,"showAdvanced":false,"verticalAxis":false,"preserveWidth":true,"preserveHeight":false,"anchorIndex":0,"hideOriginal":false,"deleteOriginal":false,"replaceOriginal":false,"previewOpacity":55,"dielineSpotNames":["CutContour","CutContour2","dieline"],"svgWarpPath":"","svgBoundsPath":""}';

  // 1. basic round-trip via packed transport + kTypeScript
  var packs = pack(settingsText);
  t('stagePacked', function () { return Number(lib.stagePacked(settingsText.length, packs[0], packs[1], packs[2], packs[3], packs[4], packs[5], packs[6], packs[7], packs[8], packs[9], packs[10], packs[11], packs[12], packs[13], packs[14], packs[15], packs[16], packs[17], packs[18], packs[19], packs[20], packs[21], packs[22], packs[23], packs[24], packs[25], packs[26], packs[27], packs[28], packs[29], packs[30], packs[31], packs[32], packs[33], packs[34], packs[35], packs[36], packs[37], packs[38], packs[39], packs[40], packs[41], packs[42], packs[43], packs[44], packs[45], packs[46], packs[47], packs[48], packs[49], packs[50], packs[51], packs[52], packs[53], packs[54], packs[55], packs[56], packs[57], packs[58], packs[59], packs[60], packs[61], packs[62], packs[63], packs[64], packs[65], packs[66], packs[67], packs[68], packs[69], packs[70], packs[71], packs[72], packs[73], packs[74], packs[75], packs[76], packs[77], packs[78], packs[79], packs[80], packs[81], packs[82], packs[83], packs[84], packs[85], packs[86], packs[87], packs[88], packs[89], packs[90], packs[91], packs[92], packs[93], packs[94], packs[95], packs[96], packs[97], packs[98], packs[99], packs[100], packs[101], packs[102], packs[103], packs[104], packs[105], packs[106], packs[107], packs[108], packs[109], packs[110], packs[111], packs[112], packs[113], packs[114], packs[115])); });
  t('validatePacked', function () { return Number(lib.validatePacked()); });
  t('evalJson', function () {
    var v = lib.evalJson();
    return (v !== null && typeof v === 'object' && v.bendPct === 35 && v.dielineSpotNames.length === 3) ? 'OBJECT-OK bend=' + v.bendPct : 'NOT-OBJECT: ' + String(v);
  });

  // 2. security: the executable payload must be REJECTED (evalJson returns
  // undefined; the payload must never reach the evaluator)
  var evil = '{"a":1,"b":(probe42=42,"x")}';
  var ep = pack(evil);
  t('evalJson.evil', function () { return Number(lib.stagePacked(evil.length, ep[0], ep[1], ep[2], ep[3], ep[4], ep[5], ep[6], ep[7])); });
  t('evalJson.evil.result', function () { return String(lib.evalJson()); });
  out.probe42After = typeof probe42;

  // 3. validator verdicts on the corpus via the packed transport
  var validCases = ['null', 'true', '0', '-0', '1.5', '1e5', '{"a":1}', '[1,2,3]', '{"a":{"b":[1,2,{"c":null}]}}', '  { "a" : 1 }  '];
  var invalidCases = ['01', '-01', '1.', '.1', '1e', '[1,]', '{"a":1,}', '{a:1}', 'undefined', 'NaN', '({a:1})', '"bad\\v"', '00', 'x=1'];
  var vOk = 0;
  var iOk = 0;
  var ci;
  for (ci = 0; ci < validCases.length; ci++) {
    var vp = pack(validCases[ci]);
    lib.stagePacked(validCases[ci].length, vp[0], vp[1], vp[2], vp[3], vp[4], vp[5], vp[6], vp[7], vp[8], vp[9], vp[10], vp[11], vp[12], vp[13], vp[14], vp[15], vp[16], vp[17], vp[18], vp[19], vp[20], vp[21], vp[22], vp[23], vp[24], vp[25], vp[26], vp[27], vp[28], vp[29], vp[30], vp[31], vp[32], vp[33], vp[34], vp[35], vp[36], vp[37], vp[38], vp[39], vp[40], vp[41], vp[42], vp[43], vp[44], vp[45], vp[46], vp[47], vp[48], vp[49], vp[50], vp[51], vp[52], vp[53], vp[54], vp[55], vp[56], vp[57], vp[58], vp[59], vp[60], vp[61], vp[62], vp[63], vp[64], vp[65], vp[66], vp[67], vp[68], vp[69], vp[70], vp[71], vp[72], vp[73], vp[74], vp[75], vp[76], vp[77], vp[78], vp[79], vp[80], vp[81], vp[82], vp[83], vp[84], vp[85], vp[86], vp[87], vp[88], vp[89], vp[90], vp[91], vp[92], vp[93], vp[94], vp[95], vp[96], vp[97], vp[98], vp[99], vp[100], vp[101], vp[102], vp[103], vp[104], vp[105], vp[106], vp[107], vp[108], vp[109], vp[110], vp[111], vp[112], vp[113], vp[114], vp[115]);
    if (Number(lib.validatePacked()) === 0) vOk++;
  }
  for (ci = 0; ci < invalidCases.length; ci++) {
    var ip = pack(invalidCases[ci]);
    lib.stagePacked(invalidCases[ci].length, ip[0], ip[1], ip[2], ip[3], ip[4], ip[5], ip[6], ip[7], ip[8], ip[9], ip[10], ip[11], ip[12], ip[13], ip[14], ip[15], ip[16], ip[17], ip[18], ip[19], ip[20], ip[21], ip[22], ip[23], ip[24], ip[25], ip[26], ip[27], ip[28], ip[29], ip[30], ip[31], ip[32], ip[33], ip[34], ip[35], ip[36], ip[37], ip[38], ip[39], ip[40], ip[41], ip[42], ip[43], ip[44], ip[45], ip[46], ip[47], ip[48], ip[49], ip[50], ip[51], ip[52], ip[53], ip[54], ip[55], ip[56], ip[57], ip[58], ip[59], ip[60], ip[61], ip[62], ip[63], ip[64], ip[65], ip[66], ip[67], ip[68], ip[69], ip[70], ip[71], ip[72], ip[73], ip[74], ip[75], ip[76], ip[77], ip[78], ip[79], ip[80], ip[81], ip[82], ip[83], ip[84], ip[85], ip[86], ip[87], ip[88], ip[89], ip[90], ip[91], ip[92], ip[93], ip[94], ip[95], ip[96], ip[97], ip[98], ip[99], ip[100], ip[101], ip[102], ip[103], ip[104], ip[105], ip[106], ip[107], ip[108], ip[109], ip[110], ip[111], ip[112], ip[113], ip[114], ip[115]);
    if (Number(lib.validatePacked()) !== 0) iOk++;
  }
  out.validAccepted = vOk + '/' + validCases.length;
  out.invalidRejected = iOk + '/' + invalidCases.length;

  // 4. packed transport benchmark: 32/64/128/256 doubles per call
  function benchPacked(nDoubles) {
    var len = nDoubles * 3;
    var args = [len];
    var i;
    for (i = 0; i < nDoubles; i++) args.push(i * 3 + i * 3 * 65536 + i * 3 * 4294967296);
    var t0 = $.hiresTimer;
    var k;
    for (k = 0; k < 200; k++) {
      lib.stagePacked.apply(lib, args);
    }
    var t1 = $.hiresTimer;
    var d = t1 - t0;
    if (d < 0) d += 2147483648;
    return d / 200;
  }
  out.packed32 = benchPacked(32);
  out.packed64 = benchPacked(64);
  out.packed128 = benchPacked(128);
  out.packed256 = benchPacked(256);

  try { lib.unload(); } catch (e) {}
  out.done = 'yes';
  save();
})();
