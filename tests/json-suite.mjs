#!/usr/bin/env node
// JSONTestSuite runner: bundles the entry, provisions the corpus via a global
// (no Node builtins in the TS bundle), runs ESON.parse against every case.
// Usage: node tests/json-suite.mjs [path-to-test_parsing]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

var ROOT = dirname(fileURLToPath(import.meta.url));
var PROJECT = join(ROOT, '..');
var ENTRY = join(ROOT, 'json-suite-entry.ts');
var BUNDLE = join(ROOT, '.eson-json-suite.bundle.mjs');

var suiteDir = process.argv[2] || join(process.env.TEMP || '', 'JSONTestSuite', 'JSONTestSuite-master', 'test_parsing');
if (!existsSync(suiteDir)) {
  console.error('suite dir not found: ' + suiteDir);
  process.exit(1);
}

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

function loadGroup(prefix) {
  var out = [];
  var names = readdirSync(suiteDir).filter(function (n) { return n.charAt(0) === prefix; });
  for (var i = 0; i < names.length; i++) {
    out.push({ name: names[i], text: readFileSync(join(suiteDir, names[i]), 'utf8') });
  }
  return out;
}

globalThis.ESON_TEST_SUITE = {
  y: loadGroup('y'),
  n: loadGroup('n'),
  i: loadGroup('i')
};

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
