// ESON facade - capability-adaptive JSON layer for ExtendScript.
//
// Lanes:
//   parse()             strict RFC 8259 parser (eval-gated: pre-scan + sanitize + eval w/ SyntaxError catch)
//   stringify()         native-assisted: normalize -> toSource/uneval -> linear
//                       rewrite; JSON2 fallback (never runs user code twice)
//   stringifyFast()     preflight + raw native source for certified-inert data
//   parseTrusted()      raw eval - explicitly trusted channel only
//   decodeSourceTrusted() raw eval alias
//   decodeSourceChecked() eval-free lenient decode of the source-literal subset
//   encodeSource()      SpiderMonkey source generation (may preserve more than
//                       JSON: undefined, NaN, functions, dates, sparse arrays)
//   capabilities()      runtime fingerprints (JSON classification, kernels)
//   benchmark()         in-module quick benchmark (hires timer when present)
//   install()           json2 fallback provisioning / global exposure
//
// Trust contract: no prefix, extension, checksum, or path heuristic ever
// routes text to eval. Trusted entry points are named functions only.
import {
  BenchItem,
  EsonCapabilities,
  FastOptions,
  InstallOptions,
  Json2Api,
  SourceKernel
} from './types';
import { captureKernel, classifyJson, detectCaps, globalObject } from './caps';
import { loadJson2 } from './json2';
import { parseJson, decodeCheckedSource, evalSource } from './parse';
import { stringifyJson } from './stringify';
import { stringifyFastJson } from './fast';
import {
  encodeSourceTrusted as encodeSourceImpl,
  decodeSourceTrusted as decodeSourceImpl,
  parseTrusted as parseTrustedImpl
} from './trusted';

declare var ESON_JSON2: any; // injected by eson-build.mjs before the bundle

interface EsonState {
  g: any;
  kernel: SourceKernel;
  json2: Json2Api | null;
  caps: EsonCapabilities | null;
}

var state: EsonState = {
  g: globalObject(),
  kernel: {
    uneval: null,
    objectToSource: null,
    arrayToSource: null,
    stringToSource: null,
    stringQuote: null,
    profile: 'none'
  },
  json2: null,
  caps: null
};

var dirty = true;

function refresh(): void {
  if (!dirty) return;
  dirty = false;
  state.g = globalObject();
  state.kernel = captureKernel(state.g);
  state.caps = detectCaps(state.g);
  if (!state.json2 && typeof ESON_JSON2 !== 'undefined' && ESON_JSON2 &&
      typeof ESON_JSON2.stringify === 'function') {
    state.json2 = ESON_JSON2 as Json2Api;
  }
}

function ensureJson2(): Json2Api {
  refresh();
  if (!state.json2) {
    throw new Error('ESON: no JSON2 fallback available; call install({ json2Source }) or build with the injected polyfill');
  }
  return state.json2;
}

export function capabilities(): EsonCapabilities {
  dirty = true; // capability queries are explicit re-probes
  refresh();
  return state.caps as EsonCapabilities;
}

export function parse(text: any, reviver?: any): any {
  refresh();
  return parseJson(text, reviver, state.json2);
}

export function stringify(value: any, replacer?: any, space?: any): string | undefined {
  refresh();
  return stringifyJson(value, replacer, space, state.kernel, ensureJson2());
}

export function stringifyFast(value: any, options?: FastOptions): string | undefined {
  refresh();
  return stringifyFastJson(value, options, state.kernel, ensureJson2());
}

export function parseTrusted(source: any, reviver?: any): any {
  return parseTrustedImpl(source, reviver);
}

export function encodeSource(value: any): string {
  refresh();
  return encodeSourceImpl(value, state.kernel);
}

export function decodeSourceTrusted(source: any): any {
  return decodeSourceImpl(source);
}

export function decodeSourceChecked(source: any, reviver?: any): any {
  return decodeCheckedSource(source, reviver);
}

export function loadJson2Api(json2Source: string): Json2Api {
  return loadJson2(json2Source);
}

