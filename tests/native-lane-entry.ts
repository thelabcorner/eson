// Native-gate lane tests (Node/V8). The ExternalObject glue is never touched:
// the enable flow is exercised through the provideLib test hook with fake
// libs, and the pure certification logic is tested with injected gates.
// Bundled to ESM by tests/native-lane.mjs.
declare var ESON_TEST_JSON2_SRC: any;

import { loadJson2 } from '../src/json2';
import { parseJson } from '../src/parse';
import {
  certifyGate,
  buildGateFromLib,
  enableNativeGateState,
  disableNativeGateState,
  nativeGate,
  nativeGateSnapshot
} from '../src/native-lane';

var json2Src: string = (typeof ESON_TEST_JSON2_SRC !== 'undefined') ? String(ESON_TEST_JSON2_SRC) : '';
if (!json2Src) {
  throw new Error('native-lane-test: ESON_TEST_JSON2_SRC global not provided by harness');
}
var json2 = loadJson2(json2Src);

var failures: string[] = [];
var passes = 0;

function ok(cond: boolean, name: string, detail?: string): void {
  if (cond) {
    passes++;
  } else {
    failures[failures.length] = name + (detail ? ' :: ' + detail : '');
  }
}

function throws(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return true;
  }
}

// JSX authority: parse throws iff the text is rejected.
function jsxAccepts(text: string): boolean {
  return !throws(function (): void { parseJson(text); });
}

// A gate that mirrors the JSX verdict (the fake lib's validateText).
function jsxGate(text: string): number {
  return jsxAccepts(text) ? 0 : 1;
}

// ---------------------------------------------------------------- certifyGate
(function (): void {
  var v = ['{}', '{"a":1}', '[1,2]'];
  var inv = ['[01]', '{"a":1,}', 'undefined'];

  var r1 = certifyGate(jsxGate, jsxAccepts, v, inv);
  ok(r1.ok === true && r1.checked === 6, 'certify.exact.parity', JSON.stringify(r1));

  // a gate that false-accepts one invalid case must fail and name it
  var looseGate = function (t: string): number {
    return t === '[01]' ? 0 : jsxGate(t);
  };
  var r2 = certifyGate(looseGate, jsxAccepts, v, inv);
  ok(r2.ok === false && r2.mismatches.length === 1, 'certify.falseAccept.caught',
    JSON.stringify(r2.mismatches));
  ok(r2.mismatches[0].indexOf('invalid[0]') === 0, 'certify.falseAccept.named',
    r2.mismatches[0]);

  // a gate that false-rejects a valid case must fail too
  var strictGate = function (t: string): number {
    return t === '{}' ? 1 : jsxGate(t);
  };
  var r3 = certifyGate(strictGate, jsxAccepts, v, inv);
  ok(r3.ok === false && r3.mismatches.length === 1, 'certify.falseReject.caught',
    JSON.stringify(r3.mismatches));

  // -999 (arg-not-string) is a gate failure, not a rejection
  var r4 = certifyGate(function (): number { return -999; }, jsxAccepts, v, inv);
  ok(r4.ok === false, 'certify.argTagFailure', JSON.stringify(r4.mismatches));

  // undefined = deferred to the pre-scan: counted, not a mismatch. A gate
  // that adjudicates NOTHING must fail enable (checked === 0).
  var deferAll = function (): number | undefined { return undefined; };
  var r6 = certifyGate(deferAll, jsxAccepts, v, inv);
  ok(r6.ok === false && r6.checked === 0 && r6.deferred === 6, 'certify.deferAll.fails', JSON.stringify(r6));

  // a gate that defers SOME cases and adjudicates the rest correctly passes
  var deferNul = function (t: string): number | undefined {
    return t.indexOf('\u0000') >= 0 ? undefined : jsxGate(t);
  };
  var r7 = certifyGate(deferNul, jsxAccepts, v.concat(['123\u0000']), inv);
  ok(r7.ok === true && r7.deferred === 1 && r7.checked === 6, 'certify.deferSome.passes', JSON.stringify(r7));
})();

// ------------------------------------------------------- buildGateFromLib
(function (): void {
  var calls = 0;
  var lib: any = {
    validateText: function (s: any): any { calls++; return jsxGate(String(s)); }
  };
  var g = buildGateFromLib(lib);
  ok(g('{"a":1}') === 0, 'buildGate.valid');
  ok(g('[01]') === 1, 'buildGate.invalid');

  // channel-safety guard: raw NUL and surrogate code units never reach the
  // DLL - the gate defers them (undefined) so the pre-scan adjudicates
  var callsAfter = calls;
  ok(g('123\u0000') === undefined && calls === callsAfter, 'buildGate.guardNul');
  ok(g('["a\u0000b"]') === undefined && calls === callsAfter, 'buildGate.guardNulInString');
  ok(g('["' + String.fromCharCode(0xDBFF, 0xDFFF) + '"]') === undefined && calls === callsAfter, 'buildGate.guardAstral');
  ok(g('{"a":1}\u0000,(probe=42)') === undefined && calls === callsAfter, 'buildGate.guardNulExploit');
  // escape-text NUL (six ASCII chars) is NOT a raw NUL - it must reach the DLL
  ok(g('"\\u0000"') === 0, 'buildGate.escapeTextNul');

  // catchable failure -> undefined (parse falls back to the pre-scan)
  var brokenLib: any = {
    validateText: function (): void { throw new Error('boom'); }
  };
  var g2 = buildGateFromLib(brokenLib);
  ok(g2('{}') === undefined, 'buildGate.catchableFailure');
})();

