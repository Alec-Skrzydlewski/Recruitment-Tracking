import test from 'node:test';
import assert from 'node:assert/strict';
import { authView } from '../src/lib/authView.js';

test('token with me null and loading false stays on loading', () => {
  assert.equal(authView({ token: 't', me: null, loading: false }), 'loading');
});

test('token with me null and loading true stays on loading', () => {
  assert.equal(authView({ token: 't', me: null, loading: true }), 'loading');
});

test('no token shows routes', () => {
  assert.equal(authView({ token: null, me: null, loading: false }), 'routes');
});

test('token and me shows routes', () => {
  assert.equal(authView({ token: 't', me: { email: 'a@b.c' }, loading: false }), 'routes');
});
