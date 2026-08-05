// Native source kernels: captured uneval / toSource intrinsics.
//
// Captured early and invoked explicitly (never `value.toSource()`) so a user
// object's own toSource cannot hijack output. `uneval` is preferred for
// arbitrary roots; toSource is the fallback. All behaviors are probed at
// runtime - SpiderMonkey extensions (toSource/uneval/quote) were removed from
// Firefox and are not portable APIs; availability differs per host/engine.
import { SourceKernel } from './types';

// Serialize an inert normalized graph to SpiderMonkey source text.
// Returns null when the kernel cannot represent the graph.
export function sourceForRoot(graph: any, kernel: SourceKernel): string | null {
  var t = typeof graph;
  if (graph === null) return 'null';
  if (t === 'boolean') return String(graph);
  if (t === 'number') return isFinite(graph) ? String(graph) : 'null';
  if (t === 'string') {
    if (kernel.uneval) {
      try {
        return (kernel.uneval as any).call(null, graph);
      } catch (e) {
        // fall through to the array-wrapper form
      }
    }
    if (kernel.arrayToSource) {
      try {
        var s = (kernel.arrayToSource as any).call([graph]);
        if (typeof s === 'string' && s.length >= 2) return s.substring(1, s.length - 1);
      } catch (e) {
        return null;
      }
    }
    return null;
  }
  if (t === 'object') {
    if (Object.prototype.toString.apply(graph) === '[object Array]') {
      if (kernel.arrayToSource) {
        try {
          return (kernel.arrayToSource as any).call(graph);
        } catch (e) {
          // e.g. SpiderMonkey stack overrun on deep graphs - fall back
          return null;
        }
      }
      return null;
    }
    if (kernel.objectToSource) {
      try {
        return (kernel.objectToSource as any).call(graph);
      } catch (e) {
        return null;
      }
    }
    return null;
  }
  return null;
}

// Trusted-codec source generation: raw source for arbitrary values (may
// contain undefined, NaN, Infinity, functions, dates, sparse arrays).
// Throws when no kernel exists.
export function encodeSourceRaw(value: any, kernel: SourceKernel): string {
  if (kernel.uneval) return (kernel.uneval as any).call(null, value);
  var t = typeof value;
  if (value !== null && t === 'object') {
    if (Object.prototype.toString.apply(value) === '[object Array]') {
      if (kernel.arrayToSource) return (kernel.arrayToSource as any).call(value);
    } else if (kernel.objectToSource) {
      return (kernel.objectToSource as any).call(value);
    }
  } else if (t === 'string') {
    if (kernel.stringToSource) return (kernel.stringToSource as any).call(value);
    if (kernel.arrayToSource) {
      var s = (kernel.arrayToSource as any).call([value]);
      if (typeof s === 'string' && s.length >= 2) return s.substring(1, s.length - 1);
    }
  } else {
    if (kernel.arrayToSource) {
      var s2 = (kernel.arrayToSource as any).call([value]);
      if (typeof s2 === 'string' && s2.length >= 2) return s2.substring(1, s2.length - 1);
    }
  }
  throw new Error('ESON.encodeSource: no native source kernel available');
}
