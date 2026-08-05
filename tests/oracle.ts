// Oracle: canonical SpiderMonkey-style source generator for inert graphs.
//
// Models the empirically observed toSource output format
// (see the ESON README §1.2 for the full list of engine quirks):
//   ({a:1, b:[true, null, "x"]})   - objects wrapped in parens, comma-space
//   [undefined, undefined, 1]      - sparse arrays expand to undefined entries
//   {"a b":1}                      - keys quoted only when not identifiers
//   {42:"x"}                       - canonical decimal keys bare
//
// The live probe (probes/eson-capability-probe.jsx) verifies the real kernel
// against this model; byte differences there are informational (the rewriter
// normalizes whatever escape forms SpiderMonkey emits).
import { SourceKernel } from '../src/types';

var rx_ident = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
var rx_int = /^-?[0-9]+$/;

var RESERVED: any = {
  break: true, case: true, catch: true, class: true, const: true, continue: true,
  debugger: true, default: true, delete: true, do: true, else: true, enum: true,
  export: true, extends: true, false: true, finally: true, for: true, function: true,
  if: true, import: true, in: true, instanceof: true, new: true, null: true,
  return: true, super: true, switch: true, this: true, throw: true, true: true,
  try: true, typeof: true, var: true, void: true, while: true, with: true
};

function escChar(c: number): string {
  switch (c) {
    case 8: return '\\b';
    case 9: return '\\t';
    case 10: return '\\n';
    case 11: return '\\v';
    case 12: return '\\f';
    case 13: return '\\r';
    default:
      if (c < 0x20 || c === 0x7f) {
        return '\\x' + ('00' + c.toString(16)).slice(-2);
      }
      if (c === 0x2028 || c === 0x2029) {
        return '\\u' + ('0000' + c.toString(16)).slice(-4);
      }
      return String.fromCharCode(c);
  }
}

function jsesc(s: string): string {
  var out: string[] = [];
  var i: number;
  var c: number;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c === 34) out[out.length] = '\\"';
    else if (c === 92) out[out.length] = '\\\\';
    else out[out.length] = escChar(c);
  }
  return out.join('');
}

function keySource(k: string): string {
  if (rx_ident.test(k) && !RESERVED[k]) return k;
  if (rx_int.test(k) && String(Number(k)) === k) return k;
  return '"' + jsesc(k) + '"';
}

export function oracleSource(v: any): string {
  var t = typeof v;
  if (v === null) return 'null';
  if (t === 'boolean') return String(v);
  if (t === 'number') {
    if (!isFinite(v)) throw new Error('oracle: non-finite number');
    return String(v);
  }
  if (t === 'string') return '"' + jsesc(v) + '"';
  if (t === 'object') {
    if (Object.prototype.toString.apply(v) === '[object Array]') {
      var elems: string[] = [];
      var i: number;
      var len = v.length;
      for (i = 0; i < len; i++) {
        if (i in v) elems[elems.length] = oracleSource(v[i]);
        else elems[elems.length] = 'undefined';
      }
      return '[' + elems.join(', ') + ']';
    }
    var members: string[] = [];
    var k: string;
    for (k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) {
        members[members.length] = keySource(k) + ': ' + oracleSource(v[k]);
      }
    }
    return '({' + members.join(', ') + '})';
  }
  throw new Error('oracle: unsupported value type ' + t);
}

export function makeOracleKernel(): SourceKernel {
  return {
    // toSource variants are this-based (called as fn.call(value)); uneval is
    // argument-based (called as uneval(value)). The oracle mirrors both.
    uneval: function (v: any): string { return oracleSource(v); },
    objectToSource: function (this: any): string { return oracleSource(this); },
    arrayToSource: function (this: any): string { return oracleSource(this); },
    stringToSource: function (this: any): string { return oracleSource(this); },
    stringQuote: null,
    profile: 'oracle'
  };
}
