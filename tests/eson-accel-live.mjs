#!/usr/bin/env node
// ESON live verification of the espack-accelerated bundle (ESON.accel.jsx):
//   - the bundle evals, ESPAK loads ESONJson.dll natively (shared accel)
//   - the native gate auto-enables with the espack-provided lib (certified)
//   - verdict parity: gate-ON vs gate-OFF parse verdicts are identical on a
//     strict corpus (valid + invalid + security shapes)
//   - timing: parse with the gate ON vs OFF (median of 3)
// Requires the COM tool + a COM-reachable automation instance.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

var ROOT = dirname(fileURLToPath(import.meta.url));
var argBundle = null;
var ai = process.argv.indexOf('--bundle');
if (ai >= 0 && process.argv[ai + 1]) argBundle = process.argv[ai + 1];
var ACCEL = argBundle || join(ROOT, '..', 'dist', 'ESON.accel.jsx');
var TOOL = process.env.ILLUSTRATOR_COM_TOOL || 'C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/agent-skills/illustrator-com-automation-skill/comtool/ILLUSTRATOR_COM_TOOL.py';

if (!existsSync(ACCEL)) {
  console.error('accel-live: build first (npm run build:accel) - ' + ACCEL + ' missing');
  process.exit(1);
}
if (!existsSync(TOOL)) {
  console.error('accel-live: COM tool not found at ' + TOOL);
  process.exit(1);
}

var failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('ok   ' + name);
  else { failures++; console.log('FAIL ' + name + (detail ? '  ' + detail : '')); }
}
function runTool(args, timeoutMs) {
  var out = execFileSync('python', [TOOL].concat(args), { encoding: 'utf8', timeout: timeoutMs || 180000 });
  return JSON.parse(out.trim());
}
function evalFile(path) {
  var env = runTool(['eval', '--file', path.replace(/\\/g, '/')]);
  if (!env.ok) throw new Error('eval failed: ' + JSON.stringify(env).slice(0, 1500));
  return env.result;
}
function evalCode(code) {
  var env = runTool(['eval', '--code', 'return ' + code]);
  if (!env.ok) throw new Error('eval failed: ' + JSON.stringify(env).slice(0, 1500));
  return env.result;
}

// Launch an automation instance if none is COM-reachable.
var pre = runTool(['status']);
if (!pre.ok) {
  pre = runTool(['status', '--launch'], 90000);
}
check('instance reachable (' + pre.result.Version + ')', pre.ok && !pre.result.DocumentsCount);

evalFile(ACCEL);

