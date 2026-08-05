import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
var ROOT = dirname(fileURLToPath(import.meta.url));
var BUNDLE = join(ROOT, '.poly.bundle.mjs');
var esb = join(ROOT, '..', 'node_modules', '.bin', 'esbuild');
execFileSync(process.execPath, [esb, join(ROOT, 'poly-entry.ts'), '--bundle', '--outfile=' + BUNDLE, '--format=esm', '--platform=node', '--target=es2019', '--log-level=error'], { stdio: 'inherit' });
globalThis.ESON_TEST_JSON2_SRC = readFileSync(join(ROOT, '..', 'vendor', 'json2.raw.js'), 'utf8');
await import(pathToFileURL(BUNDLE).href);
try { rmSync(BUNDLE); } catch (ignore) {}
