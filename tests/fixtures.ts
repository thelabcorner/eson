// ESON test corpus. Values for stringify differential; valid/invalid corpora
// for parse; security fixtures for the no-execution guarantees.
export interface ValueFixture {
  name: string;
  value: any;
  expected?: string; // hardcoded JSON2 (V8) expectation for a subset
  note?: string;
}

export function makeValues(): ValueFixture[] {
  var shared: any = { a: 1 };
  var cyclic: any = {};
  cyclic.self = cyclic;
  var arrCyc: any[] = [];
  arrCyc[0] = arrCyc;

  return [
    { name: 'null', value: null, expected: 'null' },
    { name: 'true', value: true, expected: 'true' },
    { name: 'false', value: false, expected: 'false' },
    { name: 'zero', value: 0, expected: '0' },
    { name: 'negativeZero', value: -0, expected: '0' },
    { name: 'float', value: 1.5, expected: '1.5' },
    { name: 'negFloat', value: -2.5, expected: '-2.5' },
    { name: 'bigExp', value: 1e21, expected: '1e+21' },
    { name: 'smallExp', value: -1e-7, expected: '-1e-7' },
    { name: 'hugeInt', value: 12345678901234567890 },
    { name: 'nan', value: NaN, expected: 'null' },
    { name: 'infinity', value: Infinity, expected: 'null' },
    { name: 'negInfinity', value: -Infinity, expected: 'null' },
    { name: 'emptyString', value: '', expected: '""' },
    { name: 'simpleString', value: 'x', expected: '"x"' },
    { name: 'quoteString', value: 'a"b', expected: '"a\\"b"' },
    { name: 'backslashString', value: 'a\\b', expected: '"a\\\\b"' },
    { name: 'newlineString', value: 'a\nb', expected: '"a\\nb"' },
    { name: 'tabString', value: 'a\tb', expected: '"a\\tb"' },
    { name: 'nulString', value: '\u0000', expected: '"\\u0000"' },
    { name: 'unitSep', value: '\u001f', expected: '"\\u001f"' },
    { name: 'latin1', value: 'é', expected: '"é"' },
    { name: 'cjk', value: '日本語' },
    { name: 'lineSep', value: '\u2028', expected: '"\\u2028"' },
    { name: 'paraSep', value: '\u2029', expected: '"\\u2029"' },
    { name: 'del', value: '\u007f', expected: '"\\u007f"' },
    { name: 'c1Control', value: '\u0080', expected: '"\\u0080"' },
    { name: 'softHyphen', value: '\u00ad', expected: '"\\u00ad"' },
    // Well-formed JSON.stringify (ES2019): a lone surrogate escapes as
    // \uXXXX text; a valid pair stays raw (see surrogatePair below).
    { name: 'loneSurrogate', value: '\ud800', expected: '"\\ud800"' },
    { name: 'surrogatePair', value: '\ud83d\ude00', expected: '"\ud83d\ude00"' },
    { name: 'boxedString', value: new String('ab'), expected: '{"0":"a","1":"b"}' },
    { name: 'boxedNumber', value: new Number(5), expected: '{}' },
    { name: 'boxedBoolean', value: new Boolean(true), expected: '{}' },
    { name: 'emptyArray', value: [], expected: '[]' },
    { name: 'flatArray', value: [1, 2, 3], expected: '[1,2,3]' },
    { name: 'sparseArray', value: makeSparse(), expected: '[null,null,1]' },
    { name: 'undefArray', value: [undefined], expected: '[null]' },
    { name: 'fnArray', value: [function () { return 1; }], expected: '[null]' },
    { name: 'nestedArrays', value: [[[]]], expected: '[[[]]]' },
    { name: 'scalarsArray', value: [null, true, false], expected: '[null,true,false]' },
    { name: 'nanArray', value: [NaN], expected: '[null]' },
    { name: 'infArray', value: [Infinity], expected: '[null]' },
    { name: 'negZeroArray', value: [-0], expected: '[0]' },
    { name: 'expArray', value: [1e21], expected: '[1e+21]' },
    { name: 'emptyObject', value: {}, expected: '{}' },
    { name: 'flatObject', value: { a: 1 }, expected: '{"a":1}' },
    { name: 'spaceKey', value: { 'a b': 1 }, expected: '{"a b":1}' },
    { name: 'numericKey', value: { 42: 'x' }, expected: '{"42":"x"}' },
    { name: 'constructorKey', value: { constructor: 1 }, expected: '{"constructor":1}' },
    { name: 'toStringKey', value: { toString: 1 }, expected: '{"toString":1}' },
    { name: 'toJSONKey', value: { toJSON: 1 }, expected: '{"toJSON":1}' },
    { name: 'customToJSON', value: { toJSON: function () { return 'j'; } }, expected: '"j"', note: 'root toJSON' },
    { name: 'customToSource', value: { x: 1, toSource: function () { return 'HACKED'; } }, expected: '{"x":1}', note: 'user toSource must be ignored' },
    { name: 'inherited', value: Object.create({ parent: 1 }, { own: { value: 2, enumerable: true, writable: true, configurable: true } }), expected: '{"own":2}' },
    { name: 'undefProp', value: { u: undefined }, expected: '{}' },
    { name: 'fnProp', value: { f: function () { return 1; } }, expected: '{}' },
    { name: 'nested', value: { a: { b: [1, { c: null }] } }, expected: '{"a":{"b":[1,{"c":null}]}}' },
    { name: 'key1e3', value: { '1e3': 1 }, expected: '{"1e3":1}' },
    { name: 'key150', value: { '1.50': 1 }, expected: '{"1.50":1}' },
    { name: 'key01', value: { '01': 1 }, expected: '{"01":1}' },
    { name: 'key0x10', value: { '0x10': 1 }, expected: '{"0x10":1}' },
    { name: 'keyEmpty', value: { '': 1 }, expected: '{"":1}' },
    { name: 'keySpace', value: { ' ': 1 }, expected: '{" ":1}' },
    { name: 'keyDash', value: { '-': 1 }, expected: '{"-":1}' },
    { name: 'keyUnicode', value: { 'é': 1 }, expected: '{"é":1}' },
    { name: 'keyControl', value: { 'a\u0000b': 1 }, expected: '{"a\\u0000b":1}' },
    { name: 'keyNegZero', value: { '-0': 1 }, expected: '{"-0":1}' },
    { name: 'keyHugeInt', value: { '9007199254740993': 1 }, expected: '{"9007199254740993":1}' },
    { name: 'protoOwn', value: ownProto(), expected: '{"__proto__":1}', note: 'own __proto__ data prop' },
    { name: 'sharedRef', value: [shared, shared], expected: '[{"a":1},{"a":1}]' },
    { name: 'cyclic', value: cyclic, note: 'both implementations throw' },
    { name: 'cyclicArray', value: arrCyc, note: 'both implementations throw' },
    { name: 'deep100', value: deepObject(100) },
    { name: 'date', value: new Date(0), expected: '"1970-01-01T00:00:00.000Z"' },
    { name: 'invalidDate', value: new Date(NaN), expected: 'null' }
  ];
}

