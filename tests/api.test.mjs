import test from 'node:test';
import assert from 'node:assert/strict';
import { callApi, readStoredSession, tokenIsExpired, EXPIRED_SIGN_IN_MESSAGE } from '../src/lib/api.js';

function jwt(payload) {
  const part = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(payload)}.sig`;
}

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

test('callApi posts JSON with text/plain so Apps Script skips CORS preflight', async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { json: async () => ({ ok: true, role: 'brother' }) };
  };
  try {
    const result = await callApi('bootstrap', 'tok-1', { eventId: 'e1' }, 'https://example.com/exec');
    assert.deepEqual(result, { ok: true, role: 'brother' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.com/exec');
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.headers['Content-Type'], 'text/plain;charset=utf-8');
    assert.deepEqual(JSON.parse(calls[0].opts.body), {
      action: 'bootstrap',
      token: 'tok-1',
      eventId: 'e1',
    });
  } finally {
    globalThis.fetch = original;
  }
});

test('an expired login error clears the stored token', async () => {
  const storage = memoryStorage({ google_token: 'stale' });
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const originalSession = globalThis.sessionStorage;
  globalThis.localStorage = storage;
  globalThis.sessionStorage = memoryStorage();
  globalThis.fetch = async () => ({ json: async () => ({ error: 'Invalid or expired login' }) });
  try {
    await assert.rejects(
      () => callApi('getMe', 'stale', {}, 'https://example.com/exec'),
      /Invalid or expired login/,
    );
    assert.equal(storage.getItem('google_token'), null);
    assert.equal(globalThis.sessionStorage.getItem('login_message'), EXPIRED_SIGN_IN_MESSAGE);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalStorage;
    globalThis.sessionStorage = originalSession;
  }
});

test('stored token is dropped when its exp is in the past', () => {
  const fresh = jwt({ exp: 2_000_000_000 });
  const stale = jwt({ exp: 1 });
  assert.equal(tokenIsExpired(fresh, 1_700_000_000_000), false);
  assert.equal(tokenIsExpired(stale, 1_700_000_000_000), true);

  const storage = memoryStorage({ google_token: stale });
  const dropped = readStoredSession(storage, 1_700_000_000_000);
  assert.deepEqual(dropped, { token: null, expired: true });
  assert.equal(storage.getItem('google_token'), null);

  const keptStorage = memoryStorage({ google_token: fresh });
  const kept = readStoredSession(keptStorage, 1_700_000_000_000);
  assert.equal(kept.token, fresh);
  assert.equal(kept.expired, false);
});
