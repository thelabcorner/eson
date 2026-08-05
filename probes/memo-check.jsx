// Memo correctness: hit == fresh parse, __proto__ guard, error memo.
#target illustrator

$.evalFile(File('C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/eson/dist/ESON.jsx'));

var out = { ok: true, checks: [] };
function check(name, ok, detail) {
  out.checks.push({ name: name, ok: !!ok, detail: detail });
  if (!ok) out.ok = false;
}

var t1 = '{"a":[1,true,null,"x"],"b":2.5}';
var a = ESON.parse(t1);
var b = ESON.parse(t1);
var c = ESON.parse(t1);
check('memo-hit-same-value', JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(b) === JSON.stringify(c));

var fresh = '{"a":[1,true,null,"x"],"b":2.5}';
check('memo-vs-fresh', JSON.stringify(ESON.parse(fresh)) === JSON.stringify(a));

// __proto__ text: never memoized (guard), parse still correct
var protoText = '{"__proto__":{"polluted":true}}';
var p1 = ESON.parse(protoText);
var p2 = ESON.parse(protoText);
check('proto-guard-parses', p1 && typeof p1.polluted === 'undefined' && typeof p2.polluted === 'undefined');
check('proto-no-global-pollution', (function () { try { return ({}).polluted === undefined; } catch (e) { return true; } })());

// error memo: invalid text throws on every call
function rejectsText(text) { try { ESON.parse(text); return false; } catch (e) { return true; } }
check('error-memo-01', rejectsText('[01]') && rejectsText('[01]') && rejectsText('[01]'));
check('error-memo-barekey', rejectsText('{1:1}') && rejectsText('{1:1}'));

// reviver bypasses the memo
var rv = ESON.parse('{"a":1}', function (k, v) { return k === 'a' ? 99 : v; });
check('reviver-bypasses-memo', rv.a === 99);
var rv2 = ESON.parse('{"a":1}', function (k, v) { return k === 'a' ? 99 : v; });
check('reviver-still-works-2nd', rv2.a === 99);

var rf = new File($.getenv('TEMP') + '/memo-check.json');
rf.encoding = 'UTF-8';
rf.open('w');
rf.write(out.ok ? 'MEMO OK' : 'MEMO FAIL: ' + JSON.stringify(out.checks));
rf.close();
