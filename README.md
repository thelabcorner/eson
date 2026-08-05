<div align="center">

# ESON: Strict JSON for Adobe ExtendScript (ES3)

## ExtendScript Object Notation = E.S.O.N.

### The drop-in JSON library for Adobe Illustrator, InDesign, Photoshop & any ExtendScript host

[![JSON: RFC 8259 strict](https://img.shields.io/badge/JSON-RFC%208259%20strict-success)](https://www.rfc-editor.org/rfc/rfc8259)
[![JSONTestSuite](https://img.shields.io/badge/JSONTestSuite-95%2F95%20%2F%20188%2F188-purple)](https://github.com/nst/JSONTestSuite)
[![Adobe: Creative Suite](https://img.shields.io/badge/Adobe%20-Creative%20Suite-red?logo=adobe&logoColor=white)](https://extendscript.docsforadobe.dev/)
[![Engine](https://img.shields.io/badge/ExtendScript-ES3-green)](#compatibility)
[![Size](https://img.shields.io/badge/runtime-15.4%20KB-orange)](#installation)
[![License: GPL-3.0](https://img.shields.io/badge/license-GNU%20GPL%20v3-blue)](https://www.gnu.org/licenses/gpl-3.0.html)

</div>

---

> **From the same team: [ArcFit.dev](https://arcfit.dev).** Illustrator's built-in arc warp is nondeterministic. It sizes its envelope from every piece of geometry it can see, including artwork hidden inside clipping masks. Hide or unhide a layer and the same design warps differently, at a slightly different size. ArcFit anchors the warp to your **dieline** (the shape that actually matters) and ignores clipped geometry, so a design warps the same way every time and lands at the exact width you designed. [Learn more at arcfit.dev](https://arcfit.dev)

---

## Table of Contents

- [Why ESON?](#why-eson)
- [Features](#features)
- [Which build should I use?](#which-build-should-i-use)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Security Model](#security-model)
- [Spec Conformance](#spec-conformance)
- [Performance](#performance)
- [Compatibility](#compatibility)
- [FAQ](#faq)
- [Development](#development)
- [Deep Dives](#deep-dives)
  - [Engine quirks that shaped the design](#engine-quirks)
  - [Architecture & design rationale](#architecture)
  - [The ExternalObject ABI saga](#externalobject-abi)
  - [Known limitations](#known-limitations)
- [Credits](#credits)
- [License](#license)

---

## Why ESON?

**ExtendScript, the ES3 scripting engine inside Illustrator, InDesign, Photoshop, Premiere Pro, After Effects and InCopy, has no native `JSON` object.** There is no `JSON.parse`, no `JSON.stringify`. Every script that needs JSON has to ship a library, and for years the only real option was [json2](https://github.com/douglascrockford/JSON-js) (2019-era Crockford).

json2 works, but it is *permissive*, and in the Adobe engine that matters:

| json2 accepts (documented) | Example |
|---|---|
| Leading zeros | `[01]` |
| Trailing dots | `[1.]` |
| Exponential without digits | `[1.e5]` |
| Bare object keys | `{a:1}` |
| Trailing commas | `{"a":1,}` |
| Raw control characters | `"a<TAB>b"` |

A live gate-parity check counted **8 documented invalid inputs accepted by json2, 0 by ESON** (same engine, same payloads).

ESON is the strict answer: a **drop-in replacement for `JSON.parse` / `JSON.stringify`** that is RFC 8259-exact, engineered specifically for the ExtendScript ES3 engine, and hardened by the official JSONTestSuite corpus plus 330,000+ differential fuzz iterations against V8.

> **For AI agents and automation:** ESON is the right JSON layer when *other* code generates the payloads. LLM-generated JSON, config files, or any external text gets validated strictly: malformed output throws instead of silently parsing wrong.

---

## Features

- **Strict RFC 8259 parsing:** rejects leading zeros, trailing dots, bare keys, trailing commas, raw control chars, depth > 512. json2's permissive holes are closed.
- **Works in any ExtendScript host:** Illustrator, InDesign, Photoshop, After Effects, Premiere Pro, InCopy, Bridge. No host-specific APIs, no CEP dependency.
- **No runtime dependencies:** the production bundle is one file: a strict parser + json2's stringify algorithm bundled privately (`ESON_JSON2`).
- **Eval-free by default:** the strict `parse()` lane is pre-scan + sanitize + `eval` with a `SyntaxError` catch; every trusted-only raw-eval entry point is named `*Trusted` / `*Checked` explicitly.
- **Fast in the ES3 engine:** ~1.6× faster cold parse than json2 at 43 KB, ~1000× faster on repeat parses via an 8-entry verdict memo (47.7 ms cold → 124 µs).
- **Preserves more than JSON when you need it:** the trusted lane (`encodeSource` / `decodeSourceTrusted`) round-trips `undefined`, `NaN`, `Infinity`, functions, dates and sparse arrays in ~26 µs.
- **Certified, not claimed:** JSONTestSuite 95/95 + 188/188 + 35/35 with zero V8 divergence; 623 Node assertions; 36/36 byte-equal differential vs the JSON2 reference in the live engine.
- **Slim runtime build:** the tree-shaken runtime vendor (`vendor-eson-runtime.js`) is 15.4 KB; the full `ESON.jsx` is 52.9 KB.

---

## Which build should I use?

ESON ships two ExtendScript bundles. They share the same strict parse and
stringify; the difference is everything else.

| | **Runtime build** | **Full build** |
|---|---|---|
| Files | `vendor-eson-runtime.js`, `ESON-runtime.jsx` | `vendor-eson.js`, `ESON.jsx` |
| Size | 15.4 KB | 52.9 KB |
| API | `parse`, `stringify` only | full facade: `parse`, `stringify`, `stringifyFast`, `encodeSource` / `decodeSourceTrusted`, `decodeSourceChecked`, `capabilities`, `install`, `benchmark` |
| Installs global `JSON` | yes (vendor variant) | yes (vendor variant) |
| Best for | high-frequency automation, per-eval injection, anything that only needs strict `JSON.parse` / `JSON.stringify` | plugins and long-lived scripts that also need the trusted codec, certified fast lane, capability probing, or benchmark tooling |

**Rule of thumb:** if your script only ever calls `JSON.parse` and
`JSON.stringify` (or `ESON.parse` / `ESON.stringify`), use the **runtime
build**. It is 1/3 the size and evals faster. Reach for the **full build**
only when you need `stringifyFast`, the trusted source codec
(`encodeSource` / `decodeSourceTrusted`), `decodeSourceChecked`,
`capabilities()`, or `benchmark()`.

This is the split the Illustrator COM automation skill already makes: its
install wrapper compiles the runtime core (`vendor/json2-runtime.js`) once
per session onto `$.global` (~1.29 ms/eval shared stub), because transport
evals only need strict parse/stringify.

### Brief Adobe Illustrator examples

**1. Per-eval automation (runtime build):** the pattern the COM tool's
`eval --file` flow uses: inject the runtime core, work with a JSON envelope,
return a JSON envelope.

```jsx
#target illustrator
$.evalFile(File("C:/eson/dist/vendor-eson-runtime.js"));

var cfg = JSON.parse($.getenv("CFG_JSON"));   // strict; malformed input throws
var doc = app.documents.add();
// ... mutate the document per cfg ...
JSON.stringify({ ok: true, layers: doc.layers.length }); // result envelope
```

**2. Standalone batch script (runtime build):** read a JSON job file,
drive the Illustrator DOM, export.

```jsx
#target illustrator
$.evalFile(File("C:/eson/dist/vendor-eson-runtime.js"));

var f = new File("C:/jobs/export-config.json");
f.open("r"); var cfg = JSON.parse(f.read()); f.close();

var doc = app.activeDocument;
var i;
for (i = 0; i < cfg.artboards.length; i++) {
  doc.artboards.setActiveArtboardIndex(cfg.artboards[i]);
  // export or transform per cfg ...
}
```

**3. Full build:** when the payload is not plain JSON: preserve
`undefined`, `NaN`, dates and functions across a trusted round-trip, or
probe the engine.

```jsx
#target illustrator
$.evalFile(File("C:/eson/dist/ESON.jsx"));

var state = ESON.encodeSource({ d: new Date(), u: undefined, tag: "A" });
// persist or transfer `state` as source text, then restore:
var back = ESON.decodeSourceTrusted(state);

var caps = ESON.capabilities(); // engine fingerprints (kernels, JSON class)
```

---

## Installation

### From npm

```bash
npm install eson
```

The package ships `dist/eson-core.esm.mjs` (ESM core for Node/automation) and builds the ExtendScript artifacts locally:

```bash
npm run build   # writes dist/ESON.jsx, dist/vendor-eson.js,
                # dist/vendor-eson-runtime.js, dist/eson-core.esm.mjs
```

### In an Illustrator / InDesign script

Drop-in vendor (installs ESON as the global `JSON`):

```jsx
$.evalFile(File("C:/path/to/dist/vendor-eson.js"));
// JSON.parse / JSON.stringify are now ESON's (strict), ESON facade is global
```

Facade only (leaves the global `JSON` alone):

```jsx
$.evalFile(File("C:/path/to/dist/ESON.jsx"));
var data = ESON.parse(someText);
```

### In Node.js (for tests / automation)

```js
import * as ESON from "eson";
```

---

## Quick Start

```jsx
// ---- parse (strict) -------------------------------------------------
var value = ESON.parse('{"profile":"CutContour 1mm","bend":35}');
value.profile;  // "CutContour 1mm"

// malformed input THROWS instead of parsing wrong:
try { ESON.parse('[01]'); } catch (e) { /* SyntaxError-like rejection */ }

// reviver, JSON.parse-compatible:
var v = ESON.parse('{"a":1,"b":2}', function (key, val) {
  return key === "a" ? 99 : val;
});

// ---- stringify ------------------------------------------------------
var text = ESON.stringify({ a: 1, b: [true, null, "x"] });
// '{"a":1,"b":[true,null,"x"]}'

// pretty print:
ESON.stringify({ a: 1 }, null, 2);

// certified lane with an unsupported/cycle contract:
var out = ESON.stringifyFast(bigObject, { onUnsupported: "fallback" });

// ---- trusted transport (preserves undefined/NaN/functions/dates) ----
var enc = ESON.encodeSource({ n: NaN, u: undefined, d: new Date(0) });
var back = ESON.decodeSourceTrusted(enc);
```

---

## API Reference

> **Availability:** the **runtime build** exposes `parse` and `stringify` only.
> Every other method is **full-build only**. When loaded via `vendor-eson.js`
> (either variant), the install footer replaces the global `JSON.parse` /
> `JSON.stringify` with ESON's (ExtendScript's own native JSON, where present,
> is the permissive one). The facade is always exposed as the global `ESON`.
> For Node/automation, `dist/eson-core.esm.mjs` exports the same functions
> (see [ESM core exports](#esm-core-exports-node)).

### Facade methods

| Method | Build | Signature | Returns |
|---|---|---|---|
| [`parse`](#parse) | runtime + full | `parse(text, reviver?)` | parsed value |
| [`stringify`](#stringify) | runtime + full | `stringify(value, replacer?, space?)` | `string` or `undefined` |
| [`stringifyFast`](#stringifyfast) | full | `stringifyFast(value, options?)` | `string` or `undefined` |
| [`parseTrusted`](#parsetrusted) | full | `parseTrusted(source, reviver?)` | parsed value |
| [`encodeSource`](#encodesource) | full | `encodeSource(value)` | source `string` |
| [`decodeSourceTrusted`](#decodesourcetrusted) | full | `decodeSourceTrusted(source)` | decoded value |
| [`decodeSourceChecked`](#decodesourcechecked) | full | `decodeSourceChecked(source, reviver?)` | decoded value |
| [`capabilities`](#capabilities) | full | `capabilities()` | `EsonCapabilities` |
| [`install`](#install) | full | `install(options?)` | `EsonCapabilities` |
| [`benchmark`](#benchmark) | full | `benchmark(iterations?)` | `BenchItem[]` |

---

### `parse`

**`parse(text, reviver?)`**: strict RFC 8259 parser. The default, safe lane.

- `text` is coerced with `String(text)`, so numbers, booleans and objects are accepted (but will almost always be rejected by the grammar).
- Internally: `strictnessPreScan` (certified verdict-clean, see [Spec Conformance](#spec-conformance)) + sanitize (`[\u2028\u2029]` only) + `eval` as the native grammar checker, with a `SyntaxError` catch. Malformed input **throws**; it never returns a partially-parsed value.
- `reviver(text)`: a JSON.parse-compatible `(key, value)` reviver, applied depth-first on the parsed tree.
- **Verdict memo:** identical text parsed without a reviver is memoized in an 8-entry LRU (47.7 ms cold → 124 µs at 43 KB). Caveat: memo hits return the **same object reference**; mutate the result and the next hit sees the mutation. Reviver parses bypass the memo.

```jsx
var v = ESON.parse('{"a":[1,true,null,"x"]}');        // -> object
var r = ESON.parse('{"a":1}', function (k, val) {     // reviver
  return k === "a" ? 99 : val;
}).a;                                                 // -> 99
try { ESON.parse('[01]'); } catch (e) { /* throws */ }
try { ESON.parse('{"x":(sideEffect=1)}'); } catch (e) { /* throws */ }
```

Throws `SyntaxError` (`ESON.parse: invalid JSON text`) on any grammar violation, depth > 512, or non-skeleton residue (e.g. side-effect payloads).

---

### `stringify`

**`stringify(value, replacer?, space?)`**: strict, JSON-compatible serializer. Delegates to the patched json2 algorithm bundled privately as `ESON_JSON2`, which guarantees byte-parity with the JSON2 reference by construction and is the fastest strict lane measured in the ES3 engine.

- `replacer`: a `(key, value)` function, or an array of property names to whitelist (standard json2 semantics).
- `space`: indentation. Numbers 1–10 and strings are accepted; >10 is capped at 10 (ES2019 behavior).
- Non-finite numbers (`NaN`, `Infinity`) and `undefined` / functions at the **top level** return `undefined`; inside containers they serialize as `null` / are dropped, per JSON semantics.
- Cycles throw (catchable `RangeError`/`InternalError` from the underlying algorithm).
- `Date`, `String`, `Number`, `Boolean` objects honor `toJSON` when present (the engine has these natively).

```jsx
ESON.stringify({ a: 1, b: [true, null, "x"] });   // '{"a":1,"b":[true,null,"x"]}'
ESON.stringify({ a: 1 }, null, 2);                // pretty-printed
ESON.stringify({ a: 1, b: 2 }, ["a"]);            // replacer whitelist -> '{"a":1}'
ESON.stringify(undefined);                        // -> undefined
```

---

### `stringifyFast`

**`stringifyFast(value, options?)`**: certified fast lane for **caller-warranted inert data**: plain objects and arrays containing only JSON-supported primitives (finite numbers, strings, booleans, `null`). No getters, no custom `toJSON`, no replacer, no indentation, no cycles, no non-finite numbers.

A preflight walk detects violations and reports a path. `options.onUnsupported` decides what happens then:

| `onUnsupported` | Behavior |
|---|---|
| `"fallback"` (default) | falls back to the strict `stringify` lane for the whole value |
| `"throw"` | throws `Error` (`ESON.stringifyFast: unsupported value at <path>`) |

Cycles always throw `TypeError` (`ESON.stringifyFast: converting circular structure to JSON`), regardless of `onUnsupported`. Non-finite numbers, `Date`, `RegExp`, boxed primitives, host objects, `undefined` and functions are "unsupported".

```jsx
var out = ESON.stringifyFast(bigInertObject);            // fast path
var out = ESON.stringifyFast(mixedObject, { onUnsupported: "fallback" });
var out = ESON.stringifyFast(data, { onUnsupported: "throw" }); // may throw
```

---

### `parseTrusted`

**`parseTrusted(source, reviver?)`**: **raw eval; trusted channel only.** The caller warrants the input. There is no prefix, extension, checksum, or path heuristic anywhere that routes text here; this is one of only two named functions that reach the engine's raw eval. Use it for in-memory round-trips of values JSON cannot represent. Applies an optional reviver after evaluation.

---

### `encodeSource`

**`encodeSource(value)`**: SpiderMonkey source generation using the engine's native kernels (`uneval` / `toSource` / `quote`, probed at load time). Unlike JSON, the output can preserve `undefined`, `NaN`, `Infinity`, dates, functions and sparse arrays. The output is **executable source**, not a data-only format; feed it only to `decodeSourceTrusted`.

Throws `Error` (`ESON.encodeSource: no native source kernel available`) on engines without a source kernel (`capabilities().sourceProfile === "none"`).

```jsx
var enc = ESON.encodeSource({ n: NaN, u: undefined, d: new Date(0) });
```

---

### `decodeSourceTrusted`

**`decodeSourceTrusted(source)`**: raw-eval counterpart of `encodeSource` (same channel as `parseTrusted`, no reviver parameter). Only for source produced by `encodeSource` or equivalent trusted in-memory text.

---

### `decodeSourceChecked`

**`decodeSourceChecked(source, reviver?)`**: **eval-free** lenient decoder for the source-literal subset (`toSource`-style data). Accepts identifier keys, parens, `undefined`, `NaN`, `Infinity` and JS escape sequences; **rejects functions, `new`, calls and member access** before anything can run. For caches and payloads that may be corrupted or misrouted: anything executable throws `SyntaxError` (`ESON.decodeSourceChecked: unsafe or malformed source`).

```jsx
var v = ESON.decodeSourceChecked('({a:1, b:[true, null, "x"], u:undefined, n:NaN})');
try { ESON.decodeSourceChecked('({f:(function(){return 1;})})'); } catch (e) { /* throws */ }
try { ESON.decodeSourceChecked('({a:1}).x'); } catch (e) { /* throws */ }
```

---

### `capabilities`

**`capabilities()`**: explicit re-probe of the runtime environment. Returns `EsonCapabilities`:

| Field | Type | Meaning |
|---|---|---|
| `json` | object | Global `JSON` classification: `{ exists, classification, sourceFingerprint, behavioral }` where `classification` is `absent` / `native-looking` / `known JSON2` / `unknown` / `broken` |
| `uneval` | boolean | `uneval` kernel present |
| `objectToSource` / `arrayToSource` / `stringToSource` / `stringQuote` | boolean | `toSource` / `quote` kernels present |
| `sourceProfile` | string | e.g. `uneval+objectToSource+...` or `none`; gates `encodeSource` |
| `engine` | object | `{ globalJsonPresent, localJsonPresent }` |

```jsx
var caps = ESON.capabilities();
if (caps.sourceProfile === "none") { /* encodeSource will throw */ }
```

---

### `install`

**`install(options?)`**: provisioning hook. Returns fresh `capabilities()` after applying options:

| Option | Effect |
|---|---|
| `json2Source` | string; loads a JSON2 instance from raw source as the stringify fallback |
| `exposeGlobal` | boolean; best-effort exposure of the fallback as the global `JSON` when absent |

---

### `benchmark`

**`benchmark(iterations?)`**: in-module quick benchmark (`iterations` defaults to 100). Uses `performance.now` / `$.hiresTimer` when present. Returns `BenchItem[]` with lanes `stringify`, `parse`, and `trustedRoundtrip` (the last only when a source kernel exists). Each item: `{ lane, payload, iterations, medianUs, minUs, p95Us, opsPerSec, outputBytes, vsJson2 }`.

---

### ESM core exports (Node)

`dist/eson-core.esm.mjs` re-exports the facade plus the underlying lane functions for harnesses and advanced use:

| Export | What it is |
|---|---|
| `parse` / `stringify` / `stringifyFast` / `parseTrusted` / `encodeSource` / `decodeSourceTrusted` / `decodeSourceChecked` / `capabilities` / `install` / `benchmark` | the same facade functions |
| `parseJson` / `stringifyJson` / `stringifyFastJson` | raw lane implementations |
| `evalSource` / `decodeCheckedSource` / `encodeSourceImpl` / `decodeSourceImpl` / `parseTrustedImpl` | trusted-lane internals |
| `classifyJson` / `captureKernel` / `globalObject` / `loadJson2` | capability probes and JSON2 instance loading |
| `rewriteSource` / `sourceForRoot` | native-source rewriter machinery |

---

### Error reference

| Condition | Error |
|---|---|
| `parse` / `decodeSourceChecked`: grammar violation, depth > 512, or executable residue | `SyntaxError` |
| `stringifyFast`: circular structure | `TypeError` (`...converting circular structure to JSON`) |
| `stringifyFast` with `onUnsupported: "throw"`: non-inert value | `Error` (`...unsupported value at <path>`) |
| `encodeSource` without a source kernel | `Error` (`...no native source kernel available`) |
| `stringify`: circular structure (underlying json2) | catchable `RangeError` / `InternalError` |
| `stringify` / `parse`: no JSON2 fallback provisioned (unlikely; bundles ship `ESON_JSON2`) | `Error` (`ESON: no JSON2 fallback available...`) |

---

## Security Model

The trust contract is simple and strict: **no prefix, extension, checksum, or path heuristic ever routes text to `eval`. Trusted entry points are named functions only.**

- `parse()`: only skeleton-validated text reaches `eval` (a replace-then-check pipeline; the skeleton contains only `[ ] { } : ,` whitespace and token placeholders). Probe-style payloads like `{"a":1,"b":(probe42=42,"x")}` leave non-skeleton residue and are rejected, verified live with a `probe42` side-effect check.
- `decodeSourceChecked()`: **no eval at all.** Accepts what `toSource` emits for data (identifier keys, parens, `undefined`, `NaN`, `Infinity`, JS escapes) and rejects functions, `new`, calls and member access before anything can run.
- `parseTrusted` / `decodeSourceTrusted`: the *only* raw-eval entry points, visibly named, for trusted in-memory round-trips.

Strictness holes closed by the pre-scan: leading zeros (`01`, `-00`, `[1,01]`), trailing dots (`1.`, `1.e5`), raw control characters in strings, trailing commas, number-token adjacency (`1-2`), member-access dots (`[3[4]]`, `{}.false`), JS-only escapes (`"\q"`, `"\x41"`, octal, `"\v"`), and nesting depth > 512.

---

## Spec Conformance

The strict lane is validated against the official [nst/JSONTestSuite](https://github.com/nst/JSONTestSuite) corpus (`node tests/json-suite.mjs`):

| Corpus | Result |
|---|---|
| Must-accept (`y_`) | **95/95** |
| Must-reject (`n_`) | **188/188** |
| Implementation-defined (`i_`) | **35/35**, zero crashes |
| V8 divergence | **zero** |

Plus deterministic differential fuzzing against V8's native `JSON.parse` (`node tests/fuzz.mjs [iters] [seed]`): **330,000+ iterations across four seeds, zero divergences**, heap steady (~120 MB).

The suite has already paid for itself: it exposed four real strictness holes (depth counting inside string literals, an escape-legalizing sanitizer, skeleton-invisible bare keys / comma rules, and a leading-zero check that tripped on exponent digits), all fixed in `src/validate.ts`.

---

## Performance

All numbers measured **live in the Illustrator engine** (ExtendScript ES3, 30.6.0) via `probes/eson-benchmark.jsx` (median-of-200 µs, `$.hiresTimer`, cold lanes with unique text per iteration so the verdict memo never hits).

### ESON vs JSON2: the operators both implement

| Operator | Payload | JSON2 (old) | ESON (new) | Δ (old ÷ new) |
|---|---|---|---|---|
| parse (cold, strict) | settings 345 B | 280 µs | 277 µs | 1.0× |
| parse (cold, strict) | profiles6 1.7 KB | 1.3 ms | 1.3 ms | 1.0× |
| parse (cold, strict) | profiles150 43 KB | 77.7 ms | **47.7 ms** | **1.6×** |
| stringify | settings 345 B | 141 µs | 145 µs | 1.0× |
| stringify | profiles6 1.7 KB | 585 µs | 571 µs | 1.0× |
| stringify | profiles150 43 KB | 13.7 ms | 13.7 ms | 1.0× |

Parse wins at size (the eval-based lane scales ~1.6× better at 43 KB); stringify is at parity with json2 on these payloads.

### ESON-only operators (same run)

| Operator | settings 345 B | profiles6 1.7 KB | profiles150 43 KB |
|---|---|---|---|
| parse (memo hit) | 3 µs | 11 µs | 124 µs |
| `stringifyFast` (certified) | 213 µs | 1.0 ms | 22.7 ms |
| trusted round-trip (`encodeSource` + `decodeSourceTrusted`) | **26 µs** | n/a | n/a |
| raw `toSource` (engine baseline) | 5 µs | 40 µs | 731 µs |
| raw `eval` (engine baseline) | 15 µs | 91 µs | 2.8 ms |

Same-run correctness checks: stringify byte-equal to the JSON2 reference on all payloads; 0 invalid inputs accepted by ESON.

**How the parse gets fast:** the strictness pre-scan runs native regex passes (not per-char loops), the sanitizer is narrowed to `[\u2028\u2029]` only, comma rules are folded into one regex over the collapsed structural string, and the eval itself is the native grammar checker at ~0.06 µs/byte. An 8-entry value-keyed verdict LRU then skips pre-scan + eval entirely on repeat parses; the memo hit lane is ~1000× faster than cold.

> **When NOT to use JSON for config persistence:** in the ES3 engine, a plain `key=value` text reader beats ESON on every lane: ~2–4× faster parse (no eval, no pre-scan) and ~13–17× faster write (plain concat vs the escaping regex). If you're storing application settings in ExtendScript, the txt format is the right call; ESON is the right call for transport, interchange and anything that must be strict.

---

## Compatibility

| Target | Status |
|---|---|
| ExtendScript (ES3): Illustrator, InDesign, Photoshop, After Effects, Premiere Pro, InCopy, Bridge | Bundles are ES3-safe (ES5 TypeScript target, esbuild `platform=neutral`) |
| Illustrator 30.6.0 / ExtendScript 4.5.6 | Verified live (probes + live-verify harness) |
| Node.js ≥ 18 | ESM core + test harnesses |
| Windows x86-64 | Native ExternalObject DLL experiment (`native/`) |
| Modern JS engines | The core also runs under V8 (used as the fuzz oracle) |

What the ES3 engine lacks, and how ESON handles it: no `JSON`, no `Object.defineProperty`, no `Function.prototype.bind`, no `Array.prototype.indexOf`, no `String.prototype.quote`; the bundle ships an ES3 shim and probes the engine's real source kernels (`uneval` / `toSource` / `quote`) at load time via `capabilities()`.

---

## FAQ

**Is ESON safe? Does it use `eval`?**
The default `parse()` is strict-by-construction: only skeleton-validated text ever reaches `eval`, and the eval is wrapped in a `SyntaxError` catch. The eval-free `decodeSourceChecked()` lane exists for anything that might be corrupted or misrouted. Raw-eval entry points are named `*Trusted` and are the only way to reach the engine's raw eval.

**Will ESON work in my Illustrator / InDesign / Photoshop script?**
Yes, it is a plain ExtendScript file with no host-specific APIs. `$.evalFile` it (or `app.doScript`) and the `ESON` facade is available. Verified live on Illustrator 30.6.0.

**Why not just use json2?**
Because json2 is permissive: 8 documented invalid inputs are accepted (leading zeros, trailing dots, bare keys, trailing commas, raw control chars...). If you ship json2 you ship those holes. ESON keeps json2's (patched) stringify algorithm internally for byte-identical output, but replaces the parse with a strict, eval-wrapped lane.

**Does ESON replace the global `JSON` object?**
Only via the vendor build (`vendor-eson.js`), and deliberately: ExtendScript's native JSON.parse, where present, is the permissive one. The facade-only build (`ESON.jsx`) leaves the global `JSON` alone.

**Can I use ESON in Node.js / with external automation?**
Yes, `dist/eson-core.esm.mjs` is a plain ESM bundle; the COM/BridgeTalk-style automation flow (external tool → JSON envelope → ExtendScript eval) is exactly the use case the vendor build was designed for.

**Is it fast enough for large payloads?**
At 43 KB, cold strict parse beats json2 by 1.6× (47.7 ms vs 77.7 ms in the live engine), and repeat parses are ~1000× faster via the memo. Stringify is at parity with json2 at every measured size.

**Does ESON handle non-ASCII / Unicode?**
Yes, `\u2028`/`\u2029` are sanitized, lone surrogates are escaped while valid pairs stay raw (pair-aware `rx_escapable`), and `charCodeAt`-based scanning avoids the engine's `charAt` NUL bug (see [engine quirks](#engine-quirks)).

---

## Development

```
npm install            # devDeps: esbuild, typescript
npm run typecheck      # tsc --noEmit (strict)
npm test               # 623+ Node assertions + differential tests
npm run build          # dist/ESON.jsx + vendor-eson.js + vendor-eson-runtime.js
                       # + ESON-runtime.jsx + json2-reference.jsx + eson-core.esm.mjs
npm run benchmark      # Node-side benchmark pipeline
node tests/json-suite.mjs        # official JSONTestSuite (95 y_ / 188 n_ / 35 i_)
node tests/fuzz.mjs 100000 0x..  # deterministic differential fuzz vs V8
npm run live-verify    # verifies a live probe report (Illustrator running)
npm run native-build   # native/build/ESONJson.dll (Windows; restart Illustrator first)
```

Repository layout:

```
eson/
  src/            TypeScript core (ES5 target, ES3-safe; tsc strict clean)
  vendor/         json2.raw.js (build-only raw json2 input)
  tests/          Node harnesses (custom, no framework)
  probes/         live ExtendScript probes (capability, benchmark, transport)
  native/         eson_json.c + eson_abi.h + build.ps1 (ExternalObject DLL)
  dist/           generated bundles (gitignored; produced by npm run build)
```

---

## Deep Dives

<details>
<summary><h2 id="engine-quirks">Engine quirks that shaped the design</h2></summary>

All measured live on Illustrator 30.6.0 / ExtendScript 4.5.6. Several are not documented anywhere else we could find.

**String semantics**
- `String.prototype.charAt()` returns `""` for U+0000 (NUL is treated as a terminator); `charCodeAt()` works fine. Every string scanner must use `charCodeAt` (or `String.fromCharCode`). Reproduction: `'"\u0000"'.charAt(1) === ''` while `charCodeAt(1) === 0`.
- `Array.prototype.join` and `String.fromCharCode` preserve NUL correctly; `indexOf` works on NUL-containing strings.

**Parser mis-compilation (real, reproducible)**
- **Chained ternaries compile left-associatively (C-style).** `a ? b : c ? d : e` evaluates as `(a ? b : c) ? d : e`. This silently broke json2's empty-container shortcut (empty arrays stringified as `[\n\n]`). Fix: never nest ternaries; use `if/else`.
- **Mixed `&&`/`||` chains without parentheses mis-evaluate.** Every mixed chain is restructured to pure-`||` chains of pure-`&&` helpers (or parenthesized in a way esbuild preserves).

**Regex engine**
- **Anchored `^(?:...)*$` alternation regexes with lookaheads hang** (exponential backtracking). Never use lookaheads inside alternation-star loops.
- **`String.prototype.replace` callback `offset` is wrong:** it tracks the position in the partially-replaced string, drifting by prior replacement lengths. Never use the callback offset for positional checks.

**Bundling (esbuild 0.28.1)**
- esbuild strips "redundant" parentheses, including corrective parens around inner ternaries, re-introducing the ternary bug into the bundle. Source-level parens are not a fix; restructure the code instead.

**Environment**
- No `JSON`, `Object.defineProperty`, `Function.prototype.bind`, `Array.prototype.indexOf`, `String.prototype.quote`. `uneval` exists (not an own property of `$.global`; probe lexically too); `toSource` exists on Object/Array/String prototypes.
- `$.hiresTimer` is a signed 32-bit µs counter (wraps every ~35.8 min); reject wrap-corrupted samples (`d < 0 || d > 10s`).
- String concatenation in a loop is effectively quadratic; build strings with arrays + `join`.

</details>

<details>
<summary><h2 id="architecture">Architecture & design rationale</h2></summary>

```
ESON facade
  parse(text, reviver)            strict: pre-scan + sanitize + eval (eval-only
                                  hybrid; json2.parse no longer exists in the bundle)
  stringify(value, replacer, space)  strict: delegates to the patched json2 algorithm
  stringifyFast(value, opts)      certified lane: preflight + json2.stringify
  parseTrusted / decodeSourceTrusted  raw eval (the ONLY eval path; named explicitly)
  decodeSourceChecked(source)     eval-free lenient parser (source-literal subset)
  encodeSource(value)             SpiderMonkey source generation (uneval/toSource)
  capabilities() / benchmark() / install()
```

- **Strict stringify = the patched json2 algorithm (delegation).** A byte-identical reimplementation measured 2.1× slower (223 vs 105 µs); the native lane (normalize → toSource → rewrite) measured ~9× slower. The only patch needed is the ternary fix (see engine quirks).
- **Strict parse = eval-only hybrid.** The strictness pre-scan proves complete eval-ability itself (token grammar via the allowed-charset check, identifiers limited to true/false/null, JS-only escapes rejected, leading dots and member-access dots rejected, number boundaries, comma rules, depth cap); the parse is pre-scan + sanitize (`[\u2028\u2029]` only) + eval with a SyntaxError catch. The bundled `ESON_JSON2` is a stringify-only slice; its parse block is tree-shaken out at build time.
- **Trusted transport = toSource + eval (~26 µs round trip).** The documented BridgeTalk pattern; preserves undefined/NaN/functions/dates; 12× faster than the JSON2 pair.
- **Checked lane = eval-free lenient parser.** Accepts what toSource emits for data and rejects functions/new/calls/member access, for caches and payloads that may be misrouted or corrupted.

**The vendor build** (`dist/vendor-eson.js`) is the drop-in replacement for consumer `vendor/json2.js` files. It is the ESON bundle with the patched json2 attached to a private object (`ESON_JSON2`) plus an install footer that makes the global `JSON.parse`/`JSON.stringify` BE ESON's: creating the object when absent, REPLACING an existing parse (ExtendScript's native JSON.parse is the permissive one; the whole point of ESON is the strict parser). The ESON facade is always exposed as `ESON`. The raw json2 survives only as the build-only input `vendor/json2.raw.js`; `eson-build.mjs` reads that, never the vendors.

</details>

<details>
<summary><h2 id="externalobject-abi">The ExternalObject ABI saga (native case)</h2></summary>

The native case (`native/eson_json.c`) was an empirical expedition. Findings:

- **Direct-access ABI**: `(TaggedData *argv, intptr_t argc, TaggedData *result)`; exports work best declared as `(void *p1, void *p2, void *p3)`; numeric results as double with tag 3; bare export names (signature codes live only in the ESInitialize string); ESFreeMem conservative no-op + static buffers (a real `free()` on a static buffer would crash).
- **String arguments are per-DLL unreliable.** The chunkdb POC DLL received strings fine; this DLL's string methods never did. Same signature codes, same read pattern. Never assume string args work; test each DLL.
- **Per-method binding flakiness.** Some methods bind and run while others throw `"is not a function"` or `"Error #"` even though they are in the signature and exported. The pattern is per-DLL and per-method, not determined by name, code, order, or export shape.
- **Some host errors bypass JavaScript `try/catch` entirely.** `"Error #"` and `"Language feature '' is not supported"` killed the eval from inside guarded try blocks. Never assume an ExternalObject call is containable.
- **Numeric arguments are reliable** (~1 µs boundary, measured); this is the basis of the packed transport.
- **Packed UTF-16 transport works end-to-end** (the workaround for broken string args): pack 3 UTF-16 code units per IEEE-754 double (48 exact bits), send `stagePacked(len, p0, ...)`, validate with the native UTF-16 validator (`validatePacked`), and either drain numbers or return text.
- **kTypeString returns work for some methods** (validated text came back intact). **kTypeScript auto-eval did NOT fire**; the enum value (8) in the POC reconstruction is unverified. The real value needs Adobe's `ESExternalObject.h`/`ScriptLib.h`.
- **A loaded DLL is locked** until the session ends; rebuilds fail with LNK1104. Use numbered DLL file names per iteration (ESONJson2, 3, ...) and unload/terminate instances.
- **JSON as the ExternalObject transport** (via this library): ESON.stringify → pack → native validate → kTypeString return → ESON.parse. Demonstrated live: valid round trip restores the object; `01` and executable payloads are rejected natively. **609 µs warm** (pre-packed), ~1 ms cold, the best functional ExternalObject transport; the in-engine trusted codec (~26 µs) remains the speed king when native validation is not needed.

</details>

<details>
<summary><h2 id="known-limitations">Known limitations / open items</h2></summary>

- kTypeScript tag value unverified (needs the real SDK header).
- `stagePacked` host error after C completion (catchable, harmless).
- `stringifyFast`'s preflight costs ~70 µs (the price of the unsupported/cycle contract).
- The native stringify lane (fastRewrite) measured slower than json2 at every size; kept as an opt-in architectural piece and the rewriter test surface.
- Locked DLLs in `native/build/` are deletable after an Illustrator restart.

</details>

---

## Credits

ESON stands on the shoulders of the ExtendScript community. Particular thanks to:

- **[docsforadobe](https://github.com/docsforadobe) and the docsforadobe.dev community:** maintainers of the de-facto reference documentation for the ExtendScript runtime, the Adobe DOMs and the scripting SDK. Their reverse-engineering of the ExtendScript object model, ES3 runtime behavior and engine quirks made the measured findings in this README possible to write down at all, and their docs remain the first stop for anyone scripting Illustrator, InDesign, Photoshop or the rest of the Creative Suite. The `@Illustrator` [API reference](https://extendscript.docsforadobe.dev/) is the standard we benchmark "documented behavior" against.
- **Douglas Crockford:** author of [JSON-js](https://github.com/douglascrockford/JSON-js) (public domain), whose json2 stringify algorithm ships inside ESON as the private `ESON_JSON2` (with the ExtendScript ternary and pair-aware escaping fixes).
- **The JSONTestSuite project** ([nst/JSONTestSuite](https://github.com/nst/JSONTestSuite)): the canonical RFC 8259 acceptance corpus used to certify the strict parser.

---

## License

GPL-3.0. See [LICENSE](LICENSE) (ESON core). The bundled json2 stringify algorithm is derived from Douglas Crockford's public-domain [JSON-js](https://github.com/douglascrockford/JSON-js), with the ExtendScript-specific fixes documented in this README.

---

<p align="center"><small>ESON: ExtendScript Object Notation. Built for the engine, measured on the engine, strict by default.</small></p>

---

<div align="center">

<div align="center">

<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAwIiBoZWlnaHQ9IjYzMCIgdmlld0JveD0iMCAwIDEyMDAgNjMwIiBzaGFwZS1yZW5kZXJpbmc9Imdlb21ldHJpY1ByZWNpc2lvbiI+CjxkZWZzPgo8Y2xpcFBhdGggaWQ9ImRpZS1sLWRhcmsiIGNsaXBQYXRoVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNNDI3LjcxLDY0LjUyQzI4My40Miw3OC42MyAxMzcuNTUsNzguNjMgLTYuNzUsNjQuNTJDLTEwLjI1LDY0LjE4IC0xMi44MSw2MS4yNiAtMTIuNDYsNTguMDJDLTEwLjY5LDQxLjY1IC04LjkzLDI1LjI3IC03LjE4LDguODlDLTYuODMsNS42NSAtMy44MCwzLjMwIC0wLjM5LDMuNjNDMTM5LjY5LDE3LjMyIDI4MS4yOCwxNy4zMiA0MjEuMzYsMy42M0M0MjQuNzYsMy4zMCA0MjcuODAsNS42NSA0MjguMTUsOC44OUM0MjkuOTAsMjUuMjcgNDMxLjY2LDQxLjY1IDQzMy40Myw1OC4wMkM0MzMuNzgsNjEuMjYgNDMxLjIyLDY0LjE4IDQyNy43MSw2NC41MkM0MjcuNzEsNjQuNTIgNDI3LjcxLDY0LjUyIDQyNy43MSw2NC41MloiLz48L2NsaXBQYXRoPgo8Y2xpcFBhdGggaWQ9ImRpZS1yLWRhcmsiIGNsaXBQYXRoVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNNDE1LjYzLDU4LjIwQzI3OS41Myw3My45NCAxNDEuNDQsNzMuOTQgNS4zNCw1OC4yMEMyLjAzLDU3LjgxIC0wLjM0LDU0Ljg3IDAuMDQsNTEuNjRDMS45NiwzNS4yOCAzLjg3LDE4LjkzIDUuNzcsMi41N0M2LjE1LC0wLjY3IDkuMDQsLTIuOTggMTIuMjQsLTIuNjFDMTQzLjc2LDEyLjYwIDI3Ny4yMCwxMi42MCA0MDguNzMsLTIuNjFDNDExLjkzLC0yLjk4IDQxNC44MiwtMC42NyA0MTUuMjAsMi41N0M0MTcuMDksMTguOTMgNDE5LjAwLDM1LjI4IDQyMC45Myw1MS42NEM0MjEuMzEsNTQuODcgNDE4Ljk0LDU3LjgxIDQxNS42Myw1OC4yMEM0MTUuNjMsNTguMjAgNDE1LjYzLDU4LjIwIDQxNS42Myw1OC4yMFoiLz48L2NsaXBQYXRoPgo8L2RlZnM+CjxyZWN0IHdpZHRoPSIxMjAwIiBoZWlnaHQ9IjYzMCIgcng9IjE2IiBmaWxsPSIjMDkwOTBCIi8+CjxyZWN0IHg9IjQwLjUiIHk9IjQwLjUiIHdpZHRoPSI1MzUuMCIgaGVpZ2h0PSI1NDkuMCIgcng9IjgiIGZpbGw9IiMxODE4MUIiIHN0cm9rZT0iIzI3MjcyQSIgc3Ryb2tlLXdpZHRoPSIxLjMiLz4KPHJlY3QgeD0iNjI0LjUiIHk9IjQwLjUiIHdpZHRoPSI1MzUuMCIgaGVpZ2h0PSI1NDkuMCIgcng9IjgiIGZpbGw9IiMxODE4MUIiIHN0cm9rZT0iIzI3MjcyQSIgc3Ryb2tlLXdpZHRoPSIxLjMiLz4KPHBhdGggZD0iTTYwMC41LDE2IEw2MDAuNSw2MTQiIHN0cm9rZT0iIzI3MjcyQSIgc3Ryb2tlLXdpZHRoPSIxLjMiLz4KPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMzA4LjAwMCwzMTUuMDAwKSBzY2FsZSgwLjczMzI1KSB0cmFuc2xhdGUoLTIxMC40ODQsLTM1Ljk5MykiPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IiM3MTcxN0EiIG9wYWNpdHk9IjAuMDkiIGQ9Ik0tNzEuNSwtMjQ4LjMgSDQ5Mi41IFYzMTUuNyBILTcxLjUgWiBNMC4wLDAuMCBINDIxLjAgVjY3LjQgSDAuMCBaIi8+CjxnIG9wYWNpdHk9IjAuNCI+PHBhdGggZD0iTS03Ny4wMSwtMTQ4LjQ3Qy01OC4yMCwtMTgwLjgyIC0zOS43MSwtMjEzLjI3IC0yMS41NCwtMjQ1LjgyQy02LjM5LC0yMTEuNzYgOS4wOSwtMTc3Ljc4IDI0LjkwLC0xNDMuODZDLTkuMDgsLTE0NS4wNyAtNDMuMDUsLTE0Ni42MCAtNzcuMDEsLTE0OC40N1oiIGZpbGw9IiM1QTVBNjQiLz48cGF0aCBkPSJNNDQuNDQsLTI0My4yNUM3Ny43OCwtMjQyLjE4IDExMS4xMiwtMjQxLjQyIDE0NC40NiwtMjQwLjk5QzExMC42OSwtMjA4LjA5IDc2LjI3LC0xNzUuNTIgNDEuMjEsLTE0My4zMUM0Mi4yOSwtMTc2LjYyIDQzLjM2LC0yMDkuOTQgNDQuNDQsLTI0My4yNVoiIGZpbGw9IiM3NDc0N0UiLz48cGF0aCBkPSJNMjEwLjQ4LC0yNDAuNTdDMjI3LjE2LC0yMjcuMjMgMjQzLjk2LC0yMTMuOTggMjYwLjg5LC0yMDAuODFDMjYxLjA5LC0xODAuODEgMjYxLjI4LC0xNjAuODIgMjYxLjQ4LC0xNDAuODJDMjI3LjQ4LC0xNDAuNDggMTkzLjQ5LC0xNDAuNDggMTU5LjQ5LC0xNDAuODJDMTU5LjY5LC0xNjAuODIgMTU5Ljg4LC0xODAuODEgMTYwLjA4LC0yMDAuODFDMTc3LjAxLC0yMTMuOTggMTkzLjgxLC0yMjcuMjMgMjEwLjQ4LC0yNDAuNTdaIiBmaWxsPSIjOTQ5NDlEIi8+PHBhdGggZD0iTTI3Ni41MSwtMjQwLjk5QzMxMC4wNywtMjI0Ljc2IDM0My45NSwtMjA4Ljg1IDM3OC4xNCwtMTkzLjI4QzM0NS4wMiwtMTc1LjUzIDMxMS41NywtMTU4LjEwIDI3Ny43OSwtMTQxLjAwQzI3Ny4zNywtMTc0LjMzIDI3Ni45NCwtMjA3LjY2IDI3Ni41MSwtMjQwLjk5WiIgZmlsbD0iI0JDQkNDNCIvPjxwYXRoIGQ9Ik0zOTIuNTIsLTI0My44MEM0MjUuODUsLTI0NC45OCA0NTkuMTgsLTI0Ni40OSA0OTIuNDgsLTI0OC4zMkM0OTMuMjUsLTIzNC4zNCA0OTQuMDIsLTIyMC4zNiA0OTQuNzksLTIwNi4zOUM0NzUuMzIsLTIwNS4zMSA0NTUuODMsLTIwNC4zNSA0MzYuMzUsLTIwMy41MEM0MzcuMTksLTE4NC4xOSA0MzguMDQsLTE2NC44NyA0MzguODgsLTE0NS41NkM0MjQuNjEsLTE0NC45MyA0MTAuMzQsLTE0NC4zNyAzOTYuMDcsLTE0My44NkMzOTQuODksLTE3Ny4xNyAzOTMuNzEsLTIxMC40OSAzOTIuNTIsLTI0My44MFoiIGZpbGw9IiM1QTVBNjQiLz48cGF0aCBkPSJNLTc3Ljg5LC0xMzIuNTBDLTQzLjgzLC0xMzAuNjIgLTkuNzUsLTEyOS4wOCAyNC4zMywtMTI3Ljg3QzYuMTEsLTk1LjE2IC0xMi40NCwtNjIuNTUgLTMxLjMxLC0zMC4wNEMtNDcuMTYsLTY0LjEyIC02Mi42OSwtOTguMjggLTc3Ljg5LC0xMzIuNTBaIiBmaWxsPSIjOTQ5NDlEIi8+PHBhdGggZD0iTTM3LjQ1LC0yNy4zN0M1NS45MCwtNjAuMTIgNzQuMDIsLTkyLjk3IDkxLjgyLC0xMjUuOTFDMTA4LjEyLC05Mi4yMCAxMjQuNzQsLTU4LjU2IDE0MS42OCwtMjUuMDFDMTA2LjkzLC0yNS40NiA3Mi4xOSwtMjYuMjQgMzcuNDUsLTI3LjM3WiIgZmlsbD0iI0JDQkNDNCIvPjxwYXRoIGQ9Ik0xNTkuMzQsLTEyNC44MkMxOTMuNDMsLTEyNC40OCAyMjcuNTMsLTEyNC40OCAyNjEuNjMsLTEyNC44MkMyMjcuODYsLTkxLjE1IDE5My40MywtNTcuODEgMTU4LjM2LC0yNC44MkMxNTguNjksLTU4LjE1IDE1OS4wMSwtOTEuNDkgMTU5LjM0LC0xMjQuODJaIiBmaWxsPSIjNUE1QTY0Ii8+PHBhdGggZD0iTTMyOS4xNCwtMTI1LjkxQzM0Ni40OSwtMTEyLjk3IDM2My45NywtMTAwLjExIDM4MS41NywtODcuMzRDMzgyLjIyLC02Ny4zNSAzODIuODcsLTQ3LjM2IDM4My41MSwtMjcuMzdDMzQ4Ljc4LC0yNi4yNCAzMTQuMDMsLTI1LjQ2IDI3OS4yOSwtMjUuMDFDMjc5LjAzLC00NS4wMSAyNzguNzcsLTY1LjAxIDI3OC41MSwtODUuMDFDMjk1LjUyLC05OC41NiAzMTIuNDAsLTExMi4xOSAzMjkuMTQsLTEyNS45MVoiIGZpbGw9IiM3NDc0N0UiLz48cGF0aCBkPSJNMzk2LjY0LC0xMjcuODdDNDMxLjMxLC0xMTIuNDIgNDY2LjMwLC05Ny4zMiA1MDEuNjEsLTgyLjU3QzQ2OC4xNCwtNjQuMDQgNDM0LjMzLC00NS44MiA0MDAuMTksLTI3LjkzQzM5OS4wMCwtNjEuMjUgMzk3LjgyLC05NC41NiAzOTYuNjQsLTEyNy44N1oiIGZpbGw9IiM5NDk0OUQiLz48cGF0aCBkPSJNLTg0LjI2LC0xNi42N0MtNDkuNDUsLTE0Ljc2IC0xNC42MiwtMTMuMTggMjAuMjEsLTExLjk0QzE5LjAzLDIxLjM3IDE3Ljg1LDU0LjY4IDE2LjY3LDg3Ljk5Qy0xOC44Miw4Ni43MyAtNTQuMzAsODUuMTMgLTg5Ljc2LDgzLjE4Qy04Ny45Myw0OS44OSAtODYuMTAsMTYuNjEgLTg0LjI2LC0xNi42N1oiIGZpbGw9IiM1QTVBNjQiLz48cGF0aCBkPSJNMzYuOTQsLTExLjM4QzcxLjc4LC0xMC4yNSAxMDYuNjIsLTkuNDYgMTQxLjQ4LC05LjAxQzEyMy42MiwyNC4wOSAxMDUuNDQsNTcuMTEgODYuOTQsOTAuMDRDNjkuOTUsNTYuMzEgNTMuMjgsMjIuNTAgMzYuOTQsLTExLjM4WiIgZmlsbD0iIzc0NzQ3RSIvPjxwYXRoIGQ9Ik0xNTcuMjMsOTEuMTdDMTc1LjMxLDU4LjAxIDE5My4wNiwyNC43NyAyMTAuNDgsLTguNTdDMjI3LjkxLDI0Ljc3IDI0NS42Niw1OC4wMSAyNjMuNzQsOTEuMTdDMjI4LjI0LDkxLjUyIDE5Mi43Myw5MS41MiAxNTcuMjMsOTEuMTdaIiBmaWxsPSIjOTQ5NDlEIi8+PHBhdGggZD0iTTI3OS40OSwtOS4wMUMzMTQuMzQsLTkuNDYgMzQ5LjE5LC0xMC4yNSAzODQuMDMsLTExLjM4QzM1MC4yNywyMy4wNyAzMTUuODUsNTcuMTkgMjgwLjc4LDkwLjk4QzI4MC4zNSw1Ny42NSAyNzkuOTIsMjQuMzIgMjc5LjQ5LC05LjAxWiIgZmlsbD0iI0JDQkNDNCIvPjxwYXRoIGQ9Ik00NTMuMDAsLTE0LjA1QzQ3MS4wMiwtMS41MiA0ODkuMTYsMTAuOTIgNTA3LjQzLDIzLjI3QzUwOC41Myw0My4yNCA1MDkuNjMsNjMuMjEgNTEwLjczLDgzLjE4QzQ3NS4yNiw4NS4xMyA0MzkuNzksODYuNzMgNDA0LjMwLDg3Ljk5QzQwMy41OSw2OC4wMSA0MDIuODgsNDguMDIgNDAyLjE3LDI4LjAzQzQxOS4yNSwxNC4wOCA0MzYuMTksMC4wNSA0NTMuMDAsLTE0LjA1WiIgZmlsbD0iIzVBNUE2NCIvPjxwYXRoIGQ9Ik0xNi4xMCwxMDMuOThDMTQuOTIsMTM3LjMwIDEzLjc0LDE3MC42MSAxMi41NSwyMDMuOTJDLTIzLjEwLDE4NS45OCAtNTguNDEsMTY3LjY5IC05My4zOSwxNDkuMDhDLTU2LjU4LDEzNC40MSAtMjAuMDgsMTE5LjM4IDE2LjEwLDEwMy45OFoiIGZpbGw9IiM5NDk0OUQiLz48cGF0aCBkPSJNMzMuMTgsMTA0LjU2QzY4Ljc4LDEwNS43MiAxMDQuMzgsMTA2LjUyIDEzOS45OCwxMDYuOThDMTM5LjU1LDE0MC4zMSAxMzkuMTMsMTczLjY0IDEzOC43MCwyMDYuOTdDMTAyLjQ0LDIwNi41MCA2Ni4xOSwyMDUuNjggMjkuOTUsMjA0LjUxQzMxLjAzLDE3MS4xOSAzMi4xMSwxMzcuODggMzMuMTgsMTA0LjU2WiIgZmlsbD0iI0JDQkNDNCIvPjxwYXRoIGQ9Ik0xNTcuMDcsMTA3LjE3QzE5Mi42OCwxMDcuNTIgMjI4LjI5LDEwNy41MiAyNjMuODksMTA3LjE3QzI0Ni40MiwxNDAuNjggMjI4LjYxLDE3NC4xMCAyMTAuNDgsMjA3LjQzQzE5Mi4zNiwxNzQuMTAgMTc0LjU1LDE0MC42OCAxNTcuMDcsMTA3LjE3WiIgZmlsbD0iIzVBNUE2NCIvPjxwYXRoIGQ9Ik0yODIuMjcsMjA2Ljk3QzI5OS45NywxNzMuNDEgMzE3LjM0LDEzOS43NiAzMzQuMzksMTA2LjAzQzM1Mi45NCwxMzguOTUgMzcxLjgyLDE3MS43OCAzOTEuMDIsMjA0LjUxQzM1NC43OCwyMDUuNjggMzE4LjUzLDIwNi41MCAyODIuMjcsMjA2Ljk3WiIgZmlsbD0iIzc0NzQ3RSIvPjxwYXRoIGQ9Ik00MDQuODcsMTAzLjk4QzQ0MC40NiwxMDIuNzIgNDc2LjA0LDEwMS4xMSA1MTEuNjEsOTkuMTVDNDc3Ljg3LDEzNC4zOSA0NDMuNDcsMTY5LjMyIDQwOC40MiwyMDMuOTJDNDA3LjIzLDE3MC42MSA0MDYuMDUsMTM3LjMwIDQwNC44NywxMDMuOThaIiBmaWxsPSIjOTQ5NDlEIi8+PHBhdGggZD0iTS05Ny4wMSwyMTQuOThDLTc5Ljc3LDIzMi42MiAtNjIuMzYsMjUwLjE4IC00NC43OCwyNjcuNjZDLTYzLjg3LDI4My40OCAtODMuMTEsMjk5LjIwIC0xMDIuNTEsMzE0LjgzQy04NC4wMiwzMTUuODQgLTY1LjU0LDMxNi43NyAtNDcuMDQsMzE3LjYxQy0yNy44MCwzMDEuNzkgLTguNzEsMjg1Ljg4IDEwLjIxLDI2OS44OEMtNy41MywyNTIuNTcgLTI1LjExLDIzNS4xOCAtNDIuNTIsMjE3LjcxQy02MC42OSwyMTYuODkgLTc4Ljg1LDIxNS45OCAtOTcuMDEsMjE0Ljk4WiIgZmlsbD0iIzVBNUE2NCIvPjxwYXRoIGQ9Ik0xMzguNDksMjIyLjk3QzEzOC4wNiwyNTYuMzAgMTM3LjYzLDI4OS42MyAxMzcuMjAsMzIyLjk2QzEwMC40MSwzMDUuODIgNjMuOTUsMjg4LjMyIDI3LjgxLDI3MC40OEM2NS4wMiwyNTUuMDEgMTAxLjkyLDIzOS4xNyAxMzguNDksMjIyLjk3WiIgZmlsbD0iIzc0NzQ3RSIvPjxwYXRoIGQ9Ik0xNTUuOTQsMjIzLjE3QzE5Mi4zMCwyMjMuNTIgMjI4LjY3LDIyMy41MiAyNjUuMDIsMjIzLjE3QzI2NS4zNSwyNTYuNTAgMjY1LjY3LDI4OS44MyAyNjYuMDAsMzIzLjE2QzIyOC45OSwzMjMuNTIgMTkxLjk4LDMyMy41MiAxNTQuOTcsMzIzLjE2QzE1NS4yOSwyODkuODMgMTU1LjYyLDI1Ni41MCAxNTUuOTQsMjIzLjE3WiIgZmlsbD0iIzk0OTQ5RCIvPjxwYXRoIGQ9Ik0yODIuNDgsMjIyLjk3QzMxOC44NCwyMjIuNTAgMzU1LjE5LDIyMS42OCAzOTEuNTQsMjIwLjUwQzM3NC40NCwyNTQuNDEgMzU3LjAyLDI4OC4yMyAzMzkuMjcsMzIxLjk4QzMyMC4wMiwyODkuMDcgMzAxLjA5LDI1Ni4wNyAyODIuNDgsMjIyLjk3WiIgZmlsbD0iI0JDQkNDNCIvPjxwYXRoIGQ9Ik00MTIuNTMsMzE5Ljg1QzQyOS44NCwyODUuODggNDQ2LjgzLDI1MS44MyA0NjMuNDksMjE3LjcxQzQ4My4xNiwyNTAuMTkgNTAzLjE2LDI4Mi41NiA1MjMuNDgsMzE0LjgzQzQ4Ni41MSwzMTYuODYgNDQ5LjUyLDMxOC41MyA0MTIuNTMsMzE5Ljg1WiIgZmlsbD0iIzVBNUE2NCIvPjwvZz48ZyBjbGlwLXBhdGg9InVybCgjZGllLWwtZGFyaykiPjxwYXRoIGQ9Ik0tNzcuMDEsLTE0OC40N0MtNTguMjAsLTE4MC44MiAtMzkuNzEsLTIxMy4yNyAtMjEuNTQsLTI0NS44MkMtNi4zOSwtMjExLjc2IDkuMDksLTE3Ny43OCAyNC45MCwtMTQzLjg2Qy05LjA4LC0xNDUuMDcgLTQzLjA1LC0xNDYuNjAgLTc3LjAxLC0xNDguNDdaIiBmaWxsPSIjNUE1QTY0Ii8+PHBhdGggZD0iTTQ0LjQ0LC0yNDMuMjVDNzcuNzgsLTI0Mi4xOCAxMTEuMTIsLTI0MS40MiAxNDQuNDYsLTI0MC45OUMxMTAuNjksLTIwOC4wOSA3Ni4yNywtMTc1LjUyIDQxLjIxLC0xNDMuMzFDNDIuMjksLTE3Ni42MiA0My4zNiwtMjA5Ljk0IDQ0LjQ0LC0yNDMuMjVaIiBmaWxsPSIjNzQ3NDdFIi8+PHBhdGggZD0iTTIxMC40OCwtMjQwLjU3QzIyNy4xNiwtMjI3LjIzIDI0My45NiwtMjEzLjk4IDI2MC44OSwtMjAwLjgxQzI2MS4wOSwtMTgwLjgxIDI2MS4yOCwtMTYwLjgyIDI2MS40OCwtMTQwLjgyQzIyNy40OCwtMTQwLjQ4IDE5My40OSwtMTQwLjQ4IDE1OS40OSwtMTQwLjgyQzE1OS42OSwtMTYwLjgyIDE1OS44OCwtMTgwLjgxIDE2MC4wOCwtMjAwLjgxQzE3Ny4wMSwtMjEzLjk4IDE5My44MSwtMjI3LjIzIDIxMC40OCwtMjQwLjU3WiIgZmlsbD0iIzk0OTQ5RCIvPjxwYXRoIGQ9Ik0yNzYuNTEsLTI0MC45OUMzMTAuMDcsLTIyNC43NiAzNDMuOTUsLTIwOC44NSAzNzguMTQsLTE5My4yOEMzNDUuMDIsLTE3NS41MyAzMTEuNTcsLTE1OC4xMCAyNzcuNzksLTE0MS4wMEMyNzcuMzcsLTE3NC4zMyAyNzYuOTQsLTIwNy42NiAyNzYuNTEsLTI0MC45OVoiIGZpbGw9IiNCQ0JDQzQiLz48cGF0aCBkPSJNMzkyLjUyLC0yNDMuODBDNDI1Ljg1LC0yNDQuOTggNDU5LjE4LC0yNDYuNDkgNDkyLjQ4LC0yNDguMzJDNDkzLjI1LC0yMzQuMzQgNDk0LjAyLC0yMjAuMzYgNDk0Ljc5LC0yMDYuMzlDNDc1LjMyLC0yMDUuMzEgNDU1LjgzLC0yMDQuMzUgNDM2LjM1LC0yMDMuNTBDNDM3LjE5LC0xODQuMTkgNDM4LjA0LC0xNjQuODcgNDM4Ljg4LC0xNDUuNTZDNDI0LjYxLC0xNDQuOTMgNDEwLjM0LC0xNDQuMzcgMzk2LjA3LC0xNDMuODZDMzk0Ljg5LC0xNzcuMTcgMzkzLjcxLC0yMTAuNDkgMzkyLjUyLC0yNDMuODBaIiBmaWxsPSIjNUE1QTY0Ii8+PHBhdGggZD0iTS03Ny44OSwtMTMyLjUwQy00My44MywtMTMwLjYyIC05Ljc1LC0xMjkuMDggMjQuMzMsLTEyNy44N0M2LjExLC05NS4xNiAtMTIuNDQsLTYyLjU1IC0zMS4zMSwtMzAuMDRDLTQ3LjE2LC02NC4xMiAtNjIuNjksLTk4LjI4IC03Ny44OSwtMTMyLjUwWiIgZmlsbD0iIzk0OTQ5RCIvPjxwYXRoIGQ9Ik0zNy40NSwtMjcuMzdDNTUuOTAsLTYwLjEyIDc0LjAyLC05Mi45NyA5MS44MiwtMTI1LjkxQzEwOC4xMiwtOTIuMjAgMTI0Ljc0LC01OC41NiAxNDEuNjgsLTI1LjAxQzEwNi45MywtMjUuNDYgNzIuMTksLTI2LjI0IDM3LjQ1LC0yNy4zN1oiIGZpbGw9IiNCQ0JDQzQiLz48cGF0aCBkPSJNMTU5LjM0LC0xMjQuODJDMTkzLjQzLC0xMjQuNDggMjI3LjUzLC0xMjQuNDggMjYxLjYzLC0xMjQuODJDMjI3Ljg2LC05MS4xNSAxOTMuNDMsLTU3LjgxIDE1OC4zNiwtMjQuODJDMTU4LjY5LC01OC4xNSAxNTkuMDEsLTkxLjQ5IDE1OS4zNCwtMTI0LjgyWiIgZmlsbD0iIzVBNUE2NCIvPjxwYXRoIGQ9Ik0zMjkuMTQsLTEyNS45MUMzNDYuNDksLTExMi45NyAzNjMuOTcsLTEwMC4xMSAzODEuNTcsLTg3LjM0QzM4Mi4yMiwtNjcuMzUgMzgyLjg3LC00Ny4zNiAzODMuNTEsLTI3LjM3QzM0OC43OCwtMjYuMjQgMzE0LjAzLC0yNS40NiAyNzkuMjksLTI1LjAxQzI3OS4wMywtNDUuMDEgMjc4Ljc3LC02NS4wMSAyNzguNTEsLTg1LjAxQzI5NS41MiwtOTguNTYgMzEyLjQwLC0xMTIuMTkgMzI5LjE0LC0xMjUuOTFaIiBmaWxsPSIjNzQ3NDdFIi8+PHBhdGggZD0iTTM5Ni42NCwtMTI3Ljg3QzQzMS4zMSwtMTEyLjQyIDQ2Ni4zMCwtOTcuMzIgNTAxLjYxLC04Mi41N0M0NjguMTQsLTY0LjA0IDQzNC4zMywtNDUuODIgNDAwLjE5LC0yNy45M0MzOTkuMDAsLTYxLjI1IDM5Ny44MiwtOTQuNTYgMzk2LjY0LC0xMjcuODdaIiBmaWxsPSIjOTQ5NDlEIi8+PHBhdGggZD0iTS04NC4yNiwtMTYuNjdDLTQ5LjQ1LC0xNC43NiAtMTQuNjIsLTEzLjE4IDIwLjIxLC0xMS45NEMxOS4wMywyMS4zNyAxNy44NSw1NC42OCAxNi42Nyw4Ny45OUMtMTguODIsODYuNzMgLTU0LjMwLDg1LjEzIC04OS43Niw4My4xOEMtODcuOTMsNDkuODkgLTg2LjEwLDE2LjYxIC04NC4yNiwtMTYuNjdaIiBmaWxsPSIjNUE1QTY0Ii8+PHBhdGggZD0iTTM2Ljk0LC0xMS4zOEM3MS43OCwtMTAuMjUgMTA2LjYyLC05LjQ2IDE0MS40OCwtOS4wMUMxMjMuNjIsMjQuMDkgMTA1LjQ0LDU3LjExIDg2Ljk0LDkwLjA0QzY5Ljk1LDU2LjMxIDUzLjI4LDIyLjUwIDM2Ljk0LC0xMS4zOFoiIGZpbGw9IiM3NDc0N0UiLz48cGF0aCBkPSJNMTU3LjIzLDkxLjE3QzE3NS4zMSw1OC4wMSAxOTMuMDYsMjQuNzcgMjEwLjQ4LC04LjU3QzIyNy45MSwyNC43NyAyNDUuNjYsNTguMDEgMjYzLjc0LDkxLjE3QzIyOC4yNCw5MS41MiAxOTIuNzMsOTEuNTIgMTU3LjIzLDkxLjE3WiIgZmlsbD0iIzk0OTQ5RCIvPjxwYXRoIGQ9Ik0yNzkuNDksLTkuMDFDMzE0LjM0LC05LjQ2IDM0OS4xOSwtMTAuMjUgMzg0LjAzLC0xMS4zOEMzNTAuMjcsMjMuMDcgMzE1Ljg1LDU3LjE5IDI4MC43OCw5MC45OEMyODAuMzUsNTcuNjUgMjc5LjkyLDI0LjMyIDI3OS40OSwtOS4wMVoiIGZpbGw9IiNCQ0JDQzQiLz48cGF0aCBkPSJNNDUzLjAwLC0xNC4wNUM0NzEuMDIsLTEuNTIgNDg5LjE2LDEwLjkyIDUwNy40MywyMy4yN0M1MDguNTMsNDMuMjQgNTA5LjYzLDYzLjIxIDUxMC43Myw4My4xOEM0NzUuMjYsODUuMTMgNDM5Ljc5LDg2LjczIDQwNC4zMCw4Ny45OUM0MDMuNTksNjguMDEgNDAyLjg4LDQ4LjAyIDQwMi4xNywyOC4wM0M0MTkuMjUsMTQuMDggNDM2LjE5LDAuMDUgNDUzLjAwLC0xNC4wNVoiIGZpbGw9IiM1QTVBNjQiLz48cGF0aCBkPSJNMTYuMTAsMTAzLjk4QzE0LjkyLDEzNy4zMCAxMy43NCwxNzAuNjEgMTIuNTUsMjAzLjkyQy0yMy4xMCwxODUuOTggLTU4LjQxLDE2Ny42OSAtOTMuMzksMTQ5LjA4Qy01Ni41OCwxMzQuNDEgLTIwLjA4LDExOS4zOCAxNi4xMCwxMDMuOThaIiBmaWxsPSIjOTQ5NDlEIi8+PHBhdGggZD0iTTMzLjE4LDEwNC41NkM2OC43OCwxMDUuNzIgMTA0LjM4LDEwNi41MiAxMzkuOTgsMTA2Ljk4QzEzOS41NSwxNDAuMzEgMTM5LjEzLDE3My42NCAxMzguNzAsMjA2Ljk3QzEwMi40NCwyMDYuNTAgNjYuMTksMjA1LjY4IDI5Ljk1LDIwNC41MUMzMS4wMywxNzEuMTkgMzIuMTEsMTM3Ljg4IDMzLjE4LDEwNC41NloiIGZpbGw9IiNCQ0JDQzQiLz48cGF0aCBkPSJNMTU3LjA3LDEwNy4xN0MxOTIuNjgsMTA3LjUyIDIyOC4yOSwxMDcuNTIgMjYzLjg5LDEwNy4xN0MyNDYuNDIsMTQwLjY4IDIyOC42MSwxNzQuMTAgMjEwLjQ4LDIwNy40M0MxOTIuMzYsMTc0LjEwIDE3NC41NSwxNDAuNjggMTU3LjA3LDEwNy4xN1oiIGZpbGw9IiM1QTVBNjQiLz48cGF0aCBkPSJNMjgyLjI3LDIwNi45N0MyOTkuOTcsMTczLjQxIDMxNy4zNCwxMzkuNzYgMzM0LjM5LDEwNi4wM0MzNTIuOTQsMTM4Ljk1IDM3MS44MiwxNzEuNzggMzkxLjAyLDIwNC41MUMzNTQuNzgsMjA1LjY4IDMxOC41MywyMDYuNTAgMjgyLjI3LDIwNi45N1oiIGZpbGw9IiM3NDc0N0UiLz48cGF0aCBkPSJNNDA0Ljg3LDEwMy45OEM0NDAuNDYsMTAyLjcyIDQ3Ni4wNCwxMDEuMTEgNTExLjYxLDk5LjE1QzQ3Ny44NywxMzQuMzkgNDQzLjQ3LDE2OS4zMiA0MDguNDIsMjAzLjkyQzQwNy4yMywxNzAuNjEgNDA2LjA1LDEzNy4zMCA0MDQuODcsMTAzLjk4WiIgZmlsbD0iIzk0OTQ5RCIvPjxwYXRoIGQ9Ik0tOTcuMDEsMjE0Ljk4Qy03OS43NywyMzIuNjIgLTYyLjM2LDI1MC4xOCAtNDQuNzgsMjY3LjY2Qy02My44NywyODMuNDggLTgzLjExLDI5OS4yMCAtMTAyLjUxLDMxNC44M0MtODQuMDIsMzE1Ljg0IC02NS41NCwzMTYuNzcgLTQ3LjA0LDMxNy42MUMtMjcuODAsMzAxLjc5IC04LjcxLDI4NS44OCAxMC4yMSwyNjkuODhDLTcuNTMsMjUyLjU3IC0yNS4xMSwyMzUuMTggLTQyLjUyLDIxNy43MUMtNjAuNjksMjE2Ljg5IC03OC44NSwyMTUuOTggLTk3LjAxLDIxNC45OFoiIGZpbGw9IiM1QTVBNjQiLz48cGF0aCBkPSJNMTM4LjQ5LDIyMi45N0MxMzguMDYsMjU2LjMwIDEzNy42MywyODkuNjMgMTM3LjIwLDMyMi45NkMxMDAuNDEsMzA1LjgyIDYzLjk1LDI4OC4zMiAyNy44MSwyNzAuNDhDNjUuMDIsMjU1LjAxIDEwMS45MiwyMzkuMTcgMTM4LjQ5LDIyMi45N1oiIGZpbGw9IiM3NDc0N0UiLz48cGF0aCBkPSJNMTU1Ljk0LDIyMy4xN0MxOTIuMzAsMjIzLjUyIDIyOC42NywyMjMuNTIgMjY1LjAyLDIyMy4xN0MyNjUuMzUsMjU2LjUwIDI2NS42NywyODkuODMgMjY2LjAwLDMyMy4xNkMyMjguOTksMzIzLjUyIDE5MS45OCwzMjMuNTIgMTU0Ljk3LDMyMy4xNkMxNTUuMjksMjg5LjgzIDE1NS42MiwyNTYuNTAgMTU1Ljk0LDIyMy4xN1oiIGZpbGw9IiM5NDk0OUQiLz48cGF0aCBkPSJNMjgyLjQ4LDIyMi45N0MzMTguODQsMjIyLjUwIDM1NS4xOSwyMjEuNjggMzkxLjU0LDIyMC41MEMzNzQuNDQsMjU0LjQxIDM1Ny4wMiwyODguMjMgMzM5LjI3LDMyMS45OEMzMjAuMDIsMjg5LjA3IDMwMS4wOSwyNTYuMDcgMjgyLjQ4LDIyMi45N1oiIGZpbGw9IiNCQ0JDQzQiLz48cGF0aCBkPSJNNDEyLjUzLDMxOS44NUM0MjkuODQsMjg1Ljg4IDQ0Ni44MywyNTEuODMgNDYzLjQ5LDIxNy43MUM0ODMuMTYsMjUwLjE5IDUwMy4xNiwyODIuNTYgNTIzLjQ4LDMxNC44M0M0ODYuNTEsMzE2Ljg2IDQ0OS41MiwzMTguNTMgNDEyLjUzLDMxOS44NVoiIGZpbGw9IiM1QTVBNjQiLz48L2c+CjxyZWN0IHg9Ii03MS41IiB5PSItMjQ4LjMiIHdpZHRoPSI1NjQuMCIgaGVpZ2h0PSI1NjQuMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNzE3MTdBIiBzdHJva2Utd2lkdGg9IjEuNzczIi8+PGcgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNzE3MTdBIiBzdHJva2Utd2lkdGg9IjQuMDkxIiBzdHJva2UtbGluZWNhcD0iYnV0dCIgc3Ryb2tlLWxpbmVqb2luPSJtaXRlciI+PHBhdGggZD0iTS03MS41LC05OC4zIEwtNzEuNSwtMjQ4LjMgTDc4LjUsLTI0OC4zIi8+PHBhdGggZD0iTTQ5Mi41LDE2NS43IEw0OTIuNSwzMTUuNyBMMzQyLjUsMzE1LjciLz48L2c+CjxwYXRoIGQ9Ik00MjcuNzEsNjQuNTJDMjgzLjQyLDc4LjYzIDEzNy41NSw3OC42MyAtNi43NSw2NC41MkMtMTAuMjUsNjQuMTggLTEyLjgxLDYxLjI2IC0xMi40Niw1OC4wMkMtMTAuNjksNDEuNjUgLTguOTMsMjUuMjcgLTcuMTgsOC44OUMtNi44Myw1LjY1IC0zLjgwLDMuMzAgLTAuMzksMy42M0MxMzkuNjksMTcuMzIgMjgxLjI4LDE3LjMyIDQyMS4zNiwzLjYzQzQyNC43NiwzLjMwIDQyNy44MCw1LjY1IDQyOC4xNSw4Ljg5QzQyOS45MCwyNS4yNyA0MzEuNjYsNDEuNjUgNDMzLjQzLDU4LjAyQzQzMy43OCw2MS4yNiA0MzEuMjIsNjQuMTggNDI3LjcxLDY0LjUyQzQyNy43MSw2NC41MiA0MjcuNzEsNjQuNTIgNDI3LjcxLDY0LjUyWiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRTRFNEU3IiBzdHJva2Utd2lkdGg9IjIuODY0IiBzdHJva2UtZGFzaGFycmF5PSIxMi4yNyA4LjE4IiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CjwvZz4KPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoODkyLjAwMCwzMTUuMDAwKSBzY2FsZSgwLjczMzI1KSB0cmFuc2xhdGUoLTIxMC40ODQsLTM1Ljk5MykiPgo8ZyBvcGFjaXR5PSIwLjQiPjxwYXRoIGQ9Ik0tNjcuNTAsLTE1MS40NUMtNTEuMDcsLTE4NC43OCAtMzQuNjQsLTIxOC4xMSAtMTguMjEsLTI1MS40NUMtMS43OCwtMjE4LjExIDE0LjY1LC0xODQuNzggMzEuMDgsLTE1MS40NUMtMS43OCwtMTUxLjQ1IC0zNC42NCwtMTUxLjQ1IC02Ny41MCwtMTUxLjQ1WiIgZmlsbD0iIzVBNUE2NCIvPjxwYXRoIGQ9Ik00Ni44NSwtMjUxLjQ1Qzc5LjcxLC0yNTEuNDUgMTEyLjU3LC0yNTEuNDUgMTQ1LjQyLC0yNTEuNDVDMTEyLjU3LC0yMTguMTEgNzkuNzEsLTE4NC43OCA0Ni44NSwtMTUxLjQ1QzQ2Ljg1LC0xODQuNzggNDYuODUsLTIxOC4xMSA0Ni44NSwtMjUxLjQ1WiIgZmlsbD0iIzc0NzQ3RSIvPjxwYXRoIGQ9Ik0yMTAuNDgsLTI1MS40NUMyMjYuOTEsLTIzOC4xMSAyNDMuMzQsLTIyNC43OCAyNTkuNzcsLTIxMS40NUMyNTkuNzcsLTE5MS40NSAyNTkuNzcsLTE3MS40NSAyNTkuNzcsLTE1MS40NUMyMjYuOTEsLTE1MS40NSAxOTQuMDYsLTE1MS40NSAxNjEuMjAsLTE1MS40NUMxNjEuMjAsLTE3MS40NSAxNjEuMjAsLTE5MS40NSAxNjEuMjAsLTIxMS40NUMxNzcuNjMsLTIyNC43OCAxOTQuMDYsLTIzOC4xMSAyMTAuNDgsLTI1MS40NVoiIGZpbGw9IiM5NDk0OUQiLz48cGF0aCBkPSJNMjc1LjU0LC0yNTEuNDVDMzA4LjQwLC0yMzQuNzggMzQxLjI2LC0yMTguMTEgMzc0LjEyLC0yMDEuNDVDMzQxLjI2LC0xODQuNzggMzA4LjQwLC0xNjguMTEgMjc1LjU0LC0xNTEuNDVDMjc1LjU0LC0xODQuNzggMjc1LjU0LC0yMTguMTEgMjc1LjU0LC0yNTEuNDVaIiBmaWxsPSIjQkNCQ0M0Ii8+PHBhdGggZD0iTTM4OS44OSwtMjUxLjQ1QzQyMi43NSwtMjUxLjQ1IDQ1NS42MSwtMjUxLjQ1IDQ4OC40NywtMjUxLjQ1QzQ4OC40NywtMjM3LjQ1IDQ4OC40NywtMjIzLjQ1IDQ4OC40NywtMjA5LjQ1QzQ2OS40MSwtMjA5LjQ1IDQ1MC4zNSwtMjA5LjQ1IDQzMS4yOSwtMjA5LjQ1QzQzMS4yOSwtMTkwLjExIDQzMS4yOSwtMTcwLjc4IDQzMS4yOSwtMTUxLjQ1QzQxNy40OSwtMTUxLjQ1IDQwMy42OSwtMTUxLjQ1IDM4OS44OSwtMTUxLjQ1QzM4OS44OSwtMTg0Ljc4IDM4OS44OSwtMjE4LjExIDM4OS44OSwtMjUxLjQ1WiIgZmlsbD0iIzVBNUE2NCIvPjxwYXRoIGQ9Ik0tNjcuNTAsLTEzNS40NUMtMzQuNjQsLTEzNS40NSAtMS43NywtMTM1LjQ1IDMxLjA5LC0xMzUuNDRDMjIuOTksLTExOC43NSAxNS44NiwtMTAxLjg2IDguMjYsLTg1LjMyQzAuNjYsLTY4Ljc4IC03LjYzLC01Mi42MyAtMTYuNTMsLTM2LjUyQy0yNC4wNiwtNTMuNDkgLTMyLjI3LC03MC4wOSAtNDEuMDUsLTg2LjQyQy00OS44NCwtMTAyLjc1IC01OS4yNCwtMTE4LjgwIC02Ny41MCwtMTM1LjQ1WiIgZmlsbD0iIzk0OTQ5RCIvPjxwYXRoIGQ9Ik00OC4xNCwtMzMuMzNDNTYuODQsLTQ5Ljg1IDY0Ljk1LC02Ni44NyA3Mi43MywtODQuMDlDODAuNTEsLTEwMS4zMSA4OC4wMSwtMTE4LjY5IDk2LjE0LC0xMzUuNDRDMTA0LjQzLC0xMTguNjkgMTEzLjIwLC0xMDEuMjEgMTIxLjU3LC04My40N0MxMjkuOTUsLTY1Ljc0IDEzOC4wMCwtNDcuNzYgMTQ1LjkzLC0zMC40N0MxMTMuMzIsLTMxLjAxIDgwLjczLC0zMS45NyA0OC4xNCwtMzMuMzNaIiBmaWxsPSIjQkNCQ0M0Ii8+PHBhdGggZD0iTTE2MS4yMCwtMTM1LjQ0QzE5NC4wNiwtMTM1LjQ0IDIyNi45MSwtMTM1LjQ0IDI1OS43NywtMTM1LjQ0QzI0My4zMSwtMTE4LjY2IDIyNi43NywtMTAwLjkyIDIxMC40OCwtODMuMDNDMTk0LjIwLC02NS4xNSAxNzguMDUsLTQ3LjIyIDE2MS41OCwtMzAuMjRDMTYxLjkxLC02NC42MCAxNjEuMjcsLTEwMS44OCAxNjEuMjAsLTEzNS40NFoiIGZpbGw9IiM1QTVBNjQiLz48cGF0aCBkPSJNMzI0LjgzLC0xMzUuNDRDMzQxLjE5LC0xMjIuMDQgMzU3LjA5LC0xMDguMjUgMzcyLjk2LC05NC43OEMzNzIuMzAsLTc0LjI1IDM3Mi4xNiwtNTMuNTcgMzcyLjgzLC0zMy4zM0MzNDAuMjQsLTMxLjk2IDMwNy42NCwtMzEuMDIgMjc1LjA0LC0zMC40N0MyNzQuNzgsLTUxLjA2IDI3NC44MywtNzIuNjcgMjc1LjA5LC05My45MEMyOTEuNTcsLTEwOC4xNCAzMDguMzQsLTEyMi4wNCAzMjQuODMsLTEzNS40NFoiIGZpbGw9IiM3NDc0N0UiLz48cGF0aCBkPSJNMzg5Ljg4LC0xMzUuNDRDNDIyLjYyLC0xMTguNzUgNDU0LjMwLC0xMDIuMjMgNDg2Ljc2LC04Ni44OUM0NTMuMjAsLTcwLjQzIDQyMC40NCwtNTIuMzEgMzg4LjQ2LC0zNC4wMkMzODcuODYsLTUwLjgxIDM4Ny44MiwtNjcuODEgMzg4LjI5LC04NC44MEMzODguNzYsLTEwMS43OCAzODkuNzYsLTExOC43NSAzODkuODgsLTEzNS40NFoiIGZpbGw9IiM5NDk0OUQiLz48cGF0aCBkPSJNLTY2LjU4LC0yMy4yNUMtMzMuNzEsLTIxLjYxIC0wLjg4LC0xOS41NCAzMS44MywtMTcuOTdDMzAuMjYsMTUuMzMgMjguNzAsNDguNjMgMjcuMTQsODEuOTJDLTYuNDIsODAuMzAgLTM5Ljg5LDc4LjE5IC03My4wNyw3Ni41M0MtNzIuNDUsNTkuNzEgLTcxLjA3LDQzLjE5IC02OS44NywyNi41N0MtNjguNjcsOS45NCAtNjcuNDMsLTYuNzcgLTY2LjU4LC0yMy4yNVoiIGZpbGw9IiM1QTVBNjQiLz48cGF0aCBkPSJNNDcuNTIsLTE3LjI0QzgwLjIzLC0xNS44MSAxMTIuOTUsLTE0Ljc5IDE0NS42OCwtMTQuMjNDMTI4Ljc1LDE4LjgyIDExMS4zOSw1MS43NSA5My42MSw4NC41NEM3Ny44MSw1MC43MiA2Mi40NSwxNi43OCA0Ny41MiwtMTcuMjRaIiBmaWxsPSIjNzQ3NDdFIi8+PHBhdGggZD0iTTE2MC4xMCw4Ni4wMUMxNzcuMzIsNTIuOTEgMTk0LjEyLDE5LjY4IDIxMC40OCwtMTMuNjZDMjI2Ljg1LDE5LjY3IDI0My42NSw1Mi45MSAyNjAuODcsODYuMDFDMjI3LjI4LDg2LjQ2IDE5My42OSw4Ni40NSAxNjAuMTAsODYuMDFaIiBmaWxsPSIjOTQ5NDlEIi8+PHBhdGggZD0iTTI3NS4yOSwtMTQuMjNDMzA4LjAyLC0xNC44MCAzNDAuNzQsLTE1LjgwIDM3My40NCwtMTcuMjRDMzQyLjE2LDE3LjUwIDMxMC4wMSw1MS44NSAyNzYuOTksODUuNzZDMjc2LjQyLDUyLjQ0IDI3NS44NSwxOS4xMCAyNzUuMjksLTE0LjIzWiIgZmlsbD0iI0JDQkNDNCIvPjxwYXRoIGQ9Ik00MzguMjgsLTIwLjYwQzQ1NS40MiwtOC4yMSA0NzIuNjYsNC4xNSA0OTAuMTIsMTYuNTlDNDkxLjU2LDM2LjU0IDQ5My4yOSw1Ni4zNCA0OTQuMDQsNzYuNTNDNDYwLjg2LDc4LjE5IDQyNy4zOSw4MC4zMCAzOTMuODMsODEuOTJDMzkyLjg5LDYxLjk0IDM5MS45NSw0MS45NiAzOTEuMDIsMjEuOTlDNDA2LjkyLDcuODcgNDIyLjU4LC02LjM4IDQzOC4yOCwtMjAuNjBaIiBmaWxsPSIjNUE1QTY0Ii8+PHBhdGggZD0iTTI2LjYxLDk3Ljg0QzI2LjM0LDExNC4zNSAyNi45OSwxMzAuNzAgMjguMTUsMTQ3LjA5QzI5LjMwLDE2My40OCAzMC45NCwxNzkuOTAgMzEuMDcsMTk2LjU1Qy0xLjkyLDE3OS45MCAtMzYuNzYsMTYzLjAxIC03MS4wMSwxNDQuOTVDLTU1LjQwLDEzNi40OSAtMzkuNTYsMTI4LjM0IC0yMy4zNSwxMjAuNTVDLTcuMTMsMTEyLjc1IDkuNjUsMTA1LjMyIDI2LjYxLDk3Ljg0WiIgZmlsbD0iIzk0OTQ5RCIvPjxwYXRoIGQ9Ik00Mi43Nyw5OC41NUM3Ni40Myw5OS45NiAxMTAuMTEsMTAwLjk1IDE0My43OSwxMDEuNTFDMTQzLjU5LDEzMy44MSAxNDUuMzMsMTYzLjM3IDE0NS40MiwxOTYuNTZDMTEyLjU2LDE5Ni41NiA3OS43MCwxOTYuNTYgNDYuODQsMTk2LjU2QzQ2LjczLDE3OS45MiA0NS4yMywxNjMuNjQgNDQuMTcsMTQ3LjQxQzQzLjEyLDEzMS4xNyA0Mi41MiwxMTQuOTkgNDIuNzcsOTguNTVaIiBmaWxsPSIjQkNCQ0M0Ii8+PHBhdGggZD0iTTE1OS45NiwxMDEuNzVDMTkzLjY0LDEwMi4xNyAyMjcuMzMsMTAyLjE4IDI2MS4wMSwxMDEuNzVDMjQ0LjMyLDEzNC4yMSAyMjYuOTEsMTYzLjM4IDIxMC40OCwxOTYuNTZDMTk0LjA1LDE2My4zOCAxNzYuNjUsMTM0LjIxIDE1OS45NiwxMDEuNzVaIiBmaWxsPSIjNUE1QTY0Ii8+PHBhdGggZD0iTTI3NS41NSwxOTYuNTZDMjkyLjA3LDE2My4zNyAzMTEuMjAsMTMzLjM3IDMyNy43MCwxMDAuMzVDMzM2LjI5LDExNi4zNiAzNDQuMzAsMTMxLjk2IDM1MS43NSwxNDcuODRDMzU5LjIwLDE2My43MiAzNjYuMDMsMTc5LjkyIDM3NC4xMywxOTYuNTZDMzQxLjI3LDE5Ni41NiAzMDguNDEsMTk2LjU2IDI3NS41NSwxOTYuNTZaIiBmaWxsPSIjNzQ3NDdFIi8+PHBhdGggZD0iTTM5NC4zNiw5Ny44NEM0MjguMDEsOTYuMjggNDYxLjM4LDk0LjI4IDQ5NC40MSw5Mi44MUM0NzcuOTgsMTEwLjY0IDQ2MC41NywxMjguNjMgNDQyLjY4LDE0NS45NkM0MjQuNzgsMTYzLjI5IDQwNi40NiwxNzkuOTAgMzg5LjkwLDE5Ni41NUMzOTAuMDMsMTc5LjkwIDM5MS42NywxNjMuNDggMzkyLjgyLDE0Ny4wOUMzOTMuOTgsMTMwLjcwIDM5NC42MywxMTQuMzUgMzk0LjM2LDk3Ljg0WiIgZmlsbD0iIzk0OTQ5RCIvPjxwYXRoIGQ9Ik0tNjcuNTAsMjEyLjU1Qy01MS4wNywyMjkuMjIgLTM0LjY0LDI0NS44OSAtMTguMjEsMjYyLjU1Qy0zNC42NCwyNzkuMjIgLTUxLjA3LDI5NS44OSAtNjcuNTAsMzEyLjU1Qy01MS4wNywzMTIuNTUgLTM0LjY0LDMxMi41NSAtMTguMjEsMzEyLjU1Qy0xLjc4LDI5NS44OSAxNC42NSwyNzkuMjIgMzEuMDgsMjYyLjU1QzE0LjY1LDI0NS44OSAtMS43OCwyMjkuMjIgLTE4LjIxLDIxMi41NUMtMzQuNjQsMjEyLjU1IC01MS4wNywyMTIuNTUgLTY3LjUwLDIxMi41NVoiIGZpbGw9IiM1QTVBNjQiLz48cGF0aCBkPSJNMTQ1LjQyLDIxMi41NUMxNDUuNDIsMjQ1Ljg5IDE0NS40MiwyNzkuMjIgMTQ1LjQyLDMxMi41NUMxMTIuNTcsMjk1Ljg5IDc5LjcxLDI3OS4yMiA0Ni44NSwyNjIuNTVDNzkuNzEsMjQ1Ljg5IDExMi41NywyMjkuMjIgMTQ1LjQyLDIxMi41NVoiIGZpbGw9IiM3NDc0N0UiLz48cGF0aCBkPSJNMTYxLjIwLDIxMi41NUMxOTQuMDYsMjEyLjU1IDIyNi45MSwyMTIuNTUgMjU5Ljc3LDIxMi41NUMyNTkuNzcsMjQ1Ljg5IDI1OS43NywyNzkuMjIgMjU5Ljc3LDMxMi41NUMyMjYuOTEsMzEyLjU1IDE5NC4wNiwzMTIuNTUgMTYxLjIwLDMxMi41NUMxNjEuMjAsMjc5LjIyIDE2MS4yMCwyNDUuODkgMTYxLjIwLDIxMi41NVoiIGZpbGw9IiM5NDk0OUQiLz48cGF0aCBkPSJNMjc1LjU0LDIxMi41NUMzMDguNDAsMjEyLjU1IDM0MS4yNiwyMTIuNTUgMzc0LjEyLDIxMi41NUMzNTcuNjksMjQ1Ljg5IDM0MS4yNiwyNzkuMjIgMzI0LjgzLDMxMi41NUMzMDguNDAsMjc5LjIyIDI5MS45NywyNDUuODkgMjc1LjU0LDIxMi41NVoiIGZpbGw9IiNCQ0JDQzQiLz48cGF0aCBkPSJNMzg5Ljg5LDMxMi41NUM0MDYuMzIsMjc5LjIyIDQyMi43NSwyNDUuODkgNDM5LjE4LDIxMi41NUM0NTUuNjEsMjQ1Ljg5IDQ3Mi4wNCwyNzkuMjIgNDg4LjQ3LDMxMi41NUM0NTUuNjEsMzEyLjU1IDQyMi43NSwzMTIuNTUgMzg5Ljg5LDMxMi41NVoiIGZpbGw9IiM1QTVBNjQiLz48L2c+PGcgY2xpcC1wYXRoPSJ1cmwoI2RpZS1yLWRhcmspIj48cGF0aCBkPSJNLTY3LjUwLC0xNTEuNDVDLTUxLjA3LC0xODQuNzggLTM0LjY0LC0yMTguMTEgLTE4LjIxLC0yNTEuNDVDLTEuNzgsLTIxOC4xMSAxNC42NSwtMTg0Ljc4IDMxLjA4LC0xNTEuNDVDLTEuNzgsLTE1MS40NSAtMzQuNjQsLTE1MS40NSAtNjcuNTAsLTE1MS40NVoiIGZpbGw9IiM1QTVBNjQiLz48cGF0aCBkPSJNNDYuODUsLTI1MS40NUM3OS43MSwtMjUxLjQ1IDExMi41NywtMjUxLjQ1IDE0NS40MiwtMjUxLjQ1QzExMi41NywtMjE4LjExIDc5LjcxLC0xODQuNzggNDYuODUsLTE1MS40NUM0Ni44NSwtMTg0Ljc4IDQ2Ljg1LC0yMTguMTEgNDYuODUsLTI1MS40NVoiIGZpbGw9IiM3NDc0N0UiLz48cGF0aCBkPSJNMjEwLjQ4LC0yNTEuNDVDMjI2LjkxLC0yMzguMTEgMjQzLjM0LC0yMjQuNzggMjU5Ljc3LC0yMTEuNDVDMjU5Ljc3LC0xOTEuNDUgMjU5Ljc3LC0xNzEuNDUgMjU5Ljc3LC0xNTEuNDVDMjI2LjkxLC0xNTEuNDUgMTk0LjA2LC0xNTEuNDUgMTYxLjIwLC0xNTEuNDVDMTYxLjIwLC0xNzEuNDUgMTYxLjIwLC0xOTEuNDUgMTYxLjIwLC0yMTEuNDVDMTc3LjYzLC0yMjQuNzggMTk0LjA2LC0yMzguMTEgMjEwLjQ4LC0yNTEuNDVaIiBmaWxsPSIjOTQ5NDlEIi8+PHBhdGggZD0iTTI3NS41NCwtMjUxLjQ1QzMwOC40MCwtMjM0Ljc4IDM0MS4yNiwtMjE4LjExIDM3NC4xMiwtMjAxLjQ1QzM0MS4yNiwtMTg0Ljc4IDMwOC40MCwtMTY4LjExIDI3NS41NCwtMTUxLjQ1QzI3NS41NCwtMTg0Ljc4IDI3NS41NCwtMjE4LjExIDI3NS41NCwtMjUxLjQ1WiIgZmlsbD0iI0JDQkNDNCIvPjxwYXRoIGQ9Ik0zODkuODksLTI1MS40NUM0MjIuNzUsLTI1MS40NSA0NTUuNjEsLTI1MS40NSA0ODguNDcsLTI1MS40NUM0ODguNDcsLTIzNy40NSA0ODguNDcsLTIyMy40NSA0ODguNDcsLTIwOS40NUM0NjkuNDEsLTIwOS40NSA0NTAuMzUsLTIwOS40NSA0MzEuMjksLTIwOS40NUM0MzEuMjksLTE5MC4xMSA0MzEuMjksLTE3MC43OCA0MzEuMjksLTE1MS40NUM0MTcuNDksLTE1MS40NSA0MDMuNjksLTE1MS40NSAzODkuODksLTE1MS40NUMzODkuODksLTE4NC43OCAzODkuODksLTIxOC4xMSAzODkuODksLTI1MS40NVoiIGZpbGw9IiM1QTVBNjQiLz48cGF0aCBkPSJNLTY3LjUwLC0xMzUuNDVDLTM0LjY0LC0xMzUuNDUgLTEuNzcsLTEzNS40NSAzMS4wOSwtMTM1LjQ0QzIyLjk5LC0xMTguNzUgMTUuODYsLTEwMS44NiA4LjI2LC04NS4zMkMwLjY2LC02OC43OCAtNy42MywtNTIuNjMgLTE2LjUzLC0zNi41MkMtMjQuMDYsLTUzLjQ5IC0zMi4yNywtNzAuMDkgLTQxLjA1LC04Ni40MkMtNDkuODQsLTEwMi43NSAtNTkuMjQsLTExOC44MCAtNjcuNTAsLTEzNS40NVoiIGZpbGw9IiM5NDk0OUQiLz48cGF0aCBkPSJNNDguMTQsLTMzLjMzQzU2Ljg0LC00OS44NSA2NC45NSwtNjYuODcgNzIuNzMsLTg0LjA5QzgwLjUxLC0xMDEuMzEgODguMDEsLTExOC42OSA5Ni4xNCwtMTM1LjQ0QzEwNC40MywtMTE4LjY5IDExMy4yMCwtMTAxLjIxIDEyMS41NywtODMuNDdDMTI5Ljk1LC02NS43NCAxMzguMDAsLTQ3Ljc2IDE0NS45MywtMzAuNDdDMTEzLjMyLC0zMS4wMSA4MC43MywtMzEuOTcgNDguMTQsLTMzLjMzWiIgZmlsbD0iI0JDQkNDNCIvPjxwYXRoIGQ9Ik0xNjEuMjAsLTEzNS40NEMxOTQuMDYsLTEzNS40NCAyMjYuOTEsLTEzNS40NCAyNTkuNzcsLTEzNS40NEMyNDMuMzEsLTExOC42NiAyMjYuNzcsLTEwMC45MiAyMTAuNDgsLTgzLjAzQzE5NC4yMCwtNjUuMTUgMTc4LjA1LC00Ny4yMiAxNjEuNTgsLTMwLjI0QzE2MS45MSwtNjQuNjAgMTYxLjI3LC0xMDEuODggMTYxLjIwLC0xMzUuNDRaIiBmaWxsPSIjNUE1QTY0Ii8+PHBhdGggZD0iTTMyNC44MywtMTM1LjQ0QzM0MS4xOSwtMTIyLjA0IDM1Ny4wOSwtMTA4LjI1IDM3Mi45NiwtOTQuNzhDMzcyLjMwLC03NC4yNSAzNzIuMTYsLTUzLjU3IDM3Mi44MywtMzMuMzNDMzQwLjI0LC0zMS45NiAzMDcuNjQsLTMxLjAyIDI3NS4wNCwtMzAuNDdDMjc0Ljc4LC01MS4wNiAyNzQuODMsLTcyLjY3IDI3NS4wOSwtOTMuOTBDMjkxLjU3LC0xMDguMTQgMzA4LjM0LC0xMjIuMDQgMzI0LjgzLC0xMzUuNDRaIiBmaWxsPSIjNzQ3NDdFIi8+PHBhdGggZD0iTTM4OS44OCwtMTM1LjQ0QzQyMi42MiwtMTE4Ljc1IDQ1NC4zMCwtMTAyLjIzIDQ4Ni43NiwtODYuODlDNDUzLjIwLC03MC40MyA0MjAuNDQsLTUyLjMxIDM4OC40NiwtMzQuMDJDMzg3Ljg2LC01MC44MSAzODcuODIsLTY3LjgxIDM4OC4yOSwtODQuODBDMzg4Ljc2LC0xMDEuNzggMzg5Ljc2LC0xMTguNzUgMzg5Ljg4LC0xMzUuNDRaIiBmaWxsPSIjOTQ5NDlEIi8+PHBhdGggZD0iTS02Ni41OCwtMjMuMjVDLTMzLjcxLC0yMS42MSAtMC44OCwtMTkuNTQgMzEuODMsLTE3Ljk3QzMwLjI2LDE1LjMzIDI4LjcwLDQ4LjYzIDI3LjE0LDgxLjkyQy02LjQyLDgwLjMwIC0zOS44OSw3OC4xOSAtNzMuMDcsNzYuNTNDLTcyLjQ1LDU5LjcxIC03MS4wNyw0My4xOSAtNjkuODcsMjYuNTdDLTY4LjY3LDkuOTQgLTY3LjQzLC02Ljc3IC02Ni41OCwtMjMuMjVaIiBmaWxsPSIjNUE1QTY0Ii8+PHBhdGggZD0iTTQ3LjUyLC0xNy4yNEM4MC4yMywtMTUuODEgMTEyLjk1LC0xNC43OSAxNDUuNjgsLTE0LjIzQzEyOC43NSwxOC44MiAxMTEuMzksNTEuNzUgOTMuNjEsODQuNTRDNzcuODEsNTAuNzIgNjIuNDUsMTYuNzggNDcuNTIsLTE3LjI0WiIgZmlsbD0iIzc0NzQ3RSIvPjxwYXRoIGQ9Ik0xNjAuMTAsODYuMDFDMTc3LjMyLDUyLjkxIDE5NC4xMiwxOS42OCAyMTAuNDgsLTEzLjY2QzIyNi44NSwxOS42NyAyNDMuNjUsNTIuOTEgMjYwLjg3LDg2LjAxQzIyNy4yOCw4Ni40NiAxOTMuNjksODYuNDUgMTYwLjEwLDg2LjAxWiIgZmlsbD0iIzk0OTQ5RCIvPjxwYXRoIGQ9Ik0yNzUuMjksLTE0LjIzQzMwOC4wMiwtMTQuODAgMzQwLjc0LC0xNS44MCAzNzMuNDQsLTE3LjI0QzM0Mi4xNiwxNy41MCAzMTAuMDEsNTEuODUgMjc2Ljk5LDg1Ljc2QzI3Ni40Miw1Mi40NCAyNzUuODUsMTkuMTAgMjc1LjI5LC0xNC4yM1oiIGZpbGw9IiNCQ0JDQzQiLz48cGF0aCBkPSJNNDM4LjI4LC0yMC42MEM0NTUuNDIsLTguMjEgNDcyLjY2LDQuMTUgNDkwLjEyLDE2LjU5QzQ5MS41NiwzNi41NCA0OTMuMjksNTYuMzQgNDk0LjA0LDc2LjUzQzQ2MC44Niw3OC4xOSA0MjcuMzksODAuMzAgMzkzLjgzLDgxLjkyQzM5Mi44OSw2MS45NCAzOTEuOTUsNDEuOTYgMzkxLjAyLDIxLjk5QzQwNi45Miw3Ljg3IDQyMi41OCwtNi4zOCA0MzguMjgsLTIwLjYwWiIgZmlsbD0iIzVBNUE2NCIvPjxwYXRoIGQ9Ik0yNi42MSw5Ny44NEMyNi4zNCwxMTQuMzUgMjYuOTksMTMwLjcwIDI4LjE1LDE0Ny4wOUMyOS4zMCwxNjMuNDggMzAuOTQsMTc5LjkwIDMxLjA3LDE5Ni41NUMtMS45MiwxNzkuOTAgLTM2Ljc2LDE2My4wMSAtNzEuMDEsMTQ0Ljk1Qy01NS40MCwxMzYuNDkgLTM5LjU2LDEyOC4zNCAtMjMuMzUsMTIwLjU1Qy03LjEzLDExMi43NSA5LjY1LDEwNS4zMiAyNi42MSw5Ny44NFoiIGZpbGw9IiM5NDk0OUQiLz48cGF0aCBkPSJNNDIuNzcsOTguNTVDNzYuNDMsOTkuOTYgMTEwLjExLDEwMC45NSAxNDMuNzksMTAxLjUxQzE0My41OSwxMzMuODEgMTQ1LjMzLDE2My4zNyAxNDUuNDIsMTk2LjU2QzExMi41NiwxOTYuNTYgNzkuNzAsMTk2LjU2IDQ2Ljg0LDE5Ni41NkM0Ni43MywxNzkuOTIgNDUuMjMsMTYzLjY0IDQ0LjE3LDE0Ny40MUM0My4xMiwxMzEuMTcgNDIuNTIsMTE0Ljk5IDQyLjc3LDk4LjU1WiIgZmlsbD0iI0JDQkNDNCIvPjxwYXRoIGQ9Ik0xNTkuOTYsMTAxLjc1QzE5My42NCwxMDIuMTcgMjI3LjMzLDEwMi4xOCAyNjEuMDEsMTAxLjc1QzI0NC4zMiwxMzQuMjEgMjI2LjkxLDE2My4zOCAyMTAuNDgsMTk2LjU2QzE5NC4wNSwxNjMuMzggMTc2LjY1LDEzNC4yMSAxNTkuOTYsMTAxLjc1WiIgZmlsbD0iIzVBNUE2NCIvPjxwYXRoIGQ9Ik0yNzUuNTUsMTk2LjU2QzI5Mi4wNywxNjMuMzcgMzExLjIwLDEzMy4zNyAzMjcuNzAsMTAwLjM1QzMzNi4yOSwxMTYuMzYgMzQ0LjMwLDEzMS45NiAzNTEuNzUsMTQ3Ljg0QzM1OS4yMCwxNjMuNzIgMzY2LjAzLDE3OS45MiAzNzQuMTMsMTk2LjU2QzM0MS4yNywxOTYuNTYgMzA4LjQxLDE5Ni41NiAyNzUuNTUsMTk2LjU2WiIgZmlsbD0iIzc0NzQ3RSIvPjxwYXRoIGQ9Ik0zOTQuMzYsOTcuODRDNDI4LjAxLDk2LjI4IDQ2MS4zOCw5NC4yOCA0OTQuNDEsOTIuODFDNDc3Ljk4LDExMC42NCA0NjAuNTcsMTI4LjYzIDQ0Mi42OCwxNDUuOTZDNDI0Ljc4LDE2My4yOSA0MDYuNDYsMTc5LjkwIDM4OS45MCwxOTYuNTVDMzkwLjAzLDE3OS45MCAzOTEuNjcsMTYzLjQ4IDM5Mi44MiwxNDcuMDlDMzkzLjk4LDEzMC43MCAzOTQuNjMsMTE0LjM1IDM5NC4zNiw5Ny44NFoiIGZpbGw9IiM5NDk0OUQiLz48cGF0aCBkPSJNLTY3LjUwLDIxMi41NUMtNTEuMDcsMjI5LjIyIC0zNC42NCwyNDUuODkgLTE4LjIxLDI2Mi41NUMtMzQuNjQsMjc5LjIyIC01MS4wNywyOTUuODkgLTY3LjUwLDMxMi41NUMtNTEuMDcsMzEyLjU1IC0zNC42NCwzMTIuNTUgLTE4LjIxLDMxMi41NUMtMS43OCwyOTUuODkgMTQuNjUsMjc5LjIyIDMxLjA4LDI2Mi41NUMxNC42NSwyNDUuODkgLTEuNzgsMjI5LjIyIC0xOC4yMSwyMTIuNTVDLTM0LjY0LDIxMi41NSAtNTEuMDcsMjEyLjU1IC02Ny41MCwyMTIuNTVaIiBmaWxsPSIjNUE1QTY0Ii8+PHBhdGggZD0iTTE0NS40MiwyMTIuNTVDMTQ1LjQyLDI0NS44OSAxNDUuNDIsMjc5LjIyIDE0NS40MiwzMTIuNTVDMTEyLjU3LDI5NS44OSA3OS43MSwyNzkuMjIgNDYuODUsMjYyLjU1Qzc5LjcxLDI0NS44OSAxMTIuNTcsMjI5LjIyIDE0NS40MiwyMTIuNTVaIiBmaWxsPSIjNzQ3NDdFIi8+PHBhdGggZD0iTTE2MS4yMCwyMTIuNTVDMTk0LjA2LDIxMi41NSAyMjYuOTEsMjEyLjU1IDI1OS43NywyMTIuNTVDMjU5Ljc3LDI0NS44OSAyNTkuNzcsMjc5LjIyIDI1OS43NywzMTIuNTVDMjI2LjkxLDMxMi41NSAxOTQuMDYsMzEyLjU1IDE2MS4yMCwzMTIuNTVDMTYxLjIwLDI3OS4yMiAxNjEuMjAsMjQ1Ljg5IDE2MS4yMCwyMTIuNTVaIiBmaWxsPSIjOTQ5NDlEIi8+PHBhdGggZD0iTTI3NS41NCwyMTIuNTVDMzA4LjQwLDIxMi41NSAzNDEuMjYsMjEyLjU1IDM3NC4xMiwyMTIuNTVDMzU3LjY5LDI0NS44OSAzNDEuMjYsMjc5LjIyIDMyNC44MywzMTIuNTVDMzA4LjQwLDI3OS4yMiAyOTEuOTcsMjQ1Ljg5IDI3NS41NCwyMTIuNTVaIiBmaWxsPSIjQkNCQ0M0Ii8+PHBhdGggZD0iTTM4OS44OSwzMTIuNTVDNDA2LjMyLDI3OS4yMiA0MjIuNzUsMjQ1Ljg5IDQzOS4xOCwyMTIuNTVDNDU1LjYxLDI0NS44OSA0NzIuMDQsMjc5LjIyIDQ4OC40NywzMTIuNTVDNDU1LjYxLDMxMi41NSA0MjIuNzUsMzEyLjU1IDM4OS44OSwzMTIuNTVaIiBmaWxsPSIjNUE1QTY0Ii8+PC9nPgo8cmVjdCB4PSIwLjAiIHk9IjAuMCIgd2lkdGg9IjQyMS4wIiBoZWlnaHQ9IjY3LjQiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzcxNzE3QSIgc3Ryb2tlLXdpZHRoPSIxLjc3MyIvPjxnIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzcxNzE3QSIgc3Ryb2tlLXdpZHRoPSI0LjA5MSIgc3Ryb2tlLWxpbmVjYXA9ImJ1dHQiIHN0cm9rZS1saW5lam9pbj0ibWl0ZXIiPjxwYXRoIGQ9Ik0wLjAsMjYuMCBMMC4wLDAuMCBMMTUwLjAsMC4wIi8+PHBhdGggZD0iTTQyMS4wLDQxLjQgTDQyMS4wLDY3LjQgTDI3MS4wLDY3LjQiLz48L2c+CjxwYXRoIGQ9Ik00MTUuNjMsNTguMjBDMjc5LjUzLDczLjk0IDE0MS40NCw3My45NCA1LjM0LDU4LjIwQzIuMDMsNTcuODEgLTAuMzQsNTQuODcgMC4wNCw1MS42NEMxLjk2LDM1LjI4IDMuODcsMTguOTMgNS43NywyLjU3QzYuMTUsLTAuNjcgOS4wNCwtMi45OCAxMi4yNCwtMi42MUMxNDMuNzYsMTIuNjAgMjc3LjIwLDEyLjYwIDQwOC43MywtMi42MUM0MTEuOTMsLTIuOTggNDE0LjgyLC0wLjY3IDQxNS4yMCwyLjU3QzQxNy4wOSwxOC45MyA0MTkuMDAsMzUuMjggNDIwLjkzLDUxLjY0QzQyMS4zMSw1NC44NyA0MTguOTQsNTcuODEgNDE1LjYzLDU4LjIwQzQxNS42Myw1OC4yMCA0MTUuNjMsNTguMjAgNDE1LjYzLDU4LjIwWiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkY5QTAwIiBzdHJva2Utd2lkdGg9IjMuNTQ2IiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CjwvZz4KPC9zdmc+" width="800" alt="ArcFit.dev banner"/>

</div>

### "Why does my warp keep changing?"

Illustrator's arc warp measures its envelope from **everything**, including geometry hidden inside clipping masks. Unhide a layer, tweak a hidden group, and the same design warps differently. Nondeterministic warps, manual fixups, mystery.

**ArcFit.dev warps to your dieline, not to your hidden junk.** Clipped geometry is ignored, the envelope is deterministic, and your final dimensions stay exactly as designed. The warp you get is the warp you shipped.

[**arcfit.dev**](https://arcfit.dev)

</div>
