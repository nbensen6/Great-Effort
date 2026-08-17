import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import FlowchartThumbnail from '../components/FlowchartThumbnail';
import { useConfirm } from '../hooks/useConfirm';

const NOTE_CATEGORIES = ['General', 'Draft Tendencies', 'Playstyle', 'Weaknesses', 'Player Notes'];

function Scouting() {
  const [teams, setTeams] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { confirm, confirmDialogProps } = useConfirm();

  const [activeTab, setActiveTab] = useState('players');
  const [teamNotes, setTeamNotes] = useState([]);
  const [teamImages, setTeamImages] = useState([]);
  const [teamDrafts, setTeamDrafts] = useState([]);
  const [version, setVersion] = useState('14.1.1');

  const [showNewTeam, setShowNewTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');

  const [showNewNote, setShowNewNote] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteCategory, setNoteCategory] = useState('General');
  const [editingNote, setEditingNote] = useState(null);

  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [modalImage, setModalImage] = useState(null);

  // Team drag reorder state
  const [dragTeamId, setDragTeamId] = useState(null);
  const [dragOverTeamId, setDragOverTeamId] = useState(null);

  // Players tab state
  const [teamPlayers, setTeamPlayers] = useState([]);
  const [opggUrl, setOpggUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importElapsed, setImportElapsed] = useState(0);
  const [importPlayerCount, setImportPlayerCount] = useState(0);

  // Flowcharts tab state
  const [teamFlowcharts, setTeamFlowcharts] = useState([]);
  const [flowchartLibrary, setFlowchartLibrary] = useState([]);
  const [importFlowchartId, setImportFlowchartId] = useState('');
  const [attaching, setAttaching] = useState(false);


  useEffect(() => {
    fetchTeams();
    fetchVersion();
  }, []);

  const fetchTeams = async () => {
    try {
      const response = await api.get('/scouting/teams');
      setTeams(response.data);
    } catch (err) {
      setError('Failed to load teams');
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

  const fetchTeamData = useCallback(async (teamId) => {
    try {
      const [notesRes, imagesRes, draftsRes, playersRes, flowchartsRes, libraryRes] = await Promise.all([
        api.get(`/scouting/teams/${teamId}/notes`),
        api.get(`/scouting/teams/${teamId}/images`),
        api.get(`/scouting/teams/${teamId}/drafts`),
        api.get(`/scouting/teams/${teamId}/players`),
        api.get(`/scouting/teams/${teamId}/flowcharts`),
        api.get('/scouting/flowcharts')
      ]);
      setTeamNotes(notesRes.data);
      setTeamImages(imagesRes.data);
      setTeamDrafts(draftsRes.data);
      setTeamPlayers(playersRes.data);
      setTeamFlowcharts(flowchartsRes.data);
      setFlowchartLibrary(libraryRes.data);
      setImportFlowchartId('');
    } catch (err) {
      setError('Failed to load team data');
    }
  }, []);

  useEffect(() => {
    if (selectedTeam) {
      fetchTeamData(selectedTeam.id);
    }
  }, [selectedTeam, fetchTeamData]);

  const handleSelectTeam = (team) => {
    setSelectedTeam(team);
    setActiveTab('players');
    setShowNewNote(false);
    setEditingNote(null);
  };

  const handleCreateTeam = async (e) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;

    try {
      const response = await api.post('/scouting/teams', { name: newTeamName });
      setTeams([response.data, ...teams]);
      setNewTeamName('');
      setShowNewTeam(false);
      setSelectedTeam(response.data);
    } catch (err) {
      setError('Failed to create team');
    }
  };

  const handleLogoUpload = async (teamId, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      const formData = new FormData();
      formData.append('logo', file);
      const response = await api.post(
        `/scouting/teams/${teamId}/logo`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setTeams(prev => prev.map(t => t.id === teamId ? { ...t, logo_filename: response.data.logo_filename } : t));
      if (selectedTeam?.id === teamId) {
        setSelectedTeam(prev => ({ ...prev, logo_filename: response.data.logo_filename }));
      }
    } catch (err) {
      setError('Failed to upload logo');
    }
  };

  const handleTeamDragStart = (e, teamId) => {
    setDragTeamId(teamId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleTeamDragOver = (e, teamId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (teamId !== dragOverTeamId) setDragOverTeamId(teamId);
  };

  const handleTeamDrop = async (e, targetTeamId) => {
    e.preventDefault();
    setDragOverTeamId(null);
    if (!dragTeamId || dragTeamId === targetTeamId) {
      setDragTeamId(null);
      return;
    }

    const fromIndex = teams.findIndex(t => t.id === dragTeamId);
    const toIndex = teams.findIndex(t => t.id === targetTeamId);
    if (fromIndex === -1 || toIndex === -1) return;

    const reordered = [...teams];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setTeams(reordered);
    setDragTeamId(null);

    try {
      await api.put('/scouting/teams/reorder', { order: reordered.map(t => t.id) });
    } catch (err) {
      console.error('Failed to save team order');
    }
  };

  const handleTeamDragEnd = () => {
    setDragTeamId(null);
    setDragOverTeamId(null);
  };

  const handleDeleteTeam = async (teamId) => {
    const confirmed = await confirm(
      'Delete this team and all its notes, images, players and saved drafts? Flowcharts are kept in your library.',
      { title: 'Delete Team', confirmText: 'Delete' }
    );
    if (!confirmed) return;

    try {
      await api.delete(`/scouting/teams/${teamId}`);
      setTeams(teams.filter(t => t.id !== teamId));
      if (selectedTeam?.id === teamId) {
        setSelectedTeam(null);
      }
    } catch (err) {
      setError('Failed to delete team');
    }
  };

  const handleSaveNote = async (e) => {
    e.preventDefault();
    if (!noteTitle.trim()) return;

    try {
      if (editingNote) {
        const response = await api.put(`/scouting/notes/${editingNote.id}`, {
          title: noteTitle,
          content: noteContent,
          category: noteCategory
        });
        setTeamNotes(teamNotes.map(n => n.id === editingNote.id ? response.data : n));
      } else {
        const response = await api.post(`/scouting/teams/${selectedTeam.id}/notes`, {
          title: noteTitle,
          content: noteContent,
          category: noteCategory
        });
        setTeamNotes([response.data, ...teamNotes]);
      }
      setShowNewNote(false);
      setEditingNote(null);
      setNoteTitle('');
      setNoteContent('');
      setNoteCategory('General');
    } catch (err) {
      setError('Failed to save note');
    }
  };

  const handleEditNote = (note) => {
    setEditingNote(note);
    setNoteTitle(note.title);
    setNoteContent(note.content || '');
    setNoteCategory(note.category);
    setShowNewNote(true);
  };

  const handleDeleteNote = async (noteId) => {
    const confirmed = await confirm('Delete this note?', {
      title: 'Delete Note',
      confirmText: 'Delete'
    });
    if (!confirmed) return;

    try {
      await api.delete(`/scouting/notes/${noteId}`);
      setTeamNotes(teamNotes.filter(n => n.id !== noteId));
    } catch (err) {
      setError('Failed to delete note');
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;

    await uploadImages(files);
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    await uploadImages(files);
    e.target.value = '';
  };

  const uploadImages = async (files) => {
    setUploading(true);
    setError('');

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('image', file);

        const response = await api.post(
          `/scouting/teams/${selectedTeam.id}/images`,
          formData,
          { headers: { 'Content-Type': 'multipart/form-data' } }
        );
        setTeamImages(prev => [response.data, ...prev]);
      }
    } catch (err) {
      setError('Failed to upload image(s)');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteImage = async (imageId) => {
    const confirmed = await confirm('Delete this image?', {
      title: 'Delete Image',
      confirmText: 'Delete'
    });
    if (!confirmed) return;

    try {
      await api.delete(`/scouting/images/${imageId}`);
      setTeamImages(teamImages.filter(i => i.id !== imageId));
    } catch (err) {
      setError('Failed to delete image');
    }
  };

  const handleDeleteDraft = async (draftId) => {
    const confirmed = await confirm('Delete this saved draft?', {
      title: 'Delete Draft',
      confirmText: 'Delete'
    });
    if (!confirmed) return;

    try {
      await api.delete(`/scouting/drafts/${draftId}`);
      setTeamDrafts(teamDrafts.filter(d => d.id !== draftId));
    } catch (err) {
      setError('Failed to delete draft');
    }
  };

  // Op.gg import handlers
  const parseOpggUrl = (url) => {
    try {
      const parsed = new URL(url);
      const pathMatch = parsed.pathname.match(/\/multisearch\/(\w+)/);
      const region = pathMatch ? pathMatch[1] : 'na';
      const summoners = parsed.searchParams.get('summoners') || '';
      const players = summoners.split(',').map(s => {
        const decoded = decodeURIComponent(s).trim();
        const hashIdx = decoded.lastIndexOf('#');
        if (hashIdx === -1) return null;
        return {
          gameName: decoded.substring(0, hashIdx),
          tagLine: decoded.substring(hashIdx + 1)
        };
      }).filter(Boolean);
      return { players, region };
    } catch {
      return null;
    }
  };

  const handleImportOpgg = async () => {
    if (!opggUrl.trim()) return;
    setImportError('');

    const parsed = parseOpggUrl(opggUrl);
    if (!parsed || parsed.players.length === 0) {
      setImportError('Invalid op.gg multi-search URL. Expected format: https://www.op.gg/multisearch/na?summoners=Player1%23TAG,...');
      return;
    }

    setImporting(true);
    setImportPlayerCount(parsed.players.length);
    setImportElapsed(0);
    const tickStart = Date.now();
    const tick = setInterval(() => setImportElapsed(Math.round((Date.now() - tickStart) / 1000)), 1000);

    try {
      // Step 1: Fetch player data from Riot API. Each player is fetched
      // sequentially server-side (~8-10s each, Riot rate limits leave no
      // real room to parallelize), so a full roster easily runs past a minute.
      const riotRes = await api.post('/riot/import-opgg', {
        players: parsed.players,
        region: parsed.region
      });

      const results = riotRes.data.results.filter(r => !r.error);
      if (results.length === 0) {
        setImportError('No players found. Check the URL and try again.');
        setImporting(false);
        return;
      }

      // Step 2: Save players to database
      const saveRes = await api.post(`/scouting/teams/${selectedTeam.id}/players`, {
        players: results.map(r => ({
          gameName: r.gameName,
          tagLine: r.tagLine,
          region: parsed.region,
          puuid: r.puuid,
          rankTier: r.rankTier,
          rankDivision: r.rankDivision,
          rankLp: r.rankLp,
          rankWins: r.rankWins,
          rankLosses: r.rankLosses,
          profileIconId: r.profileIconId,
          topChampions: r.topChampions,
          championMastery: r.championMastery,
          detectedRole: r.detectedRole
        }))
      });

      setTeamPlayers(saveRes.data);
      setOpggUrl('');
    } catch (err) {
      setImportError(err?.response?.data?.error || 'Failed to import players');
    } finally {
      clearInterval(tick);
      setImporting(false);
    }
  };

  const handleAttachFlowchart = async () => {
    if (!importFlowchartId) return;
    setAttaching(true);
    try {
      const res = await api.post(`/scouting/teams/${selectedTeam.id}/flowcharts/${importFlowchartId}`);
      setTeamFlowcharts(prev => [res.data, ...prev]);
      setFlowchartLibrary(prev => prev.map(f => f.id === res.data.id ? res.data : f));
      setImportFlowchartId('');
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to import flowchart');
    } finally {
      setAttaching(false);
    }
  };

  // Detach only unlinks it from this team. The flowchart stays in the library.
  const handleDetachFlowchart = async (flowchartId) => {
    const confirmed = await confirm(
      'Remove this flowchart from this team? It stays in your flowchart library.',
      { title: 'Remove From Team', confirmText: 'Remove' }
    );
    if (!confirmed) return;

    try {
      const res = await api.delete(`/scouting/teams/${selectedTeam.id}/flowcharts/${flowchartId}`);
      setTeamFlowcharts(prev => prev.filter(f => f.id !== flowchartId));
      if (res.data?.id) {
        setFlowchartLibrary(prev => prev.map(f => f.id === res.data.id ? res.data : f));
      }
    } catch (err) {
      setError('Failed to remove flowchart from team');
    }
  };

  const handleUpdatePlayerRole = async (playerId, role) => {
    try {
      const res = await api.patch(`/scouting/players/${playerId}/role`, { role });
      setTeamPlayers(prev => prev.map(p => p.id === playerId ? res.data : p));
    } catch (err) {
      setError('Failed to update role');
    }
  };

  const handleDeletePlayer = async (playerId) => {
    try {
      await api.delete(`/scouting/players/${playerId}`);
      setTeamPlayers(prev => prev.filter(p => p.id !== playerId));
    } catch (err) {
      setError('Failed to delete player');
    }
  };

  const getChampionImage = (champId) => {
    if (!champId) return null;
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champId}.png`;
  };

  const parseDraftPicks = (picksStr) => {
    try {
      return JSON.parse(picksStr);
    } catch {
      return [];
    }
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  if (loading) return <div className="loading">Loading scouting data...</div>;

  return (
    <div className="scouting-page">
      <div className="teams-sidebar card">
        <div className="card-header">
          <h3 className="card-title">Enemy Teams</h3>
          <button
            className="btn btn-primary btn-small"
            onClick={() => setShowNewTeam(!showNewTeam)}
          >
            + New
          </button>
        </div>

        {showNewTeam && (
          <form onSubmit={handleCreateTeam} style={{marginBottom: '1rem'}}>
            <input
              type="text"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="Team name..."
              style={{
                width: '100%',
                padding: '0.5rem',
                marginBottom: '0.5rem',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)'
              }}
              autoFocus
            />
            <div style={{display: 'flex', gap: '0.5rem'}}>
              <button type="submit" className="btn btn-primary btn-small">Add</button>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setShowNewTeam(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {error && <div className="error">{error}</div>}

        <div className="teams-list">
          {teams.length === 0 ? (
            <p style={{color: 'var(--text-secondary)', padding: '1rem'}}>
              No teams yet. Add your first opponent.
            </p>
          ) : (
            teams.map(team => (
              <div
                key={team.id}
                className={`team-item ${selectedTeam?.id === team.id ? 'active' : ''} ${team.logo_filename ? 'has-logo' : ''} ${dragOverTeamId === team.id ? 'drag-over' : ''}`}
                onClick={() => handleSelectTeam(team)}
                draggable
                onDragStart={(e) => handleTeamDragStart(e, team.id)}
                onDragOver={(e) => handleTeamDragOver(e, team.id)}
                onDrop={(e) => handleTeamDrop(e, team.id)}
                onDragEnd={handleTeamDragEnd}
              >
                <input
                  type="file"
                  id={`logo-upload-${team.id}`}
                  accept="image/*"
                  style={{display: 'none'}}
                  onChange={(e) => handleLogoUpload(team.id, e)}
                />
                {team.logo_filename ? (
                  <img
                    className="team-logo-full"
                    src={`/api/scouting/uploads/${team.logo_filename}`}
                    alt={team.name}
                    title={team.name}
                  />
                ) : (
                  <div className="team-name">{team.name}</div>
                )}
                <div className="team-item-actions">
                  <button
                    className="btn btn-secondary btn-small team-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      document.getElementById(`logo-upload-${team.id}`).click();
                    }}
                    title={team.logo_filename ? 'Change logo' : 'Add logo'}
                  >
                    +
                  </button>
                  <button
                    className="btn btn-danger btn-small team-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteTeam(team.id);
                    }}
                    title="Delete team"
                  >
                    X
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="team-content card">
        {selectedTeam ? (
          <>
            <div className="team-header">
              <h2>{selectedTeam.name}</h2>
            </div>

            <div className="team-tabs">
              <button
                className={`team-tab ${activeTab === 'players' ? 'active' : ''}`}
                onClick={() => setActiveTab('players')}
              >
                Players ({teamPlayers.length})
              </button>
              <button
                className={`team-tab ${activeTab === 'flowcharts' ? 'active' : ''}`}
                onClick={() => setActiveTab('flowcharts')}
              >
                Flowcharts ({teamFlowcharts.length})
              </button>
              <button
                className={`team-tab ${activeTab === 'drafts' ? 'active' : ''}`}
                onClick={() => setActiveTab('drafts')}
              >
                Saved Drafts ({teamDrafts.length})
              </button>
              <button
                className={`team-tab ${activeTab === 'images' ? 'active' : ''}`}
                onClick={() => setActiveTab('images')}
              >
                Draft Images ({teamImages.length})
              </button>
              <button
                className={`team-tab ${activeTab === 'notes' ? 'active' : ''}`}
                onClick={() => setActiveTab('notes')}
              >
                Notes ({teamNotes.length})
              </button>
            </div>

            {activeTab === 'flowcharts' && (() => {
              const attachedIds = new Set(teamFlowcharts.map(f => f.id));
              const importable = flowchartLibrary.filter(f => !attachedIds.has(f.id));

              return (
                <div className="flowcharts-tab">
                  <div className="import-section">
                    <label style={{fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'block'}}>
                      Import a flowchart from your library. The same flowchart can be used against
                      any number of teams — edits show up everywhere it's attached.
                    </label>
                    <div style={{display: 'flex', gap: '0.5rem'}}>
                      <select
                        value={importFlowchartId}
                        onChange={(e) => setImportFlowchartId(e.target.value)}
                        disabled={attaching || importable.length === 0}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-tertiary)',
                          color: 'var(--text-primary)'
                        }}
                      >
                        <option value="">
                          {importable.length === 0 ? 'Nothing left to import' : 'Choose a flowchart...'}
                        </option>
                        {importable.map(f => (
                          <option key={f.id} value={f.id}>
                            {f.name}{f.teams?.length ? ` (also on ${f.teams.map(t => t.name).join(', ')})` : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn-primary"
                        onClick={handleAttachFlowchart}
                        disabled={attaching || !importFlowchartId}
                      >
                        {attaching ? 'Importing...' : 'Import'}
                      </button>
                    </div>
                  </div>

                  {teamFlowcharts.length === 0 ? (
                    <p style={{color: 'var(--text-secondary)', marginTop: '1rem'}}>
                      No flowcharts on this team yet. Import one above, or build a new one on the{' '}
                      <Link to="/flowcharts" style={{color: 'var(--accent-blue)'}}>Flowcharts page</Link>.
                    </p>
                  ) : (
                    <div className="attached-flowcharts-list" style={{marginTop: '1rem'}}>
                      {teamFlowcharts.map(fc => {
                        let nodeCount = null;
                        try {
                          nodeCount = JSON.parse(fc.data)?.nodes?.length ?? null;
                        } catch {
                          nodeCount = null;
                        }
                        const alsoOn = (fc.teams || []).filter(t => t.id !== selectedTeam.id);

                        return (
                          <div key={fc.id} className="card mb-2">
                            <Link to={`/flowcharts?fc=${fc.id}`} className="fc-thumb-link">
                              <FlowchartThumbnail data={fc.data} />
                            </Link>
                            <div className="card-header">
                              <div>
                                <h4 style={{color: 'var(--accent-gold)'}}>{fc.name}</h4>
                                <small style={{color: 'var(--text-secondary)'}}>
                                  {nodeCount != null ? `${nodeCount} nodes | ` : ''}
                                  updated {formatDate(fc.updated_at)} by {fc.author_name}
                                  {alsoOn.length ? ` | also on ${alsoOn.map(t => t.name).join(', ')}` : ''}
                                </small>
                              </div>
                              <div style={{display: 'flex', gap: '0.5rem'}}>
                                <Link to={`/flowcharts?fc=${fc.id}`} className="btn btn-secondary btn-small">
                                  Open
                                </Link>
                                <button
                                  className="btn btn-danger btn-small"
                                  onClick={() => handleDetachFlowchart(fc.id)}
                                  title="Unlink from this team (keeps the flowchart)"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {activeTab === 'images' && (
              <div className="images-tab">
                <div
                  className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById('imageUpload').click()}
                >
                  <input
                    type="file"
                    id="imageUpload"
                    accept="image/*"
                    multiple
                    onChange={handleFileSelect}
                    style={{display: 'none'}}
                  />
                  {uploading ? (
                    <p>Uploading...</p>
                  ) : (
                    <>
                      <p>Drag & drop draft screenshots here</p>
                      <small>or click to browse</small>
                    </>
                  )}
                </div>

                {teamImages.length > 0 && (
                  <div className="draft-images-grid">
                    {teamImages.map(img => (
                      <div key={img.id} className="draft-image-card">
                        <img
                          src={`/api/scouting/uploads/${img.filename}`}
                          alt={img.original_name}
                          onClick={() => setModalImage(img)}
                        />
                        <div className="image-info">
                          <div className="image-date">{formatDate(img.created_at)}</div>
                          <button
                            className="btn btn-danger btn-small"
                            onClick={() => handleDeleteImage(img.id)}
                            style={{marginTop: '0.5rem', padding: '0.25rem 0.5rem', fontSize: '0.75rem'}}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'drafts' && (
              <div className="drafts-tab">
                <p style={{color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem'}}>
                  Drafts saved from the Draft Helper. Go to Draft Helper to create and save new drafts.
                </p>

                {teamDrafts.length === 0 ? (
                  <p style={{color: 'var(--text-secondary)'}}>
                    No saved drafts yet. Use the Draft Helper to create and save drafts against this team.
                  </p>
                ) : (
                  <div className="saved-drafts-list">
                    {teamDrafts.map(draft => {
                      const bluePicks = parseDraftPicks(draft.blue_picks);
                      const redPicks = parseDraftPicks(draft.red_picks);
                      const blueBans = parseDraftPicks(draft.blue_bans);
                      const redBans = parseDraftPicks(draft.red_bans);

                      return (
                        <div key={draft.id} className="saved-draft-card card mb-2">
                          <div className="card-header">
                            <div>
                              <h4 style={{color: 'var(--accent-gold)'}}>{draft.name}</h4>
                              <small style={{color: 'var(--text-secondary)'}}>
                                {formatDate(draft.created_at)} by {draft.author_name}
                              </small>
                            </div>
                            <button
                              className="btn btn-danger btn-small"
                              onClick={() => handleDeleteDraft(draft.id)}
                            >
                              Delete
                            </button>
                          </div>

                          <div className="draft-display">
                            <div className="draft-side blue-side">
                              <h5>Blue Team (Ally)</h5>
                              <div className="picks-display">
                                <span className="label">Picks:</span>
                                <div className="champ-row">
                                  {bluePicks.map((champId, idx) => (
                                    champId ? (
                                      <img
                                        key={idx}
                                        src={getChampionImage(champId)}
                                        alt={champId}
                                        title={champId}
                                        className="draft-champ-img"
                                      />
                                    ) : (
                                      <div key={idx} className="empty-slot" />
                                    )
                                  ))}
                                </div>
                              </div>
                              <div className="bans-display">
                                <span className="label">Bans:</span>
                                <div className="champ-row bans">
                                  {blueBans.map((champId, idx) => (
                                    champId ? (
                                      <img
                                        key={idx}
                                        src={getChampionImage(champId)}
                                        alt={champId}
                                        title={champId}
                                        className="draft-champ-img banned"
                                      />
                                    ) : (
                                      <div key={idx} className="empty-slot small" />
                                    )
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="draft-side red-side">
                              <h5>Red Team (Enemy)</h5>
                              <div className="picks-display">
                                <span className="label">Picks:</span>
                                <div className="champ-row">
                                  {redPicks.map((champId, idx) => (
                                    champId ? (
                                      <img
                                        key={idx}
                                        src={getChampionImage(champId)}
                                        alt={champId}
                                        title={champId}
                                        className="draft-champ-img"
                                      />
                                    ) : (
                                      <div key={idx} className="empty-slot" />
                                    )
                                  ))}
                                </div>
                              </div>
                              <div className="bans-display">
                                <span className="label">Bans:</span>
                                <div className="champ-row bans">
                                  {redBans.map((champId, idx) => (
                                    champId ? (
                                      <img
                                        key={idx}
                                        src={getChampionImage(champId)}
                                        alt={champId}
                                        title={champId}
                                        className="draft-champ-img banned"
                                      />
                                    ) : (
                                      <div key={idx} className="empty-slot small" />
                                    )
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>

                          {draft.notes && (
                            <div className="draft-notes" style={{marginTop: '0.5rem', padding: '0.5rem', background: 'var(--bg-tertiary)', borderRadius: '4px'}}>
                              <small style={{color: 'var(--text-secondary)'}}>Notes:</small>
                              <p style={{margin: 0, whiteSpace: 'pre-wrap'}}>{draft.notes}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'players' && (
              <div className="players-tab">
                <div className="import-section">
                  <label style={{fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'block'}}>
                    Paste an op.gg multi-search URL to import enemy players
                  </label>
                  <div style={{display: 'flex', gap: '0.5rem'}}>
                    <input
                      type="text"
                      value={opggUrl}
                      onChange={(e) => setOpggUrl(e.target.value)}
                      placeholder="https://www.op.gg/multisearch/na?summoners=..."
                      disabled={importing}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        borderRadius: '4px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)'
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && handleImportOpgg()}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={handleImportOpgg}
                      disabled={importing || !opggUrl.trim()}
                    >
                      {importing ? 'Importing...' : 'Import'}
                    </button>
                  </div>
                  {importError && (
                    <div className="error" style={{marginTop: '0.5rem'}}>{importError}</div>
                  )}
                  {importing && (
                    <div style={{marginTop: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem'}}>
                      Fetching player data from Riot API — {importPlayerCount > 1
                        ? `players are fetched one at a time, so ${importPlayerCount} can take a minute or more.`
                        : 'usually 5-10 seconds for one player.'} Elapsed: {importElapsed}s
                    </div>
                  )}
                </div>

                {teamPlayers.length > 0 && (() => {
                  const region = teamPlayers[0]?.region || 'na';
                  const multiSearchUrl = `https://www.op.gg/multisearch/${region}?summoners=${teamPlayers.map(p => `${encodeURIComponent(p.game_name)}%23${encodeURIComponent(p.tag_line)}`).join(',')}`;
                  return (
                    <a
                      href={multiSearchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="opgg-team-link"
                    >
                      View all on op.gg
                    </a>
                  );
                })()}

                {teamPlayers.length > 0 && (
                  <div className="enemy-players-grid">
                    {teamPlayers.map(player => {
                      const topChamps = player.top_champions ? JSON.parse(player.top_champions) : [];
                      const mastery = player.champion_mastery ? JSON.parse(player.champion_mastery) : [];
                      const rankDisplay = player.rank_tier
                        ? `${player.rank_tier} ${player.rank_division}${player.rank_lp != null ? ` (${player.rank_lp} LP)` : ''}`
                        : 'Unranked';
                      // Current season's ranked solo record only — Riot's API has no
                      // career-long totals or past-season history to draw on.
                      const record = (player.rank_wins != null && player.rank_losses != null)
                        ? ` · ${player.rank_wins}W ${player.rank_losses}L (${Math.round((player.rank_wins / (player.rank_wins + player.rank_losses || 1)) * 100)}%)`
                        : '';

                      return (
                        <div key={player.id} className="enemy-player-card">
                          <div className="player-card-header">
                            <img
                              className="player-icon"
                              src={player.profile_icon_id
                                ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${player.profile_icon_id}.png`
                                : `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/29.png`}
                              alt=""
                            />
                            <div className="player-info">
                              <div className="player-name">{player.game_name}<span className="player-tag">#{player.tag_line}</span></div>
                              <div className="player-rank">
                                {rankDisplay}{record}
                                {' '}
                                <a
                                  href={`https://www.op.gg/summoners/${player.region || 'na'}/${encodeURIComponent(player.game_name)}-${encodeURIComponent(player.tag_line)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="opgg-link"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  op.gg
                                </a>
                              </div>
                            </div>
                            <button
                              className="btn btn-danger btn-small"
                              onClick={() => handleDeletePlayer(player.id)}
                              style={{padding: '0.2rem 0.5rem', fontSize: '0.7rem', alignSelf: 'flex-start'}}
                            >
                              X
                            </button>
                          </div>

                          <div className="player-card-body">
                            <div className="player-role-row">
                              <label style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>Role:</label>
                              <select
                                className="role-select"
                                value={player.role || ''}
                                onChange={(e) => handleUpdatePlayerRole(player.id, e.target.value)}
                              >
                                <option value="">Unassigned</option>
                                <option value="Top">Top</option>
                                <option value="Jungle">Jungle</option>
                                <option value="Mid">Mid</option>
                                <option value="ADC">ADC</option>
                                <option value="Support">Support</option>
                              </select>
                            </div>

                            {topChamps.length > 0 && (
                              <div>
                                <label style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>
                                  Recent form (last {topChamps.reduce((sum, c) => sum + c.games, 0)} ranked games)
                                </label>
                                <div className="player-champs">
                                  {topChamps.map((c, i) => (
                                    <div
                                      key={i}
                                      className="player-champ"
                                      title={`${c.championName} — ${c.games}G ${c.winRate}% WR, ${c.avgKills}/${c.avgDeaths}/${c.avgAssists}${c.kda != null ? ` (${c.kda} KDA)` : ''}, ${c.avgCs} CS/game`}
                                    >
                                      <img
                                        src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${c.championName}.png`}
                                        alt={c.championName}
                                      />
                                      <span className="champ-stat">{c.games}G {c.winRate}%</span>
                                      {c.avgKills != null && (
                                        <span className="champ-stat" style={{fontSize: '0.65rem'}}>
                                          {c.avgKills}/{c.avgDeaths}/{c.avgAssists} · {c.avgCs} CS
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {mastery.length > 0 && (
                              <div style={{marginTop: '0.5rem'}}>
                                <label style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>
                                  Champion mastery
                                </label>
                                <div className="player-champs">
                                  {mastery.map((m, i) => (
                                    <div
                                      key={i}
                                      className="player-champ"
                                      title={`${m.championName} — Mastery ${m.championLevel}, ${m.championPoints.toLocaleString()} points`}
                                    >
                                      <img
                                        src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${m.championName}.png`}
                                        alt={m.championName}
                                      />
                                      <span className="champ-stat">
                                        M{m.championLevel} · {m.championPoints >= 1000 ? `${Math.round(m.championPoints / 1000)}k` : m.championPoints}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {teamPlayers.length === 0 && !importing && (
                  <p style={{color: 'var(--text-secondary)', marginTop: '1rem'}}>
                    No players imported yet. Paste an op.gg multi-search URL above to get started.
                  </p>
                )}
              </div>
            )}

            {activeTab === 'notes' && (
              <div className="notes-tab">
                <div style={{marginBottom: '1rem'}}>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setShowNewNote(true);
                      setEditingNote(null);
                      setNoteTitle('');
                      setNoteContent('');
                      setNoteCategory('General');
                    }}
                  >
                    + New Note
                  </button>
                </div>

                {showNewNote && (
                  <div className="card mb-3" style={{background: 'var(--bg-tertiary)'}}>
                    <form onSubmit={handleSaveNote}>
                      <div className="form-group">
                        <input
                          type="text"
                          value={noteTitle}
                          onChange={(e) => setNoteTitle(e.target.value)}
                          placeholder="Note title..."
                          required
                        />
                      </div>
                      <div className="form-group">
                        <select
                          value={noteCategory}
                          onChange={(e) => setNoteCategory(e.target.value)}
                        >
                          {NOTE_CATEGORIES.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <textarea
                          value={noteContent}
                          onChange={(e) => setNoteContent(e.target.value)}
                          placeholder="Write your scouting notes here..."
                          rows={6}
                        />
                      </div>
                      <div style={{display: 'flex', gap: '0.5rem'}}>
                        <button type="submit" className="btn btn-primary">
                          {editingNote ? 'Update' : 'Save'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setShowNewNote(false);
                            setEditingNote(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {teamNotes.length === 0 && !showNewNote ? (
                  <p style={{color: 'var(--text-secondary)'}}>
                    No notes yet. Add scouting intel about this team.
                  </p>
                ) : (
                  teamNotes.map(note => (
                    <div key={note.id} className="card mb-2">
                      <div className="card-header">
                        <div>
                          <h4 style={{color: 'var(--accent-gold)'}}>{note.title}</h4>
                          <small style={{color: 'var(--text-secondary)'}}>
                            {note.category} | {formatDate(note.created_at)} by {note.author_name}
                          </small>
                        </div>
                        <div style={{display: 'flex', gap: '0.5rem'}}>
                          <button
                            className="btn btn-secondary btn-small"
                            onClick={() => handleEditNote(note)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-danger btn-small"
                            onClick={() => handleDeleteNote(note.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <div style={{whiteSpace: 'pre-wrap', lineHeight: 1.6}}>
                        {note.content || <em style={{color: 'var(--text-secondary)'}}>No content</em>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

          </>
        ) : (
          <div style={{textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)'}}>
            <h3>Select a team to view scouting data</h3>
            <p>Or create a new enemy team to start tracking their drafts and tendencies.</p>
          </div>
        )}
      </div>

      {modalImage && (
        <div className="image-modal" onClick={() => setModalImage(null)}>
          <button className="close-btn" onClick={() => setModalImage(null)}>×</button>
          <img
            src={`/api/scouting/uploads/${modalImage.filename}`}
            alt={modalImage.original_name}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}

export default Scouting;
