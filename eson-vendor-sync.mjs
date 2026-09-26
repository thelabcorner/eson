#!/usr/bin/env node
// ESON vendor-sync guard — COM-tool integration is explicit and byte-checked.
// Ordinary ESON builds never mutate agent-skills/.
//
// Historical COM-tool names json2.js/json2-runtime.js intentionally map to the
// canonical ESON vendor/runtime outputs.
//
//   node eson-vendor-sync.mjs
//   node eson-vendor-sync.mjs --check
//   node eson-vendor-sync.mjs --check --quiet
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

var ROOT = dirname(fileURLToPath(import.meta.url));
var VENDOR_DIR = join(ROOT, '..', 'agent-skills', 'illustrator-com-automation-skill', 'vendor');
var CORE = [
  ['json2.js', join(ROOT, 'dist', 'vendor-eson.js'), join(VENDOR_DIR, 'json2.js')],
  ['json2-runtime.js', join(ROOT, 'dist', 'vendor-eson-runtime.js'), join(VENDOR_DIR, 'json2-runtime.js')]
];
var ACCEL = [
  ['ESON.accel.jsx', join(ROOT, 'dist', 'ESON.accel.jsx'), join(VENDOR_DIR, 'ESON.accel.jsx')],
  ['ESON.accel.min.jsx', join(ROOT, 'dist', 'ESON.accel.min.jsx'), join(VENDOR_DIR, 'ESON.accel.min.jsx')]
];

var args = process.argv.slice(2);
var mode = args.indexOf('--check') >= 0 ? 'check' : 'sync';
var quiet = args.indexOf('--quiet') >= 0;

function say(s) {
  if (!quiet) console.log(s);
}

function requireComplete(pairs, label, allowAllMissing) {
  var present = 0;
  for (var i = 0; i < pairs.length; i++) {
    if (existsSync(pairs[i][1])) present++;
  }
  if (present === 0 && allowAllMissing) return false;
  if (present !== pairs.length) {
    throw new Error('[eson-vendor-sync] FAIL: partial ' + label + ' artifact set; rebuild ESON before integration');
  }
  return true;
}

function processPairs(pairs) {
  for (var i = 0; i < pairs.length; i++) {
    var label = pairs[i][0];
    var source = pairs[i][1];
    var target = pairs[i][2];
    var sourceBytes = readFileSync(source);

    if (mode === 'sync') {
      writeFileSync(target, sourceBytes);
      say('[eson-vendor-sync] synced ' + label + ' (' + sourceBytes.length + ' bytes)');
      continue;
    }

    if (!existsSync(target)) {
      throw new Error('[eson-vendor-sync] FAIL: vendor/' + label + ' is missing — run node eson-vendor-sync.mjs');
    }

    var targetBytes = readFileSync(target);
    if (sourceBytes.length !== targetBytes.length || !sourceBytes.equals(targetBytes)) {
      throw new Error('[eson-vendor-sync] FAIL: vendor/' + label + ' (' + targetBytes.length +
        ' bytes) diverges from canonical source (' + sourceBytes.length +
        ' bytes) — run node eson-vendor-sync.mjs');
    }

    say('[eson-vendor-sync] ok: vendor/' + label + ' matches canonical ESON output byte-for-byte (' + sourceBytes.length + ' bytes)');
  }
}

try {
  if (!existsSync(VENDOR_DIR)) {
    throw new Error('[eson-vendor-sync] FAIL: vendor dir missing: ' + VENDOR_DIR);
  }

  requireComplete(CORE, 'core vendor', false);
  var hasAccel = requireComplete(ACCEL, 'accel vendor', true);

  processPairs(CORE);
  if (hasAccel) {
    processPairs(ACCEL);
  } else {
    say('[eson-vendor-sync] PENDING: dist/ESON.accel*.jsx not built yet — core vendor pair only');
  }
} catch (e) {
  console.error(e && e.message ? e.message : String(e));
  process.exit(1);
}