export function install(options?: InstallOptions): EsonCapabilities {
  if (options && typeof options.json2Source === 'string' && options.json2Source.length > 0) {
    state.json2 = loadJson2(options.json2Source);
  }
  if (options && options.exposeGlobal === true) {
    var g = state.g || globalObject();
    var hasGlobal = typeof g !== 'undefined' && g !== null && typeof g.JSON !== 'undefined';
    if (!hasGlobal && state.json2) {
      try {
        g.JSON = state.json2;
      } catch (e) {
        // swallow: exposing the global is best-effort
      }
    }
  }
  dirty = true;
  refresh();
  return state.caps as EsonCapabilities;
}

// ---- quick in-module benchmark -------------------------------------------------

function nowUs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now() * 1000;
  }
  if (typeof $ !== 'undefined' && $.hiresTimer) {
    return $.hiresTimer;
  }
  return Date.now() * 1000;
}

function timeLane(fn: () => void, iterations: number): number[] {
  var samples: number[] = [];
  var i: number;
  var t0: number;
  var t1: number;
  for (i = 0; i < iterations; i++) {
    t0 = nowUs();
    fn();
    t1 = nowUs();
    samples[samples.length] = t1 - t0;
  }
  return samples;
}

function median(samples: number[]): number {
  var s = samples.slice(0);
  s.sort(function (a: number, b: number): number { return a - b; });
  return s[Math.floor(s.length / 2)];
}

export function benchmark(iterations?: number): BenchItem[] {
  refresh();
  var it = iterations || 100;
  var json2 = ensureJson2();

  var settings: any = {
    styleIndex: 0, bendPct: 35, hDistortPct: 0, vDistortPct: 0,
    showAdvanced: false, verticalAxis: false, preserveWidth: true,
    preserveHeight: false, anchorIndex: 0, hideOriginal: false,
    deleteOriginal: false, replaceOriginal: false, previewOpacity: 55,
    dielineSpotNames: ['CutContour', 'CutContour2', 'dieline'],
    svgWarpPath: '', svgBoundsPath: ''
  };
  var settingsJson: string;
  try { settingsJson = json2.stringify(settings) as string; } catch (e) { settingsJson = '{}'; }

  var j2s = timeLane(function (): void { json2.stringify(settings); }, it);
  var esonS = timeLane(function (): void { stringify(settings); }, it);
  var r1 = median(esonS) > 0 ? median(j2s) / median(esonS) : 0;

  var j2p = timeLane(function (): void { json2.parse(settingsJson); }, it);
  var esonP = timeLane(function (): void { parse(settingsJson); }, it);
  var r2 = median(esonP) > 0 ? median(j2p) / median(esonP) : 0;

  var out: BenchItem[] = [];
  out[out.length] = lane('stringify', 'settings', it, esonS, settingsJson.length, r1);
  out[out.length] = lane('parse', 'settings', it, esonP, settingsJson.length, r2);

  if (state.kernel.uneval || state.kernel.objectToSource) {
    var trusted = timeLane(function (): void {
      var s = encodeSourceImpl(settings, state.kernel);
      evalSource(s);
    }, it);
    out[out.length] = lane('trustedRoundtrip', 'settings', it, trusted, settingsJson.length, 0);
  }

  return out;
}

function lane(laneName: string, payload: string, iterations: number, samples: number[], outputBytes: number, vsJson2: number): BenchItem {
  var sorted = samples.slice(0);
  sorted.sort(function (a: number, b: number): number { return a - b; });
  var medianUs = sorted[Math.floor(sorted.length / 2)];
  return {
    lane: laneName,
    payload: payload,
    iterations: iterations,
    medianUs: medianUs,
    minUs: sorted[0],
    p95Us: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    opsPerSec: medianUs > 0 ? 1000000 / medianUs : 0,
    outputBytes: outputBytes,
    vsJson2: vsJson2
  };
}

export { classifyJson, captureKernel, globalObject, loadJson2 };
export { parseJson, decodeCheckedSource, evalSource };
export { stringifyJson, stringifyFastJson, encodeSourceImpl, decodeSourceImpl, parseTrustedImpl };
export { rewriteSource } from './rewrite';
export { sourceForRoot } from './source-kernel';
