// Node-side benchmark (V8): lanes measured with the oracle kernel standing in
// for the SpiderMonkey source kernels. ExtendScript-absolute numbers come from
// probes/eson-benchmark.jsx; this harness validates the pipeline and gives a
// portable lower-bound comparison (V8 is faster than the ExtendScript VM).
declare var ESON_TEST_JSON2_SRC: any;

import { loadJson2 } from '../src/json2';
import { parseJson, evalSource } from '../src/parse';
import { stringifyJson } from '../src/stringify';
import { stringifyFastJson } from '../src/fast';
import { encodeSourceTrusted, decodeSourceTrusted } from '../src/trusted';
import { makeOracleKernel, oracleSource } from './oracle';
import { globalObject } from '../src/caps';

var g: any = globalObject();
var json2Src: string = (typeof ESON_TEST_JSON2_SRC !== 'undefined') ? String(ESON_TEST_JSON2_SRC) : '';
var json2 = loadJson2(json2Src);
var oracle = makeOracleKernel();

function settingsPayload(): any {
  return {
    styleIndex: 0, bendPct: 35, hDistortPct: 0, vDistortPct: 0,
    showAdvanced: false, verticalAxis: false, preserveWidth: true,
    preserveHeight: false, anchorIndex: 0, hideOriginal: false,
    deleteOriginal: false, replaceOriginal: false, previewOpacity: 55,
    dielineSpotNames: ['CutContour', 'CutContour2', 'dieline'],
    svgWarpPath: '', svgBoundsPath: ''
  };
}

function profilesPayload(n: number): any[] {
  var out: any[] = [];
  var i: number;
  for (i = 0; i < n; i++) {
    out[out.length] = {
      name: 'CutContour ' + (i + 1) + 'mm',
      params: {
        styleIndex: 1, bendPct: 20 + (i % 40), hDistortPct: 0, vDistortPct: 0,
        showAdvanced: false, verticalAxis: false, preserveWidth: true,
        preserveHeight: false, anchorIndex: 0, hideOriginal: false,
        deleteOriginal: false, replaceOriginal: false, previewOpacity: 55
      }
    };
  }
  return out;
}

function numericArray(n: number): number[] {
  var a: number[] = [];
  var i: number;
  for (i = 0; i < n; i++) a[a.length] = i * 0.5;
  return a;
}

function stringHeavy(size: number): string {
  var chunk = '{"k":"The quick brown fox 0123456789 \\n é 日本語","n":1.5},';
  var s = '';
  while (s.length < size) s += chunk;
  return '[' + s.substring(0, s.length - 1) + ']';
}

function keyHeavy(n: number): any {
  var o: any = {};
  var i: number;
  for (i = 0; i < n; i++) o['field_' + i] = i;
  return o;
}

function deepObject(depth: number): any {
  var o: any = { leaf: 1 };
  var i: number;
  for (i = 0; i < depth; i++) o = { next: o };
  return o;
}

interface Payload {
  name: string;
  value: any;
  text: string;
}

var payloads: Payload[] = [];
var settings = settingsPayload();
payloads[payloads.length] = { name: 'settings', value: settings, text: json2.stringify(settings) as string };
payloads[payloads.length] = { name: 'profiles6', value: profilesPayload(6), text: json2.stringify(profilesPayload(6)) as string };
payloads[payloads.length] = { name: 'profiles150', value: profilesPayload(150), text: json2.stringify(profilesPayload(150)) as string };
payloads[payloads.length] = { name: 'nums10k', value: numericArray(10000), text: json2.stringify(numericArray(10000)) as string };
payloads[payloads.length] = { name: 'deep200', value: deepObject(200), text: json2.stringify(deepObject(200)) as string };
payloads[payloads.length] = { name: 'keys5000', value: keyHeavy(5000), text: json2.stringify(keyHeavy(5000)) as string };
payloads[payloads.length] = { name: 'string256k', value: stringHeavy(262144), text: stringHeavy(262144) };

function nowUs(): number {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now() * 1000
    : Date.now() * 1000;
}

function timeLane(fn: () => any, iterations: number, warmup: number): number[] {
  var i: number;
  for (i = 0; i < warmup; i++) fn();
  var samples: number[] = [];
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

function stats(samples: number[]): { median: number; min: number; p95: number } {
  var s = samples.slice(0);
  s.sort(function (a: number, b: number): number { return a - b; });
  return {
    median: s[Math.floor(s.length / 2)],
    min: s[0],
    p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]
  };
}

function pad(s: string, width: number): string {
  while (s.length < width) s += ' ';
  return s;
}

function report(lane: string, payload: string, samples: number[], bytes: number, json2Median: number): void {
  var st = stats(samples);
  var vs = json2Median > 0 && st.median > 0 ? (json2Median / st.median).toFixed(2) : 'n/a';
  console.log(
    pad(lane, 16) + pad(payload, 12) +
    'median=' + pad(st.median.toFixed(1), 10) + 'us' +
    '  min=' + pad(st.min.toFixed(1), 8) + 'us' +
    '  p95=' + pad(st.p95.toFixed(1), 9) + 'us' +
    '  vsJson2=' + vs + 'x' +
    '  bytes=' + bytes
  );
}

var WARM = 20;
var ITERS = 200;

console.log('ESON benchmark (Node/V8, oracle kernel for native lane)');
console.log(pad('lane', 16) + pad('payload', 12) + '   median       min       p95   vsJson2     bytes');

var p: number;
for (p = 0; p < payloads.length; p++) {
  var pl = payloads[p];
  var bytes = pl.text.length;

  var j2s = timeLane(function (): any { return json2.stringify(pl.value); }, ITERS, WARM);
  var j2m = stats(j2s).median;
  var j2p = timeLane(function (): any { return json2.parse(pl.text); }, ITERS, WARM);
  var j2pm = stats(j2p).median;

  var esonS = timeLane(function (): any { return stringifyJson(pl.value, undefined, undefined, oracle, json2); }, ITERS, WARM);
  report('eson.native', pl.name, esonS, bytes, j2m);
  var esonF = timeLane(function (): any { return stringifyFastJson(pl.value, { onUnsupported: 'fallback' }, oracle, json2); }, ITERS, WARM);
  report('eson.fast', pl.name, esonF, bytes, j2m);

  var esonP = timeLane(function (): any { return parseJson(pl.text); }, ITERS, WARM);
  report('eson.parse', pl.name, esonP, bytes, j2pm);
  var rawEval = timeLane(function (): any { return evalSource('(' + pl.text + ')'); }, ITERS, WARM);
  report('raw.eval', pl.name, rawEval, bytes, j2pm);

  var trusted = timeLane(function (): any {
    var s = encodeSourceTrusted(pl.value, oracle);
    decodeSourceTrusted(s);
  }, ITERS, WARM);
  report('eson.trusted', pl.name, trusted, bytes, j2m);
}

console.log('payload sizes: ' + payloads.map(function (x: Payload): string { return x.name + '=' + x.text.length + 'B'; }).join(' '));
