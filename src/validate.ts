// Strict JSON grammar gates.
//
// Two independent validators, deliberately kept in parallel:
//
//   1. isValidJsonTextScanner - the original single-pass charCodeAt scanner
//      (RFC 8259 exact, depth-capped at 512). Used as the reference and by
//      the eval-free parser lane.
//
//   2. isValidJsonTextRegex - the hot-path strict gate in the classic
//      Crockford json2 shape (Public Domain; see dist/vendor-eson.js).
//      ExtendScript's native regex engine makes this ~7x faster than the
//      interpreter scanner. Grammar holes json2 has are closed here:
//        - numbers: no leading zeros, digits required after '.', digits
//          required in the exponent ("01", "1.", "1e" rejected)
//        - strings: raw control chars (U+0000-U+001F) rejected
//        - number-token adjacency ("01", "-00", "1-2") rejected by a
//          callback-level boundary check (the skeleton alone cannot see it)
//        - nesting depth capped at 512 (budgeted scan: wide-but-shallow texts
//          are not punished)
//
// Security: after the gate passes, the text reduces to a skeleton containing
// only `[ ] { } : ,` whitespace and token placeholders, so eval() can only
// ever compile brackets/colons/commas/strings/numbers/true/false/null.
//
// ENGINE NOTE: anchored `^(?:...)*$` alternation regexes and lookaheads
// inside star loops are FORBIDDEN here - both hang or backtrack
// exponentially in ExtendScript (measured). The replace-then-check pipeline
// is the proven shape.

