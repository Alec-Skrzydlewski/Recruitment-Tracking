import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const headers = Object.fromEntries(config.headers[0].headers.map(h => [h.key, h.value]));
const csp = Object.fromEntries(headers['Content-Security-Policy'].split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

test('security headers are present on every route', () => {
  assert.equal(config.headers[0].source, '/(.*)');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.match(headers['Permissions-Policy'], /camera=\(\)/);
});

test('CSP allows exactly what Google Identity Services and Apps Script need', () => {
  assert.deepEqual(csp['default-src'], ["'self'"]);
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.ok(csp['script-src'].includes('https://accounts.google.com/gsi/client'));
  assert.ok(csp['frame-src'].includes('https://accounts.google.com/gsi/'));
  assert.ok(csp['connect-src'].includes('https://script.google.com'));
  assert.ok(csp['connect-src'].includes('https://script.googleusercontent.com'));
  // No blanket unsafe sources anywhere.
  assert.doesNotMatch(headers['Content-Security-Policy'], /unsafe-inline|unsafe-eval|\*/);
  // Google sign-in uses a popup that must be able to message the opener.
  assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin-allow-popups');
});

test('index.html has no inline script that the CSP would block', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
  assert.equal(inline.length, 0);
});
