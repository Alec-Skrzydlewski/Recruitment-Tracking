import { useEffect, useState } from 'react';
import { fetchPhotos, photoCacheGet } from './photoCache.js';

export function usePhotoMap(token, ids) {
  const key = (ids || [])
    .map(id => String(id || '').trim())
    .filter(Boolean)
    .sort()
    .join('\n');
  const [fetched, setFetched] = useState({});

  useEffect(() => {
    const list = key ? key.split('\n') : [];
    if (!token || !list.length) return undefined;
    let cancelled = false;
    fetchPhotos(token, list).then(map => {
      if (!cancelled) setFetched(map);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [token, key]);

  const photos = {};
  const list = key ? key.split('\n') : [];
  list.forEach(id => {
    const hit = photoCacheGet(id);
    if (hit) photos[id] = hit;
  });
  Object.keys(fetched).forEach(id => {
    if (list.indexOf(id) !== -1 && fetched[id]) photos[id] = fetched[id];
  });
  return photos;
}
