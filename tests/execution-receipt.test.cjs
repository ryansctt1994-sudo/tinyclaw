'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hashContent, newAttemptId, createReceipt, verifyReceipt } =
  require('../dist/lib/execution-receipt.js');

const fixed = () => ({
  agent_sha256: hashContent('agent definition v1'),
  skill_sha256: hashContent('vetted skill bytes v1'),
  input_sha256: hashContent(Buffer.from('user input', 'utf8')),
  output_sha256: hashContent(Buffer.from('bounded mocked output', 'utf8')),
  timestamp_ms: 1763031600000,
  attempt_id: 'a'.repeat(32),
  status: 'completed',
});

test('deterministic restricted canonical JSON and identical digest', () => {
  const input = fixed();
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  assert.deepEqual(createReceipt(reordered), createReceipt(input));
  assert.equal(verifyReceipt(createReceipt(input)), true);
});

test('all bound hashes and execution timestamp affect receipt digest', () => {
  const baseline = createReceipt(fixed());
  for (const key of ['agent_sha256','skill_sha256','input_sha256','output_sha256']) {
    const modified = fixed();
    modified[key] = hashContent(key + ' changed');
    assert.notEqual(createReceipt(modified).digest_sha256, baseline.digest_sha256);
  }
  assert.notEqual(createReceipt({ ...fixed(), timestamp_ms:fixed().timestamp_ms+1 }).digest_sha256,
    baseline.digest_sha256);
  assert.notEqual(createReceipt({ ...fixed(), attempt_id:'b'.repeat(32) }).digest_sha256,
    baseline.digest_sha256);
});

test('verification rejects alteration, authority escalation, or metadata injection', () => {
  const valid = createReceipt(fixed());
  for (const altered of [
    {...valid, output_sha256:hashContent('falsified output')},
    {...valid, status:'refused'},
    {...valid, authority:'granted'},
    {...valid, schema:'tinyclaw.execution-receipt.v2'},
    {...valid, privilege:'root'},
    {...valid, digest_sha256:'0'.repeat(64)},
  ]) assert.equal(verifyReceipt(altered), false);
});

test('reject malformed input and unsafe timestamp', () => {
  const base = fixed();
  for (const changed of [
    {...base, agent_sha256:'ABC'},
    {...base, attempt_id:'not-an-id'},
    {...base, timestamp_ms:Infinity},
    {...base, timestamp_ms:-1},
    {...base, timestamp_ms:1.5},
    {...base, timestamp_ms:Number.MAX_SAFE_INTEGER + 1},
    {...base, status:'authorized'},
    {...base, extra:'unexpected'},
  ]) assert.throws(() => createReceipt(changed), /Invalid execution receipt input/);
});

test('fresh attempt IDs are 128-bit hex and do not repeat in a sample', () => {
  const ids = Array.from({length:256}, newAttemptId);
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach(id=>assert.match(id, /^[a-f0-9]{32}$/));
});

test('receipt is evidence only, not a provider credential or replay authorization', () => {
  const receipt=createReceipt({...fixed(), status:'refused'});
  assert.equal(receipt.authority,'none');
  assert.equal(verifyReceipt(receipt),true);
  assert.equal(verifyReceipt({...receipt, status:'completed'}),false);
});
