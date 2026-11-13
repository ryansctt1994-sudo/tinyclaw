const test = require('node:test');
const assert = require('node:assert/strict');
const { allowedBrowserOrigins, isBrowserOriginAllowed, apiHost } = require('../src/server/security.ts');

test('defaults to IPv4 loopback for unauthenticated API', () => {
  assert.equal(apiHost({}), '127.0.0.1');
  assert.equal(apiHost({ TINYCLAW_API_HOST: ' ' }), '127.0.0.1');
  assert.equal(apiHost({ TINYCLAW_API_HOST: '192.0.2.20' }), '192.0.2.20');
});

test('allows TinyOffice browser origins by default', () => {
  const allow = allowedBrowserOrigins({});
  assert.ok(isBrowserOriginAllowed('http://localhost:3000', allow));
  assert.ok(isBrowserOriginAllowed('http://127.0.0.1:3000', allow));
});

test('rejects unlisted cross-site browser origins and prefix tricks', () => {
  const allow = allowedBrowserOrigins({});
  assert.equal(isBrowserOriginAllowed('https://evil.example', allow), false);
  assert.equal(isBrowserOriginAllowed('http://localhost:3000.evil.example', allow), false);
  assert.equal(isBrowserOriginAllowed('http://localhost:3001', allow), false);
});

test('allows explicitly added browser origins without wildcard fallback', () => {
  const allow = allowedBrowserOrigins({TINYCLAW_ALLOWED_ORIGINS:'https://office.example, http://localhost:4200'});
  assert.equal(isBrowserOriginAllowed('https://office.example', allow), true);
  assert.equal(isBrowserOriginAllowed('http://localhost:4200', allow), true);
  assert.equal(isBrowserOriginAllowed('https://other.example', allow), false);
});

test('permits requests without Origin for CLI and channel clients', () => {
  assert.equal(isBrowserOriginAllowed(undefined, allowedBrowserOrigins({})), true);
  assert.equal(isBrowserOriginAllowed('', allowedBrowserOrigins({})), true);
});
