#!/usr/bin/env node
// Native-gate lane test harness: bundles tests/native-lane-entry.ts to ESM,
// provisions the json2 reference source via a global, runs in Node.
// The ExternalObject glue is never touched (provideLib test hook).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

var ROOT = dirname(fileURLToPath(import.meta.url));
var PROJECT = join(ROOT, '..');
var ENTRY = join(ROOT, 'native-lane-entry.ts');
var BUNDLE = join(ROOT, '.native-lane.bundle.mjs');
var JSON2_PATH = join(PROJECT, 'vendor', 'json2.raw.js');

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

if (!existsSync(JSON2_PATH)) {
  console.error('native-lane-test: json2 reference not found at ' + JSON2_PATH);
  process.exit(1);
}

globalThis.ESON_TEST_JSON2_SRC = readFileSync(JSON2_PATH, 'utf8');

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
