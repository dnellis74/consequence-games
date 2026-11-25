// High score API for consequence.games, running on Cloudflare Workers + D1.
//
//   GET    /scores?game=snail     -> { allTime: [...], recent: [...] }  (top 10 each)
//   POST   /scores                -> body { game, name, elapsed, detail }
//                                    returns { id, score, rank, allTime, recent }
//   DELETE /scores/:id            -> header "Authorization: Bearer <ADMIN_TOKEN>"
//
// The client never sends a score. It sends what happened (time survived and
// what it picked up) and the worker computes the score with the same rules as
// the game, after checking the numbers are possible. That does not make
// cheating impossible (anyone can send made-up but plausible numbers), but it
// caps what a fake entry can claim.

const TOP_N = 10;
const RECENT_MS = 24 * 60 * 60 * 1000;   // "past 24 hours" board
const MIN_GAP_MS = 5 * 1000;             // one submit per 5 s per IP
const MAX_PER_HOUR = 30;                 // per IP

// Three-letter names to refuse. Edit freely; ADMIN delete handles the rest.
const BLOCKED_NAMES = new Set([
  'FUK', 'FUC', 'FCK', 'FKU', 'CUM', 'CNT', 'KKK', 'NIG', 'NGR', 'FAG', 'SEX',
  'DIK', 'DIC', 'COK', 'TIT', 'JIZ', 'WTF', 'KYS', 'SS1', 'HTL', 'NAZ',
]);

// ── Per-game rules ────────────────────────────────────────────────
// Each game returns { score } or { error }. Keep in sync with the game file.
const GAMES = {
  snail: {
    // snail/index.html: CFG.baseRate, CFG.lootEvery, LOOT[*].sets, SET_SIZE
    baseRate: 10,
    lootEvery: 2.2,
    setSize: 5,
    sets: {
      coin:  [10, 20, 50, 100, 500],
      ingot: [100, 500, 1000, 2000, 5000],
      gem:   [1000, 2000, 5000, 10000, 20000],
    },
    maxSeconds: 3600,
    validate(elapsed, detail) {
      if (!(elapsed > 0 && elapsed <= this.maxSeconds)) return { error: 'bad elapsed' };
      const counts = (detail && detail.counts) || {};
      let total = 0, value = 0;
      for (const kind of Object.keys(counts)) {
        const table = this.sets[kind];
        const n = counts[kind];
        if (!table || !Number.isInteger(n) || n < 0) return { error: 'bad counts' };
        total += n;
        const full = Math.floor(n / this.setSize), rest = n % this.setSize;
        value += full * table[this.setSize - 1] + (rest ? table[rest - 1] : 0);
      }
      // loot spawns at most once per lootEvery seconds (plus the first one early)
      if (total > Math.floor(elapsed / this.lootEvery) + 2) return { error: 'too much loot for the time' };
      return { score: Math.floor(elapsed * this.baseRate) + value };
    },
  },
};

// ── HTTP helpers ──────────────────────────────────────────────────
function allowedOrigin(origin, env) {
  if (!origin) return null;
  const list = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin)) return origin;
  if (/^https:\/\/consequence-games-[a-z0-9-]+\.vercel\.app$/.test(origin)) return origin;  // Vercel previews
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;            // local testing
  return null;
}

function json(body, status, origin) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers['vary'] = 'Origin';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function boards(env, game, now) {
  const q = 'SELECT id, name, score, elapsed FROM scores WHERE game = ?1';
  const [all, recent] = await Promise.all([
    env.DB.prepare(`${q} ORDER BY score DESC, created_at ASC LIMIT ${TOP_N}`).bind(game).all(),
    env.DB.prepare(`${q} AND created_at > ?2 ORDER BY score DESC, created_at ASC LIMIT ${TOP_N}`)
      .bind(game, now - RECENT_MS).all(),
  ]);
  return { allTime: all.results, recent: recent.results };
}

// ── Handlers ──────────────────────────────────────────────────────
async function getScores(url, env, origin) {
  const game = url.searchParams.get('game');
  if (!GAMES[game]) return json({ error: 'unknown game' }, 400, origin);
  return json(await boards(env, game, Date.now()), 200, origin);
}

async function postScore(request, env, origin) {
  if (!origin) return json({ error: 'origin not allowed' }, 403, null);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, origin); }
  const rules = GAMES[body && body.game];
  if (!rules) return json({ error: 'unknown game' }, 400, origin);

  const name = String(body.name || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(name)) return json({ error: 'name must be 3 letters' }, 400, origin);
  if (BLOCKED_NAMES.has(name)) return json({ error: 'pick different letters' }, 400, origin);

  const elapsed = Number(body.elapsed);
  const result = rules.validate(elapsed, body.detail);
  if (result.error) return json({ error: result.error }, 400, origin);

  const now = Date.now();
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const ipHash = await sha256(`${env.IP_SALT || ''}:${ip}`);
  const lastHour = await env.DB.prepare(
    'SELECT COUNT(*) AS n, MAX(created_at) AS last FROM scores WHERE ip_hash = ?1 AND created_at > ?2'
  ).bind(ipHash, now - 60 * 60 * 1000).first();
  if (lastHour && lastHour.last && now - lastHour.last < MIN_GAP_MS) return json({ error: 'slow down' }, 429, origin);
  if (lastHour && lastHour.n >= MAX_PER_HOUR) return json({ error: 'too many scores this hour' }, 429, origin);

  const ins = await env.DB.prepare(
    'INSERT INTO scores (game, name, score, elapsed, detail, ip_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
  ).bind(body.game, name, result.score, Math.round(elapsed * 10) / 10,
         JSON.stringify(body.detail || null).slice(0, 500), ipHash, now).run();
  const id = ins.meta.last_row_id;

  const rankRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE game = ?1 AND score > ?2')
    .bind(body.game, result.score).first();
  return json({ id, score: result.score, rank: rankRow.n + 1, ...(await boards(env, body.game, now)) }, 200, origin);
}

async function deleteScore(request, env, origin, id) {
  const auth = request.headers.get('authorization') || '';
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: 'unauthorized' }, 401, origin);
  const r = await env.DB.prepare('DELETE FROM scores WHERE id = ?1').bind(id).run();
  return json({ deleted: r.meta.changes }, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request.headers.get('origin'), env);

    if (request.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '86400',
          'vary': 'Origin',
        },
      });
    }

    try {
      if (url.pathname === '/scores' && request.method === 'GET') return await getScores(url, env, origin);
      if (url.pathname === '/scores' && request.method === 'POST') return await postScore(request, env, origin);
      const m = url.pathname.match(/^\/scores\/(\d+)$/);
      if (m && request.method === 'DELETE') return await deleteScore(request, env, origin, Number(m[1]));
      return json({ error: 'not found' }, 404, origin);
    } catch (err) {
      return json({ error: 'server error' }, 500, origin);
    }
  },
};
