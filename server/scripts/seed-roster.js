// Seeds the Team Great Effort roster and champion pools.
//
// Idempotent: matches players on opgg_username (the Riot ID), so re-running
// updates in place rather than duplicating. Does not create user accounts —
// players link themselves by registering, which fills in players.user_id.
//
//   node scripts/seed-roster.js              (local)
//   fly ssh console -C "node scripts/seed-roster.js"   (production)

require('dotenv').config();
const db = require('../database/db');
const SEED_POOLS = require('../lib/seedPools');
const { normalizePool, draftableIds } = require('../lib/championPool');

// Roles confirmed against each account's most-played champions on op.gg, which
// matched the team's draft sheet column-for-column.
const ROSTER = [
  { name: 'Cooper',  role: 'Top',     riotId: '900slimes#NA2',      rank: ['EMERALD', 'III', 62, 168, 160] },
  { name: 'Ducky',   role: 'Jungle',  riotId: 'lilduckyy#NA1',      rank: ['DIAMOND', 'IV', 11, 47, 42] },
  { name: 'Nick',    role: 'Mid',     riotId: 'Bensen#noff',        rank: ['DIAMOND', 'IV', 67, 183, 174] },
  { name: 'Michael', role: 'ADC',     riotId: 'her depravity#Pain', rank: ['EMERALD', 'I', 40, 276, 265] },
  { name: 'Olivia',  role: 'Support', riotId: 'Mo0nl1ght#4848',     rank: ['GOLD', 'III', 15, 6, 5] }
];

const upsert = db.transaction(() => {
  let created = 0;
  let updated = 0;

  for (const p of ROSTER) {
    const pool = normalizePool(SEED_POOLS[p.role]);
    const poolJson = JSON.stringify(pool);
    const flat = draftableIds(pool).join(',');
    const [tier, division, lp, wins, losses] = p.rank;

    const existing = db.prepare('SELECT id FROM players WHERE opgg_username = ?').get(p.riotId);

    if (existing) {
      db.prepare(`
        UPDATE players SET summoner_name = ?, role = ?, champion_pool_data = ?, champion_pool = ?,
          rank_tier = ?, rank_division = ?, rank_lp = ?, rank_wins = ?, rank_losses = ?
        WHERE id = ?
      `).run(p.name, p.role, poolJson, flat, tier, division, lp, wins, losses, existing.id);
      updated++;
    } else {
      db.prepare(`
        INSERT INTO players (summoner_name, role, opgg_username, opgg_region, champion_pool_data,
          champion_pool, rank_tier, rank_division, rank_lp, rank_wins, rank_losses)
        VALUES (?, ?, ?, 'na', ?, ?, ?, ?, ?, ?, ?)
      `).run(p.name, p.role, p.riotId, poolJson, flat, tier, division, lp, wins, losses);
      created++;
    }
  }
  return { created, updated };
});

const { created, updated } = upsert();
console.log(`Roster seeded: ${created} created, ${updated} updated.`);
for (const row of db.prepare('SELECT summoner_name, role, opgg_username FROM players ORDER BY id').all()) {
  const pool = normalizePool(db.prepare('SELECT champion_pool_data c FROM players WHERE opgg_username = ?')
    .get(row.opgg_username).c);
  const counts = Object.entries(pool).map(([k, v]) => `${k}:${v.length}`).join(' ');
  console.log(`  ${row.role.padEnd(8)} ${row.summoner_name.padEnd(8)} ${row.opgg_username.padEnd(22)} ${counts}`);
}
