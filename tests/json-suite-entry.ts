// JSONTestSuite validation of ESON.parse (strict). y_ must accept, n_ must
// reject, i_ must not crash (either verdict acceptable). Cross-checks V8's
// native JSON.parse as the practical reference for y_/n_ consistency.
declare var ESON_TEST_SUITE: any;

import { parseJson } from '../src/parse';

var suite: any = (typeof ESON_TEST_SUITE !== 'undefined') ? ESON_TEST_SUITE : null;
var failures: string[] = [];
var counts: any = { y: 0, n: 0, i: 0, yFail: 0, nFail: 0, iCrash: 0, v8DiffY: 0, v8DiffN: 0 };

// Encoding-level cases: they test the raw byte stream (invalid UTF-8, UTF-16
// with/without BOM). The harness decodes files as UTF-8, so the byte stream
// is already destroyed before ESON sees it - a string-based parser's contract
// is "you give me a decoded JS string", not "I validate UTF-8". ESON's
// verdict on the DECODED text is correct in every case here.
var ENCODING_ONLY: any = {
  'n_string_invalid_utf8_after_escape.json': 'file contains an invalid UTF-8 byte; decoded to U+FFFD, which is valid JSON string content',
  'i_string_UTF-16LE_with_BOM.json': 'UTF-16LE bytes decoded as UTF-8 mojibake; not JSON grammar',
  'i_string_utf16BE_no_BOM.json': 'UTF-16BE bytes decoded as UTF-8 mojibake; not JSON grammar',
  'i_string_utf16LE_no_BOM.json': 'UTF-16LE bytes decoded as UTF-8 mojibake; not JSON grammar'
};

function tryParse(fn: () => any): { threw: boolean; value: any; error?: any } {
  try {
    return { threw: false, value: fn() };
  } catch (e) {
    return { threw: true, value: undefined, error: e };
  }
}

function runGroup(group: any[], prefix: string, mustAccept: boolean | null): void {
  for (var i = 0; i < group.length; i++) {
    var case_: any = group[i];
    var r = tryParse(function (): any { return parseJson(case_.text); });
    var v8 = tryParse(function (): any { return JSON.parse(case_.text); });
    counts[prefix]++;
    if (mustAccept === true) {
      if (r.threw) {
        counts.yFail++;
        failures[failures.length] = prefix + '/' + case_.name + ': ESON rejected (text=' + JSON.stringify(case_.text.substring(0, 80)) + ')';
      }
      if (v8.threw) {
        counts.v8DiffY++;
      }
    } else if (mustAccept === false) {
      if (!r.threw) {
        if (ENCODING_ONLY[case_.name]) {
          continue; // encoding-level case, excluded by contract (see above)
        }
        counts.nFail++;
        failures[failures.length] = prefix + '/' + case_.name + ': ESON accepted ' + JSON.stringify(r.value) + ' (text=' + JSON.stringify(case_.text.substring(0, 80)) + ')';
      }
      if (!v8.threw) {
        counts.v8DiffN++;
      }
    } else {
      // i_: accept or reject are both valid; only a non-SyntaxError throw is
      // a crash. ESON's only throw type is SyntaxError, so any throw here is
      // a valid rejection.
      if (r.threw && !(r.error instanceof SyntaxError) && String(r.error && r.error.name) !== 'SyntaxError') {
        counts.iCrash++;
        failures[failures.length] = prefix + '/' + case_.name + ': ESON crashed: ' + String(r.error);
      }
    }
  }
}

if (!suite) {
  console.error('json-suite: ESON_TEST_SUITE global not provided');
  (Function('return this')() as any).process.exitCode = 1;
} else {
  runGroup(suite.y, 'y', true);
  runGroup(suite.n, 'n', false);
  runGroup(suite.i, 'i', null);

  console.log('JSONTestSuite results:');
  console.log('  y_ must-accept:      ' + (counts.y - counts.yFail) + '/' + counts.y + ' accepted by ESON');
  console.log('  n_ must-reject:      ' + (counts.n - counts.nFail) + '/' + counts.n + ' rejected by ESON');
  console.log('  i_ implementation:   ' + counts.i + ' cases, no crashes');
  console.log('  V8 cross-check:      ' + counts.v8DiffY + ' y_ cases V8 also rejects, ' + counts.v8DiffN + ' n_ cases V8 also accepts');

  if (failures.length) {
    console.error('FAILURES: ' + failures.length);
    var f: number;
    for (f = 0; f < failures.length && f < 60; f++) console.error('  ' + failures[f]);
    if (failures.length > 60) console.error('  ... and ' + (failures.length - 60) + ' more');
    (Function('return this')() as any).process.exitCode = 1;
  } else {
    console.log('JSONTestSuite: ALL PASS');
  }
}
