// Apps Script web apps do not answer CORS preflight, so the body stays JSON
// but the content type is text/plain. Pass `url` in tests; the Vite env default
// is only read when the caller omits it.

export const EXPIRED_SIGN_IN_MESSAGE = 'Your sign-in expired, please sign in again.';
const EXPIRED_LOGIN_ERROR = 'Invalid or expired login';

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

// Drop tokens we cannot trust. Missing or past `exp` both count as expired.
export function tokenIsExpired(token, nowMs = Date.now()) {
  const payload = jwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return true;
  return payload.exp * 1000 <= nowMs;
}

export function readStoredSession(storage = globalThis.localStorage, nowMs = Date.now()) {
  let raw = null;
  try {
    raw = storage && storage.getItem('google_token');
  } catch {
    raw = null;
  }
  if (!raw) return { token: null, expired: false };
  if (tokenIsExpired(raw, nowMs)) {
    try { storage.removeItem('google_token'); } catch { /* ignore */ }
    return { token: null, expired: true };
  }
  return { token: raw, expired: false };
}

function forgetSignIn(message) {
  try { localStorage.removeItem('google_token'); } catch { /* not a browser */ }
  try { sessionStorage.setItem('login_message', message); } catch { /* not a browser */ }
  try {
    if (typeof window !== 'undefined' && window.location && window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
  } catch { /* ignore */ }
}

export async function callApi(action, token, extra = {}, url = import.meta.env.VITE_APPS_SCRIPT_URL) {
  if (!url) throw new Error('VITE_APPS_SCRIPT_URL not set');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token, ...extra }),
  });
  const data = await res.json();
  if (data.error) {
    if (data.error === EXPIRED_LOGIN_ERROR) forgetSignIn(EXPIRED_SIGN_IN_MESSAGE);
    throw new Error(data.error);
  }
  return data;
}
