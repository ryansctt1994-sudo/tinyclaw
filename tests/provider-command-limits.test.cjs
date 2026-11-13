'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runCommand } = require('../dist/lib/invoke.js');

test('short-lived CLI command returns standard output', async () => {
  assert.equal(await runCommand(process.execPath, ['-e', "process.stdout.write('ok')"],
    undefined, {timeoutMs:2000,maxOutputBytes:1024}), 'ok');
});

test('unattended hanging CLI is terminated by timeout', async () => {
  const start = Date.now();
  await assert.rejects(
    runCommand(process.execPath, ['-e','setInterval(()=>{},1000)'],
      undefined, {timeoutMs:300,maxOutputBytes:1024}),
    /exceeded 300ms deadline/);
  assert.ok(Date.now()-start < 5000, 'timeout should not leave the harness hanging');
});

test('oversized combined stdout and stderr is rejected', async () => {
  await assert.rejects(
    runCommand(process.execPath,
      ['-e', "process.stdout.write('X'.repeat(8192)); process.stderr.write('Y'.repeat(8192))"],
      undefined, {timeoutMs:2000,maxOutputBytes:1024}),
    /output byte limit/);
});

test('nonzero exit status remains a clear failure', async () => {
  await assert.rejects(
    runCommand(process.execPath, ['-e',"process.stderr.write('expected failure');process.exit(7)"],
      undefined, {timeoutMs:2000,maxOutputBytes:1024}),
    /expected failure/);
});

test('invalid runtime/output limits are denied before execution', async () => {
  await assert.rejects(runCommand(process.execPath,[],undefined,{timeoutMs:0}), /Invalid/);
  await assert.rejects(runCommand(process.execPath,[],undefined,{maxOutputBytes:-1}), /Invalid/);
});
