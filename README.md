# ESON — ExtendScript Object Notation (prototype)

## Why ESON exists

json2 is the de-facto ES3 JSON library, and in the Adobe engine it is *fast*
at small sizes — but "fast" is relative, and "correct" is not a given. Two
problems drove ESON:

1. **json2 is permissive.** Its gate accepts `01`, `1.`, `1.e5`, raw tabs and
   trailing commas (live gate-parity check: **8 documented invalid inputs
   accepted by JSON2 vs 0 by ESON**). And ExtendScript has no native JSON at
   all (capability probe: global `JSON` absent) — any JSON service has to be
   shipped, and shipping json2 means shipping its holes.
2. **json2's cost scales badly in the ES3 engine.** Its skeleton gate runs
   multiple full-text regex passes (~1.4 µs/byte at 43 KB — the reference
   parse costs 77.7 ms there); its stringify pays a per-string
   callback-replace escaping tax (~0.3 µs/byte); and the engine's per-char
   interpreter loops cost ~1.26 µs/char (§2). The textbook algorithms are the
   wrong primitives for this engine.

ESON's answer is to brute-force the fastest path from the engine's **own
measured primitives** (nothing is assumed — §1/§2 are live measurements):

- **eval is the native grammar checker** (~0.06 µs/byte, the cheapest
  primitive measured): the parse is pre-scan + sanitize + eval with a
  SyntaxError catch (`src/parse.ts`, the only direct eval isolated in
  `src/eval-lane.ts`). The pre-scan (`src/validate.ts`) proves complete
  eval-ability using native regex passes — no per-char loops in the hot path;
  the sanitizer is narrowed to `[\u2028\u2029]` only; the comma rules are
  folded into ONE regex over the collapsed struct (scan-split).
- **Every repeated cost is memoized**: an 8-entry value-keyed verdict LRU
  skips pre-scan + eval on repeat parses (`parseJson` — 47.7 ms cold → 124 µs
  at 43 KB); the stringify quote memo caches escaped strings per call
  (patched in `vendor/json2.raw.js`, ~14% on repeated-key payloads).
- **The bundle is slimmer than json2 itself**: the vendored `ESON_JSON2` is a
  stringify-only tree-shaken slice — its parse block is removed at build time
  (`eson-build.mjs`), so the full strict parser ships once, not twice.
- **Strictness is certified, not claimed**: JSONTestSuite 95/95 + 188/188 +
  35/35 with zero V8 divergence, 330k+ deterministic fuzz iterations with
  zero divergence, 0 invalid inputs accepted (gate-parity contract vs JSON2's
  documented 8 — checked live in `probes/eson-benchmark.jsx`).

The prototype lives at `eson/`. Measured 2026-08-05 in the
Illustrator engine (ExtendScript ES3, 30.6.0) via `probes/eson-benchmark.jsx`
(median-of-200 µs, `.hiresTimer`, cold lanes with unique text per iteration
so the verdict memo never hits).

### ESON (new) vs JSON2 (old) — the operators both implement

| Operator | Payload | JSON2 (old) | ESON (new) | Δ (old ÷ new) |
|---|---|---|---|---|
| parse (cold, strict) | settings 345 B | 280 µs | 277 µs | 1.0× |
| parse (cold, strict) | profiles6 1.7 KB | 1.3 ms | 1.3 ms | 1.0× |
| parse (cold, strict) | profiles150 43 KB | 77.7 ms | **47.7 ms** | **1.6×** |
| stringify | settings 345 B | 141 µs | 145 µs | 1.0× |
| stringify | profiles6 1.7 KB | 585 µs | 571 µs | 1.0× |
| stringify | profiles150 43 KB | 13.7 ms | 13.7 ms | 1.0× |

Δ = JSON2 ÷ ESON: **1.0× = parity, >1× = ESON faster**. Parse wins at size
(the eval-based lane scales ~1.6× better at 43 KB; see §8 for the 157 KB
history); stringify is at parity on these payloads — the quote memo's
per-call init is the settings-size cost and these payloads repeat few keys
(the memo pays off on repeated-key payloads, see §8).

