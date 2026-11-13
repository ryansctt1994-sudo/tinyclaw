const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveOutgoingFile, collectOutgoingFiles } = require('../src/lib/file-security.ts');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyclaw-files-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const exchange = path.join(home, 'files');
  fs.mkdirSync(exchange);
  const allowed = path.join(exchange, 'report.md');
  const secret = path.join(home, 'secret.txt');
  fs.writeFileSync(allowed, 'safe');
  fs.writeFileSync(secret, 'private');
  return { home, exchange, allowed, secret };
}

test('allows existing regular files inside the exchange directory', (t) => {
  const { exchange, allowed } = fixture(t);
  assert.equal(resolveOutgoingFile(allowed, exchange), fs.realpathSync(allowed));
});

test('rejects outside files, sibling prefix collisions and traversal', (t) => {
  const { home, exchange, secret } = fixture(t);
  const sibling = path.join(home, 'files-other');
  fs.mkdirSync(sibling);
  const siblingFile = path.join(sibling, 'nope.txt');
  fs.writeFileSync(siblingFile, 'nope');
  assert.equal(resolveOutgoingFile(secret, exchange), null);
  assert.equal(resolveOutgoingFile(siblingFile, exchange), null);
  assert.equal(resolveOutgoingFile(path.join(exchange, '..', 'secret.txt'), exchange), null);
});

test('rejects symlinks that resolve outside exchange directory', (t) => {
  const { exchange, secret } = fixture(t);
  const link = path.join(exchange, 'secret-link');
  fs.symlinkSync(secret, link);
  assert.equal(resolveOutgoingFile(link, exchange), null);
});

test('permits links that resolve to a regular file inside exchange directory', (t) => {
  const { exchange, allowed } = fixture(t);
  const link = path.join(exchange, 'safe-link');
  fs.symlinkSync(allowed, link);
  assert.equal(resolveOutgoingFile(link, exchange), fs.realpathSync(allowed));
});

test('rejects relative, missing, and directory paths', (t) => {
  const { exchange } = fixture(t);
  assert.equal(resolveOutgoingFile('report.md', exchange), null);
  assert.equal(resolveOutgoingFile(path.join(exchange, 'missing'), exchange), null);
  assert.equal(resolveOutgoingFile(exchange, exchange), null);
  assert.equal(resolveOutgoingFile(path.join(exchange, 'subdir'), exchange), null);
  assert.equal(resolveOutgoingFile('/tmp/other', path.join(exchange, 'missing-root')), null);
});

test('collects only permitted send_file tags and deduplicates paths', (t) => {
  const { exchange, allowed, secret } = fixture(t);
  const files = new Set();
  const response = 'Hello [send_file: ' + secret + '] [send_file: ' + allowed + '] [send_file: ' + allowed + ']';
  collectOutgoingFiles(response, files, exchange);
  assert.deepEqual([...files], [fs.realpathSync(allowed)]);
});

test('ignores incomplete and nonexistent file tags', (t) => {
  const { exchange } = fixture(t);
  const files = new Set();
  collectOutgoingFiles('[send_file: /missing/file] [send_file: ] [send_file: /not-closed', files, exchange);
  assert.equal(files.size, 0);
});
