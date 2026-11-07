// Photo cache: memory only (never sessionStorage), bounded, and scoped to one
// runtime + signed-in identity. Changing scope or signing out drops every
// cached image, so a later session can never read an earlier one's photos.

const MAX_ENTRIES = 150;
export const PHOTO_BATCH = 20;

let scope = '';
const memory = new Map();

export function setPhotoScope(next) {
  const key = String(next || '');
  if (key === scope) return;
  memory.clear();
  scope = key;
}

export function photoScope() {
  return scope;
}

export function clearPhotoCache() {
  memory.clear();
  scope = '';
}

export function photoCacheSize() {
  return memory.size;
}

export function photoCacheGet(id) {
  if (!id || !scope) return '';
  const key = String(id);
  const hit = memory.get(key);
  if (!hit) return '';
  memory.delete(key);
  memory.set(key, hit);
  return hit;
}

export function photoCacheSet(id, dataUrl) {
  if (!id || !dataUrl || !scope) return;
  if (!/^data:image\//.test(dataUrl)) return;
  const key = String(id);
  memory.delete(key);
  memory.set(key, dataUrl);
  while (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value);
}

// load(ids) -> Promise<{ photos }>. Batches run in parallel (bounded by the
// backend's 20-per-call limit) and a failed batch rejects so the UI can show
// an optional-photo warning instead of silently showing initials forever.
export async function fetchPhotos(load, ids) {
  const want = [];
  const seen = new Set();
  (ids || []).forEach(id => {
    const key = String(id || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    want.push(key);
  });
  const out = {};
  const missing = [];
  want.forEach(id => {
    const hit = photoCacheGet(id);
    if (hit) out[id] = hit;
    else missing.push(id);
  });
  const startedScope = scope;
  const chunks = [];
  for (let i = 0; i < missing.length; i += PHOTO_BATCH) chunks.push(missing.slice(i, i + PHOTO_BATCH));
  const results = await Promise.all(chunks.map(chunk => load(chunk)));
  results.forEach(res => {
    const photos = res && res.photos ? res.photos : {};
    Object.keys(photos).forEach(id => {
      if (typeof photos[id] !== 'string' || !photos[id]) return;
      // Ignore responses that arrive after a sign-out or account switch.
      if (scope === startedScope) photoCacheSet(id, photos[id]);
      out[id] = photos[id];
    });
  });
  return scope === startedScope ? out : {};
}
