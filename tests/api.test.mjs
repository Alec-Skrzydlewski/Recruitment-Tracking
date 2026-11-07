import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callApi, readStoredSession, tokenIsExpired, onSessionEnded, EXPIRED_SIGN_IN_MESSAGE, API_VERSION,
} from '../src/lib/api.js';

const URL_ = 'https://backend.example.test/exec';

function jwt(payload) {
  const part = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
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

function response(body, init = {}) {
  return { ok: init.ok !== false, status: init.status || 200, json: async () => { if (body instanceof Error) throw body; return body; } };
}

test('callApi posts JSON as text/plain with the API version and no credentials', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return response({ ok: true, role: 'brother' }); };
  const result = await callApi('bootstrap', 'tok-1', { eventId: 'e1', apiVersion: 99, action: 'evil' }, URL_, { fetchImpl });
  assert.deepEqual(result, { ok: true, role: 'brother' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.equal(calls[0].opts.credentials, 'omit');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { eventId: 'e1', apiVersion: API_VERSION, action: 'bootstrap', token: 'tok-1' });
});

test('missing backend URL fails closed without a request', async () => {
  let called = false;
  await assert.rejects(() => callApi('getMe', 't', {}, '', { fetchImpl: async () => { called = true; } }), err => err.code === 'NOT_CONFIGURED');
  assert.equal(called, false);
});

test('an AUTH error clears the stored token and ends the session once', async () => {
  const storage = memoryStorage({ google_token: 'stale' });
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = storage;
  const ended = [];
  const off = onSessionEnded(msg => ended.push(msg));
  try {
    await assert.rejects(
      () => callApi('getMe', 'stale', {}, URL_, { fetchImpl: async () => response({ error: 'Invalid or expired login', code: 'AUTH' }) }),
      err => err.code === 'AUTH' && err.message === EXPIRED_SIGN_IN_MESSAGE,
    );
    assert.equal(storage.getItem('google_token'), null);
    assert.deepEqual(ended, [EXPIRED_SIGN_IN_MESSAGE]);
  } finally {
    off();
    globalThis.localStorage = originalStorage;
  }
});

test('server errors keep their code and do not end the session', async () => {
  const ended = [];
  const off = onSessionEnded(msg => ended.push(msg));
  await assert.rejects(
    () => callApi('castVote', 't', {}, URL_, { fetchImpl: async () => response({ error: 'Invalid vote', code: 'INVALID' }) }),
    err => err.code === 'INVALID' && err.message === 'Invalid vote',
  );
  off();
  assert.equal(ended.length, 0);
});

test('network failure, HTTP failure and unreadable responses are friendly and never retried', async () => {
  let n = 0;
  await assert.rejects(() => callApi('castVote', 't', {}, URL_, { fetchImpl: async () => { n += 1; throw new TypeError('Failed to fetch'); } }), err => err.code === 'NETWORK');
  assert.equal(n, 1);
  await assert.rejects(() => callApi('getMe', 't', {}, URL_, { fetchImpl: async () => response({}, { ok: false, status: 502 }) }), err => err.code === 'HTTP');
  await assert.rejects(() => callApi('getMe', 't', {}, URL_, { fetchImpl: async () => response(new SyntaxError('bad')) }), err => err.code === 'BAD_RESPONSE');
});

test('requests time out instead of spinning forever', async () => {
  const fetchImpl = (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(() => callApi('getVoteData', 't', {}, URL_, { fetchImpl, timeoutMs: 20 }), err => err.code === 'TIMEOUT');
});

test('stored token is dropped when its exp is in the past', () => {
  const fresh = jwt({ exp: 2_000_000_000 });
  const stale = jwt({ exp: 1 });
  assert.equal(tokenIsExpired(fresh, 1_700_000_000_000), false);
  assert.equal(tokenIsExpired(stale, 1_700_000_000_000), true);
  const storage = memoryStorage({ google_token: stale });
  assert.deepEqual(readStoredSession(storage, 1_700_000_000_000), { token: null, expired: true });
  assert.equal(storage.getItem('google_token'), null);
  const kept = readStoredSession(memoryStorage({ google_token: fresh }), 1_700_000_000_000);
  assert.equal(kept.token, fresh);
});

test('photo diagnostic token is kept only when it is a bounded step/CATEGORY pair', async () => {
  const call = diagnostic => callApi('syncPhotoFolder', 't', {}, URL_, { fetchImpl: async () => response({ error: 'x', code: 'PHOTO_UNAVAILABLE', diagnostic }) });
  await assert.rejects(() => call('openSheetFile/SCOPE_NOT_GRANTED'), err => err.diagnostic === 'openSheetFile/SCOPE_NOT_GRANTED');
  for (const bad of ['You do not have permission to call DriveApp', 'a/b c', 42, { x: 1 }, '<img src=x>/X']) {
    await assert.rejects(() => call(bad), err => err.code === 'PHOTO_UNAVAILABLE' && err.diagnostic === undefined);
  }
});
