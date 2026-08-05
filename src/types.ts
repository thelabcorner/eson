// ESON core types (ES5-targeted TypeScript, ES3-runtime-safe).
export interface Json2Api {
  parse(text: any, reviver?: any): any;
  stringify(value: any, replacer?: any, space?: any): string | undefined;
}

export interface SourceKernel {
  uneval: ((v: any) => string) | null;
  objectToSource: ((v: any) => string) | null;
  arrayToSource: ((v: any) => string) | null;
  stringToSource: ((v: any) => string) | null;
  stringQuote: ((v: string) => string) | null;
  profile: string;
}

export interface JsonClassification {
  exists: boolean;
  classification: string; // absent | native-looking | known JSON2 | unknown | broken
  sourceFingerprint: string;
  behavioral: {
    roundtrip: boolean;
    undefinedInArray: string;
    undefinedInObject: string;
    negativeZero: string;
    acceptsLeadingZeroNumber: boolean;
  };
}

export interface EsonCapabilities {
  json: JsonClassification;
  uneval: boolean;
  objectToSource: boolean;
  arrayToSource: boolean;
  stringToSource: boolean;
  stringQuote: boolean;
  sourceProfile: string;
  engine: {
    globalJsonPresent: boolean;
    localJsonPresent: boolean;
  };
}

export interface FastOptions {
  onUnsupported: string; // "fallback" | "throw"
}

export interface InstallOptions {
  json2Source?: string;
  exposeGlobal?: boolean;
}

export interface BenchItem {
  lane: string;
  payload: string;
  iterations: number;
  medianUs: number;
  minUs: number;
  p95Us: number;
  opsPerSec: number;
  outputBytes: number;
  vsJson2: number;
}
