// ExternalObject-accelerated parse gate (opt-in, full build only).
//
// ESON ships TWO paths:
//
//   1. JSX-only (default, every build): parseJson's certified pre-scan
//      (JSONTestSuite 95/95 + 188/188 + differential fuzz) + sanitize +
//      eval. Works in every ExtendScript host, zero dependencies.
//
//   2. Native gate (this module, full build only, ESON.enableNativeGate):
//      the ESONJson.dll's validateText replaces the pre-scan; sanitize +
//      eval stay. Measured live on Illustrator 30.6.0 (canonical-ABI DLL,
//      version 2): cold parse ~14-17x faster at 345 B - 43 KB (native
//      validateText ~146 us at 43 KB vs pre-scan ~44 ms).
//
// Security model: the native gate NEVER loosens the gate. Enable requires a
// verdict-parity self-certification on a bundled corpus: the native verdict
// must match the JSX verdict exactly (valid accepts, invalid rejects). eval
// remains the grammar checker, stays wrapped in the SyntaxError catch, and
// still only ever sees sanitized text. Residual risks (documented, not
// eliminated): the certification covers the bundled corpus, not the full
// JSONTestSuite (the per-DLL-build full-corpus run lives in
// probes/eson-corpus-parity.jsx), and ExternalObject host errors that
// bypass JavaScript try/catch are possible but were not observed with the
// canonical-ABI build (14/14 methods bound in the live session).
import { parseJson } from './parse';
import { EsonNativeCaps } from './types';

// GateFn: native verdict for a JSON text. 0 = valid, nonzero = invalid,
// -999 = argument did not arrive as a string (ABI evidence), undefined =
// call unavailable (fall back to the JSX pre-scan).
export type GateFn = (text: string) => number | undefined;

export interface NativeGateOptions {
  dir?: string; // DLL directory; prepended to ExternalObject.searchFolders
  libName?: string; // default 'ESONJson'
  validCases?: string[]; // parity corpus overrides (probes, tests)
  invalidCases?: string[];
  lib?: any; // externally loaded ExternalObject instance (e.g. via ESPAK /
             // espack load()); skips internal loading, keeps smoke +
             // certification
  dllPath?: string; // informational: where lib came from (reported in dll)
  provideLib?: () => any; // TEST HOOK ONLY: injects a fake lib in Node tests
}

export interface ParityResult {
  ok: boolean;
  checked: number; // cases the gate actually adjudicated (deferred excluded)
  deferred: number; // cases the gate fell back to the JSX pre-scan
  mismatches: string[]; // "case -> native=X jsx=Y" entries
}

// Bundled parity corpus. Exact-verdict parity with the JSX gate is required
// at enable on every case the gate ADJUDICATES; cases the gate defers (see
// rx_forbidden below) are excluded by design. Raw tab is fully covered:
// tab-as-whitespace is VALID JSON and is accepted by both paths, while a raw
// tab inside a string literal is RFC-invalid and is rejected by BOTH paths
// (the JSX strict protect's string class is \x00-\x1f, so a raw tab leaves
// residue that the allowed-charset rejects; the native validator rejects it
// in validate_string16) - verified live on Illustrator 30.6.0, no
// divergence.
var VALID_CASES: string[] = [
  '{}',
  '[]',
  '{"a":1}',
  '{"a":[1,true,null,"x",1.5e3,-0]}',
  '[0,-1,2.5,1e10,1E-2]',
  '"str"',
  'true',
  'false',
  'null',
  '42',
  '   {"b": {"c": []}}',
  '"\\u0041\\n\\t\\"\\\\\\/"',
  '[123456789012345678901234567890]',
  '{"s":"\u2028\u2029"}',
  '{"key with spaces":"value, with [brackets]"}',
  '[-0,-0.5,-1e-3]',
  // tab-as-whitespace: valid JSON whitespace, accepted by both paths
  '[\t1]',
  '{"a":1}\t',
  '\t{"a":1}',
  // astral char inside a string: VALID JSON, but the ExternalObject string
  // channel cannot transport surrogate pairs (they are dropped at the
  // boundary, measured live) - the gate defers this class to the pre-scan,
  // which accepts it correctly.
  '["\uDBFF\uDFFF"]'
];

