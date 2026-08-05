// Capability detection and JSON classification.
//
// The bare Illustrator engine has no JSON at all, but probe artifacts show a
// runtime-injected json2 polyfill can persist in the main engine across evals
// (engine-state contamination). ESON therefore never hardcodes availability:
// it fingerprints whatever JSON exists and classifies it.
import {
  EsonCapabilities,
  JsonClassification,
  SourceKernel
} from './types';

export function detectCaps(g: any): EsonCapabilities {
  return {
    json: classifyJson(g),
    uneval: typeof g.uneval === 'function',
    objectToSource: typeof Object.prototype.toSource === 'function',
    arrayToSource: typeof Array.prototype.toSource === 'function',
    stringToSource: typeof String.prototype.toSource === 'function',
    stringQuote: typeof String.prototype.quote === 'function',
    sourceProfile: kernelProfile(g),
    engine: {
      globalJsonPresent: typeof g !== 'undefined' && g !== null && typeof g.JSON !== 'undefined',
      localJsonPresent: typeof JSON !== 'undefined'
    }
  };
}

export function classifyJson(g: any): JsonClassification {
  var present = false;
  var obj: any = null;
  try {
    present = typeof g !== 'undefined' && g !== null && typeof g.JSON !== 'undefined' && g.JSON !== null;
    if (present) obj = g.JSON;
  } catch (e) {
    present = false;
  }
  if (!present) {
    return {
      exists: false,
      classification: 'absent',
      sourceFingerprint: '',
      behavioral: emptyBehavioral()
    };
  }

  var parseFn = typeof obj.parse === 'function';
  var stringifyFn = typeof obj.stringify === 'function';
  var source = '';
  try {
    source = String(obj.parse) + '|' + String(obj.stringify);
  } catch (e) {
    source = '';
  }
  var nativeMark = source.indexOf('[native code]') >= 0;
  var json2Mark = source.indexOf('rx_dangerous') >= 0 || source.indexOf('rx_escapable') >= 0;

  var classification = 'unknown';
  if (!parseFn || !stringifyFn) classification = 'broken';
  else if (nativeMark) classification = 'native-looking';
  else if (json2Mark) classification = 'known JSON2';

  var behavior = emptyBehavioral();
  try {
    var parsed = obj.parse('{"x":1}');
    behavior.roundtrip = parsed !== null && typeof parsed === 'object' && parsed.x === 1;
  } catch (e) {
    behavior.roundtrip = false;
  }
  try {
    behavior.undefinedInArray = String(obj.stringify([undefined]));
  } catch (e) {
    behavior.undefinedInArray = 'ERR';
  }
  try {
    behavior.undefinedInObject = String(obj.stringify({ x: undefined }));
  } catch (e) {
    behavior.undefinedInObject = 'ERR';
  }
  try {
    behavior.negativeZero = String(obj.stringify(-0));
  } catch (e) {
    behavior.negativeZero = 'ERR';
  }
  behavior.acceptsLeadingZeroNumber = json2AcceptsLeadingZero(obj);

  return {
    exists: true,
    classification: classification,
    sourceFingerprint: source.substring(0, 120),
    behavioral: behavior
  };
}

function json2AcceptsLeadingZero(obj: any): boolean {
  try {
    obj.parse('01');
    return true;
  } catch (e) {
    return false;
  }
}

function emptyBehavioral(): any {
  return {
    roundtrip: false,
    undefinedInArray: '',
    undefinedInObject: '',
    negativeZero: '',
    acceptsLeadingZeroNumber: false
  };
}

export function captureKernel(g: any): SourceKernel {
  var parts: string[] = [];
  var kernel: SourceKernel = {
    uneval: null,
    objectToSource: null,
    arrayToSource: null,
    stringToSource: null,
    stringQuote: null,
    profile: 'none'
  };
  // uneval is lexical in ExtendScript (not an own property of the global
  // object) - probe both channels.
  var ue: any = (g && typeof g.uneval === 'function') ? g.uneval : null;
  if (!ue) {
    try {
      if (typeof uneval === 'function') ue = uneval;
    } catch (e) {
      ue = null;
    }
  }
  if (ue) {
    kernel.uneval = ue;
    parts[parts.length] = 'uneval';
  }
  if (typeof Object.prototype.toSource === 'function') {
    kernel.objectToSource = Object.prototype.toSource;
    parts[parts.length] = 'objectToSource';
  }
  if (typeof Array.prototype.toSource === 'function') {
    kernel.arrayToSource = Array.prototype.toSource;
    parts[parts.length] = 'arrayToSource';
  }
  if (typeof String.prototype.toSource === 'function') {
    kernel.stringToSource = String.prototype.toSource;
    parts[parts.length] = 'stringToSource';
  }
  if (typeof String.prototype.quote === 'function') {
    kernel.stringQuote = String.prototype.quote;
    parts[parts.length] = 'quote';
  }
  kernel.profile = parts.length ? parts.join('+') : 'none';
  return kernel;
}

function kernelProfile(g: any): string {
  return captureKernel(g).profile;
}

export function globalObject(): any {
  // ExtendScript's true global is $.global; Function("return this")() can
  // resolve to a caller-scope this inside the COM wrapper (measured), so
  // $.global wins when present.
  try {
    if (typeof $ !== 'undefined' && $.global) return $.global;
  } catch (e) {
    // fall through
  }
  try {
    return Function('return this')();
  } catch (e) {
    return null;
  }
}
