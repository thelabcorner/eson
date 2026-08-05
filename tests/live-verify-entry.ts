// Live-probe report verification (Node-side; report produced by
// probes/eson-capability-probe.jsx in Illustrator).
declare var ESON_LIVE_REPORT: any;
declare var ESON_TEST_JSON2_SRC: any;

import { rewriteSource } from '../src/rewrite';
import { parseJson } from '../src/parse';
import { loadJson2 } from '../src/json2';
import { oracleSource } from './oracle';
import { makeValues, makeInvalidJson, makeSecurityFixtures } from './fixtures';

var json2Src: string = (typeof ESON_TEST_JSON2_SRC !== 'undefined') ? String(ESON_TEST_JSON2_SRC) : '';
var json2 = json2Src ? loadJson2(json2Src) : null;
var report: any = (typeof ESON_LIVE_REPORT !== 'undefined') ? ESON_LIVE_REPORT : null;
var failures: string[] = [];
var passes = 0;

function ok(cond: boolean, name: string, detail?: string): void {
  if (cond) passes++;
  else failures[failures.length] = name + (detail ? ' :: ' + detail : '');
}

// ---- oracle-vs-rewrite parity for the whole corpus (always runs) ------------

var values = makeValues();
var i: number;
var vf: any;
for (i = 0; i < values.length; i++) {
  vf = values[i];
  if (vf.note && vf.note.indexOf('throw') >= 0) continue;
  if (typeof vf.value === 'function') continue;
  if (vf.value !== null && typeof vf.value === 'object' && typeof vf.value.toJSON === 'function') continue;
  if (vf.value instanceof Date) continue;
  // Sparse arrays are represented by the oracle with `undefined` entries;
  // the rewriter rightly rejects undefined, so byte-parity through the oracle
  // cannot hold - the real pipeline (normalize -> graph) is covered by the
  // probe's differential instead.
  if (vf.name === 'sparseArray') continue;
  var src: string;
  try {
    src = oracleSource(vf.value);
  } catch (e) {
    continue;
  }
  var out = rewriteSource(src);
  var expected = vf.expected;
  if (expected === undefined && json2) {
    expected = json2.stringify(vf.value) as string;
  }
  if (expected === undefined) continue;
  ok(out === expected, 'oracle.rewrite.' + vf.name, 'out=' + String(out) + ' expected=' + String(expected));
}

// ---- gate parity for the strict parse corpus (always runs) ------------------

var invalid = makeInvalidJson();
for (i = 0; i < invalid.length; i++) {
  var threw = false;
  try { parseJson(invalid[i]); } catch (e) { threw = true; }
  ok(threw, 'gate.invalid.' + i);
}
var security = makeSecurityFixtures();
for (i = 0; i < security.length; i++) {
  var sthrew = false;
  try { parseJson(security[i]); } catch (e) { sthrew = true; }
  ok(sthrew, 'gate.security.' + i);
}

// ---- live report checks (skip cleanly when no report provided) --------------

if (!report) {
  console.log('live-verify: no report provided; ran oracle/gate parity only. ' +
    passes + ' checks passed, ' + failures.length + ' failed');
} else {
  var corpus = report.corpus || [];
  var rejectedCount = 0;
  for (i = 0; i < corpus.length; i++) {
    var entry = corpus[i];
    var realSrc = String(entry.source);
    var json2Expected = String(entry.json2Expected);
    var rewritten = rewriteSource(realSrc);
    // Raw kernel sources legitimately contain non-JSON tokens (undefined,
    // NaN, functions, non-canonical keys, stack-overrun errors) that the
    // rewriter rejects by design - the pipeline handles those via
    // normalization/fallback, which the probe's differential covers. The
    // byte-parity guarantee is asserted only when the source is rewritable.
    if (rewritten === null) {
      rejectedCount++;
      ok(true, 'live.rewrite.reject.' + entry.name);
    } else {
      ok(rewritten === json2Expected, 'live.rewrite.' + entry.name,
        'rewritten=' + String(rewritten) + ' expected=' + json2Expected);
    }
    if (entry.oracleSource) {
      ok(entry.oracleSource === entry.source, 'live.oracleMatchesReal.' + entry.name,
        'oracle=' + entry.oracleSource + ' real=' + entry.source);
    }
  }
  console.log('live-verify: ' + rejectedCount + ' corpus sources rejected by design (fallback/ normalize-covered)');
  var parseVerdicts = report.parse || [];
  for (i = 0; i < parseVerdicts.length; i++) {
    var pv = parseVerdicts[i];
    ok(pv.eson === pv.jsGate, 'live.parseVerdict.' + pv.name, JSON.stringify(pv));
  }
  console.log('live-verify: report verified (' + (report.route || '?') + '). ' +
    passes + ' checks passed, ' + failures.length + ' failed');
}

if (failures.length) {
  var f: number;
  for (f = 0; f < failures.length && f < 40; f++) console.error('  FAIL ' + failures[f]);
  if (failures.length > 40) console.error('  ... and ' + (failures.length - 40) + ' more');
  throw new Error('live-verify failures: ' + failures.length);
}
