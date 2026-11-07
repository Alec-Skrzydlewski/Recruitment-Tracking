// Live transport for the Apps Script backend.
//
// Apps Script web apps do not answer CORS preflight, so the body stays JSON
// but the content type is text/plain. Requests time out and are never retried
// automatically: a mutation whose response was lost may already have been
// applied, so the UI shows the failure and lets the person decide.

export const API_VERSION = 2;
export const EXPIRED_SIGN_IN_MESSAGE = 'Your sign-in expired, please sign in again.';
export const DEFAULT_TIMEOUT_MS = 20000;
const TOKEN_KEY = 'google_token';

export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ApiError';
    this.code = code || 'ERROR';
  }
}

export function jwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

// Client-side expiry check only decides whether to reuse a stored token; the
// server independently verifies every token with Google.
export function tokenIsExpired(token, nowMs = Date.now()) {
  const payload = jwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return true;
  return payload.exp * 1000 <= nowMs;
}

export function readStoredSession(storage = globalThis.localStorage, nowMs = Date.now()) {
  let raw = null;
  try {
    raw = storage && storage.getItem(TOKEN_KEY);
  } catch {
    raw = null;
  }
  if (!raw) return { token: null, expired: false };
  if (tokenIsExpired(raw, nowMs)) {
    try { storage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    return { token: null, expired: true };
  }
  return { token: raw, expired: false };
}

export function storeToken(token, storage = globalThis.localStorage) {
  try { storage.setItem(TOKEN_KEY, token); } catch { /* private mode */ }
}

export function forgetToken(storage = globalThis.localStorage) {
  try { storage.removeItem(TOKEN_KEY); } catch { /* not a browser */ }
}

const sessionListeners = new Set();

// Pages and caches subscribe so an expired session clears everything at once.
export function onSessionEnded(listener) {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export function endSession(message) {
  forgetToken();
  sessionListeners.forEach(fn => {
    try { fn(message); } catch { /* ignore */ }
  });
}

export async function callApi(action, token, extra = {}, url = import.meta.env.VITE_APPS_SCRIPT_URL, options = {}) {
  if (!url) throw new ApiError('The app is not configured (VITE_APPS_SCRIPT_URL).', 'NOT_CONFIGURED');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...extra, apiVersion: API_VERSION, action, token }),
      signal: controller ? controller.signal : undefined,
      credentials: 'omit',
      redirect: 'follow',
    });
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    throw new ApiError(
      timedOut ? 'The server took too long to respond. Check your connection and try again.' : 'Could not reach the server. Check your connection and try again.',
      timedOut ? 'TIMEOUT' : 'NETWORK',
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.ok === false) throw new ApiError('The server returned an error (' + res.status + '). Try again.', 'HTTP');
  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiError('The server sent an unreadable response. Try again.', 'BAD_RESPONSE');
  }
  if (!data || typeof data !== 'object') throw new ApiError('The server sent an unreadable response. Try again.', 'BAD_RESPONSE');
  if (data.error) {
    if (data.code === 'AUTH' || data.error === 'Invalid or expired login') {
      endSession(EXPIRED_SIGN_IN_MESSAGE);
      throw new ApiError(EXPIRED_SIGN_IN_MESSAGE, 'AUTH');
    }
    throw new ApiError(String(data.error), data.code);
  }
  return data;
}