// ------------------------------------------------- parseJson with a gate
(function (): void {
  var counter = 0;
  var gate = function (t: string): number {
    counter++;
    return jsxGate(t);
  };

  var v1 = parseJson('{"a":1}', undefined, json2, gate);
  ok(v1 !== null && typeof v1 === 'object' && v1.a === 1, 'gateParse.valid', String(counter));
  ok(throws(function (): void { parseJson('[01]', undefined, json2, gate); }), 'gateParse.invalid');
  ok(throws(function (): void { parseJson('{"a":1,}', undefined, json2, gate); }), 'gateParse.trailingComma');

  // memo: repeated identical text hits the memo - the gate runs once.
  // (fresh text: earlier assertions primed the memo for '{"a":1}')
  counter = 0;
  parseJson('{"a":7}', undefined, json2, gate);
  parseJson('{"a":7}', undefined, json2, gate);
  ok(counter === 1, 'gateParse.memoHit', String(counter));

  // reviver bypasses the memo: gate runs every time
  counter = 0;
  parseJson('{"a":8}', function (k: string, val: any): any { return val; }, json2, gate);
  parseJson('{"a":8}', function (k: string, val: any): any { return val; }, json2, gate);
  ok(counter === 2, 'gateParse.reviverBypassesMemo', String(counter));

  // gate undefined (call unavailable) -> certified pre-scan fallback
  var g2 = function (t: string): number | undefined {
    return t === '{"a":9}' ? 0 : undefined;
  };
  ok(parseJson('{"a":9}', undefined, json2, g2).a === 9, 'gateParse.fallback.valid');
  ok(throws(function (): void { parseJson('[01]', undefined, json2, g2); }), 'gateParse.fallback.invalid');

  // a false-accepting gate still cannot smuggle non-JSON through the eval
  // (eval is the grammar checker; malformed text throws SyntaxError)
  var looseGate = function (): number { return 0; };
  ok(throws(function (): void { parseJson('[01]', undefined, json2, looseGate); }), 'gateParse.evalCatchesFalseAccept');
  ok(throws(function (): void { parseJson('{"x":(sideEffect=1)}', undefined, json2, looseGate); }), 'gateParse.evalCatchesExecutable');

  // a rejecting gate rejects valid text (availability, expected)
  var rejectAll = function (): number { return 1; };
  ok(throws(function (): void { parseJson('{"a":10}', undefined, json2, rejectAll); }), 'gateParse.rejectAll');
})();

// ------------------------------------------- enableNativeGateState (fake lib)
(function (): void {
  var makeFakeLib = function (): any {
    return {
      version: function (): number { return 2; },
      ping: function (): number { return 42; },
      validateText: function (s: any): number { return jsxGate(String(s)); },
      unload: function (): void {}
    };
  };

  var caps = enableNativeGateState({ provideLib: makeFakeLib });
  ok(caps.enabled === true && caps.certified > 0, 'enable.fakeLib.enabled', JSON.stringify(caps));
  ok(caps.dllVersion === 2, 'enable.fakeLib.version', String(caps.dllVersion));
  ok(nativeGateSnapshot().enabled === true, 'enable.snapshot.enabled');

  // the enabled gate drives parseJson end-to-end
  var g = nativeGate();
  ok(g !== null && parseJson('{"b":[1,2]}', undefined, json2, g as any).b.length === 2, 'enable.gate.drivesParse');

  // disable resets
  disableNativeGateState();
  ok(nativeGateSnapshot().enabled === false, 'disable.resets');
  ok(nativeGate() === null, 'disable.gateNull');

  // smoke failure: wrong ping
  var badPing = function (): any {
    return { version: function (): number { return 2; }, ping: function (): number { return 0; } };
  };
  var c2 = enableNativeGateState({ provideLib: badPing });
  ok(c2.enabled === false && c2.reason.indexOf('smoke') >= 0, 'enable.badPing.rejected', c2.reason);

  // parity failure: fake lib always rejects -> valid corpus mismatches
  var rejectLib = function (): any {
    return {
      version: function (): number { return 2; },
      ping: function (): number { return 42; },
      validateText: function (): number { return 1; }
    };
  };
  var c3 = enableNativeGateState({ provideLib: rejectLib });
  ok(c3.enabled === false && c3.reason.indexOf('verdict parity') >= 0, 'enable.parity.rejected', c3.reason);

  // broken lib (throws on every call) -> rejected
  var throwLib = function (): any {
    return {
      version: function (): number { throw new Error('x'); },
      ping: function (): number { return 42; },
      validateText: function (): void { throw new Error('x'); }
    };
  };
  var c4 = enableNativeGateState({ provideLib: throwLib });
  ok(c4.enabled === false, 'enable.throwingLib.rejected', c4.reason);

  // provideLib throwing -> load failure path
  var c5 = enableNativeGateState({ provideLib: function (): any { throw new Error('no dll'); } });
  ok(c5.enabled === false, 'enable.loadFailure.rejected', c5.reason);

  // external lib injection (the espack path: options.lib is the instance)
  var c6 = enableNativeGateState({ lib: makeFakeLib(), dllPath: 'C:/x/ESONJson_v1.dll' });
  ok(c6.enabled === true && c6.certified > 0, 'enable.externalLib.enabled', JSON.stringify(c6));
  ok(c6.dll === 'C:/x/ESONJson_v1.dll', 'enable.externalLib.dllPath', String(c6.dll));
  disableNativeGateState();
})();

// ------------------------------------------------------------------- report
if (failures.length > 0) {
  console.error('NATIVE-LANE TESTS FAILED: ' + failures.length + ' of ' + (passes + failures.length));
  var i: number;
  for (i = 0; i < failures.length; i++) console.error('  FAIL ' + failures[i]);
  (Function('return this')() as any).process.exitCode = 1;
}
console.log('NATIVE-LANE TESTS PASSED: ' + passes + ' assertions');
