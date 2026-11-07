import { useCallback, useEffect, useState } from 'react';
import { fetchPhotos, photoCacheGet } from './photoCache.js';

// Loads photos for the given ids through `load` (live API or demo). Photo
// failures are reported separately from core data so pages stay usable.
export function usePhotoMap(load, ids) {
  const key = (ids || [])
    .map(id => String(id || '').trim())
    .filter(Boolean)
    .sort()
    .join('\n');
  const [fetched, setFetched] = useState({});
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const list = key ? key.split('\n') : [];
    if (!load || !list.length) return undefined;
    let cancelled = false;
    setFailed(false);
    fetchPhotos(load, list).then(map => {
      if (!cancelled) setFetched(map);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [load, key, attempt]);

  const retry = useCallback(() => setAttempt(n => n + 1), []);

  const photos = {};
  const list = key ? key.split('\n') : [];
  list.forEach(id => {
    const hit = photoCacheGet(id) || fetched[id];
    if (hit) photos[id] = hit;
  });
  return { photos, failed, retry };
}
