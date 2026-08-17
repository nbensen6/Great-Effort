import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import PageBackground from '../components/PageBackground';
import FlowchartCanvas from '../components/FlowchartCanvas';
import ConfirmDialog from '../components/ConfirmDialog';
import { useConfirm } from '../hooks/useConfirm';
import { toChampionList } from '../lib/champions';

// Flowcharts are standalone documents held in a library. The team selector is a
// filter, not an owner: picking a team narrows the list to the ones attached to
// it, and the empty value shows everything. Attaching happens on the Scouting
// page; deleting a team only drops the link.
function Flowcharts() {
  const [teams, setTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [flowcharts, setFlowcharts] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [enemyPlayers, setEnemyPlayers] = useState([]);
  const [champions, setChampions] = useState([]);
  const [version, setVersion] = useState('14.1.1');
  const [editingFlowchart, setEditingFlowchart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { confirm, confirmDialogProps } = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedFcId = searchParams.get('fc');

  const selectedTeam = teams.find(t => String(t.id) === String(selectedTeamId)) || null;

  // A link to a specific flowchart (e.g. "Open" on the Scouting page) carries
  // ?fc=<id>. A flowchart can be attached to zero, one, or many teams, so
  // there's no single team it "belongs" to — always resolve it against the
  // full library rather than whatever team filter happens to be selected.
  useEffect(() => {
    if (requestedFcId && selectedTeamId !== '') {
      setSelectedTeamId('');
    }
  }, [requestedFcId, selectedTeamId]);

  useEffect(() => {
    if (!requestedFcId || flowcharts.length === 0) return;
    const match = flowcharts.find(f => String(f.id) === String(requestedFcId));
    if (match) {
      setEditingFlowchart(match);
      setSearchParams({}, { replace: true });
    }
  }, [requestedFcId, flowcharts, setSearchParams]);

  useEffect(() => {
    (async () => {
      try {
        const [teamsRes, versionsRes] = await Promise.all([
          api.get('/scouting/teams'),
          fetch('https://ddragon.leagueoflegends.com/api/versions.json').then(r => r.json())
        ]);
        setTeams(teamsRes.data);

        const latest = versionsRes[0];
        setVersion(latest);
        const champData = await fetch(
          `https://ddragon.leagueoflegends.com/cdn/${latest}/data/en_US/champion.json`
        ).then(r => r.json());
        setChampions(toChampionList(champData.data, latest));
      } catch (err) {
        setError('Failed to load flowcharts');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fetchTeamData = useCallback(async (teamId) => {
    try {
      // No team picked: show the whole library. Drafts and enemy players are
      // opponent-specific, so those panels stay empty until one is selected.
      if (!teamId) {
        const fcRes = await api.get('/scouting/flowcharts');
        setFlowcharts(fcRes.data);
        setDrafts([]);
        setEnemyPlayers([]);
        setEditingFlowchart(null);
        return;
      }

      const [fcRes, draftsRes, playersRes] = await Promise.all([
        api.get(`/scouting/teams/${teamId}/flowcharts`),
        api.get(`/scouting/teams/${teamId}/drafts`),
        api.get(`/scouting/teams/${teamId}/players`)
      ]);
      setFlowcharts(fcRes.data);
      setDrafts(draftsRes.data);
      setEnemyPlayers(playersRes.data);
      setEditingFlowchart(null);
    } catch (err) {
      setError('Failed to load flowcharts');
    }
  }, []);

  useEffect(() => { fetchTeamData(selectedTeamId); }, [selectedTeamId, fetchTeamData]);

  const handleSaveFlowchart = async (fcId, payload) => {
    try {
      if (fcId) {
        const response = await api.put(`/scouting/flowcharts/${fcId}`, payload);
        setFlowcharts(prev => prev.map(f => (f.id === fcId ? response.data : f)));
        return response.data;
      }
      // With a team filtered, a new flowchart is attached to it on creation;
      // from the library view it starts unattached.
      const response = selectedTeamId
        ? await api.post(`/scouting/teams/${selectedTeamId}/flowcharts`, payload)
        : await api.post('/scouting/flowcharts', payload);
      setFlowcharts(prev => [response.data, ...prev]);
      return response.data;
    } catch (err) {
      setError('Failed to save flowchart: ' + (err?.response?.data?.error || err.message));
      return null;
    }
  };

  const handleDeleteFlowchart = async (fcId) => {
    const confirmed = await confirm('Delete this flowchart?', {
      title: 'Delete Flowchart',
      confirmText: 'Delete'
    });
    if (!confirmed) return;
    try {
      await api.delete(`/scouting/flowcharts/${fcId}`);
      setFlowcharts(prev => prev.filter(f => f.id !== fcId));
    } catch (err) {
      setError('Failed to delete flowchart');
    }
  };

  if (loading) return <div className="loading">Loading flowcharts...</div>;

  return (
    <PageBackground>
      <div className="page-header">
        <h2>Draft Flowcharts</h2>
        {teams.length > 0 && (
          <select
            className="fc-team-select"
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
          >
            <option value="">All flowcharts</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="fc-page">
        <FlowchartCanvas
          key={selectedTeamId || 'library'}
          teamId={selectedTeam?.id}
          flowcharts={flowcharts}
          drafts={drafts}
          initialFlowchart={editingFlowchart}
          champions={champions}
          version={version}
          enemyPlayers={enemyPlayers}
          onSave={handleSaveFlowchart}
          onDelete={handleDeleteFlowchart}
          onClose={() => fetchTeamData(selectedTeamId)}
        />
      </div>

      <ConfirmDialog {...confirmDialogProps} />
    </PageBackground>
  );
}

export default Flowcharts;
