// Stage C: deterministic linear rewriter from SpiderMonkey source text to
// strict JSON. Operates only on inert graphs (normalized or preflight-clean),
// so the input grammar is narrow:
//
//   source := obj | arr | value
//   obj    := '('? '{' (member (',' member)*)? '}' ')'?   (parens only around objects)
//   member := key ':' value
//   key    := identifier | '"' string '"' | decimal-number
//   value  := obj | arr | '"' string '"' | number | true | false | null
//
// Any token outside that grammar (undefined, NaN, Infinity, function, new,
// regex literals, sharp variables, getters, ...) returns null so the caller
// falls back to the JSON2 path. It never guesses.
//
// Two tiers:
//
//   FAST PATH (fastRewrite): for toSource output of inert graphs, the only
//   structural differences from JSON are known and positional - parens around
//   object literals, `, ` separators, bare identifier/number keys, and JS-style
//   string escapes. The strings are protected into collision-free placeholders
//   (canonicalizing their escapes in the same pass), the positional transforms
//   become cheap split/join + one key-quoting regex, and a cheap bad-token
//   check guards the result. Measured ~5 native passes vs the scanner's
//   ~30 per-token regex ops.
//
//   SCANNER (rewriteSource): the linear tokenizer, kept as the fallback for
//   anything the fast path refuses (unicode keys, exotic forms).
//
// String escapes are decoded (JS forms: \x, \v, octal, \u) and re-encoded with
// JSON2's exact escaping policy (rx_escapable + meta), which makes the output
// byte-for-byte identical to JSON2's quote().

var rx_escapable = /[\\"\u0000-\u001f\u007f-\u009f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;

var meta: any = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
  '"': '\\"',
  '\\': '\\\\'
};

