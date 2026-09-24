#!/usr/bin/env node
// ESON build: bundles the TypeScript core into
//   dist/ESON.jsx            - bannerless IIFE (COM-eval / $.evalFile safe),
//                              defines var ESON (the facade); the private
//                              ESON_JSON2 backend is the ESTC prelude
//   dist/vendor-eson.js      - production drop-in: the same bundle plus the
//                              json2-compatible global-JSON install footer
//   dist/ESON-runtime.jsx    - tree-shaken parse+stringify runtime bundle
//                              (no install footer)
//   dist/vendor-eson-runtime.js - the runtime bundle + install footer
//   dist/json2-reference.jsx - full raw json2 (probe differential reference)
//   dist/eson-core.esm.mjs   - ESM bundle of the core for Node test harnesses
//
// ExtendScript emission is owned by the shared ESTC toolchain
// (../extendscript-toolchain): esbuild bundling, bundle-local compatibility
// transforms, ES3 normalization/re-emission, strict-directive strip and the
// final grammar gate. Do NOT reintroduce project-local parser/runtime shims
// or persistent built-in mutations here - ESON must never patch host globals
// beyond its documented vendor install contract.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJson2Reference } from './tooling/json2-prelude.mjs';

var ROOT = dirname(fileURLToPath(import.meta.url));
var DIST = join(ROOT, 'dist');
var ENTRY = join(ROOT, 'src', 'index.ts');
var ESTC = join(ROOT, '..', 'extendscript-toolchain', 'bin', 'estc.mjs');
var REQUIRE_ACCEL = process.argv.includes('--require-accel');

