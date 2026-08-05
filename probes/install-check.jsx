// First-eval install check.
#target illustrator
var out = {
  json: typeof JSON === 'object' && typeof JSON.parse === 'function',
  globalEson: typeof $.global.ESON === 'object',
  globalJson: typeof $.global.JSON === 'object',
  identity: typeof $.global.JSON === 'object' && $.global.JSON.parse === $.global.ESON.parse,
  strict: (function () { try { JSON.parse('[01]'); return 'accepted'; } catch (e) { return 'rejected'; } })()
};
var rf = new File($.getenv('TEMP') + '/install-check.json');
rf.encoding = 'UTF-8';
rf.open('w');
rf.write(JSON.stringify(out));
rf.close();
