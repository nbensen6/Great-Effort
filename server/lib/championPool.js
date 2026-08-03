// Shape of players.champion_pool_data.
//
// Tiers describe *why* a champion gets picked in draft, not how comfortable the
// player is on it. Mirrored in client/src/lib/championPool.js — keep both in sync.

const POOL_TIERS = [
  { key: 'main', label: 'Main' },
  { key: 'counter', label: 'Counter Pick' },
  { key: 'situational', label: 'Situational' },
  { key: 'response', label: 'In Response' }
];

const TIER_KEYS = POOL_TIERS.map(t => t.key);

// Pools written before draft tiers existed used readiness tiers. Map what still
// makes sense; 'wontPlay' has no equivalent here and is intentionally dropped.
const LEGACY_TIER_MAP = { ready: 'main', practicing: 'situational' };

function emptyPool() {
  return TIER_KEYS.reduce((acc, key) => { acc[key] = []; return acc; }, {});
}

// Entries used to be bare champion id strings; they now carry a draft note.
function toEntry(value) {
  if (typeof value === 'string') return { id: value, note: '' };
  if (value && typeof value.id === 'string') return { id: value.id, note: value.note || '' };
  return null;
}

function normalizePool(raw) {
  let data = raw;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (e) { data = null; }
  }
  const pool = emptyPool();
  if (!data || typeof data !== 'object') return pool;

  for (const [key, list] of Object.entries(data)) {
    const tier = TIER_KEYS.includes(key) ? key : LEGACY_TIER_MAP[key];
    if (!tier || !Array.isArray(list)) continue;
    for (const value of list) {
      const entry = toEntry(value);
      // A champion belongs to exactly one tier; first tier listed wins.
      if (entry && !TIER_KEYS.some(k => pool[k].some(e => e.id === entry.id))) {
        pool[tier].push(entry);
      }
    }
  }
  return pool;
}

// Flat list for the legacy champion_pool column, which several read paths and
// the nightly Riot sync still depend on.
function draftableIds(pool) {
  return TIER_KEYS.flatMap(key => pool[key].map(e => e.id));
}

module.exports = { POOL_TIERS, TIER_KEYS, emptyPool, normalizePool, draftableIds };
