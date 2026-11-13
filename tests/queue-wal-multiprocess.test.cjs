'use strict';
/** Multi-process SQLite WAL contention test. No AI providers or network. */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const Database = require('better-sqlite3');

const home = process.env.TINYCLAW_HOME ||
  fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-wal-'));
process.env.TINYCLAW_HOME = home;
fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
fs.mkdirSync(path.join(home, 'files'), { recursive: true });
const db = require('../dist/lib/db.js');

if (process.argv.includes('--drain-worker')) {
  db.initQueueDb();
  const claimed = [];
  try {
    while (true) {
      const message = db.claimNextMessage('default');
      if (!message) break;
      claimed.push(message.id);
      db.completeMessage(message.id);
    }
    db.closeQueueDb();
    process.stdout.write(JSON.stringify(claimed) + '\n');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
} else {
  after(() => {
    db.closeQueueDb();
    fs.rmSync(home, { recursive: true, force: true });
  });

  test('WAL: eight competing OS processes drain 320 messages once, with database integrity', async () => {
    const count = 320;
    db.initQueueDb();
    for (let i = 0; i < count; i++) {
      db.enqueueMessage({
        channel: 'fixture', sender: 'test',
        message: 'stress-' + i, messageId: 'wal-' + process.pid + '-' + i,
      });
    }
    assert.equal(db.getQueueStatus().pending, count);
    db.closeQueueDb();

    const worker = () => new Promise((resolve, reject) => {
      execFile(process.execPath, [__filename, '--drain-worker'], {
        env: { ...process.env, TINYCLAW_HOME: home },
        timeout: 20000,
        maxBuffer: 256 * 1024,
      }, (error, stdout, stderr) => {
        if (error) return reject(new Error('WAL worker failed: ' + error + '\n' + stderr));
        try { resolve(JSON.parse(stdout.trim())); }
        catch (e) { reject(new Error('Worker returned malformed JSON: ' + e + '\n' + stderr)); }
      });
    });

    const results = await Promise.all(Array.from({ length: 8 }, worker));
    const ids = results.flat();
    assert.equal(ids.length, count, 'every message must complete');
    assert.equal(new Set(ids).size, count, 'no message may be claimed twice');

    const readOnly = new Database(path.join(home, 'tinyclaw.db'), { readonly: true });
    try {
      assert.equal(readOnly.pragma('journal_mode', { simple: true }), 'wal');
      assert.equal(readOnly.pragma('integrity_check', { simple: true }), 'ok');
      assert.equal(readOnly.prepare("SELECT COUNT(*) AS n FROM messages WHERE status='completed'").get().n, count);
      assert.equal(readOnly.prepare("SELECT COUNT(*) AS n FROM messages WHERE status!='completed'").get().n, 0);
    } finally {
      readOnly.close();
    }
  });
}
