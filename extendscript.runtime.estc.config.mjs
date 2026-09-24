// ESTC build: ESON runtime-only bundle (dist/ESON-runtime.jsx).
//
// Tree-shaken parse + stringify entry (src/runtime.ts) for per-eval injection.
// No install footer: this artifact defines the ESON facade only; the vendor
// variant adds the global JSON install. The private JSON2 backend is the
// ESTC prelude.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJson2Prelude } from './tooling/json2-prelude.mjs';

var ROOT = dirname(fileURLToPath(import.meta.url));

export default {
  host: 'illustrator',
  hostTypes: 'Illustrator/2022',
  additionalTypes: ['./src/globals.d.ts', './src/spidermonkey.d.ts'],
  entry: 'src/runtime.ts',
  outfile: 'dist/ESON-runtime.jsx',
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
  allowJson: false,
  allowIncludes: false,
  live: false,
  liveLaunch: false
};
