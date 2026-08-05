// Runtime-vendor smoke: parse/stringify/strictness/memo through the slim core.
#target illustrator

$.evalFile(File('C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eson/dist/vendor-eson-runtime.js'));

var out = { ok: true, checks: [] };
function check(name, ok, detail) {
  out.checks.push({ name: name, ok: !!ok, detail: detail });
  if (!ok) out.ok = false;
}
check('json-installed', typeof JSON === 'object' && typeof JSON.parse === 'function' && typeof JSON.stringify === 'function');
check('roundtrip', JSON.stringify(JSON.parse('{"a":[1,true,null,"x"]}')) === '{"a":[1,true,null,"x"]}');
check('strict-01', (function () { try { JSON.parse('[01]'); return false; } catch (e) { return true; } })());
check('strict-barekey', (function () { try { JSON.parse('{1:1}'); return false; } catch (e) { return true; } })());
check('strict-topcomma', (function () { try { JSON.parse('[[1]],2'); return false; } catch (e) { return true; } })());
check('exp-fast-path', JSON.parse('[1e5, -2.5e-3, 1E+2]')[0] === 100000);
check('deep-cap', (function () { try { JSON.parse('[' + new Array(600).join('[') + new Array(600).join(']') + ']'); return false; } catch (e) { return true; } })());
check('memo-hit', (function () { var t = '{"m":1}'; JSON.parse(t); var t0 = $.hiresTimer; JSON.parse(t); return ($.hiresTimer - t0) < 10000; })());
check('reviver', JSON.parse('{"a":1}', function (k, v) { return k === 'a' ? 99 : v; }).a === 99);

var rf = new File($.getenv('TEMP') + '/runtime-smoke.json');
rf.encoding = 'UTF-8';
rf.open('w');
rf.write(out.ok ? 'RUNTIME VENDOR OK' : 'RUNTIME VENDOR FAIL: ' + JSON.stringify(out.checks));
rf.close();