export function makeRootSpecials(): ValueFixture[] {
  return [
    { name: 'rootUndefined', value: undefined, expected: 'undefined', note: 'stringify returns undefined' },
    { name: 'rootFunction', value: function () { return 1; }, expected: 'undefined', note: 'stringify returns undefined' },
    { name: 'rootString', value: 'x', expected: '"x"' },
    { name: 'rootNumber', value: 5, expected: '5' },
    { name: 'rootNegZero', value: -0, expected: '0' },
    { name: 'rootNan', value: NaN, expected: 'null' },
    { name: 'rootInfinity', value: Infinity, expected: 'null' },
    { name: 'rootDate', value: new Date(0), expected: '"1970-01-01T00:00:00.000Z"' }
  ];
}

export function makeReplacerCases(): Array<{ name: string; value: any; replacer: any; expected: string }> {
  return [
    { name: 'fnDrop', value: { a: 1, b: 2 }, replacer: function (k: string, v: any) { return k === 'b' ? undefined : v; }, expected: '{"a":1}' },
    { name: 'fnRewrite', value: { a: 1 }, replacer: function (k: string, v: any) { return typeof v === 'number' ? v * 10 : v; }, expected: '{"a":10}' },
    { name: 'fnRoot', value: 1, replacer: function (k: string, v: any) { return k === '' ? 99 : v; }, expected: '99' },
    { name: 'arrFilter', value: { a: 1, b: 2, c: 3 }, replacer: ['a', 'c'], expected: '{"a":1,"c":3}' },
    { name: 'arrMissing', value: { a: 1 }, replacer: ['z'], expected: '{}' },
    { name: 'arrNested', value: { a: { x: 1, y: 2 } }, replacer: ['a', 'x'], expected: '{"a":{"x":1}}' },
    { name: 'toJSONThenReplacer', value: { toJSON: function () { return { n: 1 }; } }, replacer: function (k: string, v: any) { return typeof v === 'number' ? v + 1 : v; }, expected: '{"n":2}' }
  ];
}

