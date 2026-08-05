// Strict stringify - measured delegation.
//
// Measured reality (Illustrator 30.6.0): the vendored json2 algorithm
// (patched for the engine's ternary quirk) is the fastest strict stringifier
// in this engine - 105us at 345B vs 223us for a byte-identical reimplementation
// (json2-v2) and ~900us for the native lane (normalize -> toSource -> rewrite).
// The delegation also guarantees byte-parity by construction.
//
// The native lane (normalize -> toSource -> rewrite in rewrite.ts) remains as
// the architectural opt-in for the trusted codec (encodeSource, which never
// rewrites) and for exotic shapes; strict stringify routes here.
//
// Cycle behavior: stock json2 throws on cycles (RangeError / InternalError),
// which is catchable - matching the "both throw" contract without a per-value
// contains() scan (measured slower).
import { Json2Api, SourceKernel } from './types';

export interface StringifyOptions {
  skipSemantics?: boolean; // accepted for API compatibility; json2's checks are
                           // already the cheapest measured path
}

export function stringifyJson(
  value: any,
  replacer: any,
  space: any,
  kernel: SourceKernel,
  json2: Json2Api,
  options?: StringifyOptions
): string | undefined {
  return json2.stringify(value, replacer, space);
}

// Certified-inert fast lane: the preflight (cycle + inertness detection) then
// the same json2 stringify. The caller warrants: plain objects/arrays, no
// getters, no custom toJSON, no replacer, no indentation, no cycles, only
// JSON-supported primitives. onUnsupported: "fallback" (default) | "throw".
export function stringifyFastJson(
  value: any,
  options: any,
  kernel: SourceKernel,
  json2: Json2Api
): string | undefined {
  var pf = preflight(value, [], 'root');
  if (pf.status === 'cycle') {
    throw new TypeError('ESON.stringifyFast: converting circular structure to JSON');
  }
  if (pf.status !== 'inert') {
    if (options && options.onUnsupported === 'throw') {
      throw new Error('ESON.stringifyFast: unsupported value at ' + (pf.at || 'root'));
    }
    return json2.stringify(value, undefined, undefined);
  }
  return json2.stringify(value, undefined, undefined);
}

export interface PreflightResult {
  status: string; // "inert" | "cycle" | "unsupported"
  at?: string;
}

function contains(list: any[], value: any): boolean {
  var i: number;
  for (i = 0; i < list.length; i++) {
    if (list[i] === value) return true;
  }
  return false;
}

function preflight(v: any, active: any[], path: string): PreflightResult {
  var t = typeof v;
  if (v === null || t === 'string' || t === 'boolean') {
    return { status: 'inert' };
  }
  if (t === 'number') {
    return isFinite(v) ? { status: 'inert' } : { status: 'unsupported', at: path };
  }
  if (t === 'object') {
    if (contains(active, v)) return { status: 'cycle', at: path };
    active[active.length] = v;
    if (Object.prototype.toString.apply(v) === '[object Array]') {
      var len = v.length;
      var i: number;
      var r: PreflightResult;
      for (i = 0; i < len; i++) {
        r = preflight(v[i], active, path + '[' + i + ']');
        if (r.status !== 'inert') {
          active.pop();
          return r;
        }
      }
      active.pop();
      return { status: 'inert' };
    }
    if (Object.prototype.toString.apply(v) !== '[object Object]') {
      active.pop();
      return { status: 'unsupported', at: path };
    }
    var k: string;
    for (k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) {
        r = preflight(v[k], active, path + '.' + k);
        if (r.status !== 'inert') {
          active.pop();
          return r;
        }
      }
    }
    active.pop();
    return { status: 'inert' };
  }
  return { status: 'unsupported', at: path }; // function / undefined / host objects
}
