const express = require('express');
const { isCronRequest } = require('../lib/cronAuth');
const db = require('../database/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const RIOT_API_KEY = process.env.RIOT_API_KEY;

// Helper to make Riot API requests
const riotFetch = async (url) => {
  const response = await fetch(url, {
    headers: { 'X-Riot-Token': RIOT_API_KEY }
  });
  if (!response.ok) {
    const error = new Error(`Riot API: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
};

// Get region routing for Riot API
const getRouting = (region) => {
  const routingMap = {
    'na': 'americas', 'br': 'americas', 'lan': 'americas', 'las': 'americas',
    'euw': 'europe', 'eune': 'europe', 'tr': 'europe', 'ru': 'europe',
    'kr': 'asia', 'jp': 'asia', 'oce': 'sea'
  };
  return routingMap[region] || 'americas';
};

// POST /api/practice/scan - Scan for practice matches (admin or cron)
router.post('/scan', async (req, res, next) => {
  // Allow the scheduled job through; everyone else authenticates normally.
  if (isCronRequest(req)) {
    req.user = { role: 'admin' };
    return next();
  }
  // Otherwise require normal auth
  authenticateToken(req, res, () => {
    requireAdmin(req, res, next);
  });
}, async (req, res) => {
  try {
    if (!RIOT_API_KEY) {
      return res.status(500).json({ error: 'Riot API key not configured' });
    }

    // Get all roster players with riot_puuid
    const players = db.prepare(`
      SELECT id, summoner_name, riot_puuid, opgg_region, champion_pool
      FROM players WHERE riot_puuid IS NOT NULL
    `).all();

    if (players.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 players with linked Riot IDs to detect practice matches' });
    }

    // Create PUUID -> player mapping
    const puuidToPlayer = {};
    players.forEach(p => {
      puuidToPlayer[p.riot_puuid] = p;
    });

    const allPuuids = new Set(players.map(p => p.riot_puuid));

    // Fetch recent match IDs for each player
    const matchIdSets = {};
    for (const player of players) {
      const routing = getRouting(player.opgg_region || 'na');
      try {
        // Only look at matches since the team started playing together.
        const configured = db.prepare('SELECT team_start_date FROM practice_settings WHERE id = 1')
          .get()?.team_start_date || '2026-01-20';
        const parsed = new Date(`${configured}T00:00:00Z`).getTime();
        const teamStartDate = Math.floor(
          (Number.isNaN(parsed) ? new Date('2026-01-20T00:00:00Z').getTime() : parsed) / 1000
        );
        const matchIds = await riotFetch(
          `https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${player.riot_puuid}/ids?count=20&startTime=${teamStartDate}`
        );
        matchIdSets[player.id] = new Set(matchIds);
        // Rate limit delay
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (e) {
        console.log(`Failed to fetch matches for ${player.summoner_name}:`, e.message);
        matchIdSets[player.id] = new Set();
      }
    }

    // Collect all unique match IDs
    const allMatchIds = new Set();
    Object.values(matchIdSets).forEach(set => {
      set.forEach(id => allMatchIds.add(id));
    });

    // Check which matches we already have
    const existingMatches = new Set(
      db.prepare('SELECT match_id FROM practice_matches').all().map(r => r.match_id)
    );

    // Filter to new matches only
    const newMatchIds = [...allMatchIds].filter(id => !existingMatches.has(id));

    let practiceMatchesFound = 0;
    let playersUpdated = new Set();
    const routing = getRouting(players[0].opgg_region || 'na');

    // Process each new match
    for (const matchId of newMatchIds) {
      try {
        const match = await riotFetch(
          `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`
        );

        // Count roster members in this match
        const rosterParticipants = match.info.participants.filter(p => allPuuids.has(p.puuid));

        if (rosterParticipants.length >= 2) {
          // This is a practice match!
          practiceMatchesFound++;

          // Store the match
          db.prepare(`
            INSERT OR IGNORE INTO practice_matches
            (match_id, game_creation, game_duration, game_mode, winning_team, roster_player_count, participants)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            matchId,
            match.info.gameCreation,
            match.info.gameDuration,
            match.info.gameMode,
            match.info.participants.find(p => p.win)?.teamId || null,
            rosterParticipants.length,
            JSON.stringify(match.info.participants.map(p => ({
              puuid: p.puuid,
              summonerName: p.riotIdGameName || p.summonerName,
              champion: p.championName,
              kills: p.kills,
              deaths: p.deaths,
              assists: p.assists,
              cs: p.totalMinionsKilled + p.neutralMinionsKilled,
              damage: p.totalDamageDealtToChampions,
              win: p.win,
              teamId: p.teamId
            })))
          );

          // Update player stats for each roster member
          for (const participant of rosterParticipants) {
            const player = puuidToPlayer[participant.puuid];
            if (!player) continue;

            playersUpdated.add(player.id);

            // Upsert champion stats
            db.prepare(`
              INSERT INTO practice_player_stats (player_id, champion, games, wins, kills, deaths, assists, cs, total_damage, total_damage_taken, updated_at)
              VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(player_id, champion) DO UPDATE SET
                games = games + 1,
                wins = wins + excluded.wins,
                kills = kills + excluded.kills,
                deaths = deaths + excluded.deaths,
                assists = assists + excluded.assists,
                cs = cs + excluded.cs,
                total_damage = total_damage + excluded.total_damage,
                total_damage_taken = total_damage_taken + excluded.total_damage_taken,
                updated_at = CURRENT_TIMESTAMP
            `).run(
              player.id,
              participant.championName,
              participant.win ? 1 : 0,
              participant.kills,
              participant.deaths,
              participant.assists,
              participant.totalMinionsKilled + participant.neutralMinionsKilled,
              participant.totalDamageDealtToChampions,
              participant.totalDamageTaken || 0
            );
          }
        }

        // Rate limit delay
        await new Promise(resolve => setTimeout(resolve, 150));
      } catch (e) {
        console.log(`Failed to process match ${matchId}:`, e.message);
      }
    }

    // Auto-update champion pools based on threshold
    const settings = db.prepare('SELECT auto_pool_threshold FROM practice_settings WHERE id = 1').get();
    const threshold = settings?.auto_pool_threshold || 3;

    let poolsUpdated = 0;
    for (const playerId of playersUpdated) {
      const player = players.find(p => p.id === playerId);
      if (!player) continue;

      const currentPool = player.champion_pool ? player.champion_pool.split(',').map(c => c.trim()).filter(Boolean) : [];
      const practiceChamps = db.prepare(`
        SELECT champion FROM practice_player_stats
        WHERE player_id = ? AND games >= ?
      `).all(playerId, threshold);

      let poolChanged = false;
      for (const { champion } of practiceChamps) {
        if (!currentPool.includes(champion)) {
          currentPool.push(champion);
          poolChanged = true;
        }
      }

      if (poolChanged) {
        db.prepare('UPDATE players SET champion_pool = ? WHERE id = ?')
          .run(currentPool.join(', '), playerId);
        poolsUpdated++;
      }
    }

    // Update last scan time
    db.prepare('UPDATE practice_settings SET last_scan_at = CURRENT_TIMESTAMP WHERE id = 1').run();

    res.json({
      success: true,
      matchesScanned: newMatchIds.length,
      practiceMatchesFound,
      playersUpdated: playersUpdated.size,
      poolsUpdated
    });

  } catch (error) {
    console.error('Practice scan error:', error);
    res.status(500).json({ error: 'Failed to scan for practice matches' });
  }
});

