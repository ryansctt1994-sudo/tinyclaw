'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCodexArgs, buildClaudeArgs, assertOpenCodeAuthorized } =
  require('../dist/lib/provider-policy.js');

test('Codex new session explicitly restricts sandbox and approvals', () => {
  const args = buildCodexArgs('test-model', 'untrusted input', false);
  assert.deepEqual(args, [
    'exec', '--model', 'test-model', '--skip-git-repo-check',
    '--sandbox', 'read-only', '--ask-for-approval', 'never', '--json', 'untrusted input',
  ]);
  assert.equal(args.includes('resume'), false);
});

test('Codex resumed session retains explicit sandbox restrictions', () => {
  const args = buildCodexArgs('', 'hello', true);
  assert.deepEqual(args.slice(0, 3), ['exec', 'resume', '--last']);
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(args[args.indexOf('--ask-for-approval') + 1], 'never');
});

test('Claude has no built-in or MCP tools for unattended calls', () => {
  const args = buildClaudeArgs('sonnet', 'hello', false);
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'plan');
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(args[args.indexOf('--disallowedTools') + 1], 'mcp__*');
  assert.equal(args.at(-1), 'hello');
});

test('Claude resumed sessions retain denial policy', () => {
  const args = buildClaudeArgs('', 'resume', true);
  assert.ok(args.includes('-c'));
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'plan');
});

test('OpenCode is off unless a separately isolated operator explicitly opts in', () => {
  assert.throws(() => assertOpenCodeAuthorized({}), /disabled by default/);
  assert.throws(() => assertOpenCodeAuthorized({TINYCLAW_ALLOW_UNSANDBOXED_OPENCODE:'true'}), /disabled/);
  assert.doesNotThrow(() => assertOpenCodeAuthorized({TINYCLAW_ALLOW_UNSANDBOXED_OPENCODE:'1'}));
});

test('Provider entry point calls policy builders and never adds bypass flags', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/lib/invoke.ts'), 'utf8');
  assert.match(source, /buildCodexArgs\(modelId, message, shouldResume\)/);
  assert.match(source, /buildClaudeArgs\(modelId, message, continueConversation\)/);
  assert.match(source, /assertOpenCodeAuthorized\(\)/);
  assert.doesNotMatch(source, /--dangerously-(skip-permissions|bypass-approvals-and-sandbox)/);
});
