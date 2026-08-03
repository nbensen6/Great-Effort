const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const RIOT_API_KEY = process.env.RIOT_API_KEY;

// Helper to make Riot API requests with rate limit retry
const riotFetch = async (url, retries = 3) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      headers: {
        'X-Riot-Token': RIOT_API_KEY
      }
    });

    if (response.status === 429) {
      // Rate limited - wait using Retry-After header or default backoff
      const retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
      const waitMs = (retryAfter + 1) * 1000;
      console.log(`Rate limited, waiting ${waitMs}ms (attempt ${attempt + 1}/${retries + 1})`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    if (!response.ok) {
      const error = new Error(`Riot API error: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  const error = new Error('Riot API rate limit exceeded after retries');
  error.status = 429;
  throw error;
};

// Get player data by Riot ID (gameName#tagLine)
router.get('/player/:gameName/:tagLine', authenticateToken, async (req, res) => {
  try {
    if (!RIOT_API_KEY) {
      return res.status(500).json({ error: 'Riot API key not configured' });
    }

    const { gameName, tagLine } = req.params;
    const region = req.query.region || 'na1';

    // Map region to routing value for account API
    const routingMap = {
      'na1': 'americas',
      'br1': 'americas',
      'la1': 'americas',
      'la2': 'americas',
      'euw1': 'europe',
      'eun1': 'europe',
      'tr1': 'europe',
      'ru': 'europe',
      'kr': 'asia',
      'jp1': 'asia',
      'oc1': 'sea',
      'ph2': 'sea',
      'sg2': 'sea',
      'th2': 'sea',
      'tw2': 'sea',
      'vn2': 'sea'
    };

    const routing = routingMap[region] || 'americas';

    // Step 1: Get PUUID from Riot ID
    const accountData = await riotFetch(
      `https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
    );

    const puuid = accountData.puuid;

    // Step 2: Get summoner data (profile icon, level)
    const summonerData = await riotFetch(
      `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`
    );

    // Step 3: Get ranked data
    let rankedData = [];
    try {
      rankedData = await riotFetch(
        `https://${region}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerData.id}`
      );
    } catch (e) {
      // Player might be unranked
      console.log('Could not fetch ranked data:', e.message);
    }

    // Find solo queue rank
    const soloQueue = rankedData.find(q => q.queueType === 'RANKED_SOLO_5x5');
    const flexQueue = rankedData.find(q => q.queueType === 'RANKED_FLEX_SR');

    res.json({
      puuid: puuid,
      gameName: accountData.gameName,
      tagLine: accountData.tagLine,
      profileIconId: summonerData.profileIconId,
      summonerLevel: summonerData.summonerLevel,
      soloQueue: soloQueue ? {
        tier: soloQueue.tier,
        rank: soloQueue.rank,
        lp: soloQueue.leaguePoints,
        wins: soloQueue.wins,
        losses: soloQueue.losses,
        winRate: Math.round((soloQueue.wins / (soloQueue.wins + soloQueue.losses)) * 100)
      } : null,
      flexQueue: flexQueue ? {
        tier: flexQueue.tier,
        rank: flexQueue.rank,
        lp: flexQueue.leaguePoints,
        wins: flexQueue.wins,
        losses: flexQueue.losses,
        winRate: Math.round((flexQueue.wins / (flexQueue.wins + flexQueue.losses)) * 100)
      } : null
    });

  } catch (error) {
    console.error('Riot API error:', error);
    if (error.status === 404) {
      return res.status(404).json({ error: 'Player not found' });
    }
    if (error.status === 403) {
      return res.status(403).json({ error: 'Riot API key expired or invalid' });
    }
    res.status(500).json({ error: 'Failed to fetch player data' });
  }
});

// Op.gg region to Riot API region mapping
const opggToRiotRegion = {
  'na': 'na1', 'euw': 'euw1', 'eune': 'eun1', 'kr': 'kr',
  'br': 'br1', 'lan': 'la1', 'las': 'la2', 'oce': 'oc1',
  'tr': 'tr1', 'ru': 'ru', 'jp': 'jp1', 'ph': 'ph2',
  'sg': 'sg2', 'th': 'th2', 'tw': 'tw2', 'vn': 'vn2'
};

const riotRoleMap = {
  'TOP': 'Top', 'JUNGLE': 'Jungle', 'MIDDLE': 'Mid',
  'BOTTOM': 'ADC', 'UTILITY': 'Support'
};

