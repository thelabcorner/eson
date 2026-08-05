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