var rx_num = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+\-]?[0-9]+)?$/;
var rx_struct = /["{}\[\]:,()]/g;
var rx_ws_only = /^[\s]*$/;
var rx_ident = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
var rx_loose_ident = /^[^\s"'{}\[\]:,()\\]+$/;

// fast-path patterns (module-level: precompiled once)
var rx_protect = /"(\\.|[^"\\])*"/g;
var rx_key = /([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*|-?\d+):/g;
// Anything outside the strict grammar the transform must refuse. Covers:
// parens, forbidden tokens, sharp variables, unquoted keys (any first char,
// including digits: "1e3:"), trailing commas, mis-ordered braces, and
// root-level commas (two values with no container).
var rx_bad = /\(|\)|;|=|\/|\.|#|undefined|NaN|Infinity|function|new|[{,]\s*[^"@\s][^:@\s]*:|,(\s*[\]}])|}[{]|^[^\[\]{}]*,[^\[\]{}]*$|[^}\][0-9"]$/;
var rx_restore = /@(\d+)@/g;

function emitString(s: string): string {
  rx_escapable.lastIndex = 0;
  if (!rx_escapable.test(s)) return '"' + s + '"';
  return '"' + s.replace(rx_escapable, function (a: string): string {
    var m = meta[a];
    return typeof m === 'string' ? m : '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
  }) + '"';
}

function isDigitChar(c: number): boolean {
  return c >= 48 && c <= 57;
}

function isUpperChar(c: number): boolean {
  return c >= 65 && c <= 90;
}

function isLowerChar(c: number): boolean {
  return c >= 97 && c <= 122;
}

function isLowerHexChar(c: number): boolean {
  return c >= 97 && c <= 102;
}

// pure-|| chain (see parser.ts note: mixed &&/|| is mis-evaluated by
// ExtendScript once esbuild strips the redundant parentheses)
function isHexDigit(c: number): boolean {
  return isDigitChar(c) || isUpperChar(c) || isLowerHexChar(c);
}

function isOctDigit(c: number): boolean {
  return c >= 48 && c <= 55;
}

interface Frame {
  type: number; // 1 = object, 2 = array
  state: string; // obj: open|key|colon|val|done   arr: open|elem|done
}

// Decode JS string escapes (\x, \v, octal, \u, short forms) to characters.
// charCodeAt-based: ExtendScript's charAt() returns "" for U+0000.
function decodeEscapesContent(content: string): string | null {
  var m = content.length;
  var k2 = 0;
  var val: string[] = [];
  var c: number;
  var e: number;
  var k: number;
  var code: number;
  while (k2 < m) {
    c = content.charCodeAt(k2);
    if (c === 92) {
      k2++;
      if (k2 >= m) return null;
      e = content.charCodeAt(k2);
      k2++;
      if (e === 34) val[val.length] = '"';
      else if (e === 92) val[val.length] = '\\';
      else if (e === 47) val[val.length] = '/';
      else if (e === 98) val[val.length] = '\b';
      else if (e === 102) val[val.length] = '\f';
      else if (e === 110) val[val.length] = '\n';
      else if (e === 114) val[val.length] = '\r';
      else if (e === 116) val[val.length] = '\t';
      else if (e === 118) val[val.length] = '\u000b';
      else if (e === 120) {
        if (k2 + 2 > m || !isHexDigit(content.charCodeAt(k2)) || !isHexDigit(content.charCodeAt(k2 + 1))) return null;
        val[val.length] = String.fromCharCode(parseInt(content.substring(k2, k2 + 2), 16));
        k2 += 2;
      } else if (e === 117) {
        if (k2 + 4 > m) return null;
        for (k = 0; k < 4; k++) {
          if (!isHexDigit(content.charCodeAt(k2 + k))) return null;
        }
        val[val.length] = String.fromCharCode(parseInt(content.substring(k2, k2 + 4), 16));
        k2 += 4;
      } else if (e >= 48 && e <= 55) {
        code = e - 48;
        if (e === 48) {
          if (k2 < m && isOctDigit(content.charCodeAt(k2))) {
            code = content.charCodeAt(k2) - 48;
            k2++;
            if (k2 < m && isOctDigit(content.charCodeAt(k2))) {
              code = code * 8 + (content.charCodeAt(k2) - 48);
              k2++;
            }
          }
        } else {
          for (k = 0; k < 2 && k2 < m && isOctDigit(content.charCodeAt(k2)); k++) {
            code = code * 8 + (content.charCodeAt(k2) - 48);
            k2++;
          }
        }
        if (code > 0xff) return null;
        val[val.length] = String.fromCharCode(code);
      } else {
        return null; // \1-\9, \<newline>, unknown escapes
      }
    } else {
      val[val.length] = String.fromCharCode(c);
      k2++;
    }
  }
  return val.join('');
}

// Fast tier: positional whole-string transform for toSource output of inert
// graphs. String literals are protected into @N@ placeholders (canonicalizing
// their escapes in the same pass), then:
//   ({  -> {      }) -> }      ,  -> ,
//   {key:/42:     -> {"key":/"42":
// A cheap bad-token check (parens, undefined/NaN/Infinity/function/new,
// unquoted keys) guards the result; anything suspicious returns null and the
// caller falls back to the scanner.
function fastRewrite(source: string): string | null {
  var vals: string[] = [];
  var n = 0;
  var p: string;
  try {
    p = source.replace(rx_protect, function (m: string): string {
      n++;
      var content = m.substring(1, m.length - 1);
      var canon: string | null;
      if (content.indexOf('\\') < 0) {
        canon = content;
      } else {
        canon = decodeEscapesContent(content);
        if (canon === null) throw null;
      }
      vals[n] = emitString(canon);
      return '@' + n + '@';
    });
  } catch (e) {
    return null;
  }
  p = p.split('({').join('{').split('})').join('}').split(', ').join(',').split(': ').join(':');
  p = p.replace(rx_key, function (m: string, pre: string, key: string): string {
    return pre + '"' + key + '":';
  });
  if (rx_bad.test(p)) return null;
  // bracket balance (order is guaranteed by the well-formed toSource input;
  // malformed inputs fail here or in the scanner fallback)
  if (p.split('{').length !== p.split('}').length) return null;
  if (p.split('[').length !== p.split(']').length) return null;
  try {
    return p.replace(rx_restore, function (m: string, d: string): string {
      return vals[Number(d)];
    });
  } catch (e) {
    return null;
  }
}

export function rewriteSource(source: string): string | null {
  var fast = fastRewrite(source);
  if (fast !== null) return fast;
  return scannerRewrite(source);
}

function scannerRewrite(source: string): string | null {
  var n = source.length;
  var i = 0;
  var out: string[] = [];
  var stack: Frame[] = [];
  var parenDepth = 0;
  var lastSig = '';
  var rootDone = false;

  function top(): Frame | null {
    return stack.length ? stack[stack.length - 1] : null;
  }

  function valuePosition(): boolean {
    var t = top();
    if (!t) return !rootDone;
    if (t.type === 2) return t.state === 'open' || t.state === 'elem';
    return t.state === 'val';
  }

  function keyPosition(): boolean {
    var t = top();
    return t !== null && t.type === 1 && (t.state === 'open' || t.state === 'key');
  }

  function pushValue(emitted: string, isKey: boolean): boolean {
    if (isKey) {
      out[out.length] = emitted;
      var t = top();
      if (!t || t.type !== 1) return false;
      t.state = 'colon';
      return true;
    }
    out[out.length] = emitted;
    var f = top();
    if (!f) {
      rootDone = true;
    } else {
      f.state = 'done';
    }
    return true;
  }

  // Validate and emit the token span between structural characters.
  function handleSpan(start: number, end: number): boolean {
    if (end <= start) return true;
    var span = source.substring(start, end);
    if (rx_ws_only.test(span)) return true;
    var trimmed = span.replace(/^\s+/, '').replace(/\s+$/, '');
    if (trimmed === '') return true;
    if (keyPosition()) {
      if (rx_num.test(trimmed)) {
        var canon = String(Number(trimmed));
        if (canon !== trimmed) return false; // non-canonical key form (1e3, 1.50, -0)
        return pushValue('"' + canon + '"', true);
      }
      var c0 = trimmed.charCodeAt(0);
      var identLike = rx_ident.test(trimmed) ||
        ((c0 > 127 || c0 === 95 || c0 === 36) && rx_loose_ident.test(trimmed));
      if (!identLike) return false;
      return pushValue('"' + trimmed + '"', true);
    }
    if (valuePosition()) {
      if (rx_num.test(trimmed)) return pushValue(trimmed, false);
      if (trimmed === 'true' || trimmed === 'false' || trimmed === 'null') return pushValue(trimmed, false);
      return false; // undefined, NaN, Infinity, function bodies, ...
    }
    return false;
  }

  // Decode one JS string literal starting at i (which points at '"').
  // Fast path: no backslash in the content -> pass through with one indexOf.
  function readStringToken(): string | null {
    var i2 = i + 1;
    var close = i2;
    for (;;) {
      close = source.indexOf('"', close);
      if (close < 0) return null;
      // count immediately-preceding backslashes to test escape parity
      var bs = 0;
      var p = close - 1;
      while (p >= i2 && source.charCodeAt(p) === 92) {
        bs++;
        p--;
      }
      if ((bs & 1) === 0) break;
      close++;
    }
    var content = source.substring(i2, close);
    i = close + 1;
    if (content.indexOf('\\') < 0) {
      // no escapes: emitString normalizes raw control chars via rx_escapable
      return emitString(content);
    }
    var decoded = decodeEscapesContent(content);
    if (decoded === null) return null;
    return emitString(decoded);
  }

  rx_struct.lastIndex = 0;
  while (i < n) {
    rx_struct.lastIndex = i;
    var m = rx_struct.exec(source);
    var structPos = m ? m.index : n;

    if (structPos > i) {
      if (!handleSpan(i, structPos)) return null;
      i = structPos;
      if (i >= n) break;
    }

    var c = source.charAt(i);

    if (c === '(') {
      if (!valuePosition()) return null;
      var j = i + 1;
      while (j < n && rx_ws_only.test(source.charAt(j))) j++;
      if (j >= n || source.charAt(j) !== '{') return null;
      parenDepth++;
      lastSig = '(';
      i = j;
      continue;
    }

    if (c === ')') {
      if (parenDepth <= 0 || lastSig !== '}') return null;
      parenDepth--;
      lastSig = ')';
      i++;
      continue;
    }

    if (c === '{') {
      if (!valuePosition()) return null;
      var fo: Frame = { type: 1, state: 'open' };
      stack[stack.length] = fo;
      out[out.length] = '{';
      lastSig = '{';
      i++;
      continue;
    }

    if (c === '[') {
      if (!valuePosition()) return null;
      var fa: Frame = { type: 2, state: 'open' };
      stack[stack.length] = fa;
      out[out.length] = '[';
      lastSig = '[';
      i++;
      continue;
    }

    if (c === '}') {
      var to = top();
      if (!to || to.type !== 1 || (to.state !== 'open' && to.state !== 'done')) return null;
      stack.pop();
      out[out.length] = '}';
      lastSig = '}';
      if (!stack.length) rootDone = true;
      else {
        var parent = top();
        if (parent) parent.state = 'done';
      }
      i++;
      continue;
    }

    if (c === ']') {
      var ta = top();
      if (!ta || ta.type !== 2 || (ta.state !== 'open' && ta.state !== 'done')) return null;
      stack.pop();
      out[out.length] = ']';
      lastSig = ']';
      if (!stack.length) rootDone = true;
      else {
        var parent2 = top();
        if (parent2) parent2.state = 'done';
      }
      i++;
      continue;
    }

    if (c === ',') {
      var tc = top();
      if (!tc) return null;
      if (tc.type === 1 && tc.state === 'done') {
        tc.state = 'key';
        out[out.length] = ',';
        lastSig = ',';
        i++;
        continue;
      }
      if (tc.type === 2 && tc.state === 'done') {
        tc.state = 'elem';
        out[out.length] = ',';
        lastSig = ',';
        i++;
        continue;
      }
      return null;
    }

    if (c === ':') {
      var tp = top();
      if (!tp || tp.type !== 1 || tp.state !== 'colon') return null;
      tp.state = 'val';
      out[out.length] = ':';
      lastSig = ':';
      i++;
      continue;
    }

    if (c === '"') {
      var decoded = readStringToken();
      if (decoded === null) return null;
      var isKey = keyPosition();
      if (!isKey && !valuePosition()) return null;
      if (!pushValue(decoded, isKey)) return null;
      lastSig = '"';
      continue;
    }

    return null; // structural char in an invalid position (should not happen)
  }

  if (parenDepth !== 0 || stack.length !== 0 || !rootDone) return null;
  return out.join('');
}
