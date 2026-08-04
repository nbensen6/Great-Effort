import React, { useState, useEffect, useMemo } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import PageBackground from '../components/PageBackground';
import ConfirmDialog from '../components/ConfirmDialog';
import AlertDialog from '../components/AlertDialog';
import { useConfirm, useAlert } from '../hooks/useConfirm';
import { POOL_TIERS, TIER_KEYS, emptyPool, normalizePool } from '../lib/championPool';
import { toChampionList } from '../lib/champions';

const ROLE_ICONS = {
  Top: '⚔️',
  Jungle: '🌲',
  Mid: '🎯',
  ADC: '🏹',
  Support: '🛡️'
};

const ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

const REGIONS = [
  { value: 'na', label: 'NA' },
  { value: 'euw', label: 'EUW' },
  { value: 'eune', label: 'EUNE' },
  { value: 'kr', label: 'KR' },
  { value: 'br', label: 'BR' },
  { value: 'lan', label: 'LAN' },
  { value: 'las', label: 'LAS' },
  { value: 'oce', label: 'OCE' },
  { value: 'tr', label: 'TR' },
  { value: 'ru', label: 'RU' },
  { value: 'jp', label: 'JP' },
];

function Roster() {
  const { user } = useAuth();
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState('14.1.1');
  const [compositions, setCompositions] = useState([]);
  const [showCompForm, setShowCompForm] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [opggForm, setOpggForm] = useState({ username: '', region: 'na', iconId: '' });
  const { confirm, confirmDialogProps } = useConfirm();
  const { showAlert, alertDialogProps } = useAlert();

  // Admin state
  const [users, setUsers] = useState([]);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayer, setNewPlayer] = useState({
    user_id: '',
    summoner_name: '',
    role: 'Top',
    champion_pool: '',
    opgg_username: '',
    opgg_region: 'na'
  });

  // New composition form state
  const [newComp, setNewComp] = useState({
    name: '',
    description: '',
    top_champion: '',
    jungle_champion: '',
    mid_champion: '',
    adc_champion: '',
    support_champion: '',
    tags: ''
  });

  const [champions, setChampions] = useState([]);

  // Per-suggestion champion overrides, keyed by suggestion id. Absent roles
  // fall back to whatever the generator produced from the champion pools.
  const [suggestionEdits, setSuggestionEdits] = useState({});
  const [savingSuggestion, setSavingSuggestion] = useState(null);

  // Saved-composition inline editing
  const [editingComp, setEditingComp] = useState(null); // composition id
  const [compDraft, setCompDraft] = useState(null);
  const [savingComp, setSavingComp] = useState(false);

  // Collapsed player cards, by player id
  const [collapsedPlayers, setCollapsedPlayers] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('collapsedPlayers') || '[]'));
    } catch (e) {
      return new Set();
    }
  });

  // Champion pool editor state
  const [editingPool, setEditingPool] = useState(null); // player id
  const [poolDraft, setPoolDraft] = useState(emptyPool());
  const [poolSearch, setPoolSearch] = useState('');
  const [savingPool, setSavingPool] = useState(false);

  useEffect(() => {
    fetchPlayers();
    fetchVersion();
    fetchCompositions();
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchUsers();
    }
  }, [user]);

  const fetchPlayers = async () => {
    try {
      const response = await api.get('/players');
      setPlayers(response.data);
    } catch (err) {
      console.error('Failed to load players');
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await api.get('/auth/users');
      setUsers(response.data);
    } catch (err) {
      console.error('Failed to load users');
    }
  };

  const fetchVersion = async () => {
    try {
      const response = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
      const versions = await response.json();
      setVersion(versions[0]);

      // Also fetch champion list for composition selector
      const champResponse = await fetch(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/champion.json`);
      const data = await champResponse.json();
      setChampions(toChampionList(data.data, versions[0]));
    } catch (err) {
      console.error('Failed to fetch version');
    }
  };

  const fetchCompositions = async () => {
    try {
      const response = await api.get('/compositions');
      setCompositions(response.data);
    } catch (err) {
      console.error('Failed to load compositions');
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

  const handleUpdateOpgg = async (playerId) => {
    try {
      const iconId = opggForm.iconId ? parseInt(opggForm.iconId) : null;
      await api.patch(`/players/${playerId}/opgg`, {
        opgg_username: opggForm.username,
        opgg_region: opggForm.region,
        profile_icon_id: iconId
      });
      setPlayers(players.map(p =>
        p.id === playerId
          ? { ...p, opgg_username: opggForm.username, opgg_region: opggForm.region, profile_icon_id: iconId }
          : p
      ));
      setEditingPlayer(null);
      setOpggForm({ username: '', region: 'na', iconId: '' });
    } catch (err) {
      console.error('Failed to update op.gg');
    }
  };

  const handleUpdateRole = async (playerId, newRole) => {
    try {
      await api.patch(`/players/${playerId}/role`, { role: newRole });
      setPlayers(players.map(p =>
        p.id === playerId ? { ...p, role: newRole } : p
      ));
    } catch (err) {
      console.error('Failed to update role');
    }
  };

  const getRankDisplay = (player) => {
    if (!player.rank_tier) return null;
    const winRate = player.rank_wins && player.rank_losses
      ? Math.round((player.rank_wins / (player.rank_wins + player.rank_losses)) * 100)
      : null;
    return {
      tier: player.rank_tier,
      division: player.rank_division,
      lp: player.rank_lp,
      wins: player.rank_wins,
      losses: player.rank_losses,
      winRate
    };
  };

  const parseRecentMatches = (player) => {
    if (!player.recent_matches) return [];
    try {
      return JSON.parse(player.recent_matches);
    } catch {
      return [];
    }
  };

  const parseChampionStats = (player) => {
    if (!player.champion_stats) return [];
    try {
      return JSON.parse(player.champion_stats);
    } catch {
      return [];
    }
  };

  const handleAddPlayer = async (e) => {
    e.preventDefault();
    try {
      const response = await api.post('/players', {
        ...newPlayer,
        user_id: newPlayer.user_id || null
      });
      setPlayers([...players, response.data]);
      setNewPlayer({
        user_id: '',
        summoner_name: '',
        role: 'Top',
        champion_pool: '',
        opgg_username: '',
        opgg_region: 'na'
      });
      setShowAddPlayer(false);
      fetchUsers(); // Refresh users to update player_id linkage
    } catch (err) {
      console.error('Failed to add player');
      showAlert(err.response?.data?.error || 'Failed to add player');
    }
  };

  const handleDeletePlayer = async (playerId) => {
    const confirmed = await confirm('Remove this player from the roster?', {
      title: 'Remove Player',
      confirmText: 'Remove'
    });
    if (!confirmed) return;
    try {
      await api.delete(`/players/${playerId}`);
      setPlayers(players.filter(p => p.id !== playerId));
      fetchUsers();
    } catch (err) {
      console.error('Failed to delete player');
    }
  };

  const handleCreateComposition = async (e) => {
    e.preventDefault();
    try {
      const response = await api.post('/compositions', newComp);
      setCompositions([response.data, ...compositions]);
      setNewComp({
        name: '',
        description: '',
        top_champion: '',
        jungle_champion: '',
        mid_champion: '',
        adc_champion: '',
        support_champion: '',
        tags: ''
      });
      setShowCompForm(false);
    } catch (err) {
      console.error('Failed to create composition');
    }
  };

  const handleDeleteComposition = async (id) => {
    const confirmed = await confirm('Delete this composition?', {
      title: 'Delete Composition',
      confirmText: 'Delete'
    });
    if (!confirmed) return;
    try {
      await api.delete(`/compositions/${id}`);
      setCompositions(compositions.filter(c => c.id !== id));
    } catch (err) {
      console.error('Failed to delete composition');
    }
  };

  // Champion pool editor handlers
  const openPoolEditor = (player) => {
    setPoolDraft(normalizePool(player.champion_pool_data));
    setPoolSearch('');
    setEditingPool(player.id);
  };

  const closePoolEditor = () => {
    setEditingPool(null);
    setPoolDraft(emptyPool());
    setPoolSearch('');
  };

  const isChampInPool = (champId) => {
    return TIER_KEYS.some(key => poolDraft[key].some(e => e.id === champId));
  };

  const addChampToTier = (champId, tier) => {
    if (isChampInPool(champId)) return;
    setPoolDraft(prev => ({ ...prev, [tier]: [...prev[tier], { id: champId, note: '' }] }));
  };

  const removeChampFromTier = (champId, tier) => {
    setPoolDraft(prev => ({ ...prev, [tier]: prev[tier].filter(e => e.id !== champId) }));
  };

  const moveChampToTier = (champId, fromTier, toTier) => {
    setPoolDraft(prev => {
      const entry = prev[fromTier].find(e => e.id === champId);
      if (!entry) return prev;
      return {
        ...prev,
        [fromTier]: prev[fromTier].filter(e => e.id !== champId),
        // Carry the note across — it explains the pick, not the tier.
        [toTier]: [...prev[toTier], entry]
      };
    });
  };

  const setChampNote = (champId, tier, note) => {
    setPoolDraft(prev => ({
      ...prev,
      [tier]: prev[tier].map(e => (e.id === champId ? { ...e, note } : e))
    }));
  };

  const handleSavePool = async () => {
    setSavingPool(true);
    try {
      const response = await api.patch(`/players/${editingPool}/champion-pool-data`, {
        champion_pool_data: poolDraft
      });
      setPlayers(players.map(p => p.id === editingPool ? response.data : p));
      closePoolEditor();
    } catch (err) {
      console.error('Failed to save champion pool');
      showAlert(err.response?.data?.error || 'Failed to save champion pool');
    } finally {
      setSavingPool(false);
    }
  };

  const getFilteredChampions = () => {
    if (!poolSearch.trim()) return [];
    return champions.filter(c =>
      c.name.toLowerCase().includes(poolSearch.toLowerCase()) &&
      !isChampInPool(c.id)
    ).slice(0, 12);
  };

  const getOpggUrl = (player) => {
    if (!player.opgg_username) return null;
    const region = player.opgg_region || 'na';
    // OP.GG uses Riot ID format: Name#TAG becomes Name-TAG in URL
    const formattedName = player.opgg_username.replace('#', '-');
    return `https://www.op.gg/summoners/${region}/${encodeURIComponent(formattedName)}`;
  };

  const COMP_ROLES = ['top', 'jungle', 'mid', 'adc', 'support'];
  const ROLE_BY_SLOT = { top: 'Top', jungle: 'Jungle', mid: 'Mid', adc: 'ADC', support: 'Support' };

  // Every champion each role's player can actually play, tagged with the tier
  // and note from their pool, for the suggestion dropdowns.
  const poolOptionsByRole = useMemo(() => {
    const map = {};
    players.forEach(p => {
      if (!p.role) return;
      const pool = normalizePool(p.champion_pool_data);
      map[p.role] = TIER_KEYS.flatMap(tier =>
        pool[tier].map(e => ({ id: e.id, tier, note: e.note }))
      );
    });
    return map;
  }, [players]);

  // Suggestions are seeded from the draft tiers rather than an arbitrary slice
  // of the flat pool, so each one means something: what we default to, what we
  // pivot to after seeing the enemy, and what we save for specific drafts.
  const getCompSuggestions = () => {
    const byRole = poolOptionsByRole;
    if (Object.keys(byRole).length < 3) return [];

    const pick = (role, tier) => byRole[role]?.find(c => c.tier === tier)?.id;
    const mainOf = (role) => pick(role, 'main') || byRole[role]?.[0]?.id;

    const build = (id, name, hint, chooser) => ({
      id,
      name,
      hint,
      champions: COMP_ROLES.reduce((acc, slot) => {
        acc[slot] = chooser(ROLE_BY_SLOT[slot]);
        return acc;
      }, {})
    });

    const suggestions = [
      build('main', 'Main Comfort Picks', 'First pick from every pool',
        (role) => mainOf(role)),
      build('counter', 'Counter Comp', 'Counter picks where we have one',
        (role) => pick(role, 'counter') || mainOf(role)),
      build('situational', 'Situational', 'Situational picks where we have one',
        (role) => pick(role, 'situational') || mainOf(role))
    ];

    // Drop any suggestion that ended up identical to Main Comfort Picks.
    const key = (s) => COMP_ROLES.map(r => s.champions[r] || '-').join('|');
    const mainKey = key(suggestions[0]);
    return suggestions.filter((s, i) => i === 0 || key(s) !== mainKey);
  };

  const suggestionChampions = (s) => ({ ...s.champions, ...(suggestionEdits[s.id] || {}) });

  const setSuggestionChampion = (suggestionId, slot, champId) => {
    setSuggestionEdits(prev => ({
      ...prev,
      [suggestionId]: { ...(prev[suggestionId] || {}), [slot]: champId }
    }));
  };

  const resetSuggestion = (suggestionId) => {
    setSuggestionEdits(prev => {
      const next = { ...prev };
      delete next[suggestionId];
      return next;
    });
  };

  const handleSaveSuggestion = async (suggestion) => {
    setSavingSuggestion(suggestion.id);
    try {
      const champs = suggestionChampions(suggestion);
      const response = await api.post('/compositions', {
        name: suggestion.name,
        description: suggestion.hint,
        top_champion: champs.top || '',
        jungle_champion: champs.jungle || '',
        mid_champion: champs.mid || '',
        adc_champion: champs.adc || '',
        support_champion: champs.support || '',
        tags: 'from suggestion'
      });
      setCompositions([response.data, ...compositions]);
    } catch (err) {
      showAlert(err.response?.data?.error || 'Failed to save composition');
    } finally {
      setSavingSuggestion(null);
    }
  };

  const startEditComp = (comp) => {
    setEditingComp(comp.id);
    setCompDraft({
      name: comp.name || '',
      description: comp.description || '',
      top_champion: comp.top_champion || '',
      jungle_champion: comp.jungle_champion || '',
      mid_champion: comp.mid_champion || '',
      adc_champion: comp.adc_champion || '',
      support_champion: comp.support_champion || '',
      tags: comp.tags || ''
    });
  };

  const handleUpdateComposition = async (e) => {
    e.preventDefault();
    setSavingComp(true);
    try {
      const response = await api.put(`/compositions/${editingComp}`, compDraft);
      setCompositions(compositions.map(c => (c.id === editingComp ? response.data : c)));
      setEditingComp(null);
      setCompDraft(null);
    } catch (err) {
      showAlert(err.response?.data?.error || 'Failed to update composition');
    } finally {
      setSavingComp(false);
    }
  };

  // The roster card this account is attached to, if any.
  const myPlayer = players.find(p => user && p.user_id === user.id) || null;

  const handleClaimPlayer = async (playerId) => {
    try {
      const response = await api.post(`/players/${playerId}/claim`);
      setPlayers(players.map(p => (p.id === playerId ? { ...p, ...response.data } : p)));
    } catch (err) {
      showAlert(err.response?.data?.error || 'Failed to claim roster card');
    }
  };

  const handleUnclaimPlayer = async (playerId) => {
    const confirmed = await confirm(
      'Unlink your account from this roster card?',
      { title: 'Release Card', confirmText: 'Unlink' }
    );
    if (!confirmed) return;
    try {
      const response = await api.post(`/players/${playerId}/unclaim`);
      setPlayers(players.map(p => (p.id === playerId ? { ...p, ...response.data } : p)));
    } catch (err) {
      showAlert(err.response?.data?.error || 'Failed to release roster card');
    }
  };

  const togglePlayerCollapsed = (playerId) => {
    setCollapsedPlayers(prev => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId); else next.add(playerId);
      localStorage.setItem('collapsedPlayers', JSON.stringify([...next]));
      return next;
    });
  };

  // Get users not yet linked to a player
  const getUnlinkedUsers = () => {
    return users.filter(u => !u.player_id);
  };

  if (loading) return <div className="loading">Loading roster...</div>;

  const compSuggestions = getCompSuggestions();
  const isAdmin = user?.role === 'admin';

  return (
    <PageBackground>
      <div className="roster-page">
        <h1 style={{marginBottom: '1.5rem', textAlign: 'center'}}>Team Roster</h1>

      {/* Admin Panel */}
      {isAdmin && (
        <div className="card mb-3">
          <div className="card-header">
            <h3 className="card-title">Admin Panel</h3>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-primary btn-small"
                onClick={() => setShowAddPlayer(!showAddPlayer)}
              >
                {showAddPlayer ? 'Cancel' : '+ Add Player'}
              </button>
            </div>
          </div>

          {showAddPlayer && (
            <form onSubmit={handleAddPlayer} className="add-player-form">
              <div className="form-row">
                <div className="form-group">
                  <label>Link to User (optional)</label>
                  <select
                    value={newPlayer.user_id}
                    onChange={(e) => setNewPlayer({...newPlayer, user_id: e.target.value})}
                  >
                    <option value="">No linked user</option>
                    {getUnlinkedUsers().map(u => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Summoner Name *</label>
                  <input
                    type="text"
                    value={newPlayer.summoner_name}
                    onChange={(e) => setNewPlayer({...newPlayer, summoner_name: e.target.value})}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Role *</label>
                  <select
                    value={newPlayer.role}
                    onChange={(e) => setNewPlayer({...newPlayer, role: e.target.value})}
                  >
                    {ROLES.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Champion Pool (comma separated)</label>
                  <input
                    type="text"
                    value={newPlayer.champion_pool}
                    onChange={(e) => setNewPlayer({...newPlayer, champion_pool: e.target.value})}
                    placeholder="e.g., Jinx, Caitlyn, Aphelios"
                  />
                </div>
                <div className="form-group">
                  <label>Riot ID</label>
                  <input
                    type="text"
                    value={newPlayer.opgg_username}
                    onChange={(e) => setNewPlayer({...newPlayer, opgg_username: e.target.value})}
                    placeholder="Name#TAG"
                  />
                </div>
                <div className="form-group">
                  <label>Region</label>
                  <select
                    value={newPlayer.opgg_region}
                    onChange={(e) => setNewPlayer({...newPlayer, opgg_region: e.target.value})}
                  >
                    {REGIONS.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button type="submit" className="btn btn-primary">Add to Roster</button>
            </form>
          )}

          {/* Registered Users */}
          <div style={{marginTop: '1rem'}}>
            <h4 style={{marginBottom: '0.5rem'}}>Registered Users ({users.length})</h4>
            <div className="users-list">
              {users.map(u => (
                <div key={u.id} className="user-item">
                  <span className="user-name">{u.username}</span>
                  <span className="user-role">{u.role}</span>
                  {u.player_id ? (
                    <span className="user-status linked">On Roster</span>
                  ) : (
                    <span className="user-status">Not on roster</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {players.length === 0 ? (
        <div className="card" style={{textAlign: 'center', padding: '3rem'}}>
          <p>No players registered yet.</p>
          {isAdmin && (
            <p style={{color: 'var(--text-secondary)', marginTop: '1rem'}}>
              Use the Admin Panel above to add players to the roster.
            </p>
          )}
        </div>
      ) : (
        <div className="roster-grid">
          {players.map(player => {
            const rank = getRankDisplay(player);
            const canEdit = user && (user.role === 'admin' || user.id === player.user_id);
            const recentMatches = parseRecentMatches(player);
            const championStats = parseChampionStats(player);

            return (
              <div
                key={player.id}
                className={`card player-card${collapsedPlayers.has(player.id) ? ' collapsed' : ''}`}
              >
                {/* Action Buttons */}
                <div className="player-card-actions">
                  <button
                    className="collapse-btn"
                    onClick={() => togglePlayerCollapsed(player.id)}
                    aria-expanded={!collapsedPlayers.has(player.id)}
                    title={collapsedPlayers.has(player.id) ? 'Expand' : 'Collapse'}
                  >
                    {collapsedPlayers.has(player.id) ? '▸' : '▾'}
                  </button>
                  {isAdmin && (
                    <button
                      className="delete-btn"
                      onClick={() => handleDeletePlayer(player.id)}
                      title="Remove from roster"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Top Section: Avatar + Basic Info */}
                <div className="player-card-header">
                  {/* Avatar */}
                  <div className="player-avatar">
                    {player.profile_icon_id ? (
                      <img
                        src={getProfileIconUrl(player.profile_icon_id)}
                        alt="Profile Icon"
                      />
                    ) : (
                      ROLE_ICONS[player.role] || '🎮'
                    )}
                  </div>

                  {/* Player Info */}
                  <div className="player-info">
                    <h3 className="player-name">
                      {player.summoner_name}
                      {player.user_id && (
                        <span className={`claim-badge${user && player.user_id === user.id ? ' mine' : ''}`}>
                          {user && player.user_id === user.id ? 'You' : player.username}
                        </span>
                      )}
                    </h3>

                    {user && !player.user_id && !myPlayer && (
                      <button
                        className="btn btn-primary btn-small claim-btn"
                        onClick={() => handleClaimPlayer(player.id)}
                      >
                        This is me
                      </button>
                    )}
                    {user && player.user_id === user.id && (
                      <button
                        className="btn btn-secondary btn-small claim-btn"
                        onClick={() => handleUnclaimPlayer(player.id)}
                      >
                        Unlink
                      </button>
                    )}

                    {/* Role + Level */}
                    <div className="player-role-row">
                      <select
                        className="player-role-select"
                        value={player.role}
                        onChange={(e) => handleUpdateRole(player.id, e.target.value)}
                        disabled={!isAdmin}
                      >
                        {ROLES.map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      {player.summoner_level && (
                        <span className="player-level">Lv. {player.summoner_level}</span>
                      )}
                    </div>

                    {/* Rank Display */}
                    {rank && (
                      <div className="player-rank">
                        <span className={`rank-tier ${rank.tier.toLowerCase()}`}>
                          {rank.tier} {rank.division}
                        </span>
                        <span className="rank-lp">{rank.lp} LP</span>
                        <span className="rank-record">
                          <span className="wins">{rank.wins}W</span>
                          {' '}
                          <span className="losses">{rank.losses}L</span>
                          {' '}({rank.winRate}%)
                        </span>
                      </div>
                    )}

                    {/* Links */}
                    <div className="player-links">
                      {player.opgg_username ? (
                        <>
                          <a
                            href={getOpggUrl(player)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="opgg-link"
                          >
                            OP.GG ↗
                          </a>
                          {canEdit && (
                            <button
                              className="opgg-link"
                              style={{background: 'none', border: 'none', cursor: 'pointer', padding: 0}}
                              onClick={() => {
                                setEditingPlayer(player.id);
                                setOpggForm({
                                  username: player.opgg_username || '',
                                  region: player.opgg_region || 'na',
                                  iconId: player.profile_icon_id || ''
                                });
                              }}
                            >
                              Edit
                            </button>
                          )}
                        </>
                      ) : canEdit && (
                        <button
                          className="opgg-link"
                          style={{background: 'none', border: 'none', cursor: 'pointer', padding: 0}}
                          onClick={() => {
                            setEditingPlayer(player.id);
                            setOpggForm({ username: '', region: 'na', iconId: '' });
                          }}
                        >
                          + Link Riot ID
                        </button>
                      )}
                    </div>

                    {/* Edit Form */}
                    {editingPlayer === player.id && (
                      <div className="player-edit-form">
                        <input
                          type="text"
                          placeholder="Riot ID (Name#TAG)"
                          value={opggForm.username}
                          onChange={(e) => setOpggForm({...opggForm, username: e.target.value})}
                        />
                        <select
                          value={opggForm.region}
                          onChange={(e) => setOpggForm({...opggForm, region: e.target.value})}
                        >
                          {REGIONS.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                        <div className="form-actions">
                          <button
                            className="btn btn-primary btn-small"
                            onClick={() => handleUpdateOpgg(player.id)}
                          >
                            Save
                          </button>
                          <button
                            className="btn btn-secondary btn-small"
                            onClick={() => setEditingPlayer(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Most Played Champions */}
                {championStats.length > 0 && (
                  <div className="player-champion-stats">
                    <h4>Most Played</h4>
                    <div className="champion-stats-list">
                      {championStats.slice(0, 3).map((champ, idx) => (
                        <div key={idx} className="champion-stat-item">
                          <img
                            src={getChampionImage(champ.champion)}
                            alt={champ.champion}
                            className="champion-stat-icon"
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                          <div className="champion-stat-info">
                            <span className="champion-stat-name">{champ.champion}</span>
                            <span className="champion-stat-kda">{champ.kda} KDA</span>
                          </div>
                          <div className="champion-stat-winrate">
                            <span className={`winrate ${champ.winRate >= 50 ? 'positive' : 'negative'}`}>
                              {champ.winRate}%
                            </span>
                            <span className="games">{champ.games} games</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent Matches */}
                {recentMatches.length > 0 && (
                  <div className="player-recent-matches">
                    <h4>Recent Matches</h4>
                    <div className="recent-matches-list">
                      {recentMatches.map((match, idx) => (
                        <div key={idx} className={`recent-match-item ${match.win ? 'win' : 'loss'}`}>
                          <img
                            src={getChampionImage(match.champion)}
                            alt={match.champion}
                            className="match-champion-icon"
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                          <div className="match-result">
                            <span className={`result-text ${match.win ? 'win' : 'loss'}`}>
                              {match.win ? 'Victory' : 'Defeat'}
                            </span>
                            <span className="match-duration">{match.gameDuration}m</span>
                          </div>
                          <div className="match-kda">
                            <span className="kda-numbers">
                              {match.kills}/{match.deaths}/{match.assists}
                            </span>
                            <span className="kda-ratio">
                              {match.deaths === 0 ? 'Perfect' : ((match.kills + match.assists) / match.deaths).toFixed(2)} KDA
                            </span>
                          </div>
                          <div className="match-cs">
                            <span>{match.cs} CS</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Champion Pool Tiers */}
                {(() => {
                  const poolData = player.champion_pool_data
                    ? normalizePool(player.champion_pool_data)
                    : null;

                  if (poolData) {
                    return (
                      <div className="player-champion-pool-section">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <h4>Champion Pool</h4>
                          {canEdit && (
                            <button
                              className="btn btn-secondary btn-small"
                              onClick={() => openPoolEditor(player)}
                              style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                            >
                              Edit Pool
                            </button>
                          )}
                        </div>
                        {POOL_TIERS.map(tier => poolData[tier.key].length > 0 && (
                          <div className="pool-tier" key={tier.key}>
                            <span className={`pool-tier-label ${tier.className}`}>{tier.label}</span>
                            <div className="champion-pool-icons">
                              {poolData[tier.key].map(entry => {
                                const champName = champions.find(c => c.id === entry.id)?.name || entry.id;
                                return (
                                  <div className="pool-champ-chip" key={entry.id}>
                                    <img src={getChampionImage(entry.id)} alt={champName}
                                      title={entry.note ? `${champName} — ${entry.note}` : champName}
                                      onError={(e) => { e.target.style.display = 'none'; }} />
                                    {entry.note && <span className="pool-champ-note">{entry.note}</span>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  }

                  // Fallback to old champion_pool display
                  if (player.champion_pool && !championStats.length) {
                    return (
                      <div className="player-champion-pool-section">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <h4>Champion Pool</h4>
                          {canEdit && (
                            <button
                              className="btn btn-secondary btn-small"
                              onClick={() => openPoolEditor(player)}
                              style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                            >
                              Edit Pool
                            </button>
                          )}
                        </div>
                        <div className="champion-pool-icons">
                          {player.champion_pool.split(',').map((champ, idx) => (
                            <img key={idx} src={getChampionImage(champ.trim())} alt={champ.trim()}
                              title={champ.trim()}
                              onError={(e) => { e.target.style.display = 'none'; }} />
                          ))}
                        </div>
                      </div>
                    );
                  }

                  // No pool data at all - show add button
                  if (canEdit) {
                    return (
                      <div className="player-champion-pool-section">
                        <button
                          className="btn btn-secondary btn-small"
                          onClick={() => openPoolEditor(player)}
                          style={{ width: '100%' }}
                        >
                          + Set Champion Pool
                        </button>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* Composition Suggestions */}
      {compSuggestions.length > 0 && (
        <div className="card mt-3">
          <div className="card-header">
            <h3 className="card-title">Suggested Compositions</h3>
          </div>
          <p style={{color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem'}}>
            Seeded from each player's draft tiers. {user ? 'Swap any pick, then save it as a composition.' : 'Sign in to edit these.'}
          </p>
          <div className="comp-suggestions">
            {compSuggestions.map(suggestion => {
              const champs = suggestionChampions(suggestion);
              const edited = !!suggestionEdits[suggestion.id];
              return (
                <div key={suggestion.id} className="comp-suggestion-card">
                  <div className="comp-suggestion-head">
                    <div>
                      <h4>{suggestion.name}{edited && <span className="comp-edited-flag">edited</span>}</h4>
                      <span className="comp-suggestion-hint">{suggestion.hint}</span>
                    </div>
                    {user && (
                      <div className="comp-suggestion-actions">
                        {edited && (
                          <button className="btn btn-secondary btn-small"
                            onClick={() => resetSuggestion(suggestion.id)}>Reset</button>
                        )}
                        <button className="btn btn-primary btn-small"
                          disabled={savingSuggestion === suggestion.id}
                          onClick={() => handleSaveSuggestion(suggestion)}>
                          {savingSuggestion === suggestion.id ? 'Saving...' : 'Save as Comp'}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="comp-champions">
                    {COMP_ROLES.map(slot => {
                      const champId = champs[slot];
                      const options = poolOptionsByRole[ROLE_BY_SLOT[slot]] || [];
                      if (!user) {
                        return champId && (
                          <div key={slot} className="comp-champ">
                            <img src={getChampionImage(champId)} alt={champId}
                              title={`${slot}: ${champId}`}
                              onError={(e) => { e.target.style.display = 'none'; }} />
                            <span>{slot}</span>
                          </div>
                        );
                      }
                      return (
                        <div key={slot} className="comp-champ comp-champ-editable">
                          <img
                            src={getChampionImage(champId)}
                            alt={champId || slot}
                            title={champId || slot}
                            style={{ visibility: champId ? 'visible' : 'hidden' }}
                            onError={(e) => { e.target.style.visibility = 'hidden'; }}
                          />
                          <select
                            className="comp-champ-select"
                            value={champId || ''}
                            onChange={(e) => setSuggestionChampion(suggestion.id, slot, e.target.value)}
                          >
                            <option value="">— none —</option>
                            {options.map(o => (
                              <option key={o.id} value={o.id}>
                                {(champions.find(c => c.id === o.id)?.name || o.id)}
                                {o.note ? ` — ${o.note}` : ''}
                              </option>
                            ))}
                          </select>
                          <span>{slot}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Team Compositions */}
      <div className="card mt-3">
        <div className="card-header">
          <h3 className="card-title">Team Compositions</h3>
          {user && (
            <button
              className="btn btn-primary btn-small"
              onClick={() => setShowCompForm(!showCompForm)}
            >
              {showCompForm ? 'Cancel' : '+ New Comp'}
            </button>
          )}
        </div>

        {showCompForm && (
          <form onSubmit={handleCreateComposition} className="comp-form mb-3">
            <div className="form-group">
              <label>Composition Name</label>
              <input
                type="text"
                value={newComp.name}
                onChange={(e) => setNewComp({...newComp, name: e.target.value})}
                placeholder="e.g., Wombo Combo, Poke Comp"
                required
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                value={newComp.description}
                onChange={(e) => setNewComp({...newComp, description: e.target.value})}
                placeholder="Describe the strategy..."
                rows={2}
              />
            </div>
            <div className="comp-champion-selectors">
              {['Top', 'Jungle', 'Mid', 'ADC', 'Support'].map(role => (
                <div key={role} className="form-group" style={{flex: 1, minWidth: '120px'}}>
                  <label>{role}</label>
                  <select
                    value={newComp[`${role.toLowerCase()}_champion`]}
                    onChange={(e) => setNewComp({...newComp, [`${role.toLowerCase()}_champion`]: e.target.value})}
                  >
                    <option value="">Select...</option>
                    {champions.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="form-group">
              <label>Tags (comma separated)</label>
              <input
                type="text"
                value={newComp.tags}
                onChange={(e) => setNewComp({...newComp, tags: e.target.value})}
                placeholder="e.g., teamfight, early game, scaling"
              />
            </div>
            <button type="submit" className="btn btn-primary">Save Composition</button>
          </form>
        )}

        {compositions.length === 0 ? (
          <p style={{color: 'var(--text-secondary)'}}>
            No compositions saved yet. Create one to plan your team strategies.
          </p>
        ) : (
          <div className="compositions-list">
            {compositions.map(comp => (
              <div key={comp.id} className="composition-card">
                <div className="comp-header">
                  <div>
                    <h4>{comp.name}</h4>
                    {comp.tags && (
                      <div className="comp-tags">
                        {comp.tags.split(',').map((tag, idx) => (
                          <span key={idx} className="comp-tag">{tag.trim()}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {user && (
                    <div className="comp-suggestion-actions">
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => (editingComp === comp.id ? setEditingComp(null) : startEditComp(comp))}
                      >
                        {editingComp === comp.id ? 'Cancel' : 'Edit'}
                      </button>
                      <button
                        className="btn btn-danger btn-small"
                        onClick={() => handleDeleteComposition(comp.id)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                {editingComp === comp.id && compDraft && (
                  <form onSubmit={handleUpdateComposition} className="comp-form mb-3">
                    <div className="form-group">
                      <label>Composition Name</label>
                      <input type="text" value={compDraft.name} required
                        onChange={(e) => setCompDraft({ ...compDraft, name: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label>Description</label>
                      <textarea rows={2} value={compDraft.description}
                        onChange={(e) => setCompDraft({ ...compDraft, description: e.target.value })} />
                    </div>
                    <div className="comp-champion-selectors">
                      {['Top', 'Jungle', 'Mid', 'ADC', 'Support'].map(role => {
                        const field = `${role.toLowerCase()}_champion`;
                        const pool = poolOptionsByRole[role] || [];
                        return (
                          <div key={role} className="form-group" style={{ flex: 1, minWidth: '120px' }}>
                            <label>{role}</label>
                            <select value={compDraft[field]}
                              onChange={(e) => setCompDraft({ ...compDraft, [field]: e.target.value })}>
                              <option value="">Select...</option>
                              {pool.length > 0 && (
                                <optgroup label={`${role} pool`}>
                                  {pool.map(o => (
                                    <option key={`pool-${o.id}`} value={o.id}>
                                      {champions.find(c => c.id === o.id)?.name || o.id}
                                      {o.note ? ` — ${o.note}` : ''}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              <optgroup label="All champions">
                                {champions.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </optgroup>
                            </select>
                          </div>
                        );
                      })}
                    </div>
                    <div className="form-group">
                      <label>Tags (comma separated)</label>
                      <input type="text" value={compDraft.tags}
                        onChange={(e) => setCompDraft({ ...compDraft, tags: e.target.value })} />
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={savingComp}>
                      {savingComp ? 'Saving...' : 'Save Changes'}
                    </button>
                  </form>
                )}
                {comp.description && (
                  <p style={{color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.5rem'}}>
                    {comp.description}
                  </p>
                )}
                <div className="comp-champions">
                  {[
                    { role: 'Top', champ: comp.top_champion },
                    { role: 'Jungle', champ: comp.jungle_champion },
                    { role: 'Mid', champ: comp.mid_champion },
                    { role: 'ADC', champ: comp.adc_champion },
                    { role: 'Support', champ: comp.support_champion }
                  ].map(({ role, champ }) => (
                    champ && (
                      <div key={role} className="comp-champ">
                        <img
                          src={getChampionImage(champ)}
                          alt={champ}
                          title={`${role}: ${champ}`}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <span>{role}</span>
                      </div>
                    )
                  ))}
                </div>
                <small style={{color: 'var(--text-secondary)'}}>
                  Created by {comp.author_name}
                </small>
              </div>
            ))}
          </div>
        )}
        </div>

      {/* Champion Pool Editor Modal */}
      {editingPool && (
        <div className="modal-overlay" onClick={closePoolEditor}>
          <div className="pool-editor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pool-editor-header">
              <h3>Edit Champion Pool - {players.find(p => p.id === editingPool)?.summoner_name}</h3>
              <button className="modal-close" onClick={closePoolEditor}>&times;</button>
            </div>

            <div className="pool-editor-body">
              {/* Search Bar */}
              <div className="pool-search-section">
                <input
                  type="text"
                  className="pool-search-input"
                  placeholder="Search champions to add..."
                  value={poolSearch}
                  onChange={(e) => setPoolSearch(e.target.value)}
                  autoFocus
                />
                {poolSearch && (
                  <div className="pool-search-results">
                    {getFilteredChampions().map(champ => (
                      <div key={champ.id} className="pool-search-item">
                        <img src={getChampionImage(champ.id)} alt={champ.name}
                          onError={(e) => { e.target.style.display = 'none'; }} />
                        <span>{champ.name}</span>
                        <div className="pool-search-actions">
                          {POOL_TIERS.map(tier => (
                            <button
                              key={tier.key}
                              className={`pool-add-btn ${tier.className}`}
                              onClick={() => addChampToTier(champ.id, tier.key)}
                              title={`Add to ${tier.label}`}
                            >
                              {tier.label[0]}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {getFilteredChampions().length === 0 && poolSearch.trim() && (
                      <div className="pool-search-empty">No matching champions found</div>
                    )}
                  </div>
                )}
              </div>

              {/* Tier Lists */}
              {POOL_TIERS.map(tier => (
                <div key={tier.key} className="pool-editor-tier">
                  <div className="pool-editor-tier-header">
                    <span className={`pool-tier-label ${tier.className}`}>{tier.label}</span>
                    <span className="pool-tier-count">{poolDraft[tier.key].length}</span>
                    <span className="pool-tier-hint">{tier.hint}</span>
                  </div>
                  <div className="pool-editor-rows">
                    {poolDraft[tier.key].map(entry => {
                      const champName = champions.find(c => c.id === entry.id)?.name || entry.id;
                      return (
                        <div key={entry.id} className="pool-editor-row">
                          <img src={getChampionImage(entry.id)} alt={champName} title={champName}
                            onError={(e) => { e.target.style.display = 'none'; }} />
                          <span className="pool-editor-row-name">{champName}</span>
                          <input
                            type="text"
                            className="pool-note-input"
                            placeholder="Why do we pick this? e.g. blue side blind"
                            value={entry.note}
                            onChange={(e) => setChampNote(entry.id, tier.key, e.target.value)}
                          />
                          <div className="pool-champ-actions">
                            {POOL_TIERS.filter(t => t.key !== tier.key).map(t => (
                              <button
                                key={t.key}
                                title={`Move to ${t.label}`}
                                onClick={() => moveChampToTier(entry.id, tier.key, t.key)}
                              >
                                {t.label[0]}
                              </button>
                            ))}
                            <button className="remove" title="Remove"
                              onClick={() => removeChampFromTier(entry.id, tier.key)}>&times;</button>
                          </div>
                        </div>
                      );
                    })}
                    {poolDraft[tier.key].length === 0 && (
                      <span className="pool-editor-empty">No champions in this tier</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="pool-editor-footer">
              <button className="btn btn-secondary" onClick={closePoolEditor}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSavePool} disabled={savingPool}>
                {savingPool ? 'Saving...' : 'Save Pool'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
      <ConfirmDialog {...confirmDialogProps} />
      <AlertDialog {...alertDialogProps} />
    </PageBackground>
  );
}

export default Roster;
