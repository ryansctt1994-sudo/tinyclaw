'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const home = process.env.TINYCLAW_HOME || fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-smoke-'));
process.env.TINYCLAW_HOME = home;
fs.mkdirSync(path.join(home, 'files'), {recursive:true});
fs.mkdirSync(path.join(home, 'logs'), {recursive:true});
const db = require('../dist/lib/db.js');

if (process.argv.includes('--claim-worker')) {
  db.initQueueDb();
  const claimed = db.claimNextMessage('default');
  process.stdout.write(JSON.stringify({id: claimed?.id || null}) + '\n');
  // Simulate a worker that remains alive until the parent kills it.
  setInterval(() => {}, 1000);
} else {
  db.initQueueDb();
  after(() => { db.closeQueueDb(); fs.rmSync(home, {recursive:true, force:true}); });

  test('queue: unique claim under competing child processes', async () => {
    const messageId = 'race-' + process.pid;
    const rowId = db.enqueueMessage({channel:'test',sender:'fixture',message:'hello',messageId});
    const worker = () => new Promise((resolve,reject) => {
      const child = spawn(process.execPath, [__filename, '--claim-worker'], {env:{...process.env, TINYCLAW_HOME:home}, stdio:['ignore','pipe','pipe']});
      let stdout = '', stderr='';
      child.stdout.on('data', chunk => {
        stdout += chunk;
        if (stdout.includes('\n')) {
          try { resolve({child, id:JSON.parse(stdout.split('\n')[0]).id}); } catch(e) { reject(e); }
        }
      });
      child.stderr.on('data', chunk => {stderr += chunk;});
      child.on('error', reject);
      child.on('exit', code => { if (!stdout.includes('\n')) reject(new Error(`worker exited ${code}: ${stderr}`)); });
    });
    const [a,b] = await Promise.all([worker(),worker()]);
    assert.deepEqual([a.id,b.id].sort((x,y)=>(x??0)-(y??0)), [null,rowId].sort((x,y)=>(x??0)-(y??0)));
    a.child.kill('SIGKILL'); b.child.kill('SIGKILL');
    // Recovery intentionally explicit: normal startup uses a 10-minute grace period.
    await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(db.recoverStaleMessages(0), 1);
    const claimed = db.claimNextMessage('default');
    assert.equal(claimed?.id,rowId);
    db.completeMessage(rowId);
  });

  test('queue: repeated failure reaches dead-letter and manual retry restores pending', () => {
    const rowId = db.enqueueMessage({channel:'test',sender:'fixture',message:'retry',messageId:'retry-'+process.pid});
    for (let i=0; i<5; i++) {
      assert.equal(db.claimNextMessage('default')?.id,rowId);
      db.failMessage(rowId, 'synthetic failure');
    }
    assert.ok(db.getDeadMessages().some(m=>m.id===rowId));
    assert.equal(db.retryDeadMessage(rowId),true);
    assert.equal(db.claimNextMessage('default')?.id,rowId);
    db.completeMessage(rowId);
  });

  test('response: queued response can be acknowledged once', () => {
    const id = db.enqueueResponse({channel:'test',sender:'fixture',message:'ok',originalMessage:'hello',messageId:'out-'+process.pid});
    assert.ok(db.getResponsesForChannel('test').some(r=>r.id===id));
    db.ackResponse(id);
    assert.ok(!db.getResponsesForChannel('test').some(r=>r.id===id));
  });

  test('attachment: same-millisecond long responses retain separate contents', () => {
    const { handleLongResponse, LONG_RESPONSE_THRESHOLD } = require('../dist/lib/response.js');
    const a = 'A'.repeat(LONG_RESPONSE_THRESHOLD+1);
    const b = 'B'.repeat(LONG_RESPONSE_THRESHOLD+1);
    const savedNow = Date.now;
    let first, second;
    Date.now = () => 1700000000000;
    try { first = handleLongResponse(a,[]); second = handleLongResponse(b,[]); }
    finally { Date.now = savedNow; }
    assert.notEqual(first.files[0],second.files[0]);
    assert.equal(fs.readFileSync(first.files[0],'utf8'),a);
    assert.equal(fs.readFileSync(second.files[0],'utf8'),b);
  });
}
