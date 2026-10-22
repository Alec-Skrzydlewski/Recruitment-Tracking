import { callApi } from './api.js';

const memory = new Map();
const STORAGE_KEY = 'rt-recruit-photos';
const BATCH = 20;
let persistDisabled = false;
let hydrated = false;

function readStore() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  const stored = readStore();
  Object.keys(stored).forEach(key => {
    if (!memory.has(key) && typeof stored[key] === 'string' && stored[key]) {
      memory.set(key, stored[key]);
    }
  });
}

function persist() {
  if (persistDisabled) return;
  try {
    const all = {};
    memory.forEach((value, key) => { all[key] = value; });
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    persistDisabled = true;
  }
}

export function photoCacheGet(id) {
  if (!id) return '';
  hydrate();
  return memory.get(String(id)) || '';
}

export function photoCacheSet(id, dataUrl) {
  if (!id || !dataUrl) return;
  hydrate();
  memory.set(String(id), dataUrl);
  persist();
}

export async function fetchPhotos(token, ids) {
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
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    const res = await callApi('getPhotos', token, { ids: chunk });
    const photos = res && res.photos ? res.photos : {};
    Object.keys(photos).forEach(id => {
      if (typeof photos[id] !== 'string' || !photos[id]) return;
      photoCacheSet(id, photos[id]);
      out[id] = photos[id];
    });
  }
  return out;
}
