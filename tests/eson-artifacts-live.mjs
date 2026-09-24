#!/usr/bin/env node
// ESON live verification of the four non-accelerated release surfaces, in a
// real Illustrator engine through the COM tool:
//   dist/ESON.jsx            - facade only; MUST leave the global JSON alone
//   dist/vendor-eson.js      - installs JSON.parse/stringify = ESON's
//   dist/ESON-runtime.jsx    - runtime facade; parse/stringify only; no install
//   dist/vendor-eson-runtime.js - runtime + install footer
//
// Each artifact is loaded and probed inside ONE eval call ($.evalFile through
// --code): the COM tool's session bootstrap re-installs the accelerated ESON
// facade between separate eval invocations, so cross-call identity checks
// would observe the tool's bootstrap rather than the artifact. The accelerated
// bundle (ESON.accel.jsx) has its own harness: tests/eson-accel-live.mjs.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

var ROOT = dirname(fileURLToPath(import.meta.url));
var DIST = join(ROOT, '..', 'dist');
var TOOL = process.env.ILLUSTRATOR_COM_TOOL || 'C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/agent-skills/illustrator-com-automation-skill/comtool/ILLUSTRATOR_COM_TOOL.py';

var files = {
  standalone: join(DIST, 'ESON.jsx'),
  vendor: join(DIST, 'vendor-eson.js'),
  runtime: join(DIST, 'ESON-runtime.jsx'),
  runtimeVendor: join(DIST, 'vendor-eson-runtime.js')
};