var INVALID_CASES: string[] = [
  '01', '-01', '00', '-00', '1.', '.1', '1e', '1e+', '1.2.3',
  '[1,]', '[1,,2]', '[,1]', '{"a":1,}', '{,}', '{"a":1,,}',
  '{a:1}', "{'a':1}", '{"a" 1}', '{"a":}', '[1 2]', '[3[4]]',
  'undefined', 'NaN', 'Infinity', '0x1', '+1', '-', '--1',
  '/*x*/1', '({a:1})', '{"x":(sideEffect=1)}', '{"x":1} extra', 'extra {"x":1}',
  '"bad\\x41"', '"bad\\u12g4"', '"bad\\v"', '"\\u12"', '"unterminated', 'nul',
  'nullx', 'tru', 'fals', '["raw\ncontrol"]', '"\\q"',
  // raw tab inside a string: RFC-invalid, rejected by BOTH paths (no
  // divergence - the JSX strict protect's string class is \x00-\x1f)
  '"\t"',
  '{"a":"\t"}',
  '\uFEFF{}', '{', '}', '[', ']', '', ' ', '[0x1]',
  // NUL payloads: raw U+0000 truncates the ExternalObject string channel
  // (the DLL sees only the prefix), so the gate defers them to the pre-scan,
  // which rejects raw control characters. Verified live: without the guard
  // the gate accepted '{"a":1}\u0000,1' and eval EXECUTED the post-NUL
  // expression - the security hole the guard closes.
  '123\u0000',
  '{"a":1}\u0000,1',
  // trailing scalar junk: valid-looking prefix + a second top-level value
  // ('{"a":1} 1') - rejected by the pre-scan (structural walk) and natively
  '{"a":1} 1',
  '[1] 2',
  '123 456'
];

// Channel-safety guard: text the ExternalObject string channel cannot
// transport faithfully is deferred to the certified JSX pre-scan.
//   - raw U+0000 truncates the string at the boundary (measured live)
//   - surrogate code units 0xD800-0xDFFF are dropped/mangled at the boundary
//     (astral chars in JSON strings are valid but cannot round-trip)
var rx_forbidden = /[\u0000\uD800-\uDFFF]/;

// Pure certification: native verdict must match the JSX authority exactly on
// every corpus case the gate ADJUDICATES. Gate verdicts of undefined mean
// "deferred to the pre-scan" (the parse then falls back to jsxAuthority, so
// the effective verdict IS the JSX verdict - no mismatch possible); those
// cases are counted separately. jsxAuthority(t) throws iff the JSX parse
// rejects t.
export function certifyGate(
  gate: GateFn,
  jsxAuthority: (text: string) => boolean,
  validCases: string[],
  invalidCases: string[]
): ParityResult {
  var mismatches: string[] = [];
  var checked = 0;
  var deferred = 0;
  var i: number;
  var t: string;
  var gv: number | undefined;
  var jv: boolean;

  for (i = 0; i < validCases.length; i++) {
    t = validCases[i];
    gv = gate(t);
    jv = jsxAuthority(t);
    if (gv === undefined) { deferred++; continue; }
    checked++;
    if (gv !== 0 || !jv) {
      mismatches[mismatches.length] = 'valid[' + i + '] "' + truncate(t) + '" -> native=' + String(gv) + ' jsx=' + String(jv);
    }
  }
  for (i = 0; i < invalidCases.length; i++) {
    t = invalidCases[i];
    gv = gate(t);
    jv = jsxAuthority(t);
    if (gv === undefined) { deferred++; continue; }
    checked++;
    // reject = nonzero (never 0); -999 (arg-not-string) is a gate failure,
    // not a rejection
    if (gv === 0 || gv === -999 || jv) {
      mismatches[mismatches.length] = 'invalid[' + i + '] "' + truncate(t) + '" -> native=' + String(gv) + ' jsx=' + String(jv);
    }
  }
  // A gate that adjudicates NOTHING is not a gate - enable must fail on
  // checked === 0 (every case deferred or an empty corpus).
  return {
    ok: mismatches.length === 0 && checked > 0,
    checked: checked,
    deferred: deferred,
    mismatches: mismatches
  };
}

function truncate(s: string): string {
  var MAX = 40;
  if (s.length <= MAX) return s;
  return s.substring(0, MAX) + '...';
}

// Build the gate closure from a loaded ExternalObject instance. The
// channel-safety guard runs FIRST: raw NUL and surrogate code units cannot
// cross the string boundary faithfully (measured live - NUL truncates and
// can smuggle an executable post-NUL expression past the native verdict;
// astral pairs are dropped), so such texts return undefined and the parse
// falls back to the certified pre-scan.
export function buildGateFromLib(lib: any): GateFn {
  return function (text: string): number | undefined {
    try {
      if (rx_forbidden.test(text)) return undefined;
      return Number(lib.validateText(text));
    } catch (e) {
      return undefined; // catchable failure: caller falls back to pre-scan
    }
  };
}

