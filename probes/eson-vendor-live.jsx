// Live vendor check: evalFile the vendor, exercise the installed JSON.
#target illustrator

$.evalFile(File('C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eson/dist/vendor-eson.js'));

var out = { ok: true, checks: [] };
function check(name, ok, detail) {
  out.checks.push({ name: name, ok: !!ok, detail: detail });
  if (!ok) out.ok = false;
}

check('json-exists', typeof JSON === 'object' && typeof JSON.parse === 'function' && typeof JSON.stringify === 'function');
var v = JSON.parse('{"a":[1,true,null,"x"],"b":"\\u2028y"}');
check('round-trip', JSON.stringify(v) === '{"a":[1,true,null,"x"],"b":"\\u2028y"}');
check('reviver', JSON.parse('{"a":1,"b":2}', function (k, val) { return k === 'a' ? 99 : val; }).a === 99);
function rejects(text) {
  try { JSON.parse(text); return false; } catch (e) { return true; }
}
check('strict-01', rejects('[01]'));
check('strict-1dot', rejects('[1.]'));
check('strict-bare-key', rejects('{1:1}'));
check('strict-leading-comma', rejects('[,1]'));
check('strict-top-comma', rejects('1,2'));
check('strict-in-string-bracket', JSON.stringify(JSON.parse('{"a}":"b"}')) === '{"a}":"b"}');
check('strict-escaped-backslash-danger', JSON.stringify(JSON.parse('"\\\\\\u00ad"')) === '"\\\\\\u00ad"');
check('deep-cap', rejects('[' + new Array(600).join('[') + new Array(600).join(']') + ']'));
check('eson-facade', typeof ESON === 'object' && typeof ESON.parse === 'function');
check('private-json2', typeof ESON_JSON2 === 'object' && typeof ESON_JSON2.stringify === 'function');

var rf = new File($.getenv('TEMP') + '/eson-vendor-live.json');
rf.encoding = 'UTF-8';
rf.open('w');
rf.write(out.ok ? 'LIVE VENDOR OK' : 'LIVE VENDOR FAIL: ' + JSON.stringify(out.checks));
rf.close();
