'use strict';
/** WP-001: exercise the actual spawned child environment, not only policy logic. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkerEnvironment } = require('../dist/lib/worker-environment.js');
const { runCommand } = require('../dist/lib/invoke.js');

const SECRET_KEYS = [
  'AWS_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN',
  'DATABASE_PASSWORD',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'NODE_OPTIONS',
  'HOME',
  'USERPROFILE',
  'XDG_CONFIG_HOME',
];

test('allowlist rejects ambient credentials and keeps essential executable PATH', () => {
  const source = {
    PATH: '/usr/bin:/bin', LANG: 'C.UTF-8',
    AWS_SECRET_ACCESS_KEY: 'fixture-not-a-secret',
    GITHUB_TOKEN: 'fixture-not-a-secret',
    DATABASE_PASSWORD: 'fixture-not-a-secret',
    NODE_OPTIONS: '--inspect',
    HOME: '/home/protected',
    TINYCLAW_ALLOW_UNSANDBOXED_OPENCODE: '1',
  };
  const result = buildWorkerEnvironment(source);
  assert.deepEqual(result, { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' });
  for (const key of SECRET_KEYS) assert.equal(result[key], undefined, key);
  assert.equal(result.TINYCLAW_ALLOW_UNSANDBOXED_OPENCODE, undefined);
});

test('real child process receives only allowlisted environment, not parent secrets', async () => {
  const saved = new Map();
  const supplied = {
    AWS_SECRET_ACCESS_KEY: 'canary-aws-009',
    GITHUB_TOKEN: 'canary-github-009',
    DATABASE_PASSWORD: 'canary-db-009',
    OPENAI_API_KEY: 'canary-openai-009',
    ANTHROPIC_API_KEY: 'canary-anthropic-009',
    NODE_OPTIONS: '--no-warnings',
    TINYCLAW_ALLOW_UNSANDBOXED_OPENCODE: '1',
  };
  for (const [key, value] of Object.entries(supplied)) {
    saved.set(key, process.env[key]);
    process.env[key] = value;
  }
  let output;
  try {
    output = await runCommand(process.execPath, [
      '-e',
      "process.stdout.write(JSON.stringify(process.env))",
    ], undefined, {timeoutMs: 3000, maxOutputBytes: 4096});
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const received = JSON.parse(output);
  for (const key of Object.keys(supplied)) {
    assert.equal(Object.prototype.hasOwnProperty.call(received, key), false, key);
  }
  for (const key of SECRET_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(received, key), false, key);
  }
  const expected = buildWorkerEnvironment(process.env);
  assert.deepEqual(Object.keys(received).sort(), Object.keys(expected).sort());
});

test('provider process is wired to the allowlist rather than default spawn env', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/lib/invoke.ts'), 'utf8');
  assert.match(source, /env:\s*buildWorkerEnvironment\(\)/);
});