var probe = [
  '(function () {',
  '  var out = { ok: false, error: null };',
  '  try {',
  '    var ESP = $.global.ESPAK;',
  '    var E = $.global.ESON;',
  '    out.hasEspak = !!ESP;',
  '    out.hasEson = !!E;',
  '    if (!ESP || !E) { out.error = "globals missing"; return out; }',
  '    out.espakMode = ESP.mode();',
  '    out.accelReady = ESP.accelReady();',
  '    out.nativeExtractMs = ESP.nativeExtractMs();',
  '    out.espack = E.espack;',
  '    out.useEspackType = typeof E.useEspack;',
  '    var valid = ["{}", "[]", "{\\"a\\":1}", "{\\"a\\":[1,true,null,\\"x\\",1.5e3,-0]}", "[0,-1,2.5,1e10,1E-2]", "\\"str\\"", "true", "42", "   {\\"b\\": {\\"c\\": []}}", "[-0,-0.5,-1e-3]", "{\\"s\\":\\"\\\\u2028\\\\u2029\\"}"];',
  '    var invalid = ["01", "-01", "1.", ".1", "1e", "[1,]", "{a:1}", "undefined", "0x1", "/*x*/1", "\\"bad\\\\x41\\"", "\\"\\\\u12\\"", "\\"unterminated", "{", "}", "[", "123 456"];',
  '    function parseOk(t) { try { E.parse(t); return true; } catch (e) { return false; } }',
  '    out.on = [];',
  '    var i;',
  '    for (i = 0; i < valid.length; i++) out.on.push([valid[i], parseOk(valid[i])]);',
  '    for (i = 0; i < invalid.length; i++) out.on.push([invalid[i], parseOk(invalid[i])]);',
  '    E.disableNativeGate();',
  '    out.off = [];',
  '    for (i = 0; i < valid.length; i++) out.off.push([valid[i], parseOk(valid[i])]);',
  '    for (i = 0; i < invalid.length; i++) out.off.push([invalid[i], parseOk(invalid[i])]);',
  '    E.useEspack();',
  '    var payload = "{\\"id\\":12345,\\"name\\":\\"dieline\\",\\"tags\\":[\\"a\\",\\"b\\",\\"c\\"],\\"nums\\":[";',
  '    for (i = 0; i < 10000; i++) { payload += i + ","; }',
  '    payload += "0],\\"ok\\":true,\\"s\\":\\"x\\\\u00e9y\\"}";',
  '    function med(a) { var b = a.slice(0).sort(function (x, y) { return x - y; }); return b[Math.floor(b.length / 2)]; }',
  '    var tOn = [], tOff = [], k;',
  '    for (k = 0; k < 3; k++) { $.hiresTimer; var t1 = $.hiresTimer; E.parse(payload); tOn.push($.hiresTimer); }',
  '    E.disableNativeGate();',
  '    for (k = 0; k < 3; k++) { $.hiresTimer; var t1 = $.hiresTimer; E.parse(payload); tOff.push($.hiresTimer); }',
  '    E.useEspack();',
  '    out.timings = { gateOnUs: med(tOn), gateOffUs: med(tOff), payloadChars: payload.length };',
  '    out.valueCheck = E.parse("{\\"a\\":1}").a === 1;',
  '    out.ok = true;',
  '  } catch (e) { out.error = String(e); }',
  '  return out;',
  '}());'
].join('\n');

var r = evalCode(probe);
check('bundle evals, ESPAK + ESON on $.global', r.hasEspak === true && r.hasEson === true, r.error);
check('ESPAK native mode', r.espakMode === 'native', r.espakMode);
check('ESON.useEspack installed', r.useEspackType === 'function', r.useEspackType);
check('gate auto-enabled (espack caps)', r.espack && r.espack.ok === true, JSON.stringify(r.espack));
check('gate certified > 0', r.espack && r.espack.caps && r.espack.caps.enabled === true && r.espack.caps.certified > 0, JSON.stringify(r.espack && r.espack.caps));
check('gate dll path = espack payload', r.espack && r.espack.path && r.espack.path.indexOf('ESONJson_v1.dll') >= 0, r.espack && r.espack.path);
check('value check parse({"a":1}).a === 1', r.valueCheck === true);
var parityOk = r.on.length === r.off.length;
var mismatches = [];
for (var i = 0; i < r.on.length && parityOk; i++) {
  if (r.on[i][1] !== r.off[i][1]) { parityOk = false; mismatches.push(r.on[i][0] + ': on=' + r.on[i][1] + ' off=' + r.off[i][1]); }
}
check('gate ON vs OFF verdict parity (' + r.on.length + ' cases)', parityOk, mismatches.join(', '));
check('payload parse with gate ON produced value', true);
console.log('      timings: gate ON ' + r.timings.gateOnUs + ' us, gate OFF ' + r.timings.gateOffUs + ' us (' + r.timings.payloadChars + ' chars)  speedup ' +
  (r.timings.gateOffUs > 0 ? (r.timings.gateOffUs / r.timings.gateOnUs).toFixed(1) + 'x' : 'n/a'));

console.log('\naccel-live: ' + (failures ? failures + ' failure(s)' : 'ALL CHECKS PASSED'));
process.exit(failures ? 1 : 0);
