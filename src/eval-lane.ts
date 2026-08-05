// The eval-lane: the ONLY module in the runtime tree that contains a direct
// eval. esbuild 0.28.1 keeps every top-level declaration (and their imports)
// of any module containing direct eval - so the eval lives alone here, and
// parse.ts's other exports (decodeCheckedSource, evalSource) can be
// tree-shaken away from the runtime vendor together with their imports
// (the ~10KB lenient parser).
export function evalSourceImpl(source: any): any {
  return eval('(' + String(source) + ')');
}
