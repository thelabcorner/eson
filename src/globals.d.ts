// Ambient declarations for host globals not present in lib.es5.
// All are runtime-guarded before use; declarations exist only for typechecking.

declare var ESON_JSON2: any; // injected by eson-build.mjs before the bundle
declare var ESON_TEST_JSON2_SRC: any; // provisioned by the Node harnesses
declare var ESON_LIVE_REPORT: any; // provisioned by eson-live-verify.mjs

declare var performance: {
  now(): number;
};
declare var console: {
  log(...args: any[]): void;
  error(...args: any[]): void;
};
declare var $: {
  hiresTimer: number;
  global: any;
};

// Adobe ExtendScript ExternalObject (host API; runtime-guarded - the module
// that touches it is only reachable via the explicit enableNativeGate call
// in the full build).
declare var ExternalObject: any;

// ---- ESTC type-environment overlays (declaration-only; zero runtime effect) --
// ESTC type-checks with noLib:true + Types-for-Adobe, whose ES3 surface is
// narrower than the engine's actual grammar. These are standard ES3 / Adobe
// host members the sources use; none emit code and none change runtime shape.

// ES3 15.3.4.3: Function.prototype.apply(thisArg, argArray) - argArray may be
// omitted/undefined (treated as no arguments). Types-for-Adobe requires it.
interface Function {
  apply(thisArg: any, argArray?: any): any;
}

// ES3 15.3.1: Function(p1, ..., body) accepts any number of string arguments
// (the doc comment on the Types-for-Adobe declaration says the same); the
// declared signature requires exactly two.
interface FunctionConstructor {
  (...args: string[]): Function;
}

// ES3 15.5.3.2: String.fromCharCode(code1, ...) accepts any number of code
// units; Types-for-Adobe declares exactly one.
interface StringConstructor {
  fromCharCode(...codes: number[]): string;
}

// ES3 15.10.7.5 (lastIndex) and 15.5.4.11 (replace with a RegExp and/or a
// replacement function); Types-for-Adobe only declares string replacement.
interface RegExp {
  lastIndex: number;
}
interface String {
  replace(searchValue: any, replaceValue: any): string;
}

// Adobe host API: ExternalObject.searchFolders is documented in the
// ExtendScript/Illustrator scripting reference (DLL search path).
interface ExternalObjectConstructor {
  searchFolders: string;
}

// The host JSON global is exactly what ESON fingerprints (caps.ts
// `localJsonPresent`) and installs (vendor footer). Every use is typeof-guarded.
declare var JSON: any;

// TypeScript utility type the checker's global-type resolution needs with
// noLib:true (ESTC emits TS2318 without it). Compile-time only.
type Extract<T, U> = T extends U ? T : never;
