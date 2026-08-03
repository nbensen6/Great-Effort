// Mirror of server/lib/championPool.js — keep both in sync.
// CRA cannot import from outside src/, so the shape lives in two places.

export const POOL_TIERS = [
  {
    key: 'main',
    label: 'Main',
    className: 'main',
    hint: 'Default answer for the role. Comfort picks we are happy to first-pick.'
  },
  {
    key: 'counter',
    label: 'Counter Pick',
    className: 'counter',
    hint: 'Picked after we have seen the enemy pick.'
  },
  {
    key: 'situational',
    label: 'Situational',
    className: 'situational',
    hint: 'Only into specific comps or draft conditions.'
  },
  {
    key: 'response',
    label: 'In Response',
    className: 'response',
    hint: 'Direct answer to a specific enemy threat.'
  }
];

export const TIER_KEYS = POOL_TIERS.map(t => t.key);

const LEGACY_TIER_MAP = { ready: 'main', practicing: 'situational' };

export function emptyPool() {
  return TIER_KEYS.reduce((acc, key) => { acc[key] = []; return acc; }, {});
}

function toEntry(value) {
  if (typeof value === 'string') return { id: value, note: '' };
  if (value && typeof value.id === 'string') return { id: value.id, note: value.note || '' };
  return null;
}

export function normalizePool(raw) {
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
      if (entry && !TIER_KEYS.some(k => pool[k].some(e => e.id === entry.id))) {
        pool[tier].push(entry);
      }
    }
  }
  return pool;
}

export function poolIsEmpty(pool) {
  return TIER_KEYS.every(key => pool[key].length === 0);
}

export function findTier(pool, champId) {
  return TIER_KEYS.find(key => pool[key].some(e => e.id === champId)) || null;
}

export function findEntry(pool, champId) {
  for (const key of TIER_KEYS) {
    const entry = pool[key].find(e => e.id === champId);
    if (entry) return entry;
  }
  return null;
}