// GET /api/practice/matches - Get practice match history
router.get('/matches', authenticateToken, (req, res) => {
  try {
    const { limit = 20, offset = 0, player_id } = req.query;

    let query = `
      SELECT * FROM practice_matches
      ORDER BY game_creation DESC
      LIMIT ? OFFSET ?
    `;
    let params = [parseInt(limit), parseInt(offset)];

    const matches = db.prepare(query).all(...params);

    // Parse participants and add player info
    const players = db.prepare('SELECT id, summoner_name, riot_puuid, profile_icon_id, role, opgg_username, opgg_region FROM players').all();
    const puuidToPlayer = {};
    players.forEach(p => {
      puuidToPlayer[p.riot_puuid] = p;
    });

    const enrichedMatches = matches.map(match => {
      const participants = JSON.parse(match.participants);
      const rosterParticipants = participants.filter(p => puuidToPlayer[p.puuid]);

      return {
        ...match,
        participants,
        rosterParticipants: rosterParticipants.map(p => ({
          ...p,
          playerId: puuidToPlayer[p.puuid]?.id,
          playerName: puuidToPlayer[p.puuid]?.summoner_name,
          profileIconId: puuidToPlayer[p.puuid]?.profile_icon_id,
          role: puuidToPlayer[p.puuid]?.role,
          opggUsername: puuidToPlayer[p.puuid]?.opgg_username,
          opggRegion: puuidToPlayer[p.puuid]?.opgg_region
        }))
      };
    });

    // Filter by player if requested
    let filteredMatches = enrichedMatches;
    if (player_id) {
      filteredMatches = enrichedMatches.filter(m =>
        m.rosterParticipants.some(p => p.playerId === parseInt(player_id))
      );
    }

    const total = db.prepare('SELECT COUNT(*) as count FROM practice_matches').get().count;

    res.json({
      matches: filteredMatches,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('Error fetching practice matches:', error);
    res.status(500).json({ error: 'Failed to fetch practice matches' });
  }
});

// GET /api/practice/stats - Get aggregated practice stats for all players
router.get('/stats', authenticateToken, (req, res) => {
  try {
    const players = db.prepare(`
      SELECT id, summoner_name, role, champion_pool, profile_icon_id FROM players
      ORDER BY
        CASE role
          WHEN 'Top' THEN 1
          WHEN 'Jungle' THEN 2
          WHEN 'Mid' THEN 3
          WHEN 'ADC' THEN 4
          WHEN 'Support' THEN 5
          ELSE 6
        END
    `).all();

    const playerStats = players.map(player => {
      const stats = db.prepare(`
        SELECT champion, games, wins, kills, deaths, assists, cs, total_damage
        FROM practice_player_stats
        WHERE player_id = ?
        ORDER BY games DESC
      `).all(player.id);

      const currentPool = player.champion_pool ? player.champion_pool.split(',').map(c => c.trim()).filter(Boolean) : [];

      const enrichedStats = stats.map(s => ({
        ...s,
        winRate: s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0,
        kda: s.deaths === 0 ? 'Perfect' : ((s.kills + s.assists) / s.deaths).toFixed(2),
        avgKills: (s.kills / s.games).toFixed(1),
        avgDeaths: (s.deaths / s.games).toFixed(1),
        avgAssists: (s.assists / s.games).toFixed(1),
        avgCs: Math.round(s.cs / s.games),
        avgDamage: Math.round(s.total_damage / s.games),
        inPool: currentPool.includes(s.champion)
      }));

      const totalGames = stats.reduce((sum, s) => sum + s.games, 0);
      const totalWins = stats.reduce((sum, s) => sum + s.wins, 0);

      return {
        player: {
          id: player.id,
          name: player.summoner_name,
          role: player.role,
          profileIconId: player.profile_icon_id
        },
        totalGames,
        totalWins,
        winRate: totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0,
        champions: enrichedStats
      };
    });

    res.json(playerStats);

  } catch (error) {
    console.error('Error fetching practice stats:', error);
    res.status(500).json({ error: 'Failed to fetch practice stats' });
  }
});

// GET /api/practice/stats/:playerId - Get practice stats for a specific player
router.get('/stats/:playerId', authenticateToken, (req, res) => {
  try {
    const { playerId } = req.params;

    const player = db.prepare('SELECT id, summoner_name, role, champion_pool FROM players WHERE id = ?').get(playerId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const stats = db.prepare(`
      SELECT champion, games, wins, kills, deaths, assists, cs, total_damage
      FROM practice_player_stats
      WHERE player_id = ?
      ORDER BY games DESC
    `).all(playerId);

    const currentPool = player.champion_pool ? player.champion_pool.split(',').map(c => c.trim()).filter(Boolean) : [];

    const enrichedStats = stats.map(s => ({
      ...s,
      winRate: s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0,
      kda: s.deaths === 0 ? 'Perfect' : ((s.kills + s.assists) / s.deaths).toFixed(2),
      avgKills: (s.kills / s.games).toFixed(1),
      avgDeaths: (s.deaths / s.games).toFixed(1),
      avgAssists: (s.assists / s.games).toFixed(1),
      avgCs: Math.round(s.cs / s.games),
      avgDamage: Math.round(s.total_damage / s.games),
      inPool: currentPool.includes(s.champion)
    }));

    res.json({
      player: {
        id: player.id,
        name: player.summoner_name,
        role: player.role
      },
      champions: enrichedStats
    });

  } catch (error) {
    console.error('Error fetching player practice stats:', error);
    res.status(500).json({ error: 'Failed to fetch player practice stats' });
  }
});

// GET /api/practice/settings - Get practice settings
router.get('/settings', authenticateToken, requireAdmin, (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM practice_settings WHERE id = 1').get();
    res.json(settings || { auto_pool_threshold: 3, last_scan_at: null });
  } catch (error) {
    console.error('Error fetching practice settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT /api/practice/settings - Update practice settings
router.put('/settings', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { auto_pool_threshold, team_start_date } = req.body;

    if (auto_pool_threshold !== undefined) {
      const threshold = Math.max(1, Math.min(20, parseInt(auto_pool_threshold)));
      db.prepare('UPDATE practice_settings SET auto_pool_threshold = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1')
        .run(threshold);
    }

    if (team_start_date !== undefined) {
      // Expect YYYY-MM-DD; reject anything the scan could not parse into a date.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(team_start_date) ||
          Number.isNaN(new Date(`${team_start_date}T00:00:00Z`).getTime())) {
        return res.status(400).json({ error: 'team_start_date must be a valid YYYY-MM-DD date' });
      }
      db.prepare('UPDATE practice_settings SET team_start_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1')
        .run(team_start_date);
    }

    const settings = db.prepare('SELECT * FROM practice_settings WHERE id = 1').get();
    res.json(settings);

  } catch (error) {
    console.error('Error updating practice settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// GET /api/practice/overview - Get team practice overview
router.get('/overview', authenticateToken, (req, res) => {
  try {
    // Total practice matches
    const totalMatches = db.prepare('SELECT COUNT(*) as count FROM practice_matches').get().count;

    // Get player name mapping
    const players = db.prepare('SELECT id, summoner_name FROM players').all();
    const playerMap = {};
    players.forEach(p => { playerMap[p.id] = p.summoner_name; });

    // Most played champions across team (with player names)
    const mostPlayed = db.prepare(`
      SELECT pps.champion, pps.player_id, p.summoner_name as player_name,
             pps.games, pps.wins
      FROM practice_player_stats pps
      JOIN players p ON pps.player_id = p.id
      ORDER BY pps.games DESC
      LIMIT 5
    `).all().map(c => ({
      ...c,
      winRate: c.games > 0 ? Math.round((c.wins / c.games) * 100) : 0
    }));

    // Best Stats - 5 categories with player info
    const minGames = 1;

    // Best KDA
    const bestKDA = db.prepare(`
      SELECT pps.champion, pps.player_id, p.summoner_name as player_name,
             pps.games, pps.kills, pps.deaths, pps.assists,
             CASE WHEN pps.deaths = 0 THEN 999
                  ELSE CAST(pps.kills + pps.assists AS FLOAT) / pps.deaths END as kda
      FROM practice_player_stats pps
      JOIN players p ON pps.player_id = p.id
      WHERE pps.games >= ?
      ORDER BY kda DESC
      LIMIT 1
    `).get(minGames);

    // Highest Damage
    const highestDamage = db.prepare(`
      SELECT pps.champion, pps.player_id, p.summoner_name as player_name,
             pps.games, pps.total_damage,
             CAST(pps.total_damage AS FLOAT) / pps.games as avg_damage
      FROM practice_player_stats pps
      JOIN players p ON pps.player_id = p.id
      WHERE pps.games >= ?
      ORDER BY avg_damage DESC
      LIMIT 1
    `).get(minGames);

    // Most Damage Taken
    const mostDamageTaken = db.prepare(`
      SELECT pps.champion, pps.player_id, p.summoner_name as player_name,
             pps.games, pps.total_damage_taken,
             CAST(pps.total_damage_taken AS FLOAT) / pps.games as avg_damage_taken
      FROM practice_player_stats pps
      JOIN players p ON pps.player_id = p.id
      WHERE pps.games >= ? AND pps.total_damage_taken > 0
      ORDER BY avg_damage_taken DESC
      LIMIT 1
    `).get(minGames);

    // Best CS
    const bestCS = db.prepare(`
      SELECT pps.champion, pps.player_id, p.summoner_name as player_name,
             pps.games, pps.cs,
             CAST(pps.cs AS FLOAT) / pps.games as avg_cs
      FROM practice_player_stats pps
      JOIN players p ON pps.player_id = p.id
      WHERE pps.games >= ?
      ORDER BY avg_cs DESC
      LIMIT 1
    `).get(minGames);

    // Most Kills
    const mostKills = db.prepare(`
      SELECT pps.champion, pps.player_id, p.summoner_name as player_name,
             pps.games, pps.kills,
             CAST(pps.kills AS FLOAT) / pps.games as avg_kills
      FROM practice_player_stats pps
      JOIN players p ON pps.player_id = p.id
      WHERE pps.games >= ?
      ORDER BY avg_kills DESC
      LIMIT 1
    `).get(minGames);

    const bestStats = {
      kda: bestKDA ? {
        label: 'Best KDA',
        player: bestKDA.player_name,
        champion: bestKDA.champion,
        value: bestKDA.deaths === 0 ? 'Perfect' : ((bestKDA.kills + bestKDA.assists) / bestKDA.deaths).toFixed(2),
        games: bestKDA.games
      } : null,
      damage: highestDamage ? {
        label: 'Highest Damage',
        player: highestDamage.player_name,
        champion: highestDamage.champion,
        value: Math.round(highestDamage.avg_damage).toLocaleString(),
        games: highestDamage.games
      } : null,
      damageTaken: mostDamageTaken ? {
        label: 'Most Damage Taken',
        player: mostDamageTaken.player_name,
        champion: mostDamageTaken.champion,
        value: Math.round(mostDamageTaken.avg_damage_taken).toLocaleString(),
        games: mostDamageTaken.games
      } : null,
      cs: bestCS ? {
        label: 'Best CS',
        player: bestCS.player_name,
        champion: bestCS.champion,
        value: Math.round(bestCS.avg_cs),
        games: bestCS.games
      } : null,
      kills: mostKills ? {
        label: 'Most Kills',
        player: mostKills.player_name,
        champion: mostKills.champion,
        value: mostKills.avg_kills.toFixed(1),
        games: mostKills.games
      } : null
    };

    // Last scan time
    const settings = db.prepare('SELECT last_scan_at FROM practice_settings WHERE id = 1').get();

    res.json({
      totalMatches,
      mostPlayed,
      bestStats,
      lastScan: settings?.last_scan_at
    });

  } catch (error) {
    console.error('Error fetching practice overview:', error);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

module.exports = router;
