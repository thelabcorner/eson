// ESTC build: ESON runtime vendor (dist/vendor-eson-runtime.js).
//
// The per-eval injection artifact for the COM tool: parse + stringify only,
// plus the global JSON install footer. `allowJson` is enabled because
// installing the global JSON object is this artifact's contract.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJson2Prelude } from './tooling/json2-prelude.mjs';

var ROOT = dirname(fileURLToPath(import.meta.url));

export default {
  host: 'illustrator',
  hostTypes: 'Illustrator/2022',
  additionalTypes: ['./src/globals.d.ts', './src/spidermonkey.d.ts'],
  entry: 'src/runtime.ts',
  outfile: 'dist/vendor-eson-runtime.js',
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
  footer: [{ file: 'tooling/estc-vendor-footer.js' }],
  allowJson: true,
  allowIncludes: false,
  live: false,
  liveLaunch: false
};
