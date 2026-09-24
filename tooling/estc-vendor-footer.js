// ESON vendor install footer (intentional product contract, ESTC `footer`):
// the vendor build REPLACES the global JSON.parse/stringify with ESON's strict
// implementations - ExtendScript's native JSON.parse (where present) is the
// permissive one, which is the whole point of the vendor. The ESON facade
// stays exposed as the global `ESON` (defined by the bundle). `allowJson` is
// enabled for the two vendor configs only, because installing the global JSON
// object IS the artifact's contract.
(function () {
  if (typeof JSON === "undefined") { JSON = {}; }
  JSON.parse = ESON.parse;
  JSON.stringify = ESON.stringify;
})();
