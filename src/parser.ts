// Single-pass JSON/value parser with two modes.
//
// Strict  : RFC 8259 JSON only (quoted keys, JSON escapes, JSON numbers, no
//           parens, no undefined/NaN/Infinity). Used by ESON.parse().
// Lenient : SpiderMonkey source-literal subset - what toSource/uneval emit
//           for DATA (identifier and number keys, JS escapes incl. \x \v
//           octal, parens around object literals, undefined/NaN/Infinity,
//           JS decimal numbers). Still rejects function bodies, new, member
//           access, calls, regex literals, assignments, and any operator.
//           Used by ESON.decodeSourceChecked().
//
// Both modes VALIDATE AND CONSTRUCT in one pass: no eval is ever called, so
// neither lane can execute side effects. Constructing mirrors eval semantics
// (e.g. {"__proto__":1} sets the prototype, Number("01") is 1, numeric keys
// stringify via String(Number(tok))), which keeps differential parity with
// JSON2/SpiderMonkey eval by construction.
//
// The depth cap (512) protects the interpreter from pathological nesting.
export interface ParseResult {
  ok: boolean;
  value: any;
  error?: string;
}

export interface ParserOptions {
  lenient?: boolean;
}

function contains(list: any[], value: any): boolean {
  var i: number;
  for (i = 0; i < list.length; i++) {
    if (list[i] === value) return true;
  }
  return false;
}

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

function isUpper(c: number): boolean {
  return c >= 65 && c <= 90;
}

function isLower(c: number): boolean {
  return c >= 97 && c <= 122;
}

function isLowerHex(c: number): boolean {
  return c >= 97 && c <= 102;
}

// NOTE: mixed &&/|| chains are forbidden in this codebase. ExtendScript's
// parser mis-evaluates them when esbuild strips the "redundant" parentheses,
// so every char-class test is a pure-|| chain of pure-&& helpers.
function isHexDigit(c: number): boolean {
  return isDigit(c) || isUpper(c) || isLowerHex(c);
}

function isOctDigit(c: number): boolean {
  return c >= 48 && c <= 55;
}

function isIdentChar(c: number): boolean {
  return isUpper(c) || isLower(c) || isDigit(c) || c === 95 || c === 36 || c > 127;
}

