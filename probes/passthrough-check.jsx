// Passthrough guard: a JSON-looking string result must stay envelope-encoded.
#target illustrator
var out = { checks: {} };
out.checks.jsonString = (function () {
  var s = '{"a":1}';
  var i = 0;
  while (i < s.length && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9 || s.charCodeAt(i) === 10 || s.charCodeAt(i) === 13)) i++;
  var c = i < s.length ? s.charCodeAt(i) : 0;
  return (c === 123) ? 'envelope' : 'raw';
})();
out.checks.trueString = (function () {
  var s = 'true story';
  var i = 0;
  while (i < s.length && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9 || s.charCodeAt(i) === 10 || s.charCodeAt(i) === 13)) i++;
  var c = i < s.length ? s.charCodeAt(i) : 0;
  return (c === 116) ? 'envelope' : 'raw';
})();
out.checks.plain = (function () {
  var s = 'plain text';
  var i = 0;
  while (i < s.length && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9 || s.charCodeAt(i) === 10 || s.charCodeAt(i) === 13)) i++;
  var c = i < s.length ? s.charCodeAt(i) : 0;
  return (c === 112) ? 'envelope' : 'raw';
})();
var rf = new File($.getenv('TEMP') + '/passthrough-check.json');
rf.encoding = 'UTF-8';
rf.open('w');
rf.write(JSON.stringify(out));
rf.close();
