<div align="center">

# ESON: Strict JSON for ExtendScript (ES3)

### The drop-in JSON library for Adobe Illustrator, InDesign, Photoshop & any ExtendScript host

[![JSON: RFC 8259 strict](https://img.shields.io/badge/JSON-RFC%208259%20strict-success)](https://www.rfc-editor.org/rfc/rfc8259)
[![JSONTestSuite](https://img.shields.io/badge/JSONTestSuite-95%2F95%20%2F%20188%2F188-purple)](https://github.com/nst/JSONTestSuite)
[![Adobe: Creative Suite](https://img.shields.io/badge/Adobe%20-Creative%20Suite-red?logo=adobe&logoColor=white)](https://extendscript.docsforadobe.dev/)
[![Engine](https://img.shields.io/badge/ExtendScript-ES3-green)](#compatibility)
[![Size](https://img.shields.io/badge/runtime-15.4%20KB-orange)](#installation)
[![License: MIT](https://img.shields.io/badge/license-GNU%20GPL%20v3-blue)](https://www.gnu.org/licenses/gpl-3.0.html)

</div>

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
- [License](#license)

---

## Why ESON?

**ExtendScript, the ES3 scripting engine inside Illustrator, InDesign, Photoshop, Premiere Pro, After Effects and InCopy, has no native `JSON` object.** There is no `JSON.parse`, no `JSON.stringify`. Every script that needs JSON has to ship a library, and for years the only real option was [json2](https://github.com/douglascrockford/JSON-js) (2009-era Crockford).

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

## License

MIT. See [LICENSE](LICENSE) (ESON core). The bundled json2 stringify algorithm is derived from Douglas Crockford's public-domain [JSON-js](https://github.com/douglascrockford/JSON-js), with the ExtendScript-specific fixes documented in this README.

---

<p align="center"><small>ESON: ExtendScript Object Notation. Built for the engine, measured on the engine, strict by default.</small></p>
