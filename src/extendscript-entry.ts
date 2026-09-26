// ExtendScript distribution entry.
//
// IMPORTANT: this module intentionally exports NOTHING. ESTC/esbuild bundles
// it as a side-effect IIFE and the ESTC prelude declares the outer `var ESON`.
// Keeping the entry export-free prevents esbuild from generating its
// __export/__toCommonJS descriptor helpers, which cannot execute in Adobe's
// ES3-era ExtendScript engine (no Object.defineProperty).
import {
  benchmark,
  capabilities,
  captureKernel,
  classifyJson,
  decodeCheckedSource,
  decodeSourceChecked,
  decodeSourceImpl,
  decodeSourceTrusted,
  disableNativeGate,
  enableNativeGate,
  encodeSource,
  encodeSourceImpl,
  evalSource,
  globalObject,
  install,
  loadJson2,
  loadJson2Api,
  parse,
  parseJson,
  parseTrusted,
  parseTrustedImpl,
  rewriteSource,
  stringify,
  stringifyFast,
  stringifyFastJson,
  stringifyJson
} from './index';

declare var ESON: any;

ESON = {
  benchmark: benchmark,
  capabilities: capabilities,
  captureKernel: captureKernel,
  classifyJson: classifyJson,
  decodeCheckedSource: decodeCheckedSource,
  decodeSourceChecked: decodeSourceChecked,
  decodeSourceImpl: decodeSourceImpl,
  decodeSourceTrusted: decodeSourceTrusted,
  disableNativeGate: disableNativeGate,
  enableNativeGate: enableNativeGate,
  encodeSource: encodeSource,
  encodeSourceImpl: encodeSourceImpl,
  evalSource: evalSource,
  globalObject: globalObject,
  install: install,
  loadJson2: loadJson2,
  loadJson2Api: loadJson2Api,
  parse: parse,
  parseJson: parseJson,
  parseTrusted: parseTrusted,
  parseTrustedImpl: parseTrustedImpl,
  rewriteSource: rewriteSource,
  stringify: stringify,
  stringifyFast: stringifyFast,
  stringifyFastJson: stringifyFastJson,
  stringifyJson: stringifyJson
};

// A top-level `var ESON` is eval-scope-local when loaded through $.evalFile in
// current Illustrator. Publish explicitly to the persistent session global so
// plain and accelerated artifacts expose the same facade semantics.
var __esonGlobal = globalObject();
if (__esonGlobal) {
  __esonGlobal.ESON = ESON;
}