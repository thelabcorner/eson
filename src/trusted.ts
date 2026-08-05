// Trusted source transport ("eson-source" codec).
//
// encodeSource/decodeSourceTrusted deliberately expose SpiderMonkey source
// semantics and may preserve values JSON cannot: undefined, sparse arrays,
// NaN, Infinity, dates, functions. It is executable source, not a data-only
// format, and the only channel that may reach raw eval. decodeSourceChecked
// is the same codec family but eval-free: it accepts the source-literal
// subset for data and rejects anything executable.
import { encodeSourceRaw } from './source-kernel';
import { decodeCheckedSource, evalSource } from './parse';
import { walkReviver } from './reviver';
import { SourceKernel } from './types';

export function encodeSourceTrusted(value: any, kernel: SourceKernel): string {
  return encodeSourceRaw(value, kernel);
}

export function decodeSourceTrusted(source: any): any {
  return evalSource(source);
}

export function decodeSourceChecked(source: any, reviver?: any): any {
  return decodeCheckedSource(source, reviver);
}

export function parseTrusted(source: any, reviver?: any): any {
  var j: any = evalSource(source);
  return typeof reviver === 'function' ? walkReviver({ '': j }, '', reviver) : j;
}
