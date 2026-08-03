import React, { useState, useEffect } from 'react';
import api from '../services/api';

function Practice() {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [playerStats, setPlayerStats] = useState([]);
  const [matches, setMatches] = useState([]);
  const [expandedMatches, setExpandedMatches] = useState(new Set());
  const [expandedPlayers, setExpandedPlayers] = useState(new Set());
  const [version, setVersion] = useState('14.1.1');

  useEffect(() => {
    fetchData();
    fetchVersion();
  }, []);

  const fetchData = async () => {
    try {
      const [overviewRes, statsRes, matchesRes] = await Promise.all([
        api.get('/practice/overview'),
        api.get('/practice/stats'),
        api.get('/practice/matches?limit=50')
      ]);
      setOverview(overviewRes.data);
      setPlayerStats(statsRes.data);
      setMatches(matchesRes.data.matches);
    } catch (err) {
      console.error('Failed to load practice data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchVersion = async () => {
    try {
      const response = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
      const versions = await response.json();
      setVersion(versions[0]);
    } catch (err) {
      console.error('Failed to fetch version');
    }
  };

  const getChampionImage = (champId) => {
    if (!champId) return null;
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champId}.png`;
  };

  const getProfileIconUrl = (iconId) => {
    if (!iconId) return null;
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${iconId}.png`;
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  };

  const getOpggUrl = (riotId, region) => {
    if (!riotId) return null;
    const r = region || 'na';
    const formatted = riotId.replace('#', '-');
    return `https://www.op.gg/summoners/${r}/${encodeURIComponent(formatted)}`;
  };

  // Build puuid->opgg lookup from roster participants across all matches
  const opggLookup = {};
  matches.forEach(match => {
    if (match.rosterParticipants) {
      match.rosterParticipants.forEach(p => {
        if (p.puuid && p.opggUsername) {
          opggLookup[p.puuid] = { username: p.opggUsername, region: p.opggRegion };
        }
      });
    }
  });

  const toggleMatch = (matchId) => {
    const newExpanded = new Set(expandedMatches);
    if (newExpanded.has(matchId)) {
      newExpanded.delete(matchId);
    } else {
      newExpanded.add(matchId);
    }
    setExpandedMatches(newExpanded);
  };

  const togglePlayer = (playerId) => {
    const newExpanded = new Set(expandedPlayers);
    if (newExpanded.has(playerId)) {
      newExpanded.delete(playerId);
    } else {
      newExpanded.add(playerId);
    }
    setExpandedPlayers(newExpanded);
  };

  if (loading) return <div className="loading">Loading practice data...</div>;

  return (
    <div className="practice-page">
      <h1 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>Team Stats</h1>

      {/* Team Overview */}
      {overview && overview.totalMatches > 0 && (
        <div className="card mb-3">
          <div className="card-header">
            <h3 className="card-title">Team Overview</h3>
            <span className="match-count">{overview.totalMatches} practice games</span>
          </div>
          <div className="overview-grid">
            <div className="overview-section">
              <h4>Most Played</h4>
              <div className="champion-list">
                {overview.mostPlayed.slice(0, 5).map((champ, idx) => (
                  <div key={idx} className="champion-item">
                    <img
                      src={getChampionImage(champ.champion)}
                      alt={champ.champion}
                      className="champion-icon"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                    <div className="champion-info">
                      <span className="champion-name">{champ.champion}</span>
                      <span className="champion-player">{champ.player_name}</span>
                    </div>
                    <span className="champion-games">{champ.games}G</span>
                    <span className={`champion-winrate ${champ.winRate >= 50 ? 'positive' : 'negative'}`}>
                      {champ.winRate}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="overview-section">
              <h4>Best Stats</h4>
              <div className="champion-list">
                {overview.bestStats && Object.values(overview.bestStats).filter(Boolean).map((stat, idx) => (
                  <div key={idx} className="champion-item">
                    <img
                      src={getChampionImage(stat.champion)}
                      alt={stat.champion}
                      className="champion-icon"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                    <div className="champion-info">
                      <span className="champion-name">{stat.label}</span>
                      <span className="champion-player">{stat.player} - {stat.champion}</span>
                    </div>
                    <span className="stat-value-highlight">{stat.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Player Stats */}
      <div className="card mb-3">
        <div className="card-header">
          <h3 className="card-title">Player Practice Stats</h3>
        </div>
        {playerStats.length === 0 || playerStats.every(p => p.totalGames === 0) ? (
          <p style={{ color: 'var(--text-secondary)' }}>
            No practice stats yet. Practice matches are auto-synced twice daily.
          </p>
        ) : (
          <div className="player-cards-grid">
            {playerStats.filter(p => p.totalGames > 0).map(player => (
              <div key={player.player.id} className="player-stat-card">
                <div className="player-card-top">
                  <div className="player-avatar">
                    {player.player.profileIconId ? (
                      <img
                        src={getProfileIconUrl(player.player.profileIconId)}
                        alt=""
                        className="profile-icon"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="profile-placeholder" />
                    )}
                  </div>
                  <div className="player-card-header">
                    <span className="player-card-name">{player.player.name}</span>
                    <span className="player-card-role">{player.player.role}</span>
                    <div className="player-card-stats">
                      <span className="games">{player.totalGames} games</span>
                      <span className={`winrate ${player.winRate >= 50 ? 'positive' : 'negative'}`}>
                        {player.winRate}% WR
                      </span>
                    </div>
                  </div>
                </div>
                <div className="player-champs-row">
                  {player.champions.slice(0, 5).map((champ, idx) => (
                    <div key={idx} className="champ-mini" title={`${champ.champion}: ${champ.games}G ${champ.winRate}% WR`}>
                      <img
                        src={getChampionImage(champ.champion)}
                        alt={champ.champion}
                        className="champ-mini-icon"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                      <span className="champ-mini-games">{champ.games}</span>
                    </div>
                  ))}
                </div>
                <button
                  className="player-card-expand"
                  onClick={() => togglePlayer(player.player.id)}
                >
                  {expandedPlayers.has(player.player.id) ? 'Hide Details' : 'View All Champions'}
                </button>
                {expandedPlayers.has(player.player.id) && (
                  <div className="player-champs-detail">
                    {player.champions.map((champ, idx) => (
                      <div key={idx} className="champ-detail-row">
                        <img
                          src={getChampionImage(champ.champion)}
                          alt={champ.champion}
                          className="champ-detail-icon"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <span className="champ-detail-name">{champ.champion}</span>
                        {champ.inPool && <span className="in-pool-badge">Pool</span>}
                        <span className="champ-detail-games">{champ.games}G</span>
                        <span className={`champ-detail-wr ${champ.winRate >= 50 ? 'positive' : 'negative'}`}>
                          {champ.winRate}%
                        </span>
                        <span className="champ-detail-kda">{champ.kda} KDA</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Match History */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Practice Matches</h3>
        </div>
        {matches.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>
            No practice matches found yet.
          </p>
        ) : (
          <div className="matches-list">
            {matches.map(match => (
              <div key={match.id} className="match-item">
                <div
                  className="match-header"
                  onClick={() => toggleMatch(match.id)}
                >
                  <div className="match-info">
                    <span className="match-date">{formatDate(match.game_creation)}</span>
                    {(() => {
                      const firstPlayer = match.rosterParticipants.find(p => p.opggUsername);
                      if (!firstPlayer) return null;
                      return (
                        <a
                          href={getOpggUrl(firstPlayer.opggUsername, firstPlayer.opggRegion)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="match-game-link"
                          onClick={(e) => e.stopPropagation()}
                          title="View on OP.GG"
                        >
                          Game ↗
                        </a>
                      );
                    })()}
                  </div>
                  <div className="match-roster">
                    {match.rosterParticipants.map((p, idx) => (
                      <div key={idx} className={`roster-participant ${p.win ? 'win' : 'loss'}`}>
                        <img
                          src={getChampionImage(p.champion)}
                          alt={p.champion}
                          className="champion-icon-small"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <span className="participant-name">{p.playerName}</span>
                        <span className="participant-kda">{p.kills}/{p.deaths}/{p.assists}</span>
                      </div>
                    ))}
                  </div>
                  <span className="expand-icon">
                    {expandedMatches.has(match.id) ? '−' : '+'}
                  </span>
                </div>
                {expandedMatches.has(match.id) && (
                  <div className="match-details">
                    <div className="teams-container">
                      {[100, 200].map(teamId => (
                        <div key={teamId} className={`team team-${teamId}`}>
                          <h5 className={match.winning_team === teamId ? 'winning' : 'losing'}>
                            {match.winning_team === teamId ? 'Victory' : 'Defeat'}
                          </h5>
                          {match.participants
                            .filter(p => p.teamId === teamId)
                            .map((p, idx) => {
                              const isRoster = match.rosterParticipants.some(rp => rp.puuid === p.puuid);
                              const opgg = opggLookup[p.puuid];
                              return (
                                <div key={idx} className={`participant ${isRoster ? 'roster' : ''}`}>
                                  <img
                                    src={getChampionImage(p.champion)}
                                    alt={p.champion}
                                    className="champion-icon-small"
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                  />
                                  {opgg ? (
                                    <a href={getOpggUrl(opgg.username, opgg.region)} target="_blank" rel="noopener noreferrer" className="name opgg-link">{p.summonerName}</a>
                                  ) : (
                                    <span className="name">{p.summonerName}</span>
                                  )}
                                  <span className="kda">{p.kills}/{p.deaths}/{p.assists}</span>
                                  <span className="cs">{p.cs} CS</span>
                                </div>
                              );
                            })}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .practice-page {
          max-width: 1200px;
          margin: 0 auto;
          padding: 1rem;
        }

        .practice-controls {
          display: flex;
          align-items: center;
          gap: 1.5rem;
          flex-wrap: wrap;
        }

        .threshold-control {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .threshold-control label {
          color: var(--text-secondary);
          font-size: 0.9rem;
        }

        .threshold-control select {
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          color: var(--text-primary);
        }

        .last-scan {
          color: var(--text-secondary);
          font-size: 0.85rem;
        }

        .scan-result {
          margin-top: 1rem;
          padding: 0.75rem;
          background: var(--bg-secondary);
          border-radius: 4px;
          color: var(--accent-green);
        }

        .match-count {
          color: var(--text-secondary);
          font-size: 0.9rem;
        }

        .overview-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 1.5rem;
        }

        .overview-section h4 {
          margin-bottom: 0.75rem;
          color: var(--text-secondary);
          font-size: 0.9rem;
          text-transform: uppercase;
        }

        .champion-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .champion-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.5rem;
          background: var(--bg-secondary);
          border-radius: 4px;
        }

        .champion-icon {
          width: 32px;
          height: 32px;
          border-radius: 4px;
        }

        .champion-icon-small {
          width: 24px;
          height: 24px;
          border-radius: 4px;
        }

        .champion-info {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-width: 0;
        }

        .champion-name {
          font-weight: 500;
        }

        .champion-player {
          font-size: 0.75rem;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .champion-games {
          color: var(--text-secondary);
          font-size: 0.85rem;
        }

        .champion-winrate {
          font-weight: 600;
          min-width: 40px;
          text-align: right;
        }

        .stat-value-highlight {
          font-weight: 600;
          color: var(--accent-green, #4ade80);
          min-width: 60px;
          text-align: right;
          font-size: 0.95rem;
        }

        .positive { color: var(--accent-green, #4ade80); }
        .negative { color: var(--accent-red, #f87171); }

        .player-cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1rem;
        }

        .player-stat-card {
          background: var(--bg-secondary);
          border-radius: 12px;
          padding: 1rem;
          border: 1px solid var(--border-color);
          overflow: hidden;
        }

        .player-card-top {
          display: flex;
          gap: 0.75rem;
          margin-bottom: 1rem;
          overflow: hidden;
        }

        .player-avatar {
          flex-shrink: 0;
        }

        .profile-icon {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          border: 3px solid var(--border-color);
        }

        .profile-placeholder {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          background: var(--bg-tertiary);
          border: 3px solid var(--border-color);
        }

        .player-card-header {
          display: flex;
          flex-direction: column;
          justify-content: center;
          overflow: hidden;
          min-width: 0;
        }

        .player-card-name {
          font-weight: 700;
          font-size: 1.1rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .player-card-role {
          color: var(--text-secondary);
          font-size: 0.85rem;
        }

        .player-card-stats {
          display: flex;
          gap: 0.75rem;
          margin-top: 0.25rem;
        }

        .player-card-stats .games {
          color: var(--text-secondary);
          font-size: 0.9rem;
        }

        .player-card-stats .winrate {
          font-weight: 600;
          font-size: 0.9rem;
        }

        .player-champs-row {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }

        .champ-mini {
          position: relative;
          width: 40px;
          height: 40px;
        }

        .champ-mini-icon {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          border: 2px solid var(--border-color);
        }

        .champ-mini-games {
          position: absolute;
          bottom: -4px;
          right: -4px;
          background: var(--bg-primary);
          color: var(--text-primary);
          font-size: 0.7rem;
          font-weight: 600;
          padding: 0 4px;
          border-radius: 4px;
          border: 1px solid var(--border-color);
        }

        .player-card-expand {
          width: 100%;
          padding: 0.5rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 0.85rem;
        }

        .player-card-expand:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .player-champs-detail {
          margin-top: 0.75rem;
          padding-top: 0.75rem;
          border-top: 1px solid var(--border-color);
        }

        .champ-detail-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.4rem 0;
          font-size: 0.85rem;
        }

        .champ-detail-icon {
          width: 28px;
          height: 28px;
          border-radius: 6px;
        }

        .champ-detail-name {
          flex: 1;
          font-weight: 500;
        }

        .in-pool-badge {
          font-size: 0.65rem;
          padding: 0.1rem 0.3rem;
          background: var(--accent-green, #4ade80);
          color: black;
          border-radius: 3px;
          font-weight: 600;
        }

        .champ-detail-games {
          color: var(--text-secondary);
          min-width: 30px;
          text-align: right;
        }

        .champ-detail-wr {
          font-weight: 600;
          min-width: 35px;
          text-align: right;
        }

        .champ-detail-kda {
          color: var(--text-secondary);
          min-width: 60px;
          text-align: right;
        }

        .expand-icon {
          font-size: 1.5rem;
          color: var(--text-secondary);
          width: 24px;
          text-align: center;
        }

        .matches-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .match-item {
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
        }

        .match-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.5rem 0.75rem;
          cursor: pointer;
          background: var(--bg-secondary);
        }

        .match-header:hover {
          background: var(--bg-hover, var(--bg-secondary));
        }

        .match-info {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-shrink: 0;
        }

        .match-date {
          font-weight: 500;
          font-size: 0.85rem;
          white-space: nowrap;
        }

        .match-game-link {
          font-size: 0.75rem;
          color: var(--accent-blue, #38bdf8);
          text-decoration: none;
          white-space: nowrap;
        }

        .match-game-link:hover {
          text-decoration: underline;
        }

        .match-roster {
          display: flex;
          gap: 0.5rem;
          flex-wrap: nowrap;
          overflow: hidden;
          flex: 1;
          min-width: 0;
          justify-content: flex-end;
        }

        .roster-participant {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.15rem 0.35rem;
          border-radius: 4px;
          font-size: 0.8rem;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .roster-participant.win {
          background: rgba(74, 222, 128, 0.15);
        }

        .roster-participant.loss {
          background: rgba(248, 113, 113, 0.15);
        }

        .participant-name {
          font-weight: 500;
          font-size: 0.8rem;
        }

        .participant-kda {
          color: var(--text-secondary);
          font-size: 0.75rem;
        }

        .match-details {
          padding: 1rem;
          border-top: 1px solid var(--border);
        }

        .teams-container {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }

        .team h5 {
          margin-bottom: 0.75rem;
          font-size: 0.9rem;
        }

        .team h5.winning {
          color: var(--accent-green, #4ade80);
        }

        .team h5.losing {
          color: var(--accent-red, #f87171);
        }

        .participant {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.35rem 0;
          font-size: 0.85rem;
        }

        .participant.roster {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
          padding: 0.35rem 0.5rem;
          font-weight: 500;
        }

        .participant .name {
          flex: 1;
        }

        .participant .name.opgg-link,
        .roster-participant .participant-name.opgg-link {
          color: var(--accent-blue, #38bdf8);
          text-decoration: none;
        }

        .participant .name.opgg-link:hover,
        .roster-participant .participant-name.opgg-link:hover {
          text-decoration: underline;
        }

        .participant .kda {
          min-width: 60px;
          text-align: right;
        }

        .participant .cs {
          color: var(--text-secondary);
          min-width: 50px;
          text-align: right;
        }

        @media (max-width: 768px) {
          .player-cards-grid {
            grid-template-columns: 1fr;
          }

          .teams-container {
            grid-template-columns: 1fr;
          }

          .match-roster {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}

export default Practice;
