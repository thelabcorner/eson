#target illustrator
// ESON example 03: config-driven batch over artboards (runtime build).
//
// Reads a strict-JSON job file, validates it, walks the listed artboards,
// reports name + size, and optionally draws a label on each (annotate).
// Demonstrates the golden execution pipeline:
//   preflight -> snapshot -> commit -> restore -> report.
// The script only READS the document unless the job sets annotate: true.
//
// Job file (default: examples/data/export-job.json):
//   { "job": "demo", "artboards": [0, 1], "annotate": false, "labelPrefix": "" }
// Overrides: ESON_DIST = path to eson/dist, ESON_JOB = path to a job file.
//
// How to run: open a document, then File > Scripts > Other Script..., or
//   python ILLUSTRATOR_COM_TOOL.py eval --file examples/03-config-job-batch.jsx
// Report: %TEMP%\esonexample-03-report.json + last-statement value.

// --- bootstrap (same loader as the other examples) -------------------------
var __esonDist = $.getenv('ESON_DIST');
if (!__esonDist) {
  __esonDist = File(decodeURI($.fileName)).parent.parent.fsName.replace(/\\/g, '/') + '/dist';
}
var __vendor = new File(__esonDist + '/vendor-eson-runtime.js');
if (!__vendor.exists) {
  $.writeln('ESON build not found at ' + __vendor.fsName + ' -- run "npm run build" in the eson repo first.');
  throw new Error('ESON build not found: ' + __vendor.fsName);
}
$.evalFile(__vendor);

var __scriptDir = File(decodeURI($.fileName)).parent.fsName.replace(/\\/g, '/');
var __jobPath = $.getenv('ESON_JOB') || (__scriptDir + '/data/export-job.json');

var out = { ok: false, checks: [], phase: 'preflight' };
function check(name, ok, detail) {
  out.checks.push({ name: name, ok: !!ok, detail: detail });
  if (!ok) out.ok = false;
}

// --- preflight: fail before any mutation -----------------------------------
var doc = app.activeDocument;
check('active-document', !!doc, doc ? '' : 'no open document -- open or create one first');

var cfg = null;
var parseError = null;
var cfgShapeOk = false;
if (doc) {
  var jobFile = new File(__jobPath);
  check('job-file-exists', jobFile.exists, __jobPath);
  if (jobFile.exists) {
    jobFile.encoding = 'UTF-8';
    var opened = jobFile.open('r');
    check('job-file-readable', opened, opened ? '' : 'could not open for read');
    if (opened) {
      try { cfg = JSON.parse(jobFile.read()); }
      catch (e) { parseError = String(e); }
      jobFile.close();
      check('job-parses-strict', !parseError, parseError || '');
    }
  }
  if (cfg) {
    cfgShapeOk = true;
    var shapeDetail = '';
    if (typeof cfg.job !== 'string' || cfg.job === '') {
      cfgShapeOk = false; shapeDetail = 'job must be a non-empty string';
    }
    if (cfgShapeOk && !(cfg.artboards instanceof Array) || cfg.artboards.length === 0) {
      cfgShapeOk = false; shapeDetail = 'artboards must be a non-empty array of indices';
    }
    if (cfgShapeOk) {
      var i;
      for (i = 0; i < cfg.artboards.length; i++) {
        var idx = cfg.artboards[i];
        if (typeof idx !== 'number' || idx !== idx || Math.floor(idx) !== idx || idx < 0 || idx >= doc.artboards.length) {
          cfgShapeOk = false;
          shapeDetail = 'artboards[' + i + '] = ' + idx + ' is not a valid artboard index';
        }
      }
    }
    check('job-shape', cfgShapeOk, shapeDetail);
  }
}

// --- run -------------------------------------------------------------------
if (doc && cfg && cfgShapeOk) {
  out.phase = 'run';

  // snapshot: state we may change, restored in the finally-equivalent below
  var savedArtboard = doc.artboards.getActiveArtboardIndex();
  var sel = doc.selection;
  var savedSelection = null;
  if (sel && sel.length) {
    savedSelection = [];
    var k;
    for (k = 0; k < sel.length; k++) savedSelection.push(sel[k]);
  }

  var artboardsInfo = [];
  var labelsDrawn = 0;
  var warnings = [];
  var i;
  for (i = 0; i < cfg.artboards.length; i++) {
    var idx = cfg.artboards[i];
    doc.artboards.setActiveArtboardIndex(idx);
    var ab = doc.artboards[idx];
    var rect = ab.artboardRect; // [left, top, right, bottom] in points
    artboardsInfo.push({
      index: idx,
      name: ab.name,
      width: Math.abs(rect[2] - rect[0]),
      height: Math.abs(rect[1] - rect[3])
    });
    if (cfg.annotate) {
      var layer = doc.activeLayer;
      if (layer.locked) {
        warnings.push('artboard ' + idx + ': active layer is locked -- label skipped');
        continue;
      }
      var frame = doc.textFrames.add();
      frame.contents = (typeof cfg.labelPrefix === 'string' ? cfg.labelPrefix : '') + ab.name;
      frame.position = [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2];
      labelsDrawn++;
    }
  }

  // restore: active artboard and selection
  doc.artboards.setActiveArtboardIndex(savedArtboard);
  if (savedSelection) { doc.selection = savedSelection; } else { doc.selection = null; }

  out.result = { job: cfg.job, artboards: artboardsInfo, labelsDrawn: labelsDrawn, warnings: warnings };
  out.ok = true;
  out.phase = 'done';
}

// --- report ---------------------------------------------------------------
var __report = JSON.stringify(out, null, 2);
$.writeln('ESON example 03: ' + (out.ok ? 'PASS' : 'FAIL'));
$.writeln(__report);
var __rf = new File($.getenv('TEMP') + '/esonexample-03-report.json');
__rf.encoding = 'UTF-8';
__rf.open('w');
__rf.write(__report);
__rf.close();
__report;
