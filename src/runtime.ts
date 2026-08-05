// Runtime-only ESON entry: parse + stringify + the verdict memo + the
// pre-scan. Everything else (rewrite, trusted codecs, stringifyFast, caps
// detection, the native-source machinery, the benchmark block) is pruned by
// the bundler's tree-shaking. Used for the COM tool's install wrapper: a
// ~15.4KB vendor instead of 53.1KB cuts the per-invocation compile.
import { parseJson } from './parse';
import { stringifyJson } from './stringify';
import { Json2Api } from './types';

declare var ESON_JSON2: any; // injected by eson-build.mjs before the bundle

var json2: Json2Api | null = null;

function ensureJson2(): Json2Api {
  if (!json2 && typeof ESON_JSON2 !== 'undefined' && ESON_JSON2 &&
      typeof ESON_JSON2.stringify === 'function') {
    json2 = ESON_JSON2 as Json2Api;
  }
  if (!json2) {
    throw new Error('ESON: no JSON2 fallback available; build with the injected polyfill');
  }
  return json2;
}

export function parse(text: any, reviver?: any): any {
  return parseJson(text, reviver);
}

export function stringify(value: any, replacer?: any, space?: any): string | undefined {
  return stringifyJson(value, replacer, space, null as any, ensureJson2());
}
