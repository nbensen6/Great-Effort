import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import api from '../services/api';
import VideoBackground from '../components/VideoBackground';

function Stats() {
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [playerFilter, setPlayerFilter] = useState('all');
  const [championFilter, setChampionFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'match_date', direction: 'desc' });

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await api.get('/stats');
      setStats(response.data);
    } catch (err) {
      setError('Failed to load stats');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setError('');
    setSuccess('');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const response = await api.post('/stats/upload', { data: results.data });
          setSuccess(`Successfully imported ${response.data.count} matches`);
          fetchStats();
        } catch (err) {
          setError(err.response?.data?.error || 'Failed to upload stats');
        }
      },
      error: (err) => {
        setError('Failed to parse CSV file');
      }
    });

    e.target.value = '';
  };

  const players = useMemo(() => {
    const unique = [...new Set(stats.map(s => s.player))];
    return unique.sort();
  }, [stats]);

  const filteredStats = useMemo(() => {
    return stats.filter(s => {
      if (playerFilter !== 'all' && s.player !== playerFilter) return false;
      if (championFilter && !s.champion.toLowerCase().includes(championFilter.toLowerCase())) return false;
      if (resultFilter !== 'all' && s.result.toLowerCase() !== resultFilter) return false;
      return true;
    });
  }, [stats, playerFilter, championFilter, resultFilter]);

  const sortedStats = useMemo(() => {
    const sorted = [...filteredStats];
    sorted.sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];

      if (sortConfig.key === 'match_date') {
        aVal = new Date(aVal);
        bVal = new Date(bVal);
      } else if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredStats, sortConfig]);

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const playerStats = useMemo(() => {
    const statsMap = {};
    filteredStats.forEach(s => {
      if (!statsMap[s.player]) {
        statsMap[s.player] = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, cs: 0, vision: 0 };
      }
      const p = statsMap[s.player];
      p.games++;
      if (s.result.toLowerCase() === 'win') p.wins++;
      p.kills += s.kills;
      p.deaths += s.deaths;
      p.assists += s.assists;
      p.cs += s.cs;
      p.vision += s.vision_score;
    });

    return Object.entries(statsMap).map(([player, data]) => ({
      player,
      games: data.games,
      winrate: ((data.wins / data.games) * 100).toFixed(1),
      avgKDA: data.deaths > 0 ? ((data.kills + data.assists) / data.deaths).toFixed(2) : 'Perfect',
      avgCS: (data.cs / data.games).toFixed(0),
      avgVision: (data.vision / data.games).toFixed(1)
    }));
  }, [filteredStats]);

  if (loading) return <div className="loading">Loading stats...</div>;

  return (
    <VideoBackground videoSrc="/videos/ZaheenLoop.mp4">
      <div className="stats-page">
        <div className="stats-header">
          <h1>Team Statistics</h1>
        <div className="file-upload">
          <input
            type="file"
            id="csvUpload"
            accept=".csv"
            onChange={handleFileUpload}
          />
          <label htmlFor="csvUpload" className="btn btn-primary">
            Upload CSV
          </label>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      {playerStats.length > 0 && (
        <div className="card mb-3">
          <h3 className="card-title">Player Overview</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Games</th>
                  <th>Winrate</th>
                  <th>Avg KDA</th>
                  <th>Avg CS</th>
                  <th>Avg Vision</th>
                </tr>
              </thead>
              <tbody>
                {playerStats.map(p => (
                  <tr key={p.player}>
                    <td className="stat-highlight">{p.player}</td>
                    <td>{p.games}</td>
                    <td className={parseFloat(p.winrate) >= 50 ? 'result-win' : 'result-loss'}>
                      {p.winrate}%
                    </td>
                    <td>{p.avgKDA}</td>
                    <td>{p.avgCS}</td>
                    <td>{p.avgVision}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="card-title">Match History</h3>

        <div className="stats-filters">
          <select value={playerFilter} onChange={(e) => setPlayerFilter(e.target.value)}>
            <option value="all">All Players</option>
            {players.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <input
            type="text"
            placeholder="Filter by champion..."
            value={championFilter}
            onChange={(e) => setChampionFilter(e.target.value)}
          />

          <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
            <option value="all">All Results</option>
            <option value="win">Wins</option>
            <option value="loss">Losses</option>
          </select>
        </div>

        {sortedStats.length === 0 ? (
          <p>No stats available. Upload a CSV file to get started.</p>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th onClick={() => handleSort('match_date')}>Date {sortConfig.key === 'match_date' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th onClick={() => handleSort('player')}>Player {sortConfig.key === 'player' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th onClick={() => handleSort('champion')}>Champion {sortConfig.key === 'champion' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th onClick={() => handleSort('kills')}>K</th>
                  <th onClick={() => handleSort('deaths')}>D</th>
                  <th onClick={() => handleSort('assists')}>A</th>
                  <th onClick={() => handleSort('cs')}>CS</th>
                  <th onClick={() => handleSort('vision_score')}>Vision</th>
                  <th onClick={() => handleSort('damage')}>Damage</th>
                  <th onClick={() => handleSort('gold')}>Gold</th>
                  <th onClick={() => handleSort('result')}>Result {sortConfig.key === 'result' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedStats.map((s, idx) => (
                  <tr key={idx}>
                    <td>{new Date(s.match_date).toLocaleDateString()}</td>
                    <td className="stat-highlight">{s.player}</td>
                    <td>{s.champion}</td>
                    <td>{s.kills}</td>
                    <td>{s.deaths}</td>
                    <td>{s.assists}</td>
                    <td>{s.cs}</td>
                    <td>{s.vision_score}</td>
                    <td>{s.damage?.toLocaleString()}</td>
                    <td>{s.gold?.toLocaleString()}</td>
                    <td className={s.result.toLowerCase() === 'win' ? 'result-win' : 'result-loss'}>
                      {s.result}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      </div>
    </VideoBackground>
  );
}

export default Stats;
