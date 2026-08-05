#!/usr/bin/env node
// Deterministic differential fuzzer: bundles the entry, runs seeded
// iterations, reports the first divergences.
// Usage: node tests/fuzz.mjs [iterations] [seed]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

var ROOT = dirname(fileURLToPath(import.meta.url));
var PROJECT = join(ROOT, '..');
var ENTRY = join(ROOT, 'fuzz-entry.ts');
var BUNDLE = join(ROOT, '.eson-fuzz.bundle.mjs');
var ITERS = parseInt(process.argv[2] || '50000', 10);
var SEED = Number(process.argv[3] || '0xC0FFEE') >>> 0;

function findEsbuild() {
  if (process.env.ESBUILD_PATH && existsSync(process.env.ESBUILD_PATH)) return process.env.ESBUILD_PATH;
  var direct = join(PROJECT, 'node_modules', '.bin', 'esbuild');
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

execFileSync(process.execPath, [findEsbuild(),
  ENTRY, '--bundle', '--outfile=' + BUNDLE,
  '--format=esm', '--platform=node', '--target=es2019',
  '--log-level=error'
], { stdio: 'inherit' });

var json2Path = join(PROJECT, 'vendor', 'json2.raw.js');
if (!existsSync(json2Path)) {
  throw new Error('fuzz: raw json2 source not found at ' + json2Path);
}
globalThis.ESON_TEST_JSON2_SRC = readFileSync(json2Path, 'utf8');
globalThis.ESON_FUZZ_CFG = { iters: ITERS, seed: SEED };
globalThis.ESON_FUZZ_DIVERGENT = [];
try {
  await import(pathToFileURL(BUNDLE).href);
} finally {
  try {
    if (globalThis.ESON_FUZZ_DIVERGENT && globalThis.ESON_FUZZ_DIVERGENT.length) {
      writeFileSync(join(ROOT, 'fuzz-divergent.json'), JSON.stringify(globalThis.ESON_FUZZ_DIVERGENT, null, 1), 'utf8');
      console.log('wrote fuzz-divergent.json with ' + globalThis.ESON_FUZZ_DIVERGENT.length + ' cases');
    }
  } catch (e) { console.error('divergent dump failed: ' + e); }
  try { rmSync(BUNDLE); } catch (ignore) {}
}
