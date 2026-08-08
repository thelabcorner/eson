<div align="center">

# ESON: Strict JSON for Adobe ExtendScript (ES3)

## ExtendScript Object Notation = E.S.O.N.

### The drop-in JSON library for Adobe Illustrator, InDesign, Photoshop & any ExtendScript host

[![JSON: RFC 8259 strict](https://img.shields.io/badge/JSON-RFC%208259%20strict-success)](https://www.rfc-editor.org/rfc/rfc8259)
[![JSONTestSuite](https://img.shields.io/badge/JSONTestSuite-95%2F95%20188%2F188%2035%2F35-purple)](https://github.com/nst/JSONTestSuite)
[![Adobe: Creative Suite](https://img.shields.io/badge/Adobe%20-Creative%20Suite-red?logo=adobe&logoColor=white)](https://extendscript.docsforadobe.dev/)
[![Engine](https://img.shields.io/badge/ExtendScript-ES3-green)](#compatibility)
[![Size](https://img.shields.io/badge/runtime-15.7%20KB-orange)](#installation)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL%203.0--or--later-blue)](https://www.gnu.org/licenses/gpl-3.0.html)

</div>

---

> **From the same team: [ArcFit.dev](https://arcfit.dev).** Illustrator's built-in arc warp is nondeterministic. It sizes its envelope from every piece of geometry it can see, including artwork hidden inside clipping masks. Hide or unhide a layer and the same design warps differently, at a slightly different size. ArcFit anchors the warp to your **dieline** (the shape that actually matters) and ignores clipped geometry, so a design warps the same way every time and lands at the exact width you designed. [Learn more at arcfit.dev](https://arcfit.dev)

---

## Table of Contents

- [Why ESON?](#why-eson)
- [Features](#features)
- [Which build should I use?](#which-build-should-i-use)
- [Get the Release](#get-the-release)
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

**ExtendScript ships no reliable native `JSON`: where a host does expose one, its parse is the permissive kind (see the table).** Every script that needs JSON has to ship a library, and for years the only real option was [json2](https://github.com/douglascrockford/JSON-js) (Crockford's JSON-js, 2023-05-10 revision).

json2 works, but it is *permissive*, and in the Adobe engine that matters:

| json2 accepts (documented) | Example |
|---|---|
| Leading zeros | `[01]` |
| Trailing dots | `[1.]` |
| Exponential without digits | `[1.e5]` |
| Bare numeric keys | `{1:1}` |
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
- **Eval-gated by default:** the strict `parse()` lane is pre-scan + sanitize + `eval` with a `SyntaxError` catch; every trusted-only raw-eval entry point is named `*Trusted` / `*Checked` explicitly; the eval-free `decodeSourceChecked` lane is documented in the API reference.
- **Fast in the ES3 engine:** ~1.6× faster cold parse than json2 at 43 KB, ~385× faster on repeat parses via an 8-entry verdict memo (47.7 ms cold → 124 µs).
- **Preserves more than JSON when you need it:** the trusted lane (`encodeSource` / `decodeSourceTrusted`) round-trips `undefined`, `NaN`, `Infinity`, functions, dates and sparse arrays in ~26 µs.
- **Certified, not claimed:** JSONTestSuite 95/95 + 188/188 + 35/35 with zero V8 divergence; 623 Node assertions; 36/36 byte-equal differential vs the JSON2 reference in the live engine.
- **Slim runtime build:** the tree-shaken runtime vendor (`vendor-eson-runtime.js`) is 15.7 KB; the full `ESON.jsx` is 59.3 KB (the +6.4 KB is the opt-in native gate module - pruned from the runtime build by tree-shaking).

---

## Which build should I use?

ESON ships two ExtendScript bundles. They share the same strict parse and
stringify; the difference is everything else.

| | **Runtime build** | **Full build** |
|---|---|---|
| Files | `vendor-eson-runtime.js`¹ | `vendor-eson.js`, `ESON.jsx` |
| Size | 15.7 KB | 59.3 KB (ESON.jsx) / 59.4 KB (vendor-eson.js) |
| API | `parse`, `stringify` only | full facade: `parse`, `stringify`, `parseTrusted`, `stringifyFast`, `encodeSource` / `decodeSourceTrusted`, `decodeSourceChecked`, `enableNativeGate` / `disableNativeGate`, `capabilities`, `install`, `loadJson2Api` (provisioning helper), `benchmark` |
| Installs global `JSON` | yes (vendor variant) | yes (vendor variant) |
| Best for | high-frequency automation, per-eval injection, anything that only needs strict `JSON.parse` / `JSON.stringify` | plugins and long-lived scripts that also need the trusted codec, certified fast lane, the ExternalObject-accelerated gate, capability probing, or benchmark tooling |

¹ `ESON-runtime.jsx` is a build intermediate (bare esbuild bundle: no `ESON_JSON2` wrapper, no ES3 shim, no install footer), not a standalone-loadable artifact; the loadable runtime artifact is `vendor-eson-runtime.js` only. The runtime build contains zero ExternalObject code (the `parseJson` gate hook is inert there - the parameter is never passed).

**Rule of thumb:** if your script only ever calls `JSON.parse` and
`JSON.stringify` (or `ESON.parse` / `ESON.stringify`), use the **runtime
build**. It is 1/3 the size and evals faster. Reach for the **full build**
only when you need `stringifyFast`, the trusted source codec
(`encodeSource` / `decodeSourceTrusted`), `decodeSourceChecked`,
`capabilities()`, or `benchmark()`.

This is also the split high-frequency automation uses: install the runtime
core once per session so later evals reuse it, because transport only needs
strict parse/stringify.

---

## Two paths: JSX-only (default) vs ExternalObject-accelerated

ESON deliberately ships **two execution paths** for `parse()`:

### Path 1 - JSX-only (the default, every build, every host)

The certified lane: a JSONTestSuite-certified regex pre-scan
(95/95 must-accept, 188/188 must-reject, differential-fuzzed) + sanitize +
eval with a SyntaxError catch, plus the 8-entry verdict memo. Zero
dependencies, works in every ExtendScript host (Illustrator, InDesign,
Photoshop, After Effects, Premiere Pro, InCopy, Bridge), no DLL, no
architecture constraints. **This is what every `parse()` call does unless
you explicitly opt in to Path 2.**

### Path 2 - ExternalObject-accelerated (opt-in, full build only, Windows x64)

`ESON.enableNativeGate({ dir })` loads the ESONJson.dll
(`native/build/ESONJson.dll`, canonical Adobe ABI - see the ABI saga below),
self-certifies verdict parity on a bundled corpus at enable, and only then
routes `parse()`'s cold path through the DLL's `validateText`. sanitize +
eval stay; the DLL replaces only the pre-scan. Measured live on
Illustrator 30.6.0:

| Lane | 345 B | 1.7 KB | 43 KB |
|---|---|---|---|
| `parse` cold, JSX-only | 270 us | 1,319 us | 46,374 us |
| `parse` cold, native gate | 19 us | 94 us | 2,784 us |
| speedup | 14x | 14x | **17x** |

The gate is certified before it is trusted:

- **Enable-time self-certification** (`certified` in `capabilities().native`):
  the native verdict must match the JSX gate verdict on every adjudicated
  corpus case (valid accepts, invalid rejects), or the gate refuses to
  enable with a reason. A gate that adjudicates nothing also fails.
- **Channel-safety guard**: raw U+0000 and surrogate code units cannot cross
  the ExternalObject string boundary faithfully (NUL truncates - verified
  live that `{"a":1}\u0000,(probe=42)` would otherwise EXECUTE the post-NUL
  expression; astral pairs are dropped). Such texts are **deferred** to the
  certified pre-scan - the gate never adjudicates what the channel cannot
  carry.
- **Full JSONTestSuite certification** (per-DLL-build, live): the
  accelerated path and the JSX path return identical verdicts on all 309
  readable corpus files (y_ 95/95, n_ 184/184, i_ identical) - see
  `probes/eson-corpus-parity.jsx` and its `%TEMP%\eson-corpus-parity.json`
  report.
- **eval stays the grammar checker**: still wrapped in the SyntaxError
  catch, still only ever sees sanitized text. The native gate is a
  reject/accept accelerator, never an eval channel.

```jsx
var caps = ESON.enableNativeGate({ dir: '/path/to/eson/native/build' });
if (caps.native.enabled) {
  ESON.parse(bigJson); // accelerated cold parse (validated gate + eval)
}
// ESON.disableNativeGate() returns to Path 1 at any time
```

Residual risks (documented, not eliminated): the enable-time corpus is a
fast spot-check - the full-corpus certification is a per-DLL-build live run
(re-run it after every DLL rebuild, since ExternalObject binding is
per-DLL-build); and ExternalObject host errors that bypass JavaScript
try/catch are possible (none observed with the canonical-ABI build: 14/14
methods bound in the live session). Payloads containing raw NUL or astral
characters fall back to Path 1's pre-scan automatically.

### Runnable examples

The `examples/` folder ships seven runnable, live-verified ExtendScript scripts
(plus a sample job file in `examples/data/`): each one loads the needed build
relative to its own location (override with the `ESON_DIST` env var), runs
self-checking demonstrations, and returns a JSON report as its last-statement
value - so they work both from File > Scripts and from COM/automation
(`eval --file examples/01-parse-stringify.jsx`). Run `npm run build` first so
`dist/` exists.

| Example | Build | Demonstrates |
|---|---|---|
| `01-parse-stringify.jsx` | runtime | drop-in global JSON: parse, reviver, stringify, memo |
| `02-strict-parse.jsx` | runtime | the json2 permissive holes, all rejected |
| `03-config-job-batch.jsx` | runtime | config-driven batch: preflight → snapshot → commit → restore → report |
| `04-trusted-transport.jsx` | full | `encodeSource` / `decodeSourceTrusted` (undefined, NaN, dates, functions) |
| `05-eval-free-lane.jsx` | full | `decodeSourceChecked`: data accepted, executable rejected |
| `06-fast-lane.jsx` | full | `stringifyFast`: fallback, throw-with-path, cycle errors |
| `07-native-gate.jsx` | full | **the two paths**: gate OFF vs gate ON, certification report, timing (native ~9-17x cold) |

Each script writes its report to `%TEMP%\esonexample-0N-report.json` as well.

### Brief Adobe Illustrator examples

**1. Per-eval automation (runtime build):** the pattern for high-frequency
automation: inject the runtime core, work with a JSON envelope, return a JSON
envelope.

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

## Get the Release

<div align="center">

**All production bundles ship as GitHub release assets — this repo holds sources. Grab the runnable builds from the [Releases page](https://github.com/thelabcorner/eson/releases).**

[![Latest stable](https://img.shields.io/github/v/release/thelabcorner/eson?style=for-the-badge&logo=github&label=Latest%20stable)](https://github.com/thelabcorner/eson/releases/latest)
[![Release date](https://img.shields.io/github/release-date/thelabcorner/eson?style=for-the-badge&label=Released)](https://github.com/thelabcorner/eson/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/thelabcorner/eson/total?style=for-the-badge&label=Downloads)](https://github.com/thelabcorner/eson/releases)

</div>

**How it works, in three steps:**

1. Open the [Releases page](https://github.com/thelabcorner/eson/releases).
2. Pick the **latest stable** tag (top of the list — today that is `v1.0.0`).
3. Download the asset that matches your use case:

| You are... | Take this release | And this asset |
|---|---|---|
| A script/plugin that needs strict `JSON.parse` / `JSON.stringify` | **Latest stable** | `vendor-eson.js` — drop-in vendor, installs the global |
| A facade-only script (leave the global alone) | Latest stable | `ESON.jsx` — bannerless IIFE, defines `ESON` |
| High-frequency automation / per-eval injection | Latest stable | `vendor-eson-runtime.js` - 15.7 KB, parse/stringify only |
| Node.js testing / tooling | Latest stable | `eson-core.esm.mjs` — ESM core (25 exports) |
| Differential probes / verification | Latest stable | `json2-reference.jsx` — raw json2 reference lane |
| A fix that isn't released yet | Pre-release / `master` | Build from source: `npm run build` |

> **Rule of thumb: start with the latest stable tag.** Every release asset is
> produced by `npm run build` from the exact tagged commit, and no release is
> tagged before it passes the full gate: 623 Node assertions, JSONTestSuite
> 95/95 + 188/188 + 35/35, and 330,000+ differential fuzz iterations vs V8.

> **Staying current:** releases follow [SemVer](https://semver.org/)
> (`v1.0.0`): patch = bug fix, minor = new feature, major = breaking change.
> Watch the repository → *Releases* to get notified, and read the release
> notes before upgrading across a major bump.

Then follow [Installation](#installation) for drop-in usage snippets.

---

## Installation

### From npm

```bash
npm install eson
```

The package ships `dist/eson-core.esm.mjs` (ESM core for Node/automation) and builds the ExtendScript artifacts locally:

```bash
npm run build   # writes dist/ESON.jsx, dist/vendor-eson.js,
                # dist/vendor-eson-runtime.js, dist/ESON-runtime.jsx,
                # dist/json2-reference.jsx, dist/eson-core.esm.mjs
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
var value = ESON.parse('{"name":"warp-config","bend":35}');
value.bend;     // 35

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
| [`enableNativeGate`](#enablenativegate) | full | `enableNativeGate(options?)` | `EsonCapabilities` (with `native`) |
| [`disableNativeGate`](#enablenativegate) | full | `disableNativeGate()` | `EsonCapabilities` (with `native`) |
| [`capabilities`](#capabilities) | full | `capabilities()` | `EsonCapabilities` |
| [`install`](#install) | full | `install(options?)` | `EsonCapabilities` |
| [`benchmark`](#benchmark) | full | `benchmark(iterations?)` | `BenchItem[]` |

---

### `enableNativeGate` / `disableNativeGate`

**Path 2 - the ExternalObject-accelerated parse gate (opt-in, full build
only, Windows x64 + the ESONJson.dll).** See the [Two paths](#two-paths-jsx-only-default-vs-externalobject-accelerated)
section for the security model.

`enableNativeGate(options?)` loads the DLL, smokes it, self-certifies
verdict parity on a bundled corpus, and - only on full success - routes
`parse()`'s cold path through the native validator. Returns fresh
`capabilities()`; the result carries the `native` block:

| Field | Meaning |
|---|---|
| `present` | the engine has `ExternalObject` |
| `enabled` | gate certified and active |
| `reason` | disabled reason (`''` when enabled) |
| `dll` / `dllVersion` | loaded DLL name and `ESGetVersion` value |
| `certified` | parity cases adjudicated at enable |

```jsx
var caps = ESON.enableNativeGate({ dir: '/path/to/native/build' });
if (!caps.native.enabled) throw new Error('native gate off: ' + caps.native.reason);
ESON.parse(payload); // accelerated cold parse
ESON.disableNativeGate(); // back to Path 1
```

Options: `dir` (DLL directory, prepended to `ExternalObject.searchFolders`),
`libName` (default `'ESONJson'`), and `validCases`/`invalidCases` corpus
overrides (probes, tests). When the gate is active, `parse()` with no
reviver routes through `validateText` + sanitize + eval; revivers, memo
hits, and every other lane are unchanged. Payloads containing raw NUL or
surrogate code units are deferred to the certified pre-scan automatically
(the boundary cannot transport them faithfully).

`disableNativeGate()` unloads the DLL and returns to the JSX-only path.
`capabilities().native` always reports the current state.

---

### `parse`

**`parse(text, reviver?)`**: strict RFC 8259 parser. The default, safe lane.

- `text` is coerced with `String(text)`, so numbers, booleans and objects are accepted (but will almost always be rejected by the grammar).
- Internally: `strictnessPreScan` (certified verdict-clean, see [Spec Conformance](#spec-conformance)) + sanitize (`[\u2028\u2029]` only) + `eval` as the native grammar checker, with a `SyntaxError` catch. Malformed input **throws**; it never returns a partially-parsed value. When the ExternalObject gate is enabled ([`enableNativeGate`](#enablenativegate)), the pre-scan is replaced by the certified native validator for no-reviver calls; the eval and its catch stay.
- `reviver(text)`: a JSON.parse-compatible `(key, value)` reviver, applied depth-first on the parsed tree.
- **Verdict memo:** identical text parsed without a reviver is memoized in an 8-entry LRU (47.7 ms cold → 124 µs at 43 KB). Caveat: memo hits return the **same object reference**; mutate the result and the next hit sees the mutation. Reviver parses bypass the memo. Parse errors are memoized too, and re-thrown on memo hits.

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
- `space`: indentation. Numbers (0, negative and positive; >10 capped at 10) and strings are accepted. The cap follows the standard algorithm; the bundled json2's pair-aware `rx_escapable` implements the ES2019 well-formed lone-surrogate escaping.
- `undefined` and functions at the **top level** return `undefined`; inside containers they are dropped (objects) or serialized as `null` (arrays). Non-finite numbers (`NaN`, `Infinity`) serialize as `null` at every level, per JSON semantics.
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

**`parseTrusted(source, reviver?)`**: **raw eval; trusted channel only.** The caller warrants the input. There is no prefix, extension, checksum, or path heuristic anywhere that routes text here; the public text-routing entry points that reach the engine's raw eval are `parseTrusted` and `decodeSourceTrusted`, and nothing routes text to eval by heuristic. Use it for in-memory round-trips of values JSON cannot represent. Applies an optional reviver after evaluation.

---

### `encodeSource`

**`encodeSource(value)`**: SpiderMonkey source generation using the engine's native source kernels (`uneval` / `toSource`; probed at first use). Unlike JSON, the output can preserve `undefined`, `NaN`, `Infinity`, dates, functions and sparse arrays. The output is **executable source**, not a data-only format; feed it only to `decodeSourceTrusted`.

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

**`benchmark(iterations?)`**: in-module quick benchmark (`iterations` defaults to 100). Uses `performance.now` / `$.hiresTimer` when present. Returns `BenchItem[]` with lanes `stringify`, `parse`, and `trustedRoundtrip` (only when an `uneval` or `objectToSource` kernel is available). Each item: `{ lane, payload, iterations, medianUs, minUs, p95Us, opsPerSec, outputBytes, vsJson2 }`.

---

### ESM core exports (Node)

`dist/eson-core.esm.mjs` re-exports the facade plus the underlying lane functions for harnesses and advanced use:

| Export | What it is |
|---|---|
| `parse` / `stringify` / `stringifyFast` / `parseTrusted` / `encodeSource` / `decodeSourceTrusted` / `decodeSourceChecked` / `enableNativeGate` / `disableNativeGate` / `capabilities` / `install` / `benchmark` | the same facade functions |
| `parseJson` / `stringifyJson` / `stringifyFastJson` | raw lane implementations |
| `evalSource` / `decodeCheckedSource` / `encodeSourceImpl` / `decodeSourceImpl` / `parseTrustedImpl` | trusted-lane internals |
| `classifyJson` / `captureKernel` / `globalObject` / `loadJson2` | capability probes and JSON2 instance loading |
| `loadJson2Api` | loads a JSON2 instance from raw source |
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

Strictness holes closed by the pre-scan: leading zeros (`01`, `-00`, `[1,01]`), trailing dots (`1.`, `1.e5`), raw control characters in strings, trailing commas, number-token adjacency (`1-2`), member-access dots (`[3[4]]`, `{}.false`), JS-only escapes (`"\q"`, `"\x41"`, octal, `"\v"`), trailing second values (`{"a":1} 1` - the skeleton masks numbers as `]`; the structural walk now rejects them, so the eval never sees them), and nesting depth > 512.

The ExternalObject gate ([`enableNativeGate`](#enablenativegate)) is covered by the same contract: it only ever replaces the pre-scan for no-reviver calls, and only after its own verdict-parity certification (see [Two paths](#two-paths-jsx-only-default-vs-externalobject-accelerated)).

---

## Spec Conformance

The strict lane is validated against the official [nst/JSONTestSuite](https://github.com/nst/JSONTestSuite) corpus (`node tests/json-suite.mjs`):

| Corpus | Result |
|---|---|
| Must-accept (`y_`) | **95/95** |
| Must-reject (`n_`) | **188/188** |
| Implementation-defined (`i_`) | **35/35**, zero crashes |
| V8 divergence | **zero** |

V8 divergence is counted and reported, not a hard failure gate. One encoding-level must-reject case (invalid UTF-8 after an escape) is out of contract by definition; 187/188 of the remaining cases are enforced.

Plus deterministic differential fuzzing against V8's native `JSON.parse` (`node tests/fuzz.mjs [iters] [seed]`): **330,000+ iterations across four seeds, zero divergences**, heap steady (~120 MB).

The suite has already paid for itself: it exposed four real strictness holes (depth counting inside string literals, an escape-legalizing sanitizer, skeleton-invisible bare keys / comma rules, and a leading-zero check that tripped on exponent digits), all fixed in `src/validate.ts`. The live full-corpus runs through the ExternalObject gate exposed two more classes that V8-based testing cannot see: an ExtendScript regex-engine hang on strings ending in a lone backslash (the `rx_protect` alternation-star, fixed with a two-pass shape) and trailing-second-value acceptance (`{"a":1} 1`, fixed in the structural walk).

---

## Performance

All numbers measured **live in the Illustrator engine** (ExtendScript ES3, 30.6.0) via `probes/eson-benchmark.jsx` (median-of-20 runs (12 for the largest payload), `$.hiresTimer`, cold lanes with unique text per iteration so the verdict memo never hits).

### ESON vs JSON2: the operators both implement

| Operator | Payload | JSON2 (old) | ESON (new) | Δ (old ÷ new) |
|---|---|---|---|---|
| parse (cold, strict) | small 345 B | 280 µs | 277 µs | 1.0× |
| parse (cold, strict) | medium 1.7 KB | 1.3 ms | 1.3 ms | 1.0× |
| parse (cold, strict) | large 43 KB | 77.7 ms | **47.7 ms** | **1.6×** |
| stringify | small 345 B | 141 µs | 145 µs | 1.0× |
| stringify | medium 1.7 KB | 585 µs | 571 µs | 1.0× |
| stringify | large 43 KB | 13.7 ms | 13.7 ms | 1.0× |

Parse wins at size (the eval-based lane scales ~1.6× better at 43 KB); stringify is at parity with json2 on these payloads.

### ESON-only operators (same run)

| Operator | small 345 B | medium 1.7 KB | large 43 KB |
|---|---|---|---|
| parse (memo hit) | 3 µs | 11 µs | 124 µs |
| `stringifyFast` (certified) | 213 µs | 1.0 ms | 22.7 ms |
| trusted round-trip (`encodeSource` + `decodeSourceTrusted`) | **26 µs** | n/a | n/a |
| raw `toSource` (engine baseline) | 5 µs | 40 µs | 731 µs |
| raw `eval` (engine baseline) | 15 µs | 91 µs | 2.8 ms |

### Path 2: the ExternalObject gate (same host, canonical-ABI DLL)

The benchmark (`probes/eson-benchmark.jsx`, `native.*` lanes) and example 07
measure the opt-in accelerated path against the JSX-only path:

| Lane | 345 B | 1.7 KB | 43 KB |
|---|---|---|---|
| `native.validate` (gate only) | 2 µs | 8 µs | 146 µs |
| `nativeGate+eval` (full parse) | 19 µs | 94 µs | 2,784 µs |
| `eson.parse.cold` (JSX-only) | 270 µs | 1,319 µs | 46,374 µs |
| speedup (cold parse) | **14×** | **14×** | **17×** |
| `native.packed.read` vs charCodeAt read | 1,241 vs 2,321 µs (1.87×) | | |
| `native.packed.write` vs fromCharCode write | 3,903 vs 7,228 µs (1.85×) | | |
| `native.escapeDirect` vs byte-drain | 81 vs 12,392 µs (153×) | | |

Memo hits (3-124 µs) still beat the native gate - the acceleration is for
cold parses of payloads ≥ ~1 KB. The verdict-memo and reviver semantics are
identical on both paths.

Same-run correctness checks: stringify byte-equal to the JSON2 reference on all payloads; 0 invalid inputs accepted by ESON.

**How the parse gets fast:** the strictness pre-scan pushes work into native regex passes (with a short per-char walk over the collapsed structural string for depth and balance), the sanitizer is narrowed to `[\u2028\u2029]` only, comma rules are folded into one regex over the collapsed structural string, and the eval itself is the native grammar checker at ~0.06 µs/byte. An 8-entry value-keyed verdict LRU then skips pre-scan + eval entirely on repeat parses; the memo hit lane is ~385× faster than cold.

> **When NOT to use JSON for config persistence:** in the ES3 engine, a plain `key=value` text reader beats ESON on every lane: ~2–4× faster parse (no eval, no pre-scan) and ~13–17× faster write (plain concat vs the escaping regex). If you're storing application settings in ExtendScript, the txt format is the right call; ESON is the right call for transport, interchange and anything that must be strict.

---

## Compatibility

| Target | Status |
|---|---|
| ExtendScript (ES3): Illustrator, InDesign, Photoshop, After Effects, Premiere Pro, InCopy, Bridge | Bundles are ES3-safe (ES5 TypeScript target, esbuild `platform=neutral`) |
| Illustrator 30.6.0 / ExtendScript 4.5.6 | Verified live (probes + live-verify harness) |
| Node.js ≥ 18 | ESM core + test harnesses |
| Windows x86-64 | Native ExternalObject DLL (`native/`) - Path 2 gate, opt-in |
| Modern JS engines | The core also runs under V8 (used as the fuzz oracle) |

The two paths: the JSX-only path is portable across every ExtendScript host;
the ExternalObject-accelerated path (Path 2) requires Windows x86-64, the
built ESONJson.dll, and the documented per-DLL-build certification
(`probes/eson-corpus-parity.jsx`).

What the ES3 engine lacks, and how ESON handles it: no `JSON`, no `Object.defineProperty`, no `Function.prototype.bind`, no `Array.prototype.indexOf`, no `String.prototype.quote`; the bundle ships an ES3 shim and probes the engine's real source kernels (`uneval` / `toSource` / `quote`) lazily on first facade call (`capabilities()` re-probes).

---

## FAQ

**Is ESON safe? Does it use `eval`?**
The default `parse()` is strict-by-construction: only skeleton-validated text ever reaches `eval`, and the eval is wrapped in a `SyntaxError` catch. The eval-free `decodeSourceChecked()` lane exists for anything that might be corrupted or misrouted. Raw-eval entry points are named `*Trusted` and are the only way to reach the engine's raw eval.

**Will ESON work in my Illustrator / InDesign / Photoshop script?**
Yes, it is a plain ExtendScript file with no host-specific APIs. `$.evalFile` it (or `app.doScript`) and the `ESON` facade is available. Verified live on Illustrator 30.6.0.

**Why not just use json2?**
Because json2 is permissive: 8 documented invalid inputs are accepted (leading zeros, trailing dots, trailing commas, array elisions...). If you ship json2 you ship those holes. ESON keeps json2's (patched) stringify algorithm internally for byte-identical output, but replaces the parse with a strict, eval-wrapped lane.

**Does ESON replace the global `JSON` object?**
Only via the vendor build (`vendor-eson.js`), and deliberately: ExtendScript's native JSON.parse, where present, is the permissive one. The facade-only build (`ESON.jsx`) leaves the global `JSON` alone.

**Can I use ESON in Node.js / with external automation?**
Yes, `dist/eson-core.esm.mjs` is a plain ESM bundle. If you build your own automation layer around ExtendScript (BridgeTalk, `DoJavaScript`-style injection, or any external-tool-to-script pipe), the vendor build is the drop-in JSON layer for it: inject once, get strict `JSON.parse` / `JSON.stringify` in every eval. ESON ships no automation tooling itself; the vendor is designed to drop into whatever you already have.

**Is it fast enough for large payloads?**
At 43 KB, cold strict parse beats json2 by 1.6× (47.7 ms vs 77.7 ms in the live engine), and repeat parses are ~385× faster via the memo. Stringify is at parity with json2 at every measured size.

**Does ESON handle non-ASCII / Unicode?**
Yes, `\u2028`/`\u2029` are sanitized, lone surrogates are escaped while valid pairs stay raw (pair-aware `rx_escapable`), and `charCodeAt`-based scanning avoids the engine's `charAt` NUL bug (see [engine quirks](#engine-quirks)).

---

## Development

```
npm install            # devDeps: esbuild, typescript
npm run typecheck      # tsc --noEmit (strict)
npm test               # 623 Node assertions + differential tests
npm run build          # dist/ESON.jsx + vendor-eson.js + vendor-eson-runtime.js
                       # + ESON-runtime.jsx + json2-reference.jsx + eson-core.esm.mjs
npm run benchmark      # Node-side benchmark pipeline
node tests/json-suite.mjs        # official JSONTestSuite (95 y_ / 188 n_ / 35 i_)
node tests/fuzz.mjs 100000 0x..  # deterministic differential fuzz vs V8
npm run live-verify    # verifies a live probe report (Illustrator running)
npm run native-build   # native/build/ESONJson.dll (Windows; restart Illustrator first)
# live certification of the native gate (per DLL build, in Illustrator):
#   python ILLUSTRATOR_COM_TOOL.py eval --file probes/eson-corpus-parity.jsx
```

Repository layout:

```
eson/
  src/            TypeScript core (ES5 target, ES3-safe; tsc strict clean)
  vendor/         json2.raw.js (build-only raw json2 input)
  tests/          Node harnesses (custom, no framework)
  probes/         live ExtendScript probes (capability, benchmark, transport)
  examples/       runnable ExtendScript examples (see "Runnable examples")
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
- **Trusted transport = toSource + eval (~26 µs round trip).** The documented BridgeTalk pattern; preserves undefined/NaN/functions/dates; ~16× faster than the JSON2 pair (per the measured lanes).
- **Checked lane = eval-free lenient parser.** Accepts what toSource emits for data and rejects functions/new/calls/member access, for caches and payloads that may be misrouted or corrupted.

**The vendor build** (`dist/vendor-eson.js`) is the drop-in replacement for consumer `vendor/json2.js` files. It is the ESON bundle with the patched json2 attached to a private object (`ESON_JSON2`) plus an install footer that makes the global `JSON.parse`/`JSON.stringify` BE ESON's: creating the object when absent, REPLACING an existing parse (ExtendScript's native JSON.parse is the permissive one; the whole point of ESON is the strict parser). The ESON facade is always exposed as `ESON`. The raw json2 survives only as the build-only input `vendor/json2.raw.js`; `eson-build.mjs` reads that, never the vendors.

</details>

<details>
<summary><h2 id="externalobject-abi">The ExternalObject ABI saga (native case)</h2></summary>

The native case (`native/eson_json.c`) went through two empirical rounds,
both live on Illustrator 30.6.0. Round 1 used the POC's *reconstructed* ABI
and mostly failed; round 2 rebuilt it on the **verified** ArcFitEso
prototype (`agent-skills/externalobject-extendscript/prototypes/arcfit-eso/`).

**Round 1 (retired): the reconstructed ABI.** `(void*,void*,void*)` exports,
tags `kTypeString=1 / kTypeInteger=4 / kTypeScript=8`, `_a` signatures, no-op
`ESFreeMem` with static buffers. Findings at the time:

- **String arguments were per-DLL unreliable** — this DLL's string methods
  (`stage`/`validateStaged`/`escapedBytes`/`validateText`) never received a
  string; in the 2026-08-05 re-probe the same set failed in a second
  session. Only `ping`/`version`/`escapeStaged`/`nextByte` bound.
- **Packed UTF-16 transport works end-to-end** (the workaround for broken
  string args): 3 UTF-16 code units per IEEE-754 double (48 exact bits),
  `stagePacked(len, p0, ...)` → `validatePacked` → `evalJson`.
- **A loaded DLL is locked** until the session ends; rebuilds fail until the
  DLL is unloaded or the session ends. Use lettered DLL file names per
  iteration (ESONJsonP, T, U, ...) and unload/terminate instances.

**Round 2 (current): the canonical ABI, verified 2026-08-07.** Rebuilt on
the ArcFitEso prototype — every one of its methods bound and ran on the same
host, and the ESON rebuild (`version` now reports 2) follows it exactly:

- **Tags are the canonical SoSharedLibDefs.h values, not the reconstruction:**
  `kTypeString=4` (verified end-to-end, ~360 KB per direction),
  `kTypeInteger=123`, `kTypeUInteger=124`, **`kTypeScript=125`** (auto-eval
  verified live: the host evaluates the returned script and returns the
  value — the old claim "did NOT fire / tag 8 unverified" is resolved; 8
  was simply the wrong value).
- **Documented `long fn(TaggedData* argv, long argc, TaggedData* retval)`
  prototypes** (not `(void*,void*,void*)`), `_s` signatures on string
  methods, **malloc'd returns + real `ESFreeMem(free)`** (mirrors
  AdobeXMPScript's decompiled contract), non-negative error codes only.
- **Measured channel tiers** (ArcFitEso dataset, same host/version): whole-
  workload-native transforms (validate/escape/base64/hex) are 4,800-11,900×
  and remove the engine wedge; the packed 2-bytes-per-char channel
  (`packBytes`/`unpackBytes`) is 1.75× reads / 3.7× writes; **kTypeScript
  bulk-array chunking loses at every chunk size (dead end)**. Boundary cost
  is ~7 µs/KB, near-linear — MB-scale strings are safe.
- **Channel rules:** NUL truncates the string channel (payloads with U+0000
  are cut); packed values 0xD800-0xDFFF cannot round-trip (surrogate
  window — ASCII/Latin-1 safe, arbitrary bytes travel as hex); signature
  codes cast argument types (`_d` → `kTypeInteger`, accept the whole numeric
  family).
- **JSON as the ExternalObject transport** (via this library):
  ESON.stringify → native `validateText` (one crossing, C validator) →
  ESON.parse, or the packed fallback. The native validator rejects `01` and
  executable payloads before they can run. The packed evalJson auto-eval
  channel (kTypeScript 125) round-trips array/scalar/string payloads only:
  the host evaluates the validated text as a statement, so JSON object
  literals (`{"a":1}`) are a block-label parse error and the C validator
  rejects parenthesized text - object payloads use the string channel. The
  in-engine trusted codec (~26 µs) remains the speed king when native
  validation is not needed.
- **Security posture: the native gate is NOT the default.** `parse()` uses
  the JSX-only path unless `ESON.enableNativeGate()` explicitly certifies
  the DLL: enable-time verdict-parity self-certification on a bundled
  corpus, a channel-safety guard (raw NUL and surrogate code units are
  deferred to the pre-scan - a live exploit check proved NUL payloads could
  otherwise smuggle an executable post-NUL expression past the native
  verdict), and a per-DLL-build full-JSONTestSuite certification run
  (`probes/eson-corpus-parity.jsx`; live result 2026-08-07: y_ 95/95,
  n_ 184/184, i_ identical, zero mismatches). eval stays the grammar
  checker on both paths.
- **Live-corpus findings (2026-08-07) that V8-based testing cannot see:**
  the full n_ run exposed an ExtendScript regex-engine hang on strings
  ending in a lone backslash (`rx_protect`'s alternation-star, fixed with a
  two-pass shape - the exact corpus file `n_string_1_surrogate_then_escape`
  wedged the engine at 100% CPU before the fix), and the pre-scan accepted
  trailing second values (`{"a":1} 1`) which the eval then rejected with
  the engine's raw "Expected: )" instead of ESON's clean verdict (fixed in
  the structural walk). Both have Node regression coverage.

</details>

<details>
<summary><h2 id="known-limitations">Known limitations / open items</h2></summary>

- `stagePacked` host error after C completion (catchable, harmless).
- `stringifyFast`'s preflight costs ~70 µs (the price of the unsupported/cycle contract).
- The native stringify lane (fastRewrite) measured slower than json2 at every size; kept as an opt-in architectural piece and the rewriter test surface.
- The native gate is certified live per DLL build (corpus parity 2026-08-07: y_ 95/95, n_ 184/184, i_ identical, zero mismatches; exploit checks for NUL-truncation and astral-surrogate payloads pass). Re-run `probes/eson-corpus-parity.jsx` after any DLL rebuild - ExternalObject binding is per-DLL-build.
- Path 2 defers (falls back to the pre-scan) on payloads containing raw NUL or surrogate code units - the boundary cannot transport them; the astral case means valid JSON with astral chars (emoji, CJK ext-B) parses at JSX-only speed, not gate speed.
- ExternalObject host errors that bypass JavaScript try/catch are a documented ExternalObject risk class; none were observed with the canonical-ABI build (14/14 methods bound and 1000+ calls in the live sessions).
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

GPL-3.0-or-later. See [LICENSE](LICENSE) (ESON core). The bundled json2 stringify algorithm is derived from Douglas Crockford's public-domain [JSON-js](https://github.com/douglascrockford/JSON-js), with the ExtendScript-specific fixes documented in this README.

---

<p align="center"><small>ESON: ExtendScript Object Notation. Built for the engine, measured on the engine, strict by default.</small></p>

---

<div align="center">

<div align="center">

<img src="https://i.ibb.co/k200gFnW/arcfit-banner-dark-1.png" width="800" alt="ArcFit.dev banner"/>

</div>

### "Why does my warp keep changing?"

Illustrator's arc warp measures its envelope from **everything**, including geometry hidden inside clipping masks. Unhide a layer, tweak a hidden group, and the same design warps differently. Nondeterministic warps, manual fixups, mystery.

**ArcFit.dev warps to your dieline, not to your hidden junk.** Clipped geometry is ignored, the envelope is deterministic, and your final dimensions stay exactly as designed. The warp you get is the warp you shipped.

[**arcfit.dev**](https://arcfit.dev)

</div>

---

## ESPACK: self-extracting single-file bundle (`ESON.accel.jsx`)

ESON is the second espack consumer (after esb64): `dist/ESON.accel.jsx` is a
single-file bundle that carries **ESONJson.dll as the espack payload** plus
the shared esb64 accelerator (the espack "1 + n" model). On eval it:

1. extracts the shared accelerator once per system (`%LOCALAPPDATA%\espack\`),
2. natively unpacks `ESONJson.dll` to `%LOCALAPPDATA%\eson\`,
3. loads it via `ExternalObject` and **auto-enables the native gate** with the
   espack-provided lib — verdict-parity certification (76 cases) runs at
   enable, exactly like the manual `enableNativeGate({ dir })` path.

Build: `npm run build:accel` (requires `npm run native-build` + the sibling
`espack` repo). Live-verified on Illustrator 30.6.0 (`npm run accel-live`):
gate enabled + certified, gate-ON vs gate-OFF verdict parity on 28 valid/
invalid cases, and the facade stays stable on `$.global` (the bundle installs
the ESON vendor semantics `JSON = ESON`, which satisfies the COM tool's ESON
share-check). `ESON.useEspack()` is the idempotent opt-in form; the outcome
is on `ESON.espack`.

Measured (30.6.0, live): parse with the native gate ON ≈ 191 µs vs OFF
≈ 179 µs at 48,976 chars — the current pre-scan is ~3.7 µs/KB, so the gate
is parity-speed today (the historical 14-17× native win was against the old
pre-scan); its value is the certified RFC-exact native verdict + single-file
delivery. The esb64 btoa/atob acceleration (58-70×) is the big espack win.

### ESON core fix shipped with this integration

The engine truncates object property names at U+0000 (measured live on
30.6.0: `o['a\u0000b'] = 1` stores the key `'a'`). ESON's parse verdict memo
therefore collided on raw-NUL texts: parsing the invalid corpus case
`{"a":1}\u0000,1` wrote its error entry under the truncated key `{"a":1}`,
poisoning every later parse of the valid text. Fixed in `src/parse.ts`
(`memoEligible`): NUL-bearing texts are never memoized (read or write) — the
memo can never answer for a different text. Covered by the existing 624
assertion suite; regression-verified live.
