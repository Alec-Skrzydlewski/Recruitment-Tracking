const URL = import.meta.env.VITE_APPS_SCRIPT_URL;

export async function callApi(action, token, extra = {}) {
  if (!URL) throw new Error('VITE_APPS_SCRIPT_URL not set');
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, token, ...extra }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}