export function makeValidJson(): string[] {
  return [
    'null', 'true', 'false', '0', '-0', '1.5', '-2.5e-3', '1e5', '1E+10', '0.5',
    '12345678901234567890', '""', '"x"', '"\\"\\\\\\/\\b\\f\\n\\r\\t"', '"\\u0041"',
    '"\\uD800"', '"\\ud800\\udc00"', '{}', '[]', '{"a":1}', '[1,2,3]',
    '{"a":{"b":[1,2,{"c":null}]}}', '  { "a" : 1 }  ', '[null,true,false]',
    '{"":0}', '{"\\u0061":1}', '["\\u2028"]', '["\u2028"]',
    '[' + deepArrayText(100) + ']',
    '{"a":1,"b":[true,"x",null,{"c":[]}]}'
  ];
}

export function makeInvalidJson(): string[] {
  return [
    '01', '-01', '1.', '.1', '1e', '1e+', '1e-', '[1,]', '{"a":1,}', '{a:1}', "{'a':1}",
    'undefined', 'NaN', 'Infinity', '/*x*/1', '({a:1})', '{"x":(sideEffect=1)}',
    '{"x":1} extra', '', ' ', '{', '}', '[', ']', '[1', '{"a"', '{"a":}', '{"a":1 "b":2}',
    '"unterminated', '"bad\\x41"', '"bad\\u12g4"', '"bad\\v"', '"bad\\0"', '\\',
    '1..2', '0x1', '+1', '-', 'tru', 'nullx', 'nul', '[,]', '{,}', '{:"a"}',
    '{"a" 1}', '{"a":1,,"b":2}', '[1 2]', '["a" "b"]', '"\\u12"', '"line\nbreak"',
    '"tab\t"',     'true false', '[1]e', '0e', '00', '-00', '\uFEFF{}',
    '[' + deepArrayText(600) + ']', '{"a":1}}}', '[1,2',
    '"\\u00"', '"\\u000"', '"\\x41"'
  ];
}

export function makeSecurityFixtures(): string[] {
  // All of these must be rejected by BOTH strict parse and the checked decode.
  // Note: "({a:1})" is deliberately NOT here - parens around object literals
  // are the legitimate source-literal format accepted by the checked lane.
  return [
    '{"a":1,"b":(probe42=42,"x")}',
    '{"x":(sideEffect=1)}',
    'x=1',
    '{"a":1};globalX=1',
    '{"a":1},"b":2',
    '[1].push(99)',
    '{"x":new Date(0)}'
  ];
}

export function makeCheckedValid(): string[] {
  return [
    'undefined', 'NaN', 'Infinity', '({a:1, b:[true, null, "x"]})',
    '({u:undefined, n:NaN, i:Infinity})', '[undefined, undefined, 1]',
    '({"a b":1})', '({42:"x"})', '({a_b:1, $x:2})', '({a:"\\v\\x41\\0"})',
    '({a:1e3})', '({a:-0.5})', '({})', '[]', '42', '"x"', 'null', 'true',
    '({nested:{arr:[1,({deep:true})]}})'
  ];
}

export function makeCheckedInvalid(): string[] {
  // "{a:1}" and "01" are deliberately absent: bare keys and leading zeros are
  // the legitimate source-literal format accepted by the checked lane.
  return [
    '({f:(function () { return 1; })})', '(new Date(0))', '({a:1}).x',
    '({a:1});x=1', 'x=1', '(function(){return 1;})()', '({a:/re/})',
    '({a:this})', '({a:{b:1}}).a.b', '({a:1}, {b:2})', '({a:1,})',
    '({a:{b:1})', '(new String("x"))', '({a:1}) extra',
    '[1,]', '({a:undefined, b:1}).b', '({a:1}) + 1', '({a:1})()'
  ];
}

function makeSparse(): any[] {
  var a: any[] = [];
  a[2] = 1;
  return a;
}

function ownProto(): any {
  var o: any = {};
  try {
    Object.defineProperty(o, '__proto__', { value: 1, writable: true, enumerable: true, configurable: true });
  } catch (e) {
    o['__proto__'] = 1;
  }
  return o;
}

function deepObject(depth: number): any {
  var o: any = { leaf: 1 };
  var i: number;
  for (i = 0; i < depth; i++) {
    o = { next: o };
  }
  return o;
}

function deepArrayText(depth: number): string {
  var s = '0';
  var i: number;
  for (i = 0; i < depth; i++) {
    s = '[' + s + ']';
  }
  return s;
}