### ESON-only operators (same run)

| Operator | settings 345 B | profiles6 1.7 KB | profiles150 43 KB | What it is |
|---|---|---|---|---|
| parse — memo hit | 3 µs | 11 µs | 124 µs | repeat parses skip pre-scan + eval entirely (~1000× vs cold) |
| `stringifyFast` (certified) | 213 µs | 1.0 ms | 22.7 ms | preflight adds the unsupported/cycle contract |
| trusted round-trip (`encodeSource` + `decodeSourceTrusted`) | **26 µs** | — | — | toSource + eval; preserves undefined/NaN/functions/dates |
| raw `toSource` (engine baseline) | 5 µs | 40 µs | 731 µs | the fastest primitive, un-safety-checked |
| raw `eval` (engine baseline) | 15 µs | 91 µs | 2.8 ms | the fastest parse, un-safety-checked |

Same-run correctness checks: stringify byte-equal to the JSON2 reference on
all three payloads; 0 invalid inputs accepted by ESON (JSON2's documented 8
stay accepted — the gate-parity contract).

Verified: 623 Node assertions, 165 live-verify checks, **36/36 byte-equal
differential** vs the JSON2 reference in the live engine, 0 invalid inputs
accepted (JSON2's documented 8 stay accepted).

---

## 1. The measured engine (quirks that shape everything)

All measured live on Illustrator 30.6.0 / ExtendScript 4.5.6. Several are not
documented anywhere else we could find.

### 1.1 String semantics
- **`String.prototype.charAt()` returns `""` for U+0000.** NUL is treated as a
  terminator. `charCodeAt()` works fine. Every string scanner must use
  `charCodeAt` (or `String.fromCharCode(code)`). Reproduction:
  `'"\u0000"'.charAt(1) === ''` while `charCodeAt(1) === 0`.
- `Array.prototype.join` and `String.fromCharCode` preserve NUL correctly;
  `indexOf` works on NUL-containing strings.

### 1.2 Parser mis-compilation (real, reproducible)
- **Chained ternaries compile left-associatively (C-style).**
  `a ? b : c ? d : e` evaluates as `(a ? b : c) ? d : e`. This silently broke
  json2's `partial.length === 0 ? "[]" : gap ? A : B` empty-container
  shortcut (empty arrays stringified as `[\n\n]`). The fix is to never nest
  ternaries — use `if/else`.
- **Mixed `&&`/`||` chains without parentheses mis-evaluate.**
  `c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || ...` evaluates to `false`
  for `'n'` even though the first clause is true, while the parenthesized
  form is true. Every mixed chain must be restructured to pure-`||` chains of
  pure-`&&` helpers (or fully parenthesized in a way esbuild preserves —
  see 1.4).

### 1.3 Regex engine
- **Anchored `^(?:...)*$` alternation regexes with lookaheads hang.**
  The strict one-pass gate `^(?:"..."|-?...(?![\d.])|...|[\],:{}\s])*$`
  never terminates on some inputs (exponential backtracking). Never use
  lookaheads inside alternation-star loops.
- **`String.prototype.replace` callback `offset` is wrong.** It tracks the
  position in the *partially-replaced* string, drifting by prior replacement
  lengths (e.g. after replacing `"a"` (3 chars) with `]` (1 char), the next
  callback's offset is 2 less than the true position). Never use the callback
  offset for positional checks; track positions manually or check the source
  text with dedicated regexes.
- Simple patterns are fast; pattern complexity dominates cost (see §2).

### 1.4 Bundling (esbuild 0.28.1)
- **esbuild strips "redundant" parentheses**, including corrective parens
  around inner ternaries (`a ? b : (c ? d : e)` → `a ? b : c ? d : e`), which
  re-introduces the 1.2 ternary bug into the bundle. Source-level parens are
  not a fix — restructure the code instead.

### 1.5 Environment
- No `JSON`, `Object.defineProperty`, `Function.prototype.bind`,
  `Array.prototype.indexOf`, `String.prototype.quote`. `uneval` **exists**
  (not an own property of `$.global` — probe lexically too); `toSource`
  exists on Object/Array/String prototypes.
- `$.hiresTimer` is a signed 32-bit µs counter (wraps every ~35.8 min) —
  reject wrap-corrupted samples (`d < 0 || d > 10s`), don't adjust.
- String concatenation in a loop is effectively quadratic (256 K appends took
  minutes) — build strings with arrays + `join`.
- The engine is not Node and has no CEP layer.

---

## 2. Primitive cost table (microbenchmarked)

| Primitive | settings 345 B | 1.7 KB | 43 KB |
|---|---|---|---|
| `charCodeAt` loop | 434 µs | 2.2 ms | 54.7 ms | (~1.26 µs/char)
| `indexOf` | 1 µs | 1 µs | 1 µs |
| regex `.test` (simple class) | 2 µs | 2 µs | 2 µs |
| regex replace w/ callback (complex) | 300 µs | 1.6 ms | 51.8 ms |
| json2 4-pass gate | ~150 µs | ~1 ms | ~53 ms |
| `eval('(' + t + ')')` | 14 µs | 88 µs | 2.5 ms |
| `toSource()` (object) | 5 µs | 29 µs | 725 µs |
| `JSON2.stringify` (whole object) | 104 µs | 537 µs | 13.6 ms |

Implications: per-char interpreter loops are the enemy; per-op regex cost is
~50–150 µs regardless of text size; **short-string per-property work beats
whole-text regex passes at every measured size** — this is why json2's
recursive algorithm wins for strict stringify in this engine.

---

## 3. Architecture

```
ESON facade
  parse(text, reviver)            strict: pre-scan + sanitize + eval (eval-only
                                  hybrid; see §8 - json2.parse no longer exists
                                  in the bundle)
  stringify(value, replacer, space)  strict: delegates to the patched json2 algorithm
  stringifyFast(value, opts)      certified lane: preflight + json2.stringify
  parseTrusted / decodeSourceTrusted  raw eval (the ONLY eval path; named explicitly)
  decodeSourceChecked(source)     eval-free lenient parser (source-literal subset)
  encodeSource(value)             SpiderMonkey source generation (uneval/toSource)
  capabilities() / benchmark() / install()
```

### Why these choices (each with the measured evidence)
- **Strict stringify = the patched json2 algorithm** (delegation). A
  byte-identical reimplementation measured 2.1× slower (223 vs 105 µs); the
  native lane (normalize → toSource → rewrite) measured ~9× slower (the
  rewrite's ~30 per-token regex ops at ~50–150 µs each). The only patch
  needed is the ternary fix (§1.2).
- **Strict parse = eval-only hybrid (json2's gate removed).** json2's own
  gate is fast (~280 µs at 345 B) but accepts `01`, `1.`, `1.e5`, raw tabs,
  and trailing commas. The strictness pre-scan now proves complete
  eval-ability itself (token grammar via the allowed-charset check,
  identifiers limited to true/false/null, JS-only escapes rejected, leading
  dots and member-access dots rejected, number boundaries, comma rules,
  depth cap) — the parse is pre-scan + sanitize (`[\u2028\u2029]` only) +
  eval with a SyntaxError catch; the eval is the native grammar checker at
  ~0.06 µs/byte and json2's skeleton gate is skipped entirely (the bundled
  `ESON_JSON2` is a stringify-only slice — its parse block is tree-shaken
  out at build time). Pre-scan zero-false-reject is certified by fuzz
  accept-parity + the JSONTestSuite must-accept corpus. Full history in §8.
- **Trusted transport = toSource + eval (25 µs round trip).** The documented
  BridgeTalk pattern; preserves undefined/NaN/functions/dates; 12× faster than
  the JSON2 pair.
- **Checked lane = eval-free lenient parser.** Accepts what toSource emits for
  data (identifier keys, parens, `undefined`, `NaN`, `Infinity`, JS escapes)
  and rejects functions/new/calls/member access before anything can run —
  for caches and payloads that may be misrouted or corrupted.

### Security model
- `parse()`: only skeleton-validated text ever reaches `eval` (a
  replace-then-check pipeline; the skeleton contains only
  `[ ] { } : ,` whitespace and token placeholders — probe42-class payloads
  leave non-skeleton characters and are rejected).
- `decodeSourceChecked()`: no eval at all.
- `parseTrusted`/`decodeSourceTrusted`: the only raw-eval entry points,
  visibly named; no prefix/extension/checksum heuristic routes anything there.
- Strictness holes closed: leading zeros (`01`, `-00`, `[1,01]`), trailing
  dots (`1.`, `1.e5`), raw control chars in strings, trailing commas,
  number-token adjacency (`1-2`), nesting depth > 512.

---

## 4. The ExternalObject ABI saga (native case)

The native case (`native/eson_json.c`) was an empirical expedition. Findings:

- **Direct-access ABI**: `(TaggedData *argv, intptr_t argc, TaggedData *result)`;
  exports work best declared as `(void *p1, void *p2, void *p3)`; numeric
  results as double with tag 3; bare export names (signature codes live only
  in the ESInitialize string); ESFreeMem conservative no-op + static buffers
  (a real `free()` on a static buffer would crash).
- **String arguments are per-DLL unreliable.** The chunkdb POC DLL's `stage`
  received strings fine; our DLL's string methods never did (`raw_string_arg`
  rejected the arriving TaggedData). Same signature codes, same read pattern.
  Never assume string args work — test each DLL.
- **Per-method binding flakiness.** On the same DLL, some methods bind and
  run (`ping`, `version`, `escapeStaged`, `nextByte`, `resetState`, plus
  whatever new first entries you add) while others throw `"is not a function"`
  or `"Error #"` even though they are in the signature and exported. The
  pattern is per-DLL and per-method, not determined by name, code, order, or
  export shape (we tested all four). The chunkdb's own DLL showed the same
  class of failures in our session (its `ping`/`version`/`resultLength`
  failed; `add`/`stage`/`nextByte`/`resultByte` worked).
- **Some host errors bypass JavaScript `try/catch` entirely.**
  `"Error #"` and `"Language feature '' is not supported"` killed the eval
  from inside guarded try blocks (the outer COM wrapper still caught them).
  Never assume an ExternalObject call is containable.
- **Numeric arguments are reliable** (~1 µs boundary, measured). This is the
  basis of the packed transport.
- **Packed UTF-16 transport works end-to-end** (the workaround for broken
  string args): pack 3 UTF-16 code units per IEEE-754 double (48 exact bits),
  send `stagePacked(len, p0, ...)`, validate with the native UTF-16 validator
  (`validatePacked`), and either drain numbers or return text.
- **kTypeString returns work for some methods** (the validated text came back
  intact). **kTypeScript auto-eval did NOT fire** — the enum value (8) in the
  POC reconstruction is unverified (the POC's own observations contradict it:
  strings arrived with tag 4, not the reconstructed 1). A 17-method tag sweep
  could not complete: only tag 0's method bound (and it correctly returned
  `undefined` per its tag, proving the host reads the tag) while every
  string-returning method threw the same host `"Error #"`. The real value
  needs Adobe's `ESExternalObject.h`/`ScriptLib.h`.
- **A loaded DLL is locked** until the session ends — rebuilds fail with
  LNK1104. Use numbered DLL file names per iteration (ESONJson2, 3, ...) and
  unload/terminate instances; clean up after.
- **JSON as the ExternalObject transport** (via this library): ESON.stringify
  → pack → native validate → kTypeString return → ESON.parse. Demonstrated
  live: valid round trip restores the object; `01` and executable payloads
  are rejected natively (`probe42` never set). **609 µs warm** (pre-packed),
  ~1 ms cold — the best functional ExternalObject transport; the in-engine
  trusted codec (25 µs) remains the speed king when native validation is not
  needed. `stagePacked` still triggers a catchable host error after the C
  completes (harmless).

---

## 5. Repository layout

```
eson/
  src/            TypeScript core (ES5 target, ES3-safe; tsc strict clean)
    validate.ts   regex gate + strictness pre-scan + scanner (parallel validators)
    parse.ts      strict parse (eval-only hybrid), checked decode, evalSource
    eval-lane.ts  the ONLY direct eval (evalSourceImpl) - isolating it lets
                   tree-shaking drop the parser from the runtime bundles
    runtime.ts    runtime-only entry (parse+stringify core; no caps/rewrite/
                   trusted/fast) - the COM tool's slim vendor
    stringify.ts  strict stringify (json2 delegation), fast lane preflight
    rewrite.ts    native-source rewriter: fastRewrite (opt-in) + scanner fallback
    parser.ts     eval-free lenient/strict parser (checked lane)
    normalize.ts  Stage-A shadow graph (native-lane semantics)
    source-kernel.ts / trusted.ts / caps.ts / json2.ts / reviver.ts / index.ts
  vendor/         json2.raw.js — BUILD-ONLY raw json2 input (the production
                   vendors hold the ESON build instead)
  tests/          Node harnesses (custom, no framework): 623 assertions +
                   json-suite.mjs (JSONTestSuite) + fuzz.mjs (differential) +
                   vendor-verify.mjs (sandboxed install semantics) +
                   eson-live-verify.mjs (live-verify driver)
  probes/         live ExtendScript probes (capability, benchmark, microbench,
                   packed transport, JSON-transport demo, vendor-live check)
  native/         eson_json.c + eson_abi.h + build.ps1 (MSVC 2019 BuildTools)
  dist/           ESON.jsx (bannerless; private stringify-only json2 slice
                   ESON_JSON2 - tree-shaken by eson-build.mjs; the ternary
                   parens / pair-aware rx_escapable / quote memo live in the
                   raw), vendor-eson.js (production vendor - copied to the two
                   vendor/json2.js locations), vendor-eson-runtime.js (runtime
                   vendor - copied to the COM skill's vendor/json2-runtime.js),
                   ESON-runtime.jsx, json2-reference.jsx (full raw standalone
                   `JSON2` for the probes' differential lanes),
                   eson-core.esm.mjs
```

## 6. Build / test / run

```
cd eson
npm install
npm run typecheck
npm test
npm run build
npm run native-build
node tests/json-suite.mjs
node tests/fuzz.mjs 100000 0x..
```

Live-run lesson: bound payload sizes and iteration counts (256 KB × 40
iterations ran for minutes; byte-drain lanes are per-byte and must be
one-shot). Write benchmark results to disk incrementally (uncatchable host
errors can kill a long eval and lose everything).

## 8. Production prep (2026-08): spec validation, fuzzing, vendor swap

### Spec validation — official JSONTestSuite (nst/JSONTestSuite)

`node tests/json-suite.mjs` runs every `test_parsing` case through `parseJson`:
**95/95 must-accept, 188/188 must-reject, 35/35 implementation-defined with
zero crashes, zero V8 divergence.** Fetch the suite into `%TEMP%\JSONTestSuite`
(`tests/json-suite.mjs [path]` accepts a custom location). Encoding-level cases
(files whose invalid UTF-8/UTF-16 bytes get decoded before a string-based
parser can see them) are classified as out of contract, with the reason in the
runner.

The suite exposed four real strictness holes, all fixed in `validate.ts`:
- the depth walk counted brackets inside string literals (a key `"b]"` or a
  value `",}P "` drove depth negative — false rejects);
- the sanitizer legalized invalid `\` + U+00AD/U+2028/29 sequences into
  `\\uXXXX` (invalid escape in the original text must be rejected; only an
  ODD backslash run counts);
- skeleton-invisible violations: bare object keys (`{1:1}`), leading/doubled
  commas (`[,1]`), top-level comma-operator text (`2.1,3` — the eval accepts
  it as JS);
- the leading-zero check tripped on exponent digits (`1e02`, `1e-02` are
  valid; the exponent mask is digit-anchored so `true-47883` is NOT masked
  and the `-`-after-token rule rejects it as an arithmetic operator).

### Parse pre-scan merge (measured speedup)

The strictness pre-scan was a stack of ten full-text passes (two charCodeAt
walks at ~0.85 us/byte each, five positional regex tests at ~0.33 us/byte
each, a callback-protect pass, two walks for depth/comma). Merged into five
passes: fixed-`@` protect (no callback), the digit-anchored exponent mask,
ONE combined positional regex (bare keys + leading zeros + minus-operator +
trailing dots + member-access dots), and ONE structural scan (value runs
collapse to `_` via a native regex; the scan then walks a short structural
string checking depth, balance, cap, and every comma rule). Live benchmark
(median-of-200, Illustrator 2026): eson.parse 1028 -> 409 us (settings,
2.5x), 4982 -> 2550 us (profiles6, 2.0x), 156973 -> 105357 us (profiles150,
1.5x) at the merge stage; the eval-only stage (below) brought those to
400/1877/78285 us.
Lesson: in ExtendScript, interpreted charCodeAt loops (~1 us/char) are the
most expensive primitive; move work into native regex passes and shrink what
a loop must walk.

### Eval-only hybrid (json2's gate removed)

`parseJson`'s fast path no longer delegates to json2.parse at all: the
strictness pre-scan now proves the complete eval-ability (token grammar via
the allowed-charset check, identifiers limited to true/false/null, JS-only
escape sequences like `\q`/`\x41`/octal/`\v` rejected, leading-dot and
member-access dots rejected, number boundaries, comma rules, depth) and the
parse is pre-scan + sanitize + eval with a SyntaxError catch. json2's own
gate (its 4-pass skeleton, ~1.4 us/byte) is skipped; the eval alone is the
native grammar checker (measured ~0.06 us/byte). The pre-scan is certified
zero-false-reject by the fuzz accept-parity (accepting inputs must not fall
through to the gate) and the JSONTestSuite must-accept corpus. The fuzz
found and the checks now close: `[3[4]]` (member access), `{}.false`
(member-access dot), `[- 1]` (space after minus), `"\q"`/`"\uD83C"` (identity
escapes), `1\u00A0` (JS `\s` is not JSON whitespace - the allowed-charset
uses explicit `\t\n\r `).
The sanitizer was narrowed to `[\u2028\u2029]` only: those are the sole
eval-unsafe raw characters (JS line terminators). The legacy json2 sanitizer
also converted U+00AD/U+0600-0604/U+200C-200F/U+FEFF/U+FFF0-FFFF etc, but
those are all eval-safe raw chars, and converting them fired the pathological
callback-replace on every payload containing e.g. U+00A0 (measured ~2.2
us/byte - the dominant hidden parse cost on real-world payloads).

Live benchmark (median-of-200, Illustrator 2026, final eval-only state, cold
lanes with unique text per iteration so the memo never hits): eson.parse
1028 -> 321 us (settings, 3.2x), 4982 -> 1541 us (profiles6, 3.2x),
156973 -> ~60 ms (profiles150, ~2.6x; this size is noise-dominated,
+/-10% run-to-run). Memo-hit lanes: 3/7/125 us. At 43KB the strict parse
now BEATS json2's permissive parse (56.6ms vs 62.9ms).
(Payload note: these stage numbers used the then-current ~157 KB benchmark
payload; the probe's profiles150 payload is now 43 KB (150 records) - the
top table holds today's numbers.)
The structural scan was split: the comma rules (leading/doubled/trailing)
and the value-before-open-bracket rule moved into ONE native regex over the
short collapsed struct (the regex cost scales with the struct, not the
input text), leaving the walk only the depth cap + balance + the top-level
comma (the eval's comma-operator - its depth-0 position is not regexable
without the hang-adjacent alternation-star shape). Measured 10.2ms -> 6.0ms
on the scan at 15.9KB (1.72x), ~10% on the cold parse at the CoV-stable
sizes.
Two fast-path bugs found by audit and fixed: the exponent mask marker was
'X' (a letter - the identifier check then rejected every exponent number,
routing them to the gate path) - now '#'; and the allowed-charset lacked
'+' (0e+1/1E+2 false-rejected at the charset) - now included, with a '\+'
alternative in rx_positional for surviving plus signs. The strict protect
(RFC-valid strings only) made the dedicated controls/js-escape raw checks
redundant: malformed strings leave their opening quote as residue which the
allowed-charset rejects - pass count 9 -> 7.
(A stale-bundle measurement pitfall: the dist bundle must be rebuilt after
parse.ts/validate.ts edits - the compiled parseJson is easy to miss and the
benchmark silently measures the old lane. The benchmark's parse lane must
also use unique text per iteration - the verdict memo otherwise turns the
cold lane into a memo-hit lane.)

### Verdict memo (value-keyed, 8-entry LRU)

`parseJson` memoizes the parsed result (or the rejection) per input text with
an `Object.prototype.hasOwnProperty`-guarded map and a `__proto__` write
guard (a plain-object assignment would set the prototype - pollution).
Identical text parsed repeatedly - benchmarks, library loops, cache reads,
the COM tool's repeated envelope work - skips the pre-scan + eval entirely
on hits: measured 400 -> 3 us (settings), 1877 -> 6 us (profiles6),
78.3 ms -> 43 us (profiles150, old ~157 KB payload; today's 43 KB payload:
47.7 ms cold -> 124 us memo) for repeat parses. Revivers bypass the memo;
the guard makes `{"__proto__":...}` parse correctly on every call. Cold
parses pay ~1 hasOwnProperty lookup + one map write (~2-5 us).

### Stringify-side optimization round (json2 tree-shake + quote memo)

The bundled json2 is now a stringify-only slice: `eson-build.mjs` removes the
parse block and the dead parse-side declarations (rx_one..rx_four +
rx_dangerous), unwraps the always-true stringify guard, and drops the
toJSON-polyfill block (`Date`/`String`/`Number.prototype.toJSON` exist
natively — live-probed) — the `ESON_JSON2` section is 7,951 B. The parse
moving into `src/eval-lane.ts` lets tree-shaking drop the ~10 KB parser from
EVERY bundle (the runtime vendor is 15.4 KB, ESON.jsx 52.9 KB).

Stringify micro-opts in the raw (semantics-preserving): `hasOwn` wired into
the for-in sites, `partial[partial.length] =` over `partial.push`, and the
ES2019 space truncation (string space >10 chars / number >10 capped at 10 —
the one spec-driven behavior change).

Quote memo (per-call, 128-insert cap): `quote` caches escaped strings per
outermost `JSON.stringify` call in a `hasOwn`-guarded object with a
`__proto__`-write guard; stateless across calls, self-healing on exceptions.
Node-measured: -14% on a 121.6 KB repeated-key payload, neutral on
all-unique keys, +0.4-1 us/call on ~500 B payloads (negligible); byte-identical
output verified against the un-memoized lane (incl. lone surrogates and
\u2028/\u2029). The linear-LRU variant measured decisively worse (+135-218%)
and was rejected.

### txt reader vs ESON — ArcFit persistence A/B (live ES3, 2026-08-05)

Direct comparison of ArcFit's text persistence methodology (the key=value
line scanners in `arcfit/src/core/settings.ts` / `profiles.ts` —
`parseSettings`/`parseProfiles`/`serialize*`) against ESON parse/stringify on
equivalent payloads, run in the Illustrator engine (ExtendScript ES3, 30.6.0)
via a bundled probe dispatched with the COM tool's `eval --file` (auto-routed
through `$.evalFile`; results returned through the envelope). Median us,
warmup 4, per-iteration unique text (defeats the verdict memo — this is the
cold lane); txt-parse and ESON-parse results were cross-validated field-equal
on all three payloads.

| Lane | txt reader | ESON JSON | Ratio (eson/txt) |
|---|---|---|---|
| settings parse (384 B vs 436 B) | 154 us | 271 us | 1.8x |
| settings write | 10 us | 174 us | 17x |
| profiles6 parse (1.4 KB vs 1.7 KB) | 733 us | 1.7 ms | 2.3x |
| profiles6 write | 45 us | 588 us | 13x |
| profiles150 parse (94.5 KB vs 121 KB, 420 recs) | 51.5 ms | 197.7 ms | 3.8x |
| profiles150 write | 3.0 ms | 38.8 ms | 13x |

Conclusion: in the ES3 engine the txt methodology beats ESON on every lane —
parse ~2-4x faster (no eval, no pre-scan), write ~13-17x faster (plain concat
vs the escaping regex at ~0.3 us/B). ArcFit's persistence stays on the txt
format; ESON JSON remains the COM/transport format, where its write lane is
the weakest point. (For reference: this payload's cold ESON parse ran ~1.6
us/B vs the ~0.4 us/B of the earlier 157 KB eson-benchmark profile — the
pre-scan rate is content-dependent.)

### Deterministic differential fuzzing

`node tests/fuzz.mjs [iters] [seed]` (hex seeds via `Number('0x..')`):
- four lanes — valid generator (budgeted recursion, ~30 KB doc cap), char-level
  mutation, structured violations, random junk;
- oracle: V8's native `JSON.parse` (RFC-exact) — accept must match, values must
  deep-equal, ESON stringify must re-parse (under V8 and ESON) to the canonical
  JSON projection (non-finite numbers serialize as `null` in V8 too);
- byte-parity with V8's stringify is deliberately NOT asserted: json2's
  `rx_escapable` escapes the "dangerous" chars (U+00AD, U+2028-202F,
  U+200C-200F, U+FEFF...) while V8 emits them raw — both spec-valid, both
  lossless;
- result: 330,000+ iterations across four distinct seeds, **zero divergences**,
  heap steady (~120 MB);
- fuzzer-side lessons: the size budget must live INSIDE the generator (a
  depth-6 full tree renders ~4.7 MB and kills GC); the rng must be a single
  uniform 0..1 draw (`a / 2^32` — a two-term sum silently spans 0..2 and
  distorts every derived distribution).

### The production vendor — json2 sneakily bundled inside ESON

`dist/vendor-eson.js` is the drop-in replacement for the two `vendor/json2.js`
files (arcfit + the COM skill, identical). It is the ESON bundle with the
patched json2 attached to a private object (`ESON_JSON2`) plus an install
footer that makes the global `JSON.parse`/`JSON.stringify` BE ESON's (creating
the object when absent, REPLACING an existing parse — ExtendScript's native
JSON.parse is the permissive one and accepts `[01]`, `[1.]`, bare keys and
trailing commas; the whole point of ESON is the strict parser). The ESON
facade is always exposed as `ESON`. The raw json2 survives only as the
build-only input `vendor/json2.raw.js`; `eson-build.mjs` reads that, never the
vendors.

Verified: sandboxed vm install semantics (create / attach / replace / reviver)
and a live Illustrator run (`probes/eson-vendor-live.jsx`) — round-trips,
strictness rejects, deep-nesting cap, in-string brackets, escaped-backslash
dangerous chars, reviver, facade, private json2 all pass live.

## 9. Known limitations / open items

- kTypeScript tag value unverified (needs the real SDK header).
- `stagePacked` host error after C completion (catchable, harmless).
- `stringifyFast`'s preflight costs ~70 µs (the price of the
  unsupported/cycle contract).
- The native stringify lane (fastRewrite) measured slower than json2 at every
  size — kept as an opt-in architectural piece and the rewriter test surface.
- `node_modules` must be installed locally (`npm install`) for build and
  test tooling (esbuild, typescript).
- Locked DLLs in `native/build/` (ESONJsonFinal/P/T/U/V) are deletable after
  an Illustrator restart.
