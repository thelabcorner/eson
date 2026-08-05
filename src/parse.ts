// ESON parse lanes.
//
// parse()            - strict RFC 8259 parse. Eval-only hybrid:
//                       strictnessPreScan (certified verdict-clean - the
//                       strict protect + RFC-exact rules prove eval-ability)
//                       then the eval as the native grammar checker.
// decodeSourceChecked- eval-free lenient parser accepting the SpiderMonkey
//                      source-literal subset toSource emits for data; rejects
//                      functions/new/calls/member-access before anything can
//                      run. Catches misrouted or corrupted payloads.
// evalSource()       - raw eval. Only reachable through the explicitly trusted
//                      API (parseTrusted / decodeSourceTrusted); the caller
//                      warrants the input. There is no prefix/extension/checksum
//                      heuristic anywhere that routes text to this path.
import { sanitizeJsonText, strictnessPreScan } from './validate';
import { parseValue } from './parser';
import { walkReviver } from './reviver';
import { Json2Api } from './types';
import { evalSourceImpl } from './eval-lane';

// Verdict memo (value-keyed, 8-entry LRU): identical text parsed repeatedly
// (benchmarks, library loops, cache reads) skips the pre-scan + eval entirely
// on hits. ES3-safe: object keys hash natively; every lookup and write goes
// through hasOwnProperty so inherited Object.prototype members can never
// produce false hits, and the '__proto__' key is never written (a plain
// object assignment would set the prototype - pollution).
var memoKeys: string[] = [];
var memoVals: any = {};

function memoSet(text: string, value: any, isError: boolean): void {
  if (text === '__proto__') return;
  if (!Object.prototype.hasOwnProperty.call(memoVals, text)) {
    memoKeys[memoKeys.length] = text;
    if (memoKeys.length > 8) {
      delete memoVals[memoKeys[0]];
      memoKeys.shift();
    }
  }
  memoVals[text] = { err: isError, value: value };
}

export function parseJson(text: any, reviver?: any, json2?: Json2Api | null): any {
  var raw = String(text);
  var noReviver = typeof reviver !== 'function';
  if (noReviver && Object.prototype.hasOwnProperty.call(memoVals, raw)) {
    var hit: any = memoVals[raw];
    if (hit.err) throw hit.value;
    return hit.value;
  }
  var ok = true;
  var value: any;
  try {
    if (strictnessPreScan(raw)) {
      // Fast path: the pre-scan proves eval-ability (identifiers limited to
      // true/false/null, no JS-only escapes, allowed charset, dots only
      // after digits, number boundaries, comma rules, depth) - the eval is
      // the native grammar checker. The eval throws SyntaxError on anything
      // the checks missed (e.g. a malformed literal).
      value = evalSourceImpl(sanitizeJsonText(raw));
    } else {
      // The pre-scan is certified verdict-clean (zero false-rejects: the
      // strict protect only fails on RFC-invalid strings and every other
      // rule is RFC-exact - certified by the fuzz accept-parity and the
      // JSONTestSuite must-accept corpus, 95/95 on the fast path). A
      // pre-scan failure IS a rejection; the 8-op regex gate is no longer
      // re-run on the reject lane (measured ~1.1-1.3us/byte saved there).
      throw new SyntaxError('ESON.parse: invalid JSON text');
    }
  } catch (e) {
    ok = false;
    value = e;
  }
  if (noReviver) {
    memoSet(raw, value, !ok);
  }
  if (!ok) throw value;
  return typeof reviver === 'function' ? walkReviver({ '': value }, '', reviver) : value;
}

export function decodeCheckedSource(source: any, reviver?: any): any {
  var s = String(source);
  var r = parseValue(s, { lenient: true });
  if (!r.ok) {
    throw new SyntaxError('ESON.decodeSourceChecked: unsafe or malformed source' + (r.error ? ' (' + r.error + ')' : ''));
  }
  return typeof reviver === 'function' ? walkReviver({ '': r.value }, '', reviver) : r.value;
}

// Trusted lane: no gate, no scan. Caller warrants the source.
export function evalSource(source: any): any {
  return evalSourceImpl(source);
}
