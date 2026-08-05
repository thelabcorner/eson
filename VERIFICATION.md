# ESON README Verification & Remediation Register

Status: **IN PROGRESS** (4 validation agents complete, 6 fix agents dispatched)
Date: 2026-08-05

## Purpose

Track the full claim-by-claim audit of `README.md` against the current ESON
codebase state, and coordinate 6 parallel fix agents so their edits do not
conflict.

## Method

- 4 parallel `general` subagents each validated a README section against the
  source tree (`src/`, `tests/`, `probes/`, `native/`, `eson-build.mjs`,
  `package.json`, `tsconfig.json`, `LICENSE`, `dist/` artifacts).
- Verdicts: `VERIFIED` (supported by artifact), `WRONG`/`STALE` (contradicts
  artifact), `UNVERIFIABLE` (live-measured or run-history claim, no in-repo
  artifact), `NUANCE` (accurate with qualification).
- Fix agents apply corrections; each must claim its items on this register
  before editing and mark state as it goes.

## Legend

| Mark | Meaning |
|---|---|
| [ ] | not yet claimed / not started |
| [~] | claimed or in progress |
| [x] | fixed and verified |
| [k] | keep as-is (measured claim, or verified correct) |

---

## Consolidated findings (validation round, 4 agents)

### A. Hero, badges, Why ESON, Features (README lines 1-82)

