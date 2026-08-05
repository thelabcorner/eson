// Private JSON2 instance loader.
//
// The vendored json2.js (dist/vendor-eson.js) attaches to a global `JSON`
// object. We wrap the source in an IIFE that receives a private object so the
// polyfill never touches the engine's global scope; the returned instance is
// ESON's fallback backend and the differential reference.
//
// Side effect inherited from json2: it polyfills Date.prototype.toJSON and
// Boolean/Number/String.prototype.toJSON when missing (identical to what the
// ESON bundle does today).
import { Json2Api } from './types';

export function loadJson2(json2Source: string): Json2Api {
  if (!json2Source || typeof json2Source !== 'string') {
    throw new Error('ESON.loadJson2: json2 source required');
  }
  var wrapped = '(function (JSON) {\n' + json2Source + '\nreturn JSON;\n})({})';
  var instance: any = eval(wrapped);
  if (!instance || typeof instance.parse !== 'function' || typeof instance.stringify !== 'function') {
    throw new Error('ESON.loadJson2: loaded instance is not a JSON API');
  }
  return instance as Json2Api;
}
