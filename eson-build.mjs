#!/usr/bin/env node
// ESON build: bundles the TypeScript core into
//   dist/ESON.jsx            - bannerless IIFE (COM-eval / $.evalFile safe),
//                              defines var ESON_JSON2 (private json2) then
//                              var ESON (the facade)
//   dist/vendor-eson.js      - production drop-in: ESON + the private patched
//                              json2 bundled inside ("sneakily"), plus the
//                              json2-compatible global-JSON install footer.
//                              This file REPLACES vendor/json2.js.
//   dist/eson-core.esm.mjs   - ESM bundle of the core for Node test harnesses
// The raw json2 source lives at vendor/json2.raw.js (build-only input; the
// patched copy is what gets bundled privately inside ESON).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

var ROOT = dirname(fileURLToPath(import.meta.url));
var DIST = join(ROOT, 'dist');
var ENTRY = join(ROOT, 'src', 'index.ts');
var JSON2_PATH = join(ROOT, 'vendor', 'json2.raw.js');
if (!existsSync(JSON2_PATH)) {
  throw new Error('eson-build: raw json2 source not found at ' + JSON2_PATH +
    ' (the production vendors now hold the ESON build; the raw json2 is a build-only input)');
}

function findEsbuild() {
  if (process.env.ESBUILD_PATH && existsSync(process.env.ESBUILD_PATH)) return process.env.ESBUILD_PATH;
  var direct = join(ROOT, 'node_modules', '.bin', 'esbuild');
  if (existsSync(direct)) return direct;
  var cacheDirs = [
    join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx'),
    join(process.env.USERPROFILE || '', 'AppData', 'Local', 'npm-cache', '_npx')
  ];
  for (var i = 0; i < cacheDirs.length; i++) {
    try {
      var entries = readdirSync(cacheDirs[i]);
      for (var j = 0; j < entries.length; j++) {
        var p = join(cacheDirs[i], entries[j], 'node_modules', 'esbuild', 'bin', 'esbuild');
        if (existsSync(p)) return p;
      }
    } catch (ignore) {}
  }
  return 'npx esbuild';
}

function esmBuild(entry, outfile) {
  execFileSync(process.execPath, [
    findEsbuild(), entry, '--bundle', '--outfile=' + outfile,
    '--format=esm', '--platform=node', '--target=es2019',
    '--log-level=warning'
  ], { stdio: 'inherit' });
}

function jsxBuild(entry, outfile) {
  execFileSync(process.execPath, [
    findEsbuild(), entry, '--bundle', '--outfile=' + outfile,
    '--format=iife', '--global-name=ESON', '--platform=neutral', '--target=es5',
    '--log-level=warning'
  ], { stdio: 'inherit' });
}

mkdirSync(DIST, { recursive: true });

// 1. ESM core bundle (Node harnesses import this).
esmBuild(ENTRY, join(DIST, 'eson-core.esm.mjs'));

// 2. JSX bundle with private json2 injected before the facade.
var jsx = join(DIST, 'ESON.jsx');
jsxBuild(ENTRY, jsx);

