async function handle(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

const json = (method) => (path, data) =>
  fetch(`/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data)
  }).then(handle);

export const api = {
  get: (name) => fetch(`/api/${name}`).then(handle),
  put: json('PUT'),
  post: json('POST'),
  patch: json('PATCH'),
  del: (path) => fetch(`/api/${path}`, { method: 'DELETE' }).then(handle)
};

const NAMES = ['trips', 'segments', 'candidates', 'travelers', 'cards', 'programs', 'expenses', 'exchanges', 'policies', 'settings'];

export async function loadAll() {
  const values = await Promise.all(NAMES.map((n) => api.get(n)));
  return Object.fromEntries(NAMES.map((n, i) => [n, values[i]]));
}
