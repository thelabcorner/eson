// Fast stringify lane for caller-certified-inert data.
//
// Contract: plain objects/arrays, no getters, no custom toJSON, no replacer,
// no indentation, no cycles, only JSON-supported primitives. Preflight
// detects violations (and cycles) cheaply; the stringify itself skips the
// toJSON/replacer semantic machinery (json2-v2 skipSemantics), which is the
// certified lane's win over the strict path. onUnsupported: "fallback"
// (default) | "throw".
import { stringifyJson } from './stringify';
import { Json2Api, SourceKernel } from './types';

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
    // Only plain objects qualify for the fast lane. Dates, boxed primitives,
    // RegExps and host objects serialize through toJSON/property semantics
    // that the lane is not certified for - route them to the full path.
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
    return stringifyJson(value, undefined, undefined, kernel, json2);
  }
  return stringifyJson(value, undefined, undefined, kernel, json2, { skipSemantics: true });
}
