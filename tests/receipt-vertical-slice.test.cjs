'use strict';
/**
 * Credential-free vertical-slice fixture:
 * synthetic agent bytes -> synthetic skill bytes -> SQLite queued message
 * -> mock deterministic operation -> completed message -> verifiable receipt.
 *
 * No real skill authorization, model call, OS sandbox, or signed audit custody.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-receipt-'));
process.env.TINYCLAW_HOME = home;
for (const dir of ['files', 'logs', 'receipts']) {
  fs.mkdirSync(path.join(home, dir), {recursive:true});
}
const queue = require('../dist/lib/db.js');
const { hashContent, createReceipt, newAttemptId, verifyReceipt } =
  require('../dist/lib/execution-receipt.js');
queue.initQueueDb();
after(() => {
  queue.closeQueueDb();
  fs.rmSync(home, {recursive:true, force:true});
});

test('mock end-to-end queue → deterministic result → exclusive receipt → independent verify', () => {
  const agentBytes = Buffer.from('name: approved-fixture\nrole: mock', 'utf8');
  const skillBytes = Buffer.from('id: text-upper\nauthority: none', 'utf8');
  const input = 'hello agent';
  const messageId = 'fixture-' + process.pid;

  const rowId = queue.enqueueMessage({
    channel:'test', sender:'fixture', agent:'default',
    message: input, messageId,
  });
  const claimed = queue.claimNextMessage('default');
  assert.equal(claimed.id, rowId);
  assert.equal(claimed.message, input);
  const boundedOutput = claimed.message.toUpperCase().slice(0, 256);
  queue.completeMessage(rowId);
  assert.equal(queue.getQueueStatus().completed, 1);

  const receipt = createReceipt({
    agent_sha256: hashContent(agentBytes),
    skill_sha256: hashContent(skillBytes),
    input_sha256: hashContent(Buffer.from(claimed.message, 'utf8')),
    output_sha256: hashContent(Buffer.from(boundedOutput, 'utf8')),
    timestamp_ms: 1763031600000,
    attempt_id: newAttemptId(),
    status: 'completed',
  });
  const receiptPath = path.join(home, 'receipts', receipt.attempt_id + '.json');
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n',
    {flag:'wx', mode:0o600});
  const saved = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(verifyReceipt(saved), true);
  assert.equal(saved.authority, 'none');
  assert.equal(saved.input_sha256, hashContent(input));
  assert.equal(saved.output_sha256, hashContent(boundedOutput));
  assert.throws(() => fs.writeFileSync(receiptPath, 'overwrite', {flag:'wx'}),
    /EEXIST/);
  assert.equal(verifyReceipt({...saved, output_sha256:hashContent('changed')}), false);
});

test('independent attempts produce distinct receipt identities for identical contents', () => {
  const input = {
    agent_sha256: hashContent('agent'),
    skill_sha256: hashContent('skill'),
    input_sha256: hashContent('input'),
    output_sha256: hashContent('output'),
    timestamp_ms: 1763031600000,
    status: 'completed',
  };
  const a = createReceipt({...input, attempt_id:newAttemptId()});
  const b = createReceipt({...input, attempt_id:newAttemptId()});
  assert.notEqual(a.attempt_id, b.attempt_id);
  assert.notEqual(a.digest_sha256, b.digest_sha256);
  assert.equal(verifyReceipt(a), true);
  assert.equal(verifyReceipt(b), true);
});