// ---- host glue (ExternalObject; never touched in Node tests) --------------

var state: {
  present: boolean;
  active: boolean;
  reason: string;
  lib: any;
  gate: GateFn | null;
  dll: string;
  dllVersion: number;
  certified: number;
} = {
  present: false,
  active: false,
  reason: '',
  lib: null,
  gate: null,
  dll: '',
  dllVersion: 0,
  certified: 0
};

// Injectable for Node tests: options.provideLib overrides the ExternalObject
// loader so the enable flow can be exercised with a fake lib (it also
// implies the host API is present - the check is skipped). options.lib is
// the production external-injection path: an already-loaded lib (e.g. the
// espack ESPAK.load() result); smoke + certification still run on it.
export function enableNativeGateState(options?: NativeGateOptions): EsonNativeCaps {
  disableNativeGateState();
  var opts = options || {};
  var present = false;
  if (!opts.provideLib && !opts.lib) {
    try {
      present = typeof ExternalObject !== 'undefined' && ExternalObject !== null;
    } catch (e) {
      present = false;
    }
  } else {
    present = true;
  }
  state.present = present;
  if (!present) {
    state.reason = 'ExternalObject not available in this engine';
    return snapshot();
  }
  var lib: any = null;
  if (opts.lib) {
    lib = opts.lib;
    state.dll = opts.dllPath || 'external';
  } else if (opts.provideLib) {
    try {
      lib = opts.provideLib();
    } catch (e) {
      lib = null;
    }
  } else {
    try {
      var dir = opts.dir || '';
      if (dir.length > 0) {
        ExternalObject.searchFolders = dir + ';' + (ExternalObject.searchFolders || '');
      }
      var libName = opts.libName || 'ESONJson';
      lib = new ExternalObject('lib:' + libName);
      state.dll = libName;
    } catch (e) {
      lib = null;
      state.dll = opts.libName || 'ESONJson';
    }
  }
  if (!lib) {
    state.reason = 'ESONJson DLL failed to load (is it built? native/build/ESONJson.dll)';
    return snapshot();
  }
  state.lib = lib;

  // smoke: the methods this gate actually uses must bind and answer
  var ver = -1;
  var ping = -1;
  try {
    ver = Number(lib.version(0));
    ping = Number(lib.ping(0));
  } catch (e) {
    state.reason = 'smoke failed: ' + String(e);
    return teardown();
  }
  if (ping !== 42) {
    state.reason = 'smoke failed: ping returned ' + String(ping) + ' (wrong DLL?)';
    return teardown();
  }
  state.dllVersion = ver;

  var gate = buildGateFromLib(lib);
  var validCases = opts.validCases || VALID_CASES;
  var invalidCases = opts.invalidCases || INVALID_CASES;
  var parity = certifyGate(gate, jsxAuthority, validCases, invalidCases);
  if (!parity.ok) {
    state.reason = 'verdict parity failed (' + String(parity.mismatches.length) + ' of ' + String(parity.checked) + '): ' + parity.mismatches[0];
    return teardown();
  }
  state.gate = gate;
  state.active = true;
  state.certified = parity.checked;
  state.reason = '';
  return snapshot();
}

function jsxAuthority(text: string): boolean {
  try {
    parseJson(text);
    return true;
  } catch (e) {
    return false;
  }
}

function teardown(): EsonNativeCaps {
  try {
    if (state.lib && typeof state.lib.unload === 'function') state.lib.unload();
  } catch (e) {
    // unload failure is not worth reporting over the enable failure
  }
  state.lib = null;
  state.gate = null;
  return snapshot();
}

export function disableNativeGateState(): void {
  if (state.lib) {
    try {
      state.lib.unload();
    } catch (e) {
      // a loaded DLL stays locked until the session ends regardless
    }
  }
  state.lib = null;
  state.gate = null;
  state.active = false;
  state.reason = '';
  state.dll = '';
  state.dllVersion = 0;
  state.certified = 0;
}

export function nativeGate(): GateFn | null {
  return state.gate;
}

export function nativeGateSnapshot(): EsonNativeCaps {
  return snapshot();
}

function snapshot(): EsonNativeCaps {
  // Lazy presence probe: before the first enable, report whether this
  // engine has ExternalObject at all (never touches it otherwise).
  var present = state.present;
  if (!present) {
    try {
      present = typeof ExternalObject !== 'undefined' && ExternalObject !== null;
    } catch (e) {
      present = false;
    }
  }
  return {
    present: present,
    enabled: state.active,
    reason: state.reason,
    dll: state.dll,
    dllVersion: state.dllVersion,
    certified: state.certified
  };
}
