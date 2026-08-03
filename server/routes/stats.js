const express = require('express');
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all stats
router.get('/', authenticateToken, (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT * FROM match_stats
      ORDER BY match_date DESC
    `).all();

    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Upload stats from CSV
router.post('/upload', authenticateToken, (req, res) => {
  try {
    const { data } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    const insert = db.prepare(`
      INSERT INTO match_stats (player, match_date, champion, kills, deaths, assists, cs, vision_score, damage, gold, result)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((rows) => {
      let count = 0;
      for (const row of rows) {
        // Parse the CSV row - handle various column name formats
        const player = row.player || row.Player || '';
        const matchDate = row.date || row.match_date || row.Date || new Date().toISOString().split('T')[0];
        const champion = row.champion || row.Champion || '';
        const kills = parseInt(row.kills || row.Kills || 0);
        const deaths = parseInt(row.deaths || row.Deaths || 0);
        const assists = parseInt(row.assists || row.Assists || 0);
        const cs = parseInt(row.cs || row.CS || row.creeps || 0);
        const visionScore = parseInt(row.vision_score || row.vision || row.Vision || 0);
        const damage = parseInt(row.damage || row.Damage || 0);
        const gold = parseInt(row.gold || row.Gold || 0);
        const result = row.result || row.Result || 'Win';

        if (player && champion) {
          insert.run(player, matchDate, champion, kills, deaths, assists, cs, visionScore, damage, gold, result);
          count++;
        }
      }
      return count;
    });

    const count = insertMany(data);

    res.json({ success: true, count });
  } catch (error) {
    console.error('Error uploading stats:', error);
    res.status(500).json({ error: 'Failed to upload stats' });
  }
});

// Get stats for a specific player
router.get('/player/:name', authenticateToken, (req, res) => {
  try {
    const { name } = req.params;
    const stats = db.prepare(`
      SELECT * FROM match_stats
      WHERE player = ?
      ORDER BY match_date DESC
    `).all(name);

    res.json(stats);
  } catch (error) {
    console.error('Error fetching player stats:', error);
    res.status(500).json({ error: 'Failed to fetch player stats' });
  }
});

// Auto-import recent matches from Riot API for all players (called by cron job)
router.post('/auto-import', async (req, res) => {
  try {
    const cronSecret = req.headers['x-cron-secret'];
    if (cronSecret !== process.env.CRON_SECRET && cronSecret !== 'internal-refresh') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const RIOT_API_KEY = process.env.RIOT_API_KEY;
    if (!RIOT_API_KEY) {
      return res.status(500).json({ error: 'Riot API key not configured' });
    }

    const players = db.prepare('SELECT * FROM players WHERE riot_puuid IS NOT NULL').all();

    const regionMap = {
      'na': 'na1', 'euw': 'euw1', 'eune': 'eun1', 'kr': 'kr',
      'br': 'br1', 'lan': 'la1', 'las': 'la2', 'oce': 'oc1',
      'tr': 'tr1', 'ru': 'ru', 'jp': 'jp1'
    };
    const routingMap = {
      'na': 'americas', 'br': 'americas', 'lan': 'americas', 'las': 'americas',
      'euw': 'europe', 'eune': 'europe', 'tr': 'europe', 'ru': 'europe',
      'kr': 'asia', 'jp': 'asia', 'oce': 'sea'
    };

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

    const insert = db.prepare(`
      INSERT INTO match_stats (player, match_date, champion, kills, deaths, assists, cs, vision_score, damage, gold, result, riot_match_id, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'riot_api')
    `);

    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const player of players) {
      try {
        const region = player.opgg_region || 'na';
        const routing = routingMap[region] || 'americas';

        // Fetch recent match IDs
        const matchIds = await riotFetch(
          `https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${player.riot_puuid}/ids?count=10`
        );

        for (const matchId of matchIds) {
          // Check if this match already exists for this player
          const existing = db.prepare(
            'SELECT id FROM match_stats WHERE riot_match_id = ? AND player = ?'
          ).get(matchId, player.summoner_name);

          if (existing) {
            skipped++;
            continue;
          }

          try {
            const match = await riotFetch(
              `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`
            );

            const participant = match.info.participants.find(
              p => p.puuid === player.riot_puuid
            );
            if (!participant) continue;

            const matchDate = new Date(match.info.gameCreation).toISOString().split('T')[0];

            insert.run(
              player.summoner_name,
              matchDate,
              participant.championName,
              participant.kills,
              participant.deaths,
              participant.assists,
              participant.totalMinionsKilled + participant.neutralMinionsKilled,
              participant.visionScore,
              participant.totalDamageDealtToChampions,
              participant.goldEarned,
              participant.win ? 'Win' : 'Loss',
              matchId
            );
            imported++;

            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (e) {
            console.log(`Failed to fetch match ${matchId}:`, e.message);
          }
        }

        await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit between players
      } catch (e) {
        console.error(`Failed to import stats for ${player.summoner_name}:`, e.message);
        failed++;
      }
    }

    console.log(`Stats auto-import complete: ${imported} imported, ${skipped} skipped, ${failed} failed`);
    res.json({ success: true, imported, skipped, failed });

  } catch (error) {
    console.error('Stats auto-import error:', error);
    res.status(500).json({ error: 'Failed to auto-import stats' });
  }
});

// Delete a stat entry
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM match_stats WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting stat:', error);
    res.status(500).json({ error: 'Failed to delete stat' });
  }
});

module.exports = router;