export function parseValue(text: string, options?: ParserOptions): ParseResult {
  var lenient = !!(options && options.lenient);
  var n = text.length;
  var pos = 0;
  var depth = 0;
  var MAX_DEPTH = 512;

  function skipWs(): void {
    var c: number;
    while (pos < n) {
      c = text.charCodeAt(pos);
      if (c === 32 || c === 9 || c === 10 || c === 13) pos++;
      else return;
    }
  }

  function fail(msg: string): ParseResult {
    return { ok: false, value: undefined, error: msg };
  }

  function readString(): ParseResult {
    var i2 = pos + 1;
    var val: string[] = [];
    var c: number;
    var e: number;
    var k: number;
    var code: number;
    while (i2 < n) {
      c = text.charCodeAt(i2);
      if (c === 34) {
        pos = i2 + 1;
        return { ok: true, value: val.join('') };
      }
      if (c === 92) {
        i2++;
        if (i2 >= n) return fail('unterminated escape');
        e = text.charCodeAt(i2);
        i2++;
        if (e === 34) val[val.length] = '"';
        else if (e === 92) val[val.length] = '\\';
        else if (e === 47) val[val.length] = '/';
        else if (e === 98) val[val.length] = '\b';
        else if (e === 102) val[val.length] = '\f';
        else if (e === 110) val[val.length] = '\n';
        else if (e === 114) val[val.length] = '\r';
        else if (e === 116) val[val.length] = '\t';
        else if (lenient && e === 118) val[val.length] = '\u000b';
        else if (lenient && e === 120) {
          if (i2 + 2 > n || !isHexDigit(text.charCodeAt(i2)) || !isHexDigit(text.charCodeAt(i2 + 1))) {
            return fail('bad \\x escape');
          }
          val[val.length] = String.fromCharCode(parseInt(text.substring(i2, i2 + 2), 16));
          i2 += 2;
        } else if (e === 117) {
          if (i2 + 4 > n) return fail('short \\u escape');
          for (k = 0; k < 4; k++) {
            if (!isHexDigit(text.charCodeAt(i2 + k))) return fail('bad \\u escape');
          }
          val[val.length] = String.fromCharCode(parseInt(text.substring(i2, i2 + 4), 16));
          i2 += 4;
        } else if (lenient && e >= 48 && e <= 55) {
          code = e - 48;
          if (e === 48) {
            if (i2 < n && isOctDigit(text.charCodeAt(i2))) {
              code = text.charCodeAt(i2) - 48;
              i2++;
              if (i2 < n && isOctDigit(text.charCodeAt(i2))) {
                code = code * 8 + (text.charCodeAt(i2) - 48);
                i2++;
              }
            }
          } else {
            for (k = 0; k < 2 && i2 < n && isOctDigit(text.charCodeAt(i2)); k++) {
              code = code * 8 + (text.charCodeAt(i2) - 48);
              i2++;
            }
          }
          if (code > 0xff) return fail('octal overflow');
          val[val.length] = String.fromCharCode(code);
        } else {
          return fail('unexpected escape \\' + String.fromCharCode(e));
        }
      } else if (!lenient && c < 32) {
        return fail('raw control char in string');
      } else {
        // charCodeAt, never charAt: ExtendScript's charAt() returns "" for
        // U+0000, silently dropping the character. Lenient mode accepts raw
        // control chars because SpiderMonkey's toSource emits them raw.
        val[val.length] = String.fromCharCode(c);
        i2++;
      }
    }
    return fail('unterminated string');
  }

  function readNumber(lenientMode: boolean): ParseResult {
    var start = pos;
    var c: string;
    if (text.charAt(pos) === '-') pos++;
    if (pos >= n) return fail('truncated number');
    c = text.charAt(pos);
    if (c === '0') {
      pos++;
      if (lenientMode) {
        while (pos < n && isDigit(text.charCodeAt(pos))) pos++;
      } else if (pos < n && isDigit(text.charCodeAt(pos))) {
        return fail('leading zero');
      }
    } else if (c >= '1' && c <= '9') {
      while (pos < n && isDigit(text.charCodeAt(pos))) pos++;
    } else if (lenientMode && c === '.') {
      // .5 form
    } else {
      return fail('bad number start');
    }
    if (pos < n && text.charAt(pos) === '.') {
      pos++;
      var any = false;
      while (pos < n && isDigit(text.charCodeAt(pos))) {
        any = true;
        pos++;
      }
      if (!any) return fail('no digits after dot');
    }
    if (pos < n && (text.charAt(pos) === 'e' || text.charAt(pos) === 'E')) {
      pos++;
      if (pos < n && (text.charAt(pos) === '+' || text.charAt(pos) === '-')) pos++;
      var any2 = false;
      while (pos < n && isDigit(text.charCodeAt(pos))) {
        any2 = true;
        pos++;
      }
      if (!any2) return fail('no exponent digits');
    }
    var tok = text.substring(start, pos);
    return { ok: true, value: Number(tok) };
  }

  function readIdentifierToken(): ParseResult {
    var i2 = pos;
    while (i2 < n && isIdentChar(text.charCodeAt(i2))) i2++;
    var tok = text.substring(pos, i2);
    pos = i2;
    if (!tok) return fail('empty identifier');
    return { ok: true, value: tok };
  }

  function readIdentifier(): ParseResult {
    var tok: string;
    var r = readIdentifierToken();
    if (!r.ok) return r;
    tok = String(r.value);
    if (tok === 'true') return { ok: true, value: true };
    if (tok === 'false') return { ok: true, value: false };
    if (tok === 'null') return { ok: true, value: null };
    if (lenient && tok === 'undefined') return { ok: true, value: undefined };
    if (lenient && tok === 'NaN') return { ok: true, value: NaN };
    if (lenient && tok === 'Infinity') return { ok: true, value: Infinity };
    return fail('unexpected identifier "' + tok + '"');
  }

  function readValue(): ParseResult {
    if (pos >= n) return fail('unexpected end');
    var c = text.charAt(pos);
    if (c === '{') return readObject();
    if (c === '[') return readArray();
    if (c === '"') return readString();
    if (lenient && c === '(') {
      var j = pos + 1;
      while (j < n) {
        var cc = text.charCodeAt(j);
        if (cc === 32 || cc === 9 || cc === 10 || cc === 13) j++;
        else break;
      }
      if (j >= n || text.charAt(j) !== '{') return fail('paren must wrap object literal');
      pos = j;
      var inner = readObject();
      if (!inner.ok) return inner;
      var k2 = pos;
      while (k2 < n) {
        var cc2 = text.charCodeAt(k2);
        if (cc2 === 32 || cc2 === 9 || cc2 === 10 || cc2 === 13) k2++;
        else break;
      }
      if (k2 >= n || text.charAt(k2) !== ')') return fail('unclosed paren');
      pos = k2 + 1;
      return inner;
    }
    var d = text.charCodeAt(pos);
    if (d === 45 || isDigit(d)) return readNumber(lenient);
    if (isIdentChar(text.charCodeAt(pos))) {
      return readIdentifier();
    }
    return fail('unexpected char "' + c + '"');
  }

  function readObject(): ParseResult {
    var out: any = {};
    var c: string;
    pos++;
    depth++;
    if (depth > MAX_DEPTH) {
      depth--;
      return fail('nesting depth exceeded');
    }
    skipWs();
    if (pos >= n) {
      depth--;
      return fail('unterminated object');
    }
    if (text.charAt(pos) === '}') {
      pos++;
      depth--;
      return { ok: true, value: out };
    }
    for (;;) {
      skipWs();
      if (pos >= n) {
        depth--;
        return fail('unterminated object');
      }
      var key: string;
      var kr = text.charAt(pos);
      if (kr === '"') {
        var sr = readString();
        if (!sr.ok) {
          depth--;
          return sr;
        }
        key = String(sr.value);
      } else if (lenient && (isDigit(text.charCodeAt(pos)) || text.charAt(pos) === '-')) {
        var nr = readNumber(true);
        if (!nr.ok) {
          depth--;
          return nr;
        }
        key = String(Number(nr.value));
      } else if (lenient && (isLower(kr.charCodeAt(0)) || isUpper(kr.charCodeAt(0)) || kr === '_' || kr === '$')) {
        var ir = readIdentifierToken();
        if (!ir.ok) {
          depth--;
          return ir;
        }
        key = String(ir.value);
      } else {
        depth--;
        return fail('object key must be a string');
      }
      skipWs();
      if (pos >= n || text.charAt(pos) !== ':') {
        depth--;
        return fail('expected ":"');
      }
      pos++;
      skipWs();
      var vr = readValue();
      if (!vr.ok) {
        depth--;
        return vr;
      }
      out[key] = vr.value;
      skipWs();
      if (pos >= n) {
        depth--;
        return fail('unterminated object');
      }
      c = text.charAt(pos);
      if (c === ',') {
        pos++;
        continue;
      }
      if (c === '}') {
        pos++;
        depth--;
        return { ok: true, value: out };
      }
      depth--;
      return fail('expected "," or "}"');
    }
  }

  function readArray(): ParseResult {
    var out: any[] = [];
    var c: string;
    pos++;
    depth++;
    if (depth > MAX_DEPTH) {
      depth--;
      return fail('nesting depth exceeded');
    }
    skipWs();
    if (pos >= n) {
      depth--;
      return fail('unterminated array');
    }
    if (text.charAt(pos) === ']') {
      pos++;
      depth--;
      return { ok: true, value: out };
    }
    for (;;) {
      skipWs();
      var vr = readValue();
      if (!vr.ok) {
        depth--;
        return vr;
      }
      out[out.length] = vr.value;
      skipWs();
      if (pos >= n) {
        depth--;
        return fail('unterminated array');
      }
      c = text.charAt(pos);
      if (c === ',') {
        pos++;
        continue;
      }
      if (c === ']') {
        pos++;
        depth--;
        return { ok: true, value: out };
      }
      depth--;
      return fail('expected "," or "]"');
    }
  }

  skipWs();
  var r = readValue();
  if (!r.ok) return r;
  skipWs();
  if (pos !== n) return fail('trailing content at ' + pos);
  return r;
}
