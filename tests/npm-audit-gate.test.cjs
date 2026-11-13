'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {summarize} = require('../scripts/npm-audit-gate.cjs');
test('fail closed when npm audit is missing or malformed', () => {
  assert.equal(summarize({error:{code:'EAI_AGAIN'}}).status, 2);
  assert.equal(summarize({}).status, 2);
});
test('fail on production high or critical package entries', () => {
  const r = summarize({vulnerabilities: {
    'unsafe-package': {severity:'critical', isDirect:true, fixAvailable:false, via:['bad-advisory']},
    nested: {severity:'high', isDirect:false, fixAvailable:true, via:['unsafe-package']},
  }, metadata:{vulnerabilities:{critical:1,high:1}}});
  assert.equal(r.status, 1);
  assert.match(r.lines.join('\n'), /unsafe-package/);
  assert.match(r.lines.join('\n'), /nested/);
});
test('moderate findings report but do not trigger high-severity block', () => {
  const r = summarize({vulnerabilities:{minor:{severity:'moderate',via:[],fixAvailable:true}},
    metadata:{vulnerabilities:{moderate:1}}});
  assert.equal(r.status,0);
});
