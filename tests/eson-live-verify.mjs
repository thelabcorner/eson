#!/usr/bin/env node
// Bundles tests/live-verify-entry.ts, provisions the probe report (JSON path
// via --report <file>, or default %TEMP%\eson-capability-report-menu.json),
// and runs the verification. Without a report it still runs oracle/gate parity.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

var ROOT = dirname(fileURLToPath(import.meta.url));
var PROJECT = join(ROOT, '..');
var ENTRY = join(ROOT, 'live-verify-entry.ts');
var BUNDLE = join(ROOT, '.eson-live-verify.bundle.mjs');

function findEsbuild() {
  if (process.env.ESBUILD_PATH && existsSync(process.env.ESBUILD_PATH)) return process.env.ESBUILD_PATH;
  var direct = join(PROJECT, 'node_modules', 'esbuild', 'bin', 'esbuild');
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

var JSON2_PATH = join(PROJECT, 'dist', 'vendor-eson.js');
if (!existsSync(JSON2_PATH)) {
  console.error('live-verify: json2 reference not found at ' + JSON2_PATH);
  process.exit(1);
}
globalThis.ESON_TEST_JSON2_SRC = readFileSync(JSON2_PATH, 'utf8');

var reportArg = process.argv[2];
var reportPath = reportArg && reportArg.startsWith('--report')
  ? process.argv[3]
  : join(process.env.TEMP || '', 'eson-capability-report-menu.json');

if (reportPath && existsSync(reportPath)) {
  globalThis.ESON_LIVE_REPORT = JSON.parse(readFileSync(reportPath, 'utf8'));
  console.log('live-verify: loaded report ' + reportPath);
} else {
  console.log('live-verify: report not found at ' + reportPath + '; oracle/gate parity only');
}

execFileSync(process.execPath, [findEsbuild(),
  ENTRY, '--bundle', '--outfile=' + BUNDLE,
  '--format=esm', '--platform=node', '--target=es2019',
  '--log-level=warning'
], { stdio: 'inherit' });

try {
  await import(pathToFileURL(BUNDLE).href);
} finally {
  try { rmSync(BUNDLE); } catch (ignore) {}
}
