#!/usr/bin/env node
// ESON accelerator speed sweep v2 (temp harness - not part of the repo).
// Gate ON vs OFF at multiple payload sizes; wall-clock batches of cold parses
// (distinct payloads per round defeat the verdict memo).
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

var ROOT = dirname(fileURLToPath(import.meta.url));
var OUT = process.env.ESON_OPT_OUT || join(tmpdir(), 'eson-opt');
mkdirSync(OUT, { recursive: true });
var SCRIPTS = process.env.ESPAK_DEV_SCRIPTS || 'C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts';
var TOOL = process.env.ILLUSTRATOR_COM_TOOL || SCRIPTS + '/agent-skills/illustrator-com-automation-skill/comtool/ILLUSTRATOR_COM_TOOL.py';
var ACCEL = join(ROOT, '..', 'dist', 'ESON.accel.jsx');

if (!existsSync(ACCEL)) { console.error('build first: ' + ACCEL + ' missing'); process.exit(1); }

var SIZES = [49152, 524288, 1048576, 2097152];

var probe = [
  '#target illustrator',
  '(function () {',
  '  $.evalFile(File("' + ACCEL.replace(/\\/g, '/') + '"));',
  '  var E = $.global.ESON;',
  '  var out = { ok: false, error: null, sizes: [] };',
  '  if (!E || !E.espack || !E.espack.ok) { out.error = "gate not enabled"; return out; }',
  '  // build a JSON payload of approximately `size` chars (array of numbers)',
  '  function payload(target, seed) {',
  '    var head = "{\\"id\\":12345,\\"name\\":\\"p" + seed + "\\",\\"nums\\":[";',
  '    var tail = "0],\\"ok\\":true,\\"s\\":\\"x\\\\u00e9y\\"}";',
  '    var s = head, i = 0;',
  '    var lim = target - head.length - tail.length;',
  '    var step = 64;',
  '    while (s.length < lim) {',
  '      var part = "", j;',
  '      for (j = 0; j < step; j++) { part += (i + j) + ","; }',
  '      i += step;',
  '      s += part;',
  '    }',
  '    return s + tail;',
  '  }',
  '  function med(a) { var b = a.slice(0).sort(function (x, y) { return x - y; }); return b[Math.floor(b.length / 2)]; }',
  '  var SIZES = [' + SIZES.join(',') + '];',
  '  var si, r;',
  '  for (si = 0; si < SIZES.length; si++) {',
  '    var target = SIZES[si];',
  '    // warm: build both payloads once so build cost is not in the timing',
  '    var pOn = payload(target, 1);',
  '    var pOff = payload(target, 2);',
  '    E.parse(pOn);',
  '    E.disableNativeGate(); E.parse(pOff); E.useEspack();',
  '    var onMs = [], offMs = [], k;',
  '    for (k = 0; k < 3; k++) {',
  '      var t1 = new Date().getTime(); E.parse(pOn); var t2 = new Date().getTime(); onMs.push(t2 - t1);',
  '      E.disableNativeGate();',
  '      var t3 = new Date().getTime(); E.parse(pOff); var t4 = new Date().getTime(); offMs.push(t4 - t3);',
  '      E.useEspack();',
  '    }',
  '    var onMed = med(onMs), offMed = med(offMs);',
  '    out.sizes.push({ chars: pOn.length, onMs: onMs, offMs: offMs, onMed: onMed, offMed: offMed });',
  '  }',
  '  out.ok = true;',
  '  return out;',
  '}());'
].join('\n');

var probePath = join(OUT, 'eson-speed-sweep.jsx').replace(/\\/g, '/');
writeFileSync(probePath, probe);

var pyOut;
try {
  pyOut = execFileSync('python', [TOOL, 'eval', '--file', probePath], { encoding: 'utf8', timeout: 600000 });
} catch (e) {
  console.error('COM tool failed: ' + String((e.stdout || e.message) + '').slice(0, 1500));
  process.exit(2);
}
var env = JSON.parse(pyOut.trim());
if (!env.ok || !env.result || env.result.ok !== true) {
  console.error('probe error: ' + JSON.stringify(env).slice(0, 2000));
  process.exit(2);
}
console.log('chars     gate ON med  gate OFF med  speedup');
env.result.sizes.forEach(function (s) {
  var sp = s.offMed / s.onMed;
  console.log(String(s.chars).padStart(8) + '  ' + String(s.onMed).padStart(7) + ' ms   ' + String(s.offMed).padStart(7) + ' ms   ' + sp.toFixed(2) + 'x');
});
console.log('done');
