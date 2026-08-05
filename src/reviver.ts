// Reviver walk, mirroring JSON2's walk() exactly (this === holder).
export function walkReviver(holder: any, key: string, reviver: any): any {
  var value = holder[key];
  if (value && typeof value === 'object') {
    var k: string;
    for (k in value) {
      if (Object.prototype.hasOwnProperty.call(value, k)) {
        var v = walkReviver(value, k, reviver);
        if (v !== undefined) {
          value[k] = v;
        } else {
          delete value[k];
        }
      }
    }
  }
  return reviver.call(holder, key, value);
}
