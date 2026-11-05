// Leaderboard logic, kept separate from Netlify so it can be tested with an in-memory store.
// A store needs: get(key, { type: 'json' }), setJSON(key, value), list({ prefix }) -> { blobs: [{ key }] }

export const MAX_NAME = 24;
const MAX_PROFIT_PER_JOB = 250000; // a sanity cap, well above the best possible job
const ID_RE = /^[a-z0-9-]{8,40}$/i;

export function cleanName(name) {
  return String(name ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
}

export function validateEntry(body) {
  if (!body || typeof body !== 'object') return 'Missing body';
  const { id, profit, jobs } = body;
  if (typeof id !== 'string' || !ID_RE.test(id)) return 'Bad player id';
  if (!Number.isFinite(profit) || !Number.isFinite(jobs)) return 'Bad numbers';
  if (!Number.isInteger(jobs) || jobs < 0 || jobs > 100000) return 'Bad job count';
  if (Math.abs(profit) > Math.max(1, jobs) * MAX_PROFIT_PER_JOB) return 'Profit out of range';
  if (!cleanName(body.name)) return 'Name required';
  return null;
}

export async function topEntries(store, limit = 25) {
  const { blobs } = await store.list({ prefix: 'p/' });
  const entries = (await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })))).filter(Boolean);
  entries.sort((a, b) => b.profit - a.profit || a.updated - b.updated);
  return { entries: entries.slice(0, limit).map(({ id, name, profit, jobs }) => ({ id, name, profit, jobs })), total: entries.length };
}

export async function handle(req, store) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
  try {
    if (req.method === 'GET') return json(await topEntries(store));
    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
      const err = validateEntry(body);
      if (err) return json({ error: err }, 400);
      const entry = {
        id: body.id,
        name: cleanName(body.name),
        profit: Math.round(body.profit),
        jobs: body.jobs,
        updated: Date.now(),
      };
      await store.setJSON(`p/${entry.id}`, entry);
      return json(await topEntries(store));
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    return json({ error: 'Server error' }, 500);
  }
}