var rx_one = /^[\],:{}\t\n\r ]*$/;
var rx_two = /\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g;
// Strict tokens: strings may not contain raw control chars; numbers are
// RFC 8259-exact (json2's original accepted "01" and "1." - this does not).
var rx_three = /"[^"\\\x00-\x1f]*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+\-]?\d+)?/g;
var rx_four = /(?:^|:|,)(?:\s*\[)+/g;
// Sanitization set: ONLY the JS line terminators. Raw U+2028/U+2029 inside
// a string literal break the eval, so they are converted to \uXXXX escape
// text before the eval. The legacy json2 sanitizer also converted U+00AD,
// U+0600-0604, U+200C-200F, U+FEFF, U+FFF0-FFFF etc - but those are all
// eval-safe raw characters, and converting them cost the pathological
// callback-replace on every payload containing e.g. U+00A0 (measured
// ~2.2us/byte). Raw control characters are invalid JSON and must reach the
// grammar checks, never be converted into escapes (a strictness hole).
var rx_dangerous = /[\u2028\u2029]/g;
// A LONE backslash directly before a sanitizer-set char is an INVALID escape
// in the original text; without this check the sanitizer would legalize it
// (backslash + converted \uXXXX becomes a valid \\ + escape). The "\\"-pair
// (even backslash count) is a valid escape, so only an ODD run counts: the
// pattern is a non-backslash/start + an even run + one more backslash.
var rx_backslash_dangerous = /(?:^|[^\\])(?:\\\\)*\\[\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/;
// Strict string protection: only RFC-valid strings (no raw control chars,
// only JSON escapes \" \\ \/ b f n r t and \uXXXX) are replaced with '@'.
// Every malformed string - a raw control inside, a JS-only escape (\q,
// \x41, \0, \v), an unterminated literal - leaves its opening quote in the
// protected text, and the allowed-charset (which excludes ") rejects it.
// This makes the dedicated raw controls/js-escape checks redundant in the
// pre-scan (the residue IS the malformed-string detector).
var rx_protect = /"([^"\\\x00-\x1f]|\\["\\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/g;
// Digit-anchored exponent mask: valid exponents become '#' (NOT a letter -
// an 'X' marker would survive rx_ident_strip's [^A-Za-z] strip and falsely
// reject every exponent number, routing them to the gate path). '#' is not a
// letter/digit/dot and sits inside the bare-key class, so '{1e5:1}' still
// rejects as a bare numeric key.
var rx_exponent = /([0-9])[eE][+\-]?\d+/g;

// Replace string literals with a fixed '@' placeholder so positional checks
// never see string content (which can contain anything: ",]0-"). A fixed
// replacement is used - the callback version measured ~1.4x slower and the
// placeholder does not need to be unique (the checks only need the strings
// gone; '@' is excluded from the bare-key class).
function structuralText(text: string): string {
  return text.replace(rx_protect, '@');
}

// Skeleton-invisible grammar violations, all in ONE native regex pass on the
// exponent-masked structural text (each measured ~0.33us/byte separately;
// the combined alternation is one pass):
//   ([\[{,])\s*[^"@\s[\]{},:]+:  - bare (unquoted) object keys {1:1}, {a:1}
//   (^|[^0-9.])0[0-9]            - leading-zero number tokens "01", "-00"
//   [^\[{,:\s]\s*-               - '-' after a token (1-2, true-47883)
//   \+                           - '+' anywhere after the exponent mask (the
//                                  mask ate every valid exponent; a surviving
//                                  '+' is the JS plus operator - "[1+2]")
//   (^|[^0-9])\.                 - dots not preceded by a digit (".5" JS
//                                  decimals, "}.false" member access)
//   \.(\s*[,\]}:]|[eE]|$)        - trailing-dot number tokens "1.", "1.e5"
var rx_positional = /([\[{,])\s*[^"@\s[\]{},:]+:|(^|[^0-9.])0[0-9]|[^\[{,:\s]\s*-|-\D|\+|(^|[^0-9])\.|\.(\s*[,\]}:]|[eE]|$)/;
// Hoisted inline literals from strictnessPreScan: ExtendScript recompiles
// inline regex literals per call (measured) - module scope compiles once.
// \t-free raw-control class: tab is valid JSON whitespace outside strings
// and is caught in-string by the strict protect's residue.
var rx_controls_scan = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
// The gate's own controls check: same class as rx_controls_scan (the gate is
// the \t-exempt fallback; a raw \t in a string is the documented edge the
// eval accepts). Hoisted - inline literals recompile per call.
var rx_controls_gate = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
// Chars the eval could interpret as JS that JSON forbids: quotes, parens,
// operators, comment markers, U+00A0 (JS \s but not JSON whitespace), etc.
// Strings are '@' so no string content can trip it. Explicit \t\n\r space -
// NOT \s: JS \s includes U+00A0/U+2028/29 which are invalid JSON whitespace.
var rx_allowed_charset = /[^\[\]{},:@\t\n\r 0-9eE+\-.A-Za-z]/;
var rx_ident_strip = /true|false|null|[^A-Za-z]/g;

var MAX_DEPTH = 512;

export function sanitizeJsonText(text: string): string {
  rx_dangerous.lastIndex = 0;
  if (rx_dangerous.test(text)) {
    return text.replace(rx_dangerous, function (a: string): string {
      return '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
    });
  }
  return text;
}

export function isValidJsonText(text: string): boolean {
  return isValidJsonTextRegex(text);
}

export function isValidJsonTextRegex(text: string): boolean {
  // Escape substitution first: \uXXXX and friends become '@', so the checks
  // below never see digit runs inside escape text.
  var sub = text.replace(rx_two, '@');
  // String protection for positional checks: string content can contain
  // anything (",]0-"), which would otherwise false-trip them.
  var prot = structuralText(text);

  // Raw control chars (except the \t \n \r whitespace trio - those are the
  // eval's job: a raw \n in a string literal is a JS line terminator, which
  // the eval rejects; raw \t inside a string is a documented edge).
  if (rx_controls_gate.test(text)) return false;
  // A backslash directly before a sanitizer-set char is an invalid escape
  // that the sanitizer would otherwise legalize.
  if (rx_backslash_dangerous.test(text)) return false;

  // Number boundaries, bare keys, trailing dots (one native pass).
  var x = prot.replace(rx_exponent, '$1#');
  if (rx_positional.test(x)) return false;

  // Commas (top-level / leading / doubled / trailing) and bracket
  // depth/balance/cap (one native extraction + a short structural scan).
  if (!structuralScanOk(prot)) return false;

  var skeleton: string;
  skeleton = sub.replace(rx_three, ']').replace(rx_four, '');
  if (!rx_one.test(skeleton)) return false;

  return true;
}

// The strictness holes json2's own gate+eval accepts (json2's number pattern
// allows "01"/"1.", its string class allows raw control chars other than
// \n\r, and its skeleton cannot see bare keys, comma positions, or top-level
// commas). Used as a cheap pre-scan before delegating to json2.parse. False
// rejects are safe (they route to the gate path); false accepts are the bug.
// Cheapest tests first so invalid input rejects without the protect/mask
// passes. The merged design (one protect + one mask + one combined positional
// regex + one structural scan) replaced a stack of ten full-text passes that
// measured ~4.4us/byte; the merge measures ~1.5us/byte.
export function strictnessPreScan(text: string): boolean {
  // \t-free raw-control prefilter: rejects raw-control junk (outside
  // strings) in microseconds before the protect pass. In-string controls
  // are caught by the strict protect's residue (rx_protect). \t is excluded:
  // tab-as-whitespace is valid ("[\t1]") and its in-string case is handled
  // by the residue too.
  if (rx_controls_scan.test(text)) return false;
  var prot = structuralText(text);
  if (rx_allowed_charset.test(prot)) return false;
  var x = prot.replace(rx_exponent, '$1#');
  if (rx_positional.test(x)) return false;
  // Identifiers other than true/false/null (undefined, NaN, Infinity, hex
  // 0x1, octal 0o1, property access, keywords...) that the eval would
  // resolve or reject differently than JSON. After the exponent mask the
  // only valid letter words are the three JSON literals.
  if (x.replace(rx_ident_strip, '').length > 0) return false;
  return structuralScanOk(prot);
}

// Value runs AND string placeholders collapse to a single '_' (native regex)
// so the scan walks a short structural string instead of the whole protected
// text (the full walk measured ~1.24us/byte; the extraction is native and
// value/string runs are the bulk of the text). Whitespace and ':' are kept:
// the trailing-comma lookahead needs whitespace ("[1, ]" is a trailing
// comma) and the colon is a key/value separator (a '{' after ':' is legal,
// a '{' after a value is the eval's member access - "[3[4]]" - and must be
// rejected).
var rx_value_runs = /[^\[\]{},:@\t\n\r ]+/g;

// The scan's native-regexable rules, all in ONE pass over the SHORT struct
// (measured ~1.2ms vs the full walk's ~10.3ms at 15.9KB of profiles - the
// regex cost scales with the struct, not the input text):
//   (^|[\[{,])\s*,        - leading/doubled commas: [,1], [1,,2], {,"a":1}
//   ,\s*[\]}]             - trailing commas: [1,], [1, ]
//   ([^\[{,:\s])\s*[\[{]  - value directly before an open bracket through
//                           whitespace: [3[4]], {}.x, "a".b, [1 [2]]
var rx_scan_rules = /(^|[\[{,])\s*,|,\s*[\]}]|([^\[{,:\s])\s*[\[{]/;

// One walk over the structural characters of the string-protected text
// covering only what the native regexes cannot express: bracket depth +
// balance + cap, and the top-level comma (the eval would accept "2.1,3"
// as the comma operator - its depth-0 position is not regexable without
// the hang-adjacent alternation-star shape). This replaced two full
// charCodeAt walks (measured ~0.85us/byte each) with one.
function structuralScanOk(prot: string): boolean {
  var struct = prot.replace(rx_value_runs, '_');
  if (rx_scan_rules.test(struct)) return false;
  var n = struct.length;
  var depth = 0;
  var i: number;
  var c: number;
  for (i = 0; i < n; i++) {
    c = struct.charCodeAt(i);
    if (c === 91 || c === 123) { // [ {
      depth++;
      if (depth > MAX_DEPTH) return false;
    } else if (c === 93 || c === 125) { // ] }
      depth--;
      if (depth < 0) return false;
    } else if (c === 44 && depth === 0) { // , at top level
      return false;
    }
    // '_' (collapsed value runs), ':' and whitespace: no state change
  }
  return true;
}

// ------------------------------------------------------------ scanner gate

export function isValidJsonTextScanner(text: string): boolean {
  var n = text.length;
  var pos = 0;
  var depth = 0;
  var MAX_SCANNER_DEPTH = 512;

  function skipWs(): void {
    var c: number;
    while (pos < n) {
      c = text.charCodeAt(pos);
      if (c === 32 || c === 9 || c === 10 || c === 13) pos++;
      else return;
    }
  }

  function isDigitChar(c: number): boolean {
    return c >= 48 && c <= 57;
  }

  function isUpperChar(c: number): boolean {
    return c >= 65 && c <= 90;
  }

  function isLowerHexChar(c: number): boolean {
    return c >= 97 && c <= 102;
  }

  // pure-|| chain (ExtendScript mis-evaluates mixed &&/|| once esbuild strips
  // the redundant parentheses)
  function isHexDigit(c: number): boolean {
    return isDigitChar(c) || isUpperChar(c) || isLowerHexChar(c);
  }

  function readString(): boolean {
    var c: number;
    var k: number;
    var e: number;
    pos++;
    while (pos < n) {
      c = text.charCodeAt(pos);
      if (c === 34) {
        pos++;
        return true;
      }
      if (c === 92) {
        pos++;
        if (pos >= n) return false;
        e = text.charCodeAt(pos);
        pos++;
        if (
          e === 34 || e === 92 || e === 47 || e === 98 ||
          e === 102 || e === 110 || e === 114 || e === 116
        ) {
          continue;
        }
        if (e === 117) {
          for (k = 0; k < 4; k++) {
            if (pos >= n || !isHexDigit(text.charCodeAt(pos))) return false;
            pos++;
          }
          continue;
        }
        return false;
      }
      if (c < 32) return false;
      pos++;
    }
    return false;
  }

  function readNumber(): boolean {
    var c: number;
    var any: boolean;
    if (text.charCodeAt(pos) === 45) pos++;
    if (pos >= n) return false;
    c = text.charCodeAt(pos);
    if (c === 48) {
      pos++;
      if (pos < n && isDigitChar(text.charCodeAt(pos))) return false;
    } else if (c >= 49 && c <= 57) {
      while (pos < n && isDigitChar(text.charCodeAt(pos))) pos++;
    } else {
      return false;
    }
    if (pos < n && text.charCodeAt(pos) === 46) {
      pos++;
      any = false;
      while (pos < n && isDigitChar(text.charCodeAt(pos))) {
        any = true;
        pos++;
      }
      if (!any) return false;
    }
    if (pos < n && (text.charCodeAt(pos) === 101 || text.charCodeAt(pos) === 69)) {
      pos++;
      if (pos < n && (text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45)) pos++;
      any = false;
      while (pos < n && isDigitChar(text.charCodeAt(pos))) {
        any = true;
        pos++;
      }
      if (!any) return false;
    }
    return true;
  }

  function readLiteral(expected: string): boolean {
    if (text.substr(pos, expected.length) === expected) {
      pos += expected.length;
      return true;
    }
    return false;
  }

  function readValue(): boolean {
    if (pos >= n) return false;
    var c = text.charCodeAt(pos);
    if (c === 123) return readObject();
    if (c === 91) return readArray();
    if (c === 34) return readString();
    if (c === 116) return readLiteral('true');
    if (c === 102) return readLiteral('false');
    if (c === 110) return readLiteral('null');
    if (c === 45 || isDigitChar(c)) return readNumber();
    return false;
  }

  function readObject(): boolean {
    var c: number;
    pos++;
    depth++;
    if (depth > MAX_SCANNER_DEPTH) {
      depth--;
      return false;
    }
    skipWs();
    if (pos >= n) {
      depth--;
      return false;
    }
    if (text.charCodeAt(pos) === 125) {
      pos++;
      depth--;
      return true;
    }
    for (;;) {
      skipWs();
      if (pos >= n || text.charCodeAt(pos) !== 34) {
        depth--;
        return false;
      }
      if (!readString()) {
        depth--;
        return false;
      }
      skipWs();
      if (pos >= n || text.charCodeAt(pos) !== 58) {
        depth--;
        return false;
      }
      pos++;
      skipWs();
      if (!readValue()) {
        depth--;
        return false;
      }
      skipWs();
      if (pos >= n) {
        depth--;
        return false;
      }
      c = text.charCodeAt(pos);
      if (c === 44) {
        pos++;
        continue;
      }
      if (c === 125) {
        pos++;
        depth--;
        return true;
      }
      depth--;
      return false;
    }
  }

  function readArray(): boolean {
    var c: number;
    pos++;
    depth++;
    if (depth > MAX_SCANNER_DEPTH) {
      depth--;
      return false;
    }
    skipWs();
    if (pos >= n) {
      depth--;
      return false;
    }
    if (text.charCodeAt(pos) === 93) {
      pos++;
      depth--;
      return true;
    }
    for (;;) {
      skipWs();
      if (!readValue()) {
        depth--;
        return false;
      }
      skipWs();
      if (pos >= n) {
        depth--;
        return false;
      }
      c = text.charCodeAt(pos);
      if (c === 44) {
        pos++;
        continue;
      }
      if (c === 93) {
        pos++;
        depth--;
        return true;
      }
      depth--;
      return false;
    }
  }

  skipWs();
  if (!readValue()) return false;
  skipWs();
  return pos === n;
}
