// Well-formed JSON.stringify: lone surrogates escape as \uXXXX text.
#target illustrator
$.evalFile(File('C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eson/dist/vendor-eson.js'));
var out = { ok: true, checks: [] };
function check(name, ok, detail) {
  out.checks.push({ name: name, ok: !!ok, detail: detail });
  if (!ok) out.ok = false;
}
check('high-surrogate-escaped', JSON.stringify('\ud800') === '"\\ud800"', JSON.stringify(JSON.stringify('\ud800')));
check('low-surrogate-escaped', JSON.stringify('\udc00') === '"\\udc00"');
check('pair-preserved', JSON.stringify('\ud83d\ude00') === '"\ud83d\ude00"');
check('mixed-escaped', JSON.stringify(['a\ud800b', '\udc00c']) === '["a\\ud800b","\\udc00c"]');
check('roundtrip-surrogate', JSON.parse(JSON.stringify('\ud800')) === '\ud800');
check('roundtrip-pair', JSON.parse(JSON.stringify('\ud83d\ude00')) === '\ud83d\ude00');
check('quote-backslash', JSON.stringify('"\\') === '"\\"\\\\"');
var rf = new File($.getenv('TEMP') + '/wellformed-check.json');
rf.encoding = 'UTF-8';
rf.open('w');
rf.write(out.ok ? 'WELLFORMED OK' : 'WELLFORMED FAIL: ' + JSON.stringify(out.checks));
rf.close();
