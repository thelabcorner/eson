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
// NUL guard: the ES3 engine (SpiderMonkey 2014 lineage) truncates property
// names at U+0000 (measured live on Illustrator 30.6.0: o['a\u0000b']=1
// stores 'a'), so a raw-NUL text would collide with its NUL-free prefix -
// e.g. the invalid corpus case '{"a":1}\u0000,1' would write its error
// entry under the truncated key '{"a":1}' and poison every later parse of
// the VALID text. NUL-bearing texts are never memoized (read or write):
// the memo must never answer for a different text.
var memoKeys: string[] = [];
var memoVals: any = {};

function memoEligible(text: string): boolean {
  if (text === '__proto__') return false;
  return text.indexOf('\0') < 0;
}

function memoSet(text: string, value: any, isError: boolean): void {
  if (!memoEligible(text)) return;
  if (!Object.prototype.hasOwnProperty.call(memoVals, text)) {
    memoKeys[memoKeys.length] = text;
    if (memoKeys.length > 8) {
      delete memoVals[memoKeys[0]];
      memoKeys.shift();
    }
  }
  memoVals[text] = { err: isError, value: value };
}

export function parseJson(text: any, reviver?: any, json2?: Json2Api | null, gate?: ((s: string) => number | undefined) | null): any {
  var raw = String(text);
  var noReviver = typeof reviver !== 'function';
  if (noReviver && memoEligible(raw) && Object.prototype.hasOwnProperty.call(memoVals, raw)) {
    var hit: any = memoVals[raw];
    if (hit.err) throw hit.value;
    return hit.value;
  }
  var ok = true;
  var value: any;
  try {
    var accepted = false;
    if (gate) {
      // ExternalObject-accelerated path (opt-in, full build only): the
      // native validator is the gate. It only ever runs after enable-time
      // verdict-parity certification (see native-lane.ts); the eval below
      // remains the grammar checker and the SyntaxError catch stays. A
      // gate verdict of undefined (call unavailable) falls back to the
      // certified pre-scan.
      var gv = gate(raw);
      if (gv === 0) accepted = true;
      else if (gv === undefined) accepted = strictnessPreScan(raw);
    } else {
      // Fast path: the pre-scan proves eval-ability (identifiers limited to
      // true/false/null, no JS-only escapes, allowed charset, dots only
      // after digits, number boundaries, comma rules, depth) - the eval is
      // the native grammar checker. The eval throws SyntaxError on anything
      // the checks missed (e.g. a malformed literal). The pre-scan is
      // certified verdict-clean (zero false-rejects: the strict protect
      // only fails on RFC-invalid strings and every other rule is
      // RFC-exact - certified by the fuzz accept-parity and the
      // JSONTestSuite must-accept corpus, 95/95 on the fast path). A
      // pre-scan failure IS a rejection; the 8-op regex gate is no longer
      // re-run on the reject lane (measured ~1.1-1.3us/byte saved there).
      accepted = strictnessPreScan(raw);
    }
    if (accepted) {
      value = evalSourceImpl(sanitizeJsonText(raw));
    } else {
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
