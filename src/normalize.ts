// Stage A: semantic normalization into an inert shadow graph.
//
// Mirrors JSON2's str() semantics exactly, once, so that:
//   - toJSON() and replacer run exactly once per value
//   - accessors are read exactly once (the double-read hazard of
//     "preflight then toSource on the original" is avoided)
//   - the graph contains only plain objects/arrays/strings/finite numbers/
//     booleans/null, so native source generation can never see functions,
//     NaN, Infinity, undefined, dates, getters, or user toSource()
//   - cycles throw TypeError (standard JSON behavior; JSON2 itself
//     stack-overflows)
export interface NormalizeResult {
  ok: boolean;
  graph: any;
  reason?: string;
}

var fallbackSignal: any = { esonFallback: true };

function contains(list: any[], value: any): boolean {
  var i: number;
  for (i = 0; i < list.length; i++) {
    if (list[i] === value) return true;
  }
  return false;
}

function setProp(obj: any, key: string, value: any): void {
  if (key === '__proto__') {
    if (typeof Object.defineProperty === 'function') {
      try {
        Object.defineProperty(obj, key, {
          value: value,
          writable: true,
          enumerable: true,
          configurable: true
        });
        // Verify the own data property was actually created. ES3 shims and
        // exotic hosts can silently set the prototype instead - fall back.
        if (!Object.prototype.hasOwnProperty.call(obj, key)) throw fallbackSignal;
        return;
      } catch (e) {
        throw fallbackSignal;
      }
    }
    throw fallbackSignal;
  }
  obj[key] = value;
}

export function normalizeJsonValue(value: any, replacer: any): NormalizeResult {
  try {
    var holder: any = { '': value };
    var active: any[] = [];
    var graph = build('', holder, replacer, active);
    return { ok: true, graph: graph };
  } catch (e) {
    if (e === fallbackSignal) {
      return { ok: false, graph: null, reason: '__proto__ key without defineProperty' };
    }
    throw e;
  }
}

function build(key: string, holder: any, rep: any, active: any[]): any {
  var value: any = holder[key];

  if (value !== null && typeof value === 'object' && typeof value.toJSON === 'function') {
    value = value.toJSON(key);
  }
  if (typeof rep === 'function') {
    value = rep.call(holder, key, value);
  }

  if (value === null) return null;

  var t = typeof value;
  if (t === 'string') return value;
  if (t === 'number') {
    if (!isFinite(value)) return null;
    return value === 0 ? 0 : value; // -0 -> 0 (String(-0) === "0" in JSON2)
  }
  if (t === 'boolean') return value;
  if (t !== 'object') return undefined; // undefined / function

  if (Object.prototype.toString.apply(value) === '[object Array]') {
    if (contains(active, value)) throw new TypeError('ESON.stringify: converting circular structure to JSON');
    active[active.length] = value;
    var outArr: any[] = [];
    var len: number = value.length;
    var i: number;
    var e: any;
    for (i = 0; i < len; i++) {
      e = build(String(i), value, rep, active);
      outArr[i] = e === undefined ? null : e;
    }
    active.pop();
    return outArr;
  }

  if (contains(active, value)) throw new TypeError('ESON.stringify: converting circular structure to JSON');
  active[active.length] = value;
  var outObj: any = {};
  var k: string;
  var v: any;

  if (rep && typeof rep === 'object') {
    var rl: number = rep.length;
    for (i = 0; i < rl; i++) {
      if (typeof rep[i] === 'string') {
        k = rep[i];
        v = build(k, value, rep, active);
        if (v !== undefined) setProp(outObj, k, v);
      }
    }
  } else {
    for (k in value) {
      if (Object.prototype.hasOwnProperty.call(value, k)) {
        v = build(k, value, rep, active);
        if (v !== undefined) setProp(outObj, k, v);
      }
    }
  }

  active.pop();
  return outObj;
}
