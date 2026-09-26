// Slim ExtendScript distribution entry used by high-frequency COM eval.
//
// Like the full ExtendScript entry, this module intentionally exports nothing.
// The ESTC prelude declares `var ESON`; assigning the facade here avoids
// esbuild's export/commonjs descriptor helpers entirely.
import {
  parse,
  stringify
} from './runtime';

declare var ESON: any;

ESON = {
  parse: parse,
  stringify: stringify
};

// Keep the slim runtime's load semantics identical to the full facade: files
// executed through $.evalFile must persist the facade on the session global.
var __esonRuntimeGlobal = null;
try {
  if (typeof $ !== 'undefined' && $.global) {
    __esonRuntimeGlobal = $.global;
  }
} catch (e1) {}
if (!__esonRuntimeGlobal) {
  try { __esonRuntimeGlobal = Function('return this')(); } catch (e2) {}
}
if (__esonRuntimeGlobal) {
  __esonRuntimeGlobal.ESON = ESON;
}