// Import players from op.gg multi-search data
router.post('/import-opgg', authenticateToken, async (req, res) => {
  try {
    if (!RIOT_API_KEY) {
      return res.status(500).json({ error: 'Riot API key not configured' });
    }

    const { players, region: opggRegion } = req.body;
    if (!players || !Array.isArray(players) || players.length === 0) {
      return res.status(400).json({ error: 'No players provided' });
    }

    const riotRegion = opggToRiotRegion[opggRegion] || 'na1';
    const routingMap = {
      'na1': 'americas', 'br1': 'americas', 'la1': 'americas', 'la2': 'americas',
      'euw1': 'europe', 'eun1': 'europe', 'tr1': 'europe', 'ru': 'europe',
      'kr': 'asia', 'jp1': 'asia',
      'oc1': 'sea', 'ph2': 'sea', 'sg2': 'sea', 'th2': 'sea', 'tw2': 'sea', 'vn2': 'sea'
    };
    const routing = routingMap[riotRegion] || 'americas';

    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const results = [];

    for (let pi = 0; pi < Math.min(players.length, 10); pi++) {
      const player = players[pi];
      const result = {
        gameName: player.gameName,
        tagLine: player.tagLine,
        error: null
      };

      // Add extra delay between players to avoid rate limiting
      if (pi > 0) await delay(1000);

      try {
        // Step 1: Get PUUID
        const accountData = await riotFetch(
          `https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(player.gameName)}/${encodeURIComponent(player.tagLine)}`
        );
        result.puuid = accountData.puuid;
        result.gameName = accountData.gameName;
        result.tagLine = accountData.tagLine;
        await delay(300);

        // Step 2: Get summoner data
        const summonerData = await riotFetch(
          `https://${riotRegion}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${accountData.puuid}`
        );
        result.profileIconId = summonerData.profileIconId;
        await delay(300);

        // Step 3: Get ranked data
        try {
          const rankedData = await riotFetch(
            `https://${riotRegion}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerData.id}`
          );
          const soloQueue = rankedData.find(q => q.queueType === 'RANKED_SOLO_5x5');
          if (soloQueue) {
            result.rankTier = soloQueue.tier;
            result.rankDivision = soloQueue.rank;
            result.rankLp = soloQueue.leaguePoints;
          }
        } catch (e) {
          console.log(`Could not fetch ranked data for ${player.gameName}`);
        }
        await delay(300);

        // Step 4: Get match IDs (ranked solo queue = 420)
        const championStats = {};
        const roleCounts = {};
        try {
          const matchIds = await riotFetch(
            `https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${accountData.puuid}/ids?queue=420&count=15`
          );
          await delay(500);

          // Step 5: Fetch match details
          for (const matchId of matchIds.slice(0, 10)) {
            try {
              const match = await riotFetch(
                `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`
              );
              const participant = match.info.participants.find(p => p.puuid === accountData.puuid);
              if (participant) {
                const champName = participant.championName;
                if (!championStats[champName]) {
                  championStats[champName] = { championName: champName, games: 0, wins: 0 };
                }
                championStats[champName].games++;
                if (participant.win) championStats[champName].wins++;

                const role = participant.teamPosition;
                if (role) {
                  roleCounts[role] = (roleCounts[role] || 0) + 1;
                }
              }
              await delay(500);
            } catch (e) {
              console.log(`Failed to fetch match ${matchId}`);
            }
          }
        } catch (e) {
          console.log(`Could not fetch match history for ${player.gameName}`);
        }

        // Calculate top champions
        result.topChampions = Object.values(championStats)
          .map(c => ({ ...c, winRate: c.games > 0 ? Math.round((c.wins / c.games) * 100) : 0 }))
          .sort((a, b) => b.games - a.games)
          .slice(0, 3);

        // Detect role from most common position
        const topRole = Object.entries(roleCounts).sort((a, b) => b[1] - a[1])[0];
        result.detectedRole = topRole ? (riotRoleMap[topRole[0]] || null) : null;

      } catch (e) {
        console.error(`Error fetching ${player.gameName}#${player.tagLine}:`, e.message);
        result.error = e.status === 404 ? 'Player not found' : 'Failed to fetch player data';
      }

      results.push(result);
    }

    res.json({ results, region: opggRegion });

  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Failed to import players' });
  }
});

module.exports = router;
