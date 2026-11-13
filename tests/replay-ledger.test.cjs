'use strict';
/**
 * WP-002: SQLite replay admission across processes, restart, and kill windows.
 * Tests ledger admission only; no external effects or live providers.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const Database = require('better-sqlite3');

const workerMode = process.argv[2];
const home = workerMode ? process.env.TINYCLAW_HOME :
  fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-replay-'));
process.env.TINYCLAW_HOME = home;
fs.mkdirSync(path.join(home, 'logs'), {recursive:true});
const storePath = path.join(home, 'tinyclaw.db');
const db = require('../dist/lib/db.js');

if (workerMode === '--race') {
  try {
    db.initQueueDb();
    let admitted = 0;
    for (let i = 0; i < 40; i++) {
      if (db.admitExecution(process.argv[3])) admitted += 1;
    }
    db.closeQueueDb();
    process.stdout.write(JSON.stringify({admitted}) + '\n');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
} else if (workerMode === '--uncommitted') {
  const conn = new Database(storePath);
  conn.pragma('busy_timeout = 5000');
  conn.exec('BEGIN IMMEDIATE');
  conn.prepare('INSERT INTO execution_admissions(execution_id, admitted_at_ms) VALUES (?, ?)').run(
    process.argv[3], Date.now());
  process.stdout.write('TRANSACTION_OPEN\n');
  setInterval(() => {}, 1000);
} else if (workerMode === '--committed') {
  db.initQueueDb();
  if (!db.admitExecution(process.argv[3])) process.exit(2);
  process.stdout.write('ADMITTED\n');
  setInterval(() => {}, 1000);
} else {
  db.initQueueDb();
  after(() => {
    db.closeQueueDb();
    fs.rmSync(home, {recursive:true, force:true});
  });

  function rows(executionId) {
    const conn = new Database(storePath, {readonly: true});
    try {
      return conn.prepare('SELECT COUNT(*) AS n FROM execution_admissions WHERE execution_id=?')
        .get(executionId).n;
    } finally {
      conn.close();
    }
  }

  function runWorker(mode, executionId) {
    return new Promise((resolve,reject) => {
      execFile(process.execPath, [__filename, mode, executionId], {
        env:{PATH:process.env.PATH, TINYCLAW_HOME:home},
        timeout:20000, maxBuffer: 128*1024,
      }, (err, stdout, stderr) => {
        if (err) reject(new Error('Worker failure: '+err+'\n'+stderr));
        else {
          try { resolve(JSON.parse(stdout.trim())); }
          catch (parseError) {reject(parseError);}
        }
      });
    });
  }

  /** Parent kills child after a proven transaction boundary marker. */
  function killAt(mode, executionId, marker) {
    return new Promise((resolve,reject) => {
      const child = spawn(process.execPath, [__filename, mode, executionId], {
        env:{PATH:process.env.PATH, TINYCLAW_HOME:home},
        stdio:['ignore','pipe','pipe'],
      });
      let observed = false;
      let stdout = '';
      let stderr = '';
      const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.stdout.on('data', chunk => {
        stdout += String(chunk);
        if (!observed && stdout.includes(marker)) {
          observed = true;
          child.kill('SIGKILL');
        }
      });
      child.stderr.on('data', chunk => {stderr += String(chunk);});
      child.on('error', reject);
      child.on('close', (code, signal) => {
        clearTimeout(deadline);
        if (observed && signal === 'SIGKILL') resolve();
        else reject(new Error('Kill boundary not observed: '+JSON.stringify({code,signal,stdout,stderr})));
      });
    });
  }

  test('eight competing OS processes: only one of 320 admissions succeeds', async () => {
    const id = 'a'.repeat(32);
    const outcomes = await Promise.all(Array.from({length:8}, () => runWorker('--race',id)));
    assert.equal(outcomes.reduce((n,x)=>n+x.admitted,0),1);
    assert.equal(rows(id),1);
    assert.equal(db.admitExecution(id),false);
    const conn = new Database(storePath, {readonly:true});
    try {
      assert.equal(conn.pragma('journal_mode',{simple:true}),'wal');
      assert.equal(conn.pragma('integrity_check',{simple:true}),'ok');
    } finally {
      conn.close();
    }
  });

  test('committed admission survives DB close and process restart', () => {
    const id='b'.repeat(32);
    assert.equal(db.admitExecution(id),true);
    db.closeQueueDb();
    db.initQueueDb();
    assert.equal(rows(id),1);
    assert.equal(db.admitExecution(id),false);
  });

  test('killing a writer before commit rolls back and permits exactly one later admission', async () => {
    const id='c'.repeat(32);
    await killAt('--uncommitted',id,'TRANSACTION_OPEN');
    assert.equal(rows(id),0,'uncommitted insert must not survive');
    assert.equal(db.admitExecution(id),true);
    assert.equal(db.admitExecution(id),false);
    assert.equal(rows(id),1);
  });

  test('killing after commit cannot re-admit the same identity', async () => {
    const id='d'.repeat(32);
    await killAt('--committed',id,'ADMITTED');
    assert.equal(rows(id),1);
    assert.equal(db.admitExecution(id),false);
  });

  test('invalid identities fail closed, not silently ignored', () => {
    for (const bad of ['', 'A'.repeat(32), 'xyz', '../outside', 'f'.repeat(33)]) {
      assert.throws(()=>db.admitExecution(bad),/Invalid execution identity/);
    }
  });
}
