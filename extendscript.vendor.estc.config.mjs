// ESTC build: ESON production vendor (dist/vendor-eson.js).
//
// Same bundle as the standalone facade plus the install footer that makes the
// global JSON.parse/JSON.stringify BE ESON's. `allowJson` is enabled here (and
// only here + the runtime vendor) because installing the global JSON object is
// this artifact's contract.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJson2Prelude } from './tooling/json2-prelude.mjs';

var ROOT = dirname(fileURLToPath(import.meta.url));

export default {
  host: 'illustrator',
  hostTypes: 'Illustrator/2022',
  additionalTypes: ['./src/globals.d.ts', './src/spidermonkey.d.ts'],
  entry: 'src/index.ts',
  outfile: 'dist/vendor-eson.js',
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