function findEsbuild() {
  if (process.env.ESBUILD_PATH && existsSync(process.env.ESBUILD_PATH)) return process.env.ESBUILD_PATH;
  var direct = join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
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

function estcBuild(config) {
  execFileSync(process.execPath, [ESTC, 'build', '--config', config], {
    cwd: ROOT,
    stdio: 'inherit'
  });
}

if (!existsSync(ESTC)) {
  throw new Error('eson-build: shared ExtendScript toolchain not found at ' + ESTC);
}

mkdirSync(DIST, { recursive: true });

// 1. ESM core bundle (Node harnesses import this).
esmBuild(ENTRY, join(DIST, 'eson-core.esm.mjs'));

// 2. Canonical ExtendScript artifacts, emitted through ESTC. The toolchain
//    localizes esbuild's ES5 helpers bundle-locally (no Object/Function
//    prototype patches), rewrites ES3 reserved dot-properties, strips
//    generated strict directives and runs the conservative ES3 grammar gate.
estcBuild('./extendscript.estc.config.mjs');
estcBuild('./extendscript.vendor.estc.config.mjs');
estcBuild('./extendscript.runtime.estc.config.mjs');
estcBuild('./extendscript.runtime-vendor.estc.config.mjs');

// 3. Reference artifact: the FULL raw json2 standalone (var JSON2) for the
//    probes' json2-parse differential lanes. Not a release artifact and not
//    ESTC-normalized - its value is being the unmodified reference.
writeFileSync(join(DIST, 'json2-reference.jsx'), buildJson2Reference(ROOT));

// 4. Accelerated self-extracting bundle (ESON.accel.jsx): espack "1 + n" -
//    ESONJson.dll is the payload, the shared esb64 accelerator is embedded
//    automatically; the native gate enables on the espack-provided lib.
//    Requires: ../espack (espack-build.mjs), native/build/ESONJson.dll and
//    the current ESTC-built esb64 runtime (../esb64/dist/vendor-esb64-runtime.js).
//    Skips silently when the inputs are absent (unless --require-accel).
var ACCELERATOR = [
  '',
  '(function () {',
  '  // ESON espack adapter: ESPAK.load() materializes ESONJson.dll (natively,',
  '  // via the shared accelerator), then the ExternalObject parse gate enables',
  '  // on the espack-provided lib. Auto-enables on eval; ESON.useEspack() is',
  '  // the opt-in form (idempotent). ESON.espack holds the outcome.',
  '  if (typeof ESPAK !== "object" || !ESPAK || typeof ESPAK.load !== "function") return;',
  '  if (typeof ESON !== "object" || !ESON || typeof ESON.enableNativeGate !== "function") return;',
  '  var cached = null;',
  '  function useEspack() {',
  '    // Lane C (merge architecture v1): load by NAME, never load(0) - the',
  '    // merged bundle carries multiple payloads and index 0 is not ESONJson.',
  '    var l = ESPAK.load("ESONJson");',
  '    if (!l.ok || l.mode !== "native" || !l.lib) {',
  '      cached = { ok: false, reason: (l && l.error) || "ESPAK load failed" };',
  '      return cached;',
  '    }',
  '    var caps = ESON.enableNativeGate({ lib: l.lib, dllPath: l.path });',
  '    cached = { ok: caps["native"] && caps["native"].enabled === true, caps: caps["native"], path: l.path };',
  '    return cached;',
  '  }',
  '  ESON.useEspack = useEspack;',
  '  ESON.espack = useEspack();',
  '  var g = null;',
  '  try { if (typeof $ !== "undefined" && $.global) { g = $.global; } } catch (e1) {}',
  '  if (g) {',
  '    g.ESON = ESON;',
  '    g.ESPAK = ESPAK;',
  '    // ESON vendor semantics: JSON = ESON. This also satisfies the COM',
  '    // tool\'s ESON share-check (JSON.parse === ESON.parse), so the facade',
  '    // stays stable on $.global instead of being replaced by the tool\'s',
  '    // slim runtime vendor on the next eval.',
  '    if (typeof g.JSON === "undefined" || g.JSON === null) { g.JSON = {}; }',
  '    g.JSON.parse = ESON.parse;',
  '    g.JSON.stringify = ESON.stringify;',
  '  }',
  '}());',
  ''
].join('\n');

// Lane C manifest sidecar (contract/manifest-schema-v1, pinned): the payload
// + accel metadata espack embeds, in the exact schema shape espack-merge
// consumes. Deterministic (fixed key order, no machine paths). Self-generated
// here from the same DLL inputs espack embeds; smoke-tested byte-equality
// against espack-build --manifest-out (Lane A) in the build validation.
function espackManifest(bundleName, payloadDll, payloadName, payloadVersion, accelDll) {
  var payloadBytes = readFileSync(payloadDll);
  var payload = {
    name: payloadName,
    version: payloadVersion,
    len: payloadBytes.length,
    b64: payloadBytes.toString('base64'),
    fileName: payloadName + '_v' + payloadVersion + '.dll'
  };
  var accel = null;
  if (accelDll && existsSync(accelDll)) {
    var accelBytes = readFileSync(accelDll);
    accel = {
      name: 'ESB64Native',
      version: '2',
      len: accelBytes.length,
      b64: accelBytes.toString('base64'),
      fileName: 'ESB64Native_v2.dll'
    };
  }
  return {
    format: 'espack-manifest',
    version: 1,
    bundleName: bundleName,
    cacheDir: '',
    chunkSize: 24576, // mirrors espack-build.mjs CHUNK_SIZE
    accel: accel,
    payloads: [payload]
  };
}

function accelSkip(reason) {
  if (REQUIRE_ACCEL) {
    throw new Error('eson-build: --require-accel set but accel cannot build: ' + reason);
  }
  console.log('[eson-build] accel skipped: ' + reason);
}

function buildAccel() {
  var espackBuild = join(ROOT, '..', 'espack', 'espack-build.mjs');
  var dll = join(ROOT, 'native', 'build', 'ESONJson.dll');
  // Explicitly pin the CURRENT ESTC-built esb64 runtime and the CURRENT
  // ESB64Native accelerator. espack's vendored snapshots (espack/vendor/*)
  // have carried pre-migration shims and stale DLL bytes, and the ESPAK
  // merge contract is byte-exact (manifest vs bundle) - neither may
  // re-enter this composite.
  var esb64Runtime = process.env.ESB64_RUNTIME_PATH || join(ROOT, '..', 'esb64', 'dist', 'vendor-esb64-runtime.js');
  var accelDll = process.env.ESB64_ACCEL_PATH || join(ROOT, '..', 'esb64', 'native', 'bin', 'ESB64Native.dll');
  if (!existsSync(espackBuild)) {
    return accelSkip('espack repo not found at ' + join(ROOT, '..', 'espack'));
  }
  if (!existsSync(dll)) {
    return accelSkip(dll + ' missing (run npm run native-build)');
  }
  if (!existsSync(esb64Runtime)) {
    return accelSkip('ESTC-built esb64 runtime not found at ' + esb64Runtime +
      ' (build ../esb64 first, or set ESB64_RUNTIME_PATH)');
  }
  if (!existsSync(accelDll)) {
    return accelSkip('ESB64 accelerator not found at ' + accelDll +
      ' (build ../esb64 first, or set ESB64_ACCEL_PATH)');
  }
  var accelBundle = join(DIST, '.eson-accel-bundle.jsx');
  execFileSync(process.execPath, [espackBuild, '--embed', dll, '--accel', accelDll, '--accel-version', '2', '--out', accelBundle,
    '--name', 'eson', '--quiet'], {
    stdio: 'inherit',
    env: Object.assign({}, process.env, { ESB64_RUNTIME_PATH: esb64Runtime })
  });
  var bundleText = readFileSync(accelBundle, 'utf8');
  var facadeText = readFileSync(join(DIST, 'ESON.jsx'), 'utf8');
  // Lane C (merge architecture v1): emit the manifest sidecar (pinned schema
  // contract/manifest-schema-v1) + the loader-free facade artifact for the
  // composer. The standalone .accel.jsx below is unchanged in composition
  // (bundle + facade + adapter; only the adapter's load call changed).
  var manifest = espackManifest('eson', dll, 'ESONJson', '1', accelDll);
  writeFileSync(join(DIST, 'ESON.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  var facadeOut = facadeText + '\n' + ACCELERATOR +
    '// ESON.facade.jsx - loader-free facade + espack adapter (composer appends to a merged bundle; requires ESPAK on $.global)\n';
  writeFileSync(join(DIST, 'ESON.facade.jsx'), facadeOut);
  var accelOut = bundleText + '\n' + facadeText + '\n' + ACCELERATOR +
    '// ESON.accel.jsx - self-extracting single-file bundle (espack 1+n + ESON + native gate)\n';
  writeFileSync(join(DIST, 'ESON.accel.jsx'), accelOut);
  // Vendor copy for the COM tool (its session bootstrap evals this bundle so
  // the wrapper's ESON share-check resolves the accelerated facade).
  var skillVendor = join(ROOT, '..', 'agent-skills', 'illustrator-com-automation-skill', 'vendor');
  if (existsSync(skillVendor)) {
    writeFileSync(join(skillVendor, 'ESON.accel.jsx'), accelOut);
    console.log('[eson-build] vendored ESON.accel.jsx -> ' + join(skillVendor, 'ESON.accel.jsx'));
  }
  console.log('[eson-build] wrote ' + join(DIST, 'ESON.accel.jsx') + ' (' + accelOut.length + ' bytes)');
  minifyAccel(accelOut, skillVendor);
}

// Minify the accelerated bundle via the adobe-extendscript-minification
// skill's conservative pipeline (UglifyJS + switch repair + directive
// restore + node --check). The espack banner (leading block comment) is
// extracted BEFORE minification and restored after - the conservative
// config strips comments, and the banner identifies the generated artifact.
function minifyAccel(accelOut, skillVendor) {
  var skillDir = join(ROOT, '..', 'agent-skills', 'adobe-extendscript-minification');
  var minifyScript = join(skillDir, 'scripts', 'minify-jsx.py');
  var minifyConfig = join(skillDir, 'configs', 'conservative.json');
  if (!existsSync(minifyScript) || !existsSync(minifyConfig)) {
    if (REQUIRE_ACCEL) {
      throw new Error('eson-build: --require-accel set but minification skill not found at ' + skillDir);
    }
    console.log('[eson-build] accel minify skipped: minification skill not found at ' + skillDir);
    return;
  }
  var m = accelOut.match(/^\/\*[\s\S]*?\*\//);
  var banner = m ? m[0] : '';
  var body = m ? accelOut.substring(m[0].length) : accelOut;
  var bodyPath = join(DIST, '.eson-accel-bundle.body.jsx');
  var minPath = join(DIST, '.eson-accel-bundle.min.jsx');
  writeFileSync(bodyPath, body, 'utf8');
  execFileSync('python', [minifyScript, '--in', bodyPath, '--config', minifyConfig,
    '--out', minPath], { stdio: 'inherit' });
  var minBody = readFileSync(minPath, 'utf8');
  var minOut = (banner ? banner + '\n' : '') + minBody;
  var minFinal = join(DIST, 'ESON.accel.min.jsx');
  writeFileSync(minFinal, minOut, 'utf8');
  if (skillVendor && existsSync(skillVendor)) {
    writeFileSync(join(skillVendor, 'ESON.accel.min.jsx'), minOut);
    console.log('[eson-build] vendored ESON.accel.min.jsx -> ' + join(skillVendor, 'ESON.accel.min.jsx'));
  }
  console.log('[eson-build] wrote ' + minFinal + ' (' + minOut.length + ' bytes, banner preserved)');
}

if (process.argv.includes('--accel')) {
  buildAccel();
}

console.log('[eson-build] wrote ' + join(DIST, 'ESON.jsx') + ', ' + join(DIST, 'vendor-eson.js') + ', ' +
  join(DIST, 'vendor-eson-runtime.js') + ', ' + join(DIST, 'ESON-runtime.jsx') + ' and ' +
  join(DIST, 'eson-core.esm.mjs') + ' via ESTC');