var json2Src = readFileSync(JSON2_PATH, 'utf8');
var codeStart = json2Src.indexOf('if (typeof JSON');
if (codeStart > 0) json2Src = json2Src.slice(codeStart);
json2Src = json2Src.replace(/"use strict";?/g, '');
// TREE-SHAKE the bundled json2: ESON's parse is eval-only (the facade never
// calls json2.parse), so the ~2.3KB parse block is redundant in every
// bundle. The toJSON-polyfill block stays (guarded, engine-dependent).
// The full raw stays available as dist/json2-reference.jsx for the probes'
// differential reference lanes.
var parseAnchor = 'if (typeof JSON.parse !== "function") {';
var parseIdx = json2Src.indexOf(parseAnchor);
if (parseIdx < 0) {
  throw new Error('eson-build: json2 parse block anchor not found');
}
// The raw json2 is one big IIFE `(function () { ... }())` - the parse block
// is its last statement. Remove the block but KEEP the IIFE's closing.
var closeIdx = json2Src.indexOf('}());', parseIdx);
if (closeIdx < 0) {
  throw new Error('eson-build: json2 IIFE closing not found after the parse block');
}
json2Src = json2Src.substring(0, parseIdx) + json2Src.substring(closeIdx);
// SLICE CLEANUP: drop the parse-side declarations that survive the slice
// (the stringify never touches them): rx_one..rx_four + rx_dangerous.
var rxStart = json2Src.indexOf('    var rx_one');
var rxEnd = json2Src.indexOf('var rx_escapable');
if (rxStart < 0 || rxEnd < 0 || rxEnd <= rxStart) {
  throw new Error('eson-build: json2 rx-dead-slice anchors not found');
}
json2Src = json2Src.substring(0, rxStart) + json2Src.substring(rxEnd);
// The rx_dangerous line (the json2.parse sanitizer class - dead in the
// stringify-only slice) sits between rx_escapable and f(n); remove it too.
var rdStart = json2Src.indexOf('\r\n    var rx_dangerous');
var rdEnd = json2Src.indexOf('\r\n    function f(n) {');
if (rdStart < 0 || rdEnd < 0 || rdEnd <= rdStart) {
  throw new Error('eson-build: json2 rx_dangerous dead-slice anchors not found');
}
json2Src = json2Src.substring(0, rdStart) + json2Src.substring(rdEnd);
// Unwrap the always-true `if (typeof JSON.stringify !== "function")` guard
// (the ESON_JSON2 wrapper's JSON is a fresh object, so the guard always
// fires) - drop the guard line and the block's closing brace. The raw is
// CRLF, so the closing anchor carries \r\n.
var guardLine = '    if (typeof JSON.stringify !== "function") {';
var guardIdx = json2Src.indexOf(guardLine);
if (guardIdx < 0) {
  throw new Error('eson-build: json2 stringify guard anchor not found');
}
json2Src = json2Src.substring(0, guardIdx) + json2Src.substring(guardIdx + guardLine.length + 1);
var closeAnchor = '\r\n    }\r\n';
var closeIdx = json2Src.indexOf(closeAnchor, guardIdx);
if (closeIdx < 0) {
  throw new Error('eson-build: json2 stringify guard closing not found');
}
json2Src = json2Src.substring(0, closeIdx) + json2Src.substring(closeIdx + closeAnchor.length);
// Drop the toJSON-polyfill block + the f(n)/this_value helpers: the live
// engine has Date/String/Number.prototype.toJSON natively (probed live -
// all "function"), so the guard never fires and the block is dead weight.
var polyStart = json2Src.indexOf('    function f(n) {');
var polyEnd = json2Src.indexOf('    var gap;');
if (polyStart < 0 || polyEnd < 0 || polyEnd <= polyStart) {
  throw new Error('eson-build: json2 toJSON-polyfill slice anchors not found');
}
json2Src = json2Src.substring(0, polyStart) + json2Src.substring(polyEnd);
// The raw json2 source (vendor/json2.raw.js) is maintained directly with the
// ExtendScript fixes: the empty-container ternaries are explicitly
// parenthesized (chained ternaries compile left-associatively in this
// engine) and rx_escapable is pair-aware for the well-formed JSON.stringify
// (lone surrogates escape, valid pairs stay raw). No build-time string
// patches are needed anymore.
if (json2Src.indexOf('[\\ud800-\\udbff][\\udc00-\\udfff]') < 0) {
  throw new Error('eson-build: raw json2 missing the pair-aware rx_escapable');
}
var wrapper = 'var ESON_JSON2 = (function (JSON) {\n' + json2Src + '\nreturn JSON;\n})({});\n\n';

// Reference artifact: the FULL raw json2 standalone (var JSON2) for the
// probes' json2-parse differential lanes.
var rawRef = readFileSync(JSON2_PATH, 'utf8').replace(/"use strict";?/g, '');
writeFileSync(join(DIST, 'json2-reference.jsx'),
  'var JSON2 = (function (JSON) {\n' + rawRef + '\nreturn JSON;\n})({});\n');

