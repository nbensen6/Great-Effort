// Verifies RIOT_API_KEY works, without printing it.
//
// Checks each rostered player: resolves the Riot ID to a PUUID, then reads
// their ranked entry. Read-only — it does not write to the database.
//
//   node scripts/check-riot.js
//   fly ssh console -C "node scripts/check-riot.js" --app tge-lol-team

require('dotenv').config();
const db = require('../database/db');

const KEY = process.env.RIOT_API_KEY;
if (!KEY) {
  console.error('RIOT_API_KEY is not set in this environment.');
  process.exit(1);
}

const ROUTING = 'americas';
const PLATFORM = 'na1';

async function get(url) {
  const res = await fetch(url, { headers: { 'X-Riot-Token': KEY } });
  let body = null;
  try { body = await res.json(); } catch (e) { /* non-JSON error page */ }
  return { status: res.status, body };
}

(async () => {
  const players = db.prepare(
    'SELECT summoner_name, role, opgg_username FROM players ORDER BY id'
  ).all();

  if (!players.length) {
    console.log('No players on the roster yet — run scripts/seed-roster.js first.');
    return;
  }

  let ok = 0;
  for (const p of players) {
    const [gameName, tagLine] = (p.opgg_username || '').split('#');
    if (!gameName || !tagLine) {
      console.log(`${p.role.padEnd(8)} ${p.summoner_name.padEnd(8)} SKIP  no valid Riot ID`);
      continue;
    }

    const acct = await get(`https://${ROUTING}.api.riotgames.com/riot/account/v1/accounts/` +
      `by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);

    if (acct.status !== 200) {
      const why = acct.status === 401 || acct.status === 403
        ? 'key rejected (invalid or expired)'
        : acct.status === 429 ? 'rate limited' : (acct.body?.status?.message || '');
      console.log(`${p.role.padEnd(8)} ${p.summoner_name.padEnd(8)} FAIL  account ${acct.status} ${why}`);
      continue;
    }

    const summ = await get(
      `https://${PLATFORM}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${acct.body.puuid}`);
    if (summ.status !== 200) {
      console.log(`${p.role.padEnd(8)} ${p.summoner_name.padEnd(8)} FAIL  summoner ${summ.status}`);
      continue;
    }

    // Riot removed the encrypted summoner id from SUMMONER-V4 responses, so
    // league/v4/entries/by-summoner/undefined just 403s. Key off the PUUID.
    const league = await get(
      `https://${PLATFORM}.api.riotgames.com/lol/league/v4/entries/by-puuid/${acct.body.puuid}`);
    const solo = Array.isArray(league.body)
      ? league.body.find(e => e.queueType === 'RANKED_SOLO_5x5')
      : null;
    const rank = solo
      ? `${solo.tier} ${solo.rank} ${solo.leaguePoints}LP (${solo.wins}W/${solo.losses}L)`
      : 'unranked';

    console.log(`${p.role.padEnd(8)} ${p.summoner_name.padEnd(8)} OK    lvl ${summ.body.summonerLevel}, ${rank}`);
    ok++;
  }

  console.log(`\n${ok}/${players.length} players resolved successfully.`);
  if (!ok) process.exit(1);
})().catch(e => { console.error('Unexpected error:', e.message); process.exit(1); });