for (var key in files) {
  if (!existsSync(files[key])) {
    console.error('artifacts-live: build first (npm run build) - ' + files[key] + ' missing');
    process.exit(1);
  }
}
if (!existsSync(TOOL)) {
  console.error('artifacts-live: COM tool not found at ' + TOOL);
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
function evalCode(code) {
  var env = runTool(['eval', '--code', 'return ' + code]);
  if (!env.ok) throw new Error('eval failed: ' + JSON.stringify(env).slice(0, 1500));
  return env.result;
}

// One eval call per artifact: snapshot -> $.evalFile -> snapshot -> probes.
function probeArtifact(path, probeBody) {
  var p = path.replace(/\\/g, '/');
  var code = [
    '(function () {',
    '  var g = $.global;',
    '  function tryParse(fn, text) { try { fn(text); return false; } catch (e) { return true; } }',
    '  var before = { json: g.JSON, parse: g.JSON && g.JSON.parse, stringify: g.JSON && g.JSON.stringify };',
    '  $.evalFile(new File(' + JSON.stringify(p) + '));',
    '  var after = { json: g.JSON, parse: g.JSON && g.JSON.parse, stringify: g.JSON && g.JSON.stringify };',
    '  var localEson = null;',
    '  try { if (typeof ESON !== "undefined") { localEson = ESON; } } catch (e0) { localEson = null; }',
    '  if (!localEson) { localEson = g.ESON; }',
    '  var out = {',
    '    jsonSame: after.json === before.json,',
    '    parseSame: !!after.json && after.parse === before.parse,',
    '    stringifySame: !!after.json && after.stringify === before.stringify',
    '  };',
    probeBody,
    '  return out;',
    '}());'
  ].join('\n');
  return evalCode(code);
}

// Launch an automation instance if none is COM-reachable.
var pre = runTool(['status']);
if (!pre.ok) {
  pre = runTool(['status', '--launch'], 90000);
}
check('instance reachable (' + pre.result.Version + ')', pre.ok === true, JSON.stringify(pre).slice(0, 400));

// ---- 1. dist/ESON.jsx: facade only, global JSON untouched -------------------
var r1 = probeArtifact(files.standalone, [
  '  out.facade = !!localEson && typeof localEson.parse === "function" && typeof localEson.stringify === "function";',
  '  out.fullApi = typeof localEson.encodeSource === "function" && typeof localEson.capabilities === "function";',
  '  out.strict01 = tryParse(localEson.parse, "[01]");',
  '  out.strictComma = tryParse(localEson.parse, "[1,]");',
  '  out.value = localEson.parse("{\\"a\\":[1,true,null,\\"x\\"]}").a[3] === "x";',
  '  out.roundtrip = localEson.stringify({ a: [1, true, null, "x"] }) === \'{"a":[1,true,null,"x"]}\';'
].join('\n'));
check('ESON.jsx facade + full API', r1.facade === true && r1.fullApi === true, JSON.stringify(r1));
check('ESON.jsx strict parse rejects [01] / [1,]', r1.strict01 === true && r1.strictComma === true);
check('ESON.jsx parse/stringify round-trip', r1.value === true && r1.roundtrip === true);
check('ESON.jsx leaves the global JSON object identical',
  r1.jsonSame === true && r1.parseSame === true && r1.stringifySame === true,
  JSON.stringify({ jsonSame: r1.jsonSame, parseSame: r1.parseSame, stringifySame: r1.stringifySame }));

// ---- 2. dist/vendor-eson.js: installs the global JSON = ESON ----------------
var r2 = probeArtifact(files.vendor, [
  '  out.parseIsEson = !!g.JSON && !!localEson && g.JSON.parse === localEson.parse;',
  '  out.stringifyIsEson = !!g.JSON && !!localEson && g.JSON.stringify === localEson.stringify;',
  '  out.strict01 = tryParse(g.JSON.parse, "[01]");',
  '  out.strictBareKey = tryParse(g.JSON.parse, "{1:1}");',
  '  out.strictTrailingDot = tryParse(g.JSON.parse, "[1.]");',
  '  var v = g.JSON.parse(\'{"a":1,"b":2}\', function (k, val) { return k === "a" ? 99 : val; });',
  '  out.reviver = v.a === 99 && v.b === 2;',
  '  out.deep = g.JSON.parse("{\\"n\\":[1,2,3],\\"s\\":\\"x\\\\u00e9\\"}").n.length === 3;',
  '  out.stringify = g.JSON.stringify({ x: [1, "a"] }) === \'{"x":[1,"a"]}\';'
].join('\n'));
check('vendor-eson.js installs JSON.parse/stringify = ESON', r2.parseIsEson === true && r2.stringifyIsEson === true, JSON.stringify(r2));
check('vendor-eson.js strict verdicts (01, bare key, 1.)', r2.strict01 === true && r2.strictBareKey === true && r2.strictTrailingDot === true);
check('vendor-eson.js reviver + deep parse + stringify', r2.reviver === true && r2.deep === true && r2.stringify === true);

// ---- 3. dist/ESON-runtime.jsx: runtime facade only, no install --------------
var r3 = probeArtifact(files.runtime, [
  '  out.facade = !!localEson && typeof localEson.parse === "function" && typeof localEson.stringify === "function";',
  '  out.runtimeOnly = typeof localEson.encodeSource === "undefined" && typeof localEson.capabilities === "undefined" && typeof localEson.parseTrusted === "undefined";',
  '  out.strict = tryParse(localEson.parse, "[01]");',
  '  out.value = localEson.parse("[1,2,3]").length === 3;',
  '  out.stringify = localEson.stringify({ a: 1 }) === \'{"a":1}\';'
].join('\n'));
check('ESON-runtime.jsx runtime facade (parse/stringify only)', r3.facade === true && r3.runtimeOnly === true, JSON.stringify(r3));
check('ESON-runtime.jsx strict + behavior', r3.strict === true && r3.value === true && r3.stringify === true);
check('ESON-runtime.jsx leaves the global JSON object identical',
  r3.jsonSame === true && r3.parseSame === true && r3.stringifySame === true,
  JSON.stringify({ jsonSame: r3.jsonSame, parseSame: r3.parseSame, stringifySame: r3.stringifySame }));

// ---- 4. dist/vendor-eson-runtime.js: runtime + install ----------------------
var r4 = probeArtifact(files.runtimeVendor, [
  '  out.parseIsEson = !!g.JSON && !!localEson && g.JSON.parse === localEson.parse;',
  '  out.stringifyIsEson = !!g.JSON && !!localEson && g.JSON.stringify === localEson.stringify;',
  '  out.runtimeOnly = typeof localEson.encodeSource === "undefined" && typeof localEson.capabilities === "undefined";',
  '  out.strict = tryParse(g.JSON.parse, "[1,]");',
  '  out.value = g.JSON.parse("{\\"k\\":true}").k === true;'
].join('\n'));
check('vendor-eson-runtime.js installs + runtime-only surface', r4.parseIsEson === true && r4.stringifyIsEson === true && r4.runtimeOnly === true, JSON.stringify(r4));
check('vendor-eson-runtime.js strict + behavior', r4.strict === true && r4.value === true);

console.log('\nartifacts-live: ' + (failures ? failures + ' failure(s)' : 'ALL CHECKS PASSED'));
process.exit(failures ? 1 : 0);
