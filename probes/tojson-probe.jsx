// Live engine capabilities: Date.prototype.toJSON and friends.
#target illustrator
var out = {
  dateToJSON: typeof Date.prototype.toJSON,
  stringToJSON: typeof String.prototype.toJSON,
  numberToJSON: typeof Number.prototype.toJSON,
  dateIso: (function () { try { return String(new Date(0)); } catch (e) { return 'ERR:' + e; } })()
};
var rf = new File($.getenv('TEMP') + '/tojson-probe.json');
rf.encoding = 'UTF-8';
rf.open('w');
rf.write(JSON.stringify(out));
rf.close();
