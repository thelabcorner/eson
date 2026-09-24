// Shared build-time input: the private JSON2 wrapper injected before every
// ESON ExtendScript bundle (ESON_JSON2), and the raw reference artifact for
// the probes' differential lanes.
//
// The raw json2 lives at vendor/json2.raw.js (build-only input; the production
// vendors hold the ESON build). ESON's parse is eval-only (the facade never
// calls json2.parse), so the ~2.3KB parse block is sliced out of the bundled
// copy; the full raw stays available as dist/json2-reference.jsx.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function json2RawPath(root) {
  return join(root, 'vendor', 'json2.raw.js');
}

export function loadJson2Raw(root) {
  var rawPath = json2RawPath(root);
  if (!existsSync(rawPath)) {
    throw new Error('eson-build: raw json2 source not found at ' + rawPath +
      ' (the production vendors now hold the ESON build; the raw json2 is a build-only input)');
  }
  return readFileSync(rawPath, 'utf8');
}

// The stringify-only slice of the raw json2, wrapped in the private
// `var ESON_JSON2 = (function (JSON) { ... })({})` IIFE. This is the ESTC
// `prelude` fragment for the standalone, vendor, runtime and runtime-vendor
// builds.
export function buildJson2Prelude(root) {
  var json2Src = loadJson2Raw(root);
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
  var closeIdx2 = json2Src.indexOf(closeAnchor, guardIdx);
  if (closeIdx2 < 0) {
    throw new Error('eson-build: json2 stringify guard closing not found');
  }
  json2Src = json2Src.substring(0, closeIdx2) + json2Src.substring(closeIdx2 + closeAnchor.length);
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
  return 'var ESON_JSON2 = (function (JSON) {\n' + json2Src + '\nreturn JSON;\n})({});\n';
}

// Full raw json2 as a standalone `var JSON2` reference artifact (used by the
// probes' json2-parse differential lanes). Not an ESTC release artifact.
export function buildJson2Reference(root) {
  var rawRef = loadJson2Raw(root).replace(/"use strict";?/g, '');
  return 'var JSON2 = (function (JSON) {\n' + rawRef + '\nreturn JSON;\n})({});\n';
}