| # | Location | Claim | Verdict | Evidence / correction |
|---|---|---|---|---|
| A1 | line 50 | "2009-era Crockford" | WRONG | vendored `vendor/json2.raw.js:1-2` is dated **2023-05-10** |
| A2 | line 50 | "has no native JSON object" | NUANCE | base engine lacks JSON (`caps.ts:3`), but hosts can expose a permissive one (`eson-build.mjs:195-197`); README:508 already hedges "where present" |
| A3 | line 59 | json2 accepts `{a:1}` bare keys | WRONG | json2's gate rejects bare alpha keys; it accepts `{1:1}` (numeric key). Example should be `{1:1}` |
| A4 | line 63 | "8 documented invalid inputs accepted by json2, 0 by ESON" | VERIFIED | live probe `eson-benchmark.jsx:138-151`; counted 8 = `01, -01, 00, -00, 1., [1,], {"a":1,}, [,]` (no bare keys, no raw controls) |
| A5 | line 76 | bullet "Eval-free by default" | WRONG wording | default `parse()` DOES eval (pre-scan-gated, `parse.ts:52-59`); eval-free applies only to `decodeSourceChecked` |
| A6 | line 77 | "~1000× faster ... (47.7 ms cold -> 124 µs)" | WRONG | 47.7 ms / 124 µs = **~385×** (README's own tables imply 92-118x on smaller payloads) |
| A7 | line 78 | "in ~26 µs" trusted round-trip | NUANCE | measured on the small settings payload, not on exotic-value payloads |
| A8 | line 79 | "623 Node assertions" | VERIFIED | `npm test` run = exactly 623 |
| A9 | line 79 | "zero V8 divergence" | NUANCE | reported observation; suite runner counts, does not fail-gate V8 diffs |
| A10 | line 10 badge | JSONTestSuite "95/95 / 188/188" | MINOR | omits the 35/35 implementation-defined corpus |
| A11 | line 14 badge | "GNU GPL v3" | MINOR | `package.json:22` + `LICENSE:639` say **GPL-3.0-or-later** |

### B. Which build, examples, Installation (README lines 84-195)

| # | Location | Claim | Verdict | Evidence / correction |
|---|---|---|---|---|
| B1 | line 91 | `ESON-runtime.jsx` is a usable runtime build file | WRONG | `dist/ESON-runtime.jsx` is a bare esbuild bundle: no `ESON_JSON2` wrapper, no ES3 shim, no install footer; `ESON.stringify` throws (`runtime.ts:19-21`). Usable runtime artifact is `vendor-eson-runtime.js` only |
| B2 | line 92 | size "52.9 KB" for both full files | MINOR | `ESON.jsx` 52,952 B (52.9 KB) ok; `vendor-eson.js` 53,086 B (**53.1 KB**) |
| B3 | line 93 | "full facade:" enumeration | MINOR | omits `parseTrusted` and `loadJson2Api` (exported `index.ts:104,121`) |
| B4 | lines 170-172 | `npm run build` writes 4 artifacts | WRONG | writes **6**: also `ESON-runtime.jsx` (`eson-build.mjs:214`) and `json2-reference.jsx` (`eson-build.mjs:148-149`) |
| B5 | lines 104-106 | "install ... onto $.global" | NUANCE | footer assigns the unqualified global `JSON`; equivalent to `$.global` in ExtendScript (`caps.ts:162-176`) |

### C. API Reference (README lines 230-415)

| # | Location | Claim | Verdict | Evidence / correction |
|---|---|---|---|---|
| C1 | line 285 | "Non-finite numbers (NaN, Infinity) ... at the top level return undefined" | WRONG | non-finite numbers serialize as `"null"` at EVERY level (`json2.raw.js:289-295`; `JSON.stringify(NaN) === "null"`). Only undefined/functions return undefined at top level |
| C2 | line 284 | ">10 capped at 10 (ES2019 behavior)" | WRONG attribution | 10-char space cap is ES5 spec; ES2019 well-formed stringify is about lone-surrogate escaping (which the patched `rx_escapable` implements, `json2.raw.js:168`) |
| C3 | line 284 | "Numbers 1-10 ... accepted" | MINOR | 0 and negatives also accepted (produce empty indentation, `json2.raw.js:432`) |
| C4 | line 327 | "kernels (uneval / toSource / quote, probed at load time)" | MINOR | `stringQuote` is probed/reported but never used by `encodeSourceRaw` (`source-kernel.ts:62-83`); probing is lazy (first facade call, `index.ts:61-73`), not at load |
| C5 | line 321 | "one of only two named functions that reach the engine's raw eval" | MINOR | true for public text-routing; `loadJson2` also evals (`json2.ts:18`), benchmark's internal lane calls `evalSource` (`index.ts:208`) |
| C6 | line 387 | trustedRoundtrip lane "only when a source kernel exists" | MINOR | gate is `uneval || objectToSource` (`index.ts:205`), narrower than "any kernel" |
| C7 | line 264 | "47.7 ms cold -> 124 µs at 43 KB" | UNVERIFIABLE | documented measurement; current probe payload is ~48 KB and never wires `bigText` into payloads; keep numbers, fix payload label |
| C8 | lines 397-401 | ESM exports table | MINOR omission | bundle also exports `loadJson2Api` (`index.ts:121`) |
| C9 | API docs generally | error results memoized + rethrown | omission | `parse.ts:46-48,73-75`; worth one sentence |

### D. Security, Spec Conformance, Performance (README lines 418-480)

| # | Location | Claim | Verdict | Evidence / correction |
|---|---|---|---|---|
| D1 | line 449 | "median-of-200 µs" | STALE | probe uses WARM=3, ITERS=20, MEDIUM=12 (`eson-benchmark.jsx:182-190`) = median-of-20 (12 for large) |
| D2 | lines 457-468 | payload "medium 1.7 KB" | WRONG | actual 1,927 B = **~1.9 KB** |
| D3 | lines 457-468 | payload "large 43 KB" | WRONG | actual 48,343 B = **~48 KB** |
| D4 | line 476 | "~1000× faster than cold" memo | WRONG | max ~**385×** (see A6) |
| D5 | line 476 | "native regex passes (not per-char loops)" | MINOR | bulk is regex, but the depth walk is a charCodeAt loop over the collapsed structural string (`validate.ts:204-225`) |
| D6 | line 476 | "~0.06 µs/byte" eval rate | UNVERIFIABLE | keep as measured claim (no artifact) |
| D7 | line 439 | "V8 divergence: zero" | NUANCE | reported observation; counted, not failure-gated (`json-suite-entry.ts:43-45,54-56`) |
| D8 | line 437 | "188/188 must-reject" | NUANCE | one n_ case (invalid UTF-8 after escape) excluded by contract as encoding-level (`json-suite-entry.ts:17-22,48-50`) |
| D9 | line 478 | txt-reader "~2-4x / ~13-17x" | UNVERIFIABLE in-repo | corroborated by root AGENTS.md (2026-08-05); keep |
| D10 | lines 65, 441 | "330,000+ iterations, four seeds, ~120 MB heap" | UNVERIFIABLE | code defaults 50K iters / seed 0xC0FFEE; totals are run-history; keep as documented runs |

### E. Compatibility, FAQ, Development, Deep Dives engine/arch (README lines 482-631)

| # | Location | Claim | Verdict | Evidence / correction |
|---|---|---|---|---|
| E1 | line 514 | FAQ "43 KB" + "~1000×" | WRONG | use ~48 KB and ~385× (see A6, D2-D4) |
| E2 | line 505 | FAQ parenthetical "(leading zeros, trailing dots, bare keys, trailing commas, raw control chars...)" | WRONG list | counted 8 = `01, -01, 00, -00, 1., [1,], {"a":1,}, [,]` (no bare keys, no raw controls) |
| E3 | line 596 | "12× faster than the JSON2 pair" | UNVERIFIABLE/approx | own table implies ~16x (421 µs / 26 µs); use "~16×" or "an order of magnitude" |
| E4 | line 567 | replace-callback offset drift | UNVERIFIABLE | README-only measured claim; keep |
| E5 | line 475-477 | "byte-equal ... 0 invalid inputs" | VERIFIED | probe lanes `eson-benchmark.jsx:119-122,138-151` |

### F. ExternalObject ABI, Known limitations, Credits, License, footer (README lines 603-670)

| # | Location | Claim | Verdict | Evidence / correction |
|---|---|---|---|---|
| F1 | line 615 | "numbered DLL file names (ESONJson2, 3, ...)" | MINOR | actual artifacts lettered: ESONJsonP/T/U/V/Final (`native/build/`); LNK1104 not in any artifact |
| F2 | line 645 | "GPL-3.0" | MINOR | use **GPL-3.0-or-later** (`package.json:22`, `LICENSE:639`) |
| F3 | line 625 | "stringifyFast preflight ~70 µs" | UNVERIFIABLE | keep as measured claim |
| F4 | line 627 | "fastRewrite slower at every size" | NUANCE | fastRewrite exists + tested (`rewrite.ts`, `eson-test-entry.ts:85-132`); measurement is run-history |
| F5 | all sections | em-dash count | VERIFIED | 0 em-dashes (U+2014) in README |
| F6 | lines 20, 654-668 | ArcFit ad blocks | KEEP | user-requested; only ArcFit mentions, all inside ads |

### G. Source-side staleness (not README; fix as cleanup)

| # | File | Issue |
|---|---|---|
| G1 | `src/index.ts:4` | comment says parse is "eval-free" (it is eval-gated) |
| G2 | `src/runtime.ts:5` | comment "~20KB vendor instead of 58.6KB" vs actual 15.4 / 52.9 KB |
| G3 | `probes/eson-benchmark.jsx:58` | comment "(106us)" conflicts with stringify.ts:105 µs / README table 141 µs |

---

## Fix agent task board

Protocol: each agent appends its claim marker below BEFORE editing, then
updates its row to DONE with a one-line summary. Edit only its assigned
items. README is edited concurrently by agents A-E: use unique exact-match
strings, re-read the file if an edit fails, never reformat outside your
claims, keep zero em-dashes, no emoji.

| Agent | Assigned items | State | Notes |
|---|---|---|---|
| FIX-A | A1-A11 (hero, badges, Why ESON, Features) | [x] | A1/A2/A3/A5/A6/A10/A11 fixed; A4/A7/A8/A9 kept (verified). json2 year corrected to 2023-05-10; "Eval-free" -> "Eval-gated"; ~1000x -> ~385x; `{a:1}` -> `{1:1}` bare numeric keys; badges updated (35/35, GPL-3.0-or-later) |
| FIX-B | B1-B5 (Which build, examples, Installation) | [x] | B1-B4 fixed; B5 kept. ESON-runtime.jsx flagged as build intermediate; 6-artifact build list; facade list + parseTrusted/loadJson2Api; $.global reworded |
| FIX-C | C1-C9 (API Reference) | [x] | C1-C9 fixed. NaN/Infinity -> "null" at every level; ES2019 attribution removed; kernels reworded; parseTrusted "two functions" reworded; benchmark gate reworded; loadJson2Api row added |
| FIX-D | D1-D10 (Security, Conformance, Performance) | [x] | D1/D4/D6/D7 fixed; D2/D3 KEPT (payload sizes 345/1723/43243 B VERIFIED by live measurement, see note); D5/D8/D9/D10 kept. Flagged 48KB conflict (resolved by coordinator) |
| FIX-E | E1-E5 (Compatibility, FAQ, Development, engine/arch) | [x] | E1/E2/E3/E5/E6 fixed. 43KB + ~385x; array elisions list; ~16x vs JSON2; lazily-probed kernels in Compatibility; 623 assertions verified |
| FIX-F | F1-F6, G1-G3 (ABI, limitations, credits, license, source comments) | [x] | F1/F2/G1/G2/G3 fixed; F3-F6 kept. lettered DLL names; GPL-3.0-or-later; source comments updated (index.ts, runtime.ts, json-transport probe) |

---

## Final state (fix round complete)

### Coordinator resolution (post-agent conflict)

**Payload sizes (D2/D3 vs C7/E1):** FIX-D measured the probe payloads with the
shipped dist bundle and the live `%TEMP%\eson-benchmark-report.json`
(2026-08-05): settings = 345 B, profiles6 = **1,723 B**, profiles150 =
**43,243 B**. The validation round's "48,343 B / 1.9 KB" figures were not
reproducible. The README's original "1.7 KB / 43 KB" labels are CORRECT and
kept. C7/E1's "~48 KB" edits were reverted by the coordinator to "43 KB".

### Verified-clean claims (kept after audit)

- All error strings, API signatures, build availability (runtime vs full)
- Security model bullets + probe42 check + strictness hole list
- JSONTestSuite 95/95 + 188/188 + 35/35 (with new footnote on the
  encoding-level n_ exclusion + V8-divergence reporting semantics)
- 623 Node assertions (npm test run), 36/36 differential corpus
- Memo (8-entry LRU, __proto__ guard, same-reference caveat, error rethrow)
- Engine quirks, ABI saga bullets, credits, ArcFit ads (lines 20, 654-673)
- Zero em-dashes in the entire README

### Unverifiable-but-kept (documented run claims, no in-repo artifact)

- 330,000+ fuzz iterations / four seeds / ~120 MB heap (run history)
- ~0.06 µs/byte eval rate; ~70 µs stringifyFast preflight
- ~26 µs trusted round-trip; ~16× vs JSON2 pair (per measured lanes)
- txt-reader 2-4x / 13-17x (corroborated by root AGENTS.md 2026-08-05)

### Residual notes

- Badge URLs not fetched (text-only sanity check; shields.io may be unreachable
  in CI, acceptable for README)
- npm publish of `eson` itself not executed; `npm pack --dry-run` succeeded
  (70 files, dist artifacts included)
