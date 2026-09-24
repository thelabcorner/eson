// ESTC build: ESON standalone facade (dist/ESON.jsx).
//
// Bannerless IIFE (COM-eval / $.evalFile safe) defining `var ESON`. The
// private JSON2 backend is injected as the ESTC `prelude`; the canonical
// emission (ES3 normalization, esbuild-helper localization, strict-directive
// strip, final grammar gate) is owned by the shared toolchain. No project
// shim: ESON must never mutate persistent host built-ins.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJson2Prelude } from './tooling/json2-prelude.mjs';

var ROOT = dirname(fileURLToPath(import.meta.url));

export default {
  host: 'illustrator',
  hostTypes: 'Illustrator/2022',
  additionalTypes: ['./src/globals.d.ts', './src/spidermonkey.d.ts'],
  entry: 'src/index.ts',
  outfile: 'dist/ESON.jsx',
  globalName: 'ESON',
  target: 'illustrator',
  requireTarget: false,
  sourceLint: true,
  typecheck: true,
  normalize: true,
  compatibilityTransforms: ['esbuild'],
  compatibilityShims: [],
  allowedMissingBuiltins: [],
  allowedGlobalPatches: [],
  prelude: [{ code: buildJson2Prelude(ROOT) }],
  footer: [],
  // ESON fingerprints the host JSON (caps.ts `localJsonPresent`) but the
  // standalone facade never installs or requires it - the warning stays.
  allowJson: false,
  allowIncludes: false,
  live: false,
  liveLaunch: false
};