// ES3 shim: ExtendScript (SpiderMonkey 2014) lacks Object.defineProperty and
// Function.prototype.bind, which esbuild's ES5 export helpers require. The
// shim is getter-aware via __defineGetter__ when present. ESON's own code
// verifies defineProperty results (normalize.setProp) so the shim can never
// silently produce wrong __proto__ output.
var shim = [
  'if (typeof Object.defineProperty !== "function") {',
  '  Object.defineProperty = function (obj, prop, desc) {',
  '    if (desc) {',
  '      if (typeof desc.get === "function") {',
  '        if (typeof obj.__defineGetter__ === "function") { obj.__defineGetter__(prop, desc.get); }',
  '        else { obj[prop] = desc.get(); }',
  '      } else if ("value" in desc) {',
  '        obj[prop] = desc.value;',
  '      }',
  '    }',
  '    return obj;',
  '  };',
  '  Object.getOwnPropertyDescriptor = function (obj, prop) {',
  '    return { value: obj[prop], writable: true, enumerable: true, configurable: true };',
  '  };',
  '  Object.getOwnPropertyNames = function (obj) {',
  '    var a = [], k;',
  '    for (k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) { a.push(k); } }',
  '    return a;',
  '  };',
  '}',
  'if (typeof Function.prototype.bind !== "function") {',
  '  Function.prototype.bind = function (thisArg) {',
  '    var fn = this;',
  '    var args = Array.prototype.slice.call(arguments, 1);',
  '    return function () {',
  '      return fn.apply(thisArg, args.concat(Array.prototype.slice.call(arguments)));',
  '    };',
  '  };',
  '}',
  ''
].join('\n');

var finalJsx = wrapper + shim + readFileSync(jsx, 'utf8');
finalJsx = finalJsx.replace(/"use strict";?/g, '');
writeFileSync(jsx, finalJsx);

// 3. Production vendor: the same ESON bundle + an install footer that makes
//    JSON = ESON. ExtendScript's native JSON.parse is the broken permissive
//    one (accepts "[01]", "[1.]", "{1:1}", trailing commas), so the vendor
//    REPLACES parse/stringify unconditionally (creating the JSON object when
//    absent). The ESON facade is always available as the global `ESON`.
var vendor = finalJsx + '\n' + [
  '(function () {',
  '  if (typeof JSON === "undefined") { JSON = {}; }',
  '  JSON.parse = ESON.parse;',
  '  JSON.stringify = ESON.stringify;',
  '})();',
  ''
].join('\n');
writeFileSync(join(DIST, 'vendor-eson.js'), vendor);

// 4. Runtime-only vendor for the COM tool's install wrapper: tree-shaken
//    parse+stringify core (15.4KB vs 53KB - the rewrite/trusted/fast/caps
//    machinery is dead weight there). Same ESON_JSON2 wrapper + shim +
//    install footer.
var runtimeJsx = join(DIST, 'ESON-runtime.jsx');
jsxBuild(join(ROOT, 'src', 'runtime.ts'), runtimeJsx);
var runtimeFinal = wrapper + shim + readFileSync(runtimeJsx, 'utf8');
runtimeFinal = runtimeFinal.replace(/"use strict";?/g, '');
var runtimeVendor = runtimeFinal + '\n' + [
  '(function () {',
  '  if (typeof JSON === "undefined") { JSON = {}; }',
  '  JSON.parse = ESON.parse;',
  '  JSON.stringify = ESON.stringify;',
  '})();',
  ''
].join('\n');
writeFileSync(join(DIST, 'vendor-eson-runtime.js'), runtimeVendor);

console.log('[eson-build] wrote ' + join(DIST, 'ESON.jsx') + ', ' + join(DIST, 'vendor-eson.js') + ', ' +
  join(DIST, 'vendor-eson-runtime.js') + ' and ' + join(DIST, 'eson-core.esm.mjs'));
