import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import PageBackground from '../components/PageBackground';
import FlowchartCanvas from '../components/FlowchartCanvas';
import ConfirmDialog from '../components/ConfirmDialog';
import { useConfirm } from '../hooks/useConfirm';
import { toChampionList } from '../lib/champions';

// Draft flowcharts used to live inside a tab on the Scouting page. They are
// still stored per enemy team (draft_flowcharts.team_id), so this page keeps a
// team selector rather than inventing a new scope for them.
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

  const selectedTeam = teams.find(t => String(t.id) === String(selectedTeamId)) || null;

  useEffect(() => {
    (async () => {
      try {
        const [teamsRes, versionsRes] = await Promise.all([
          api.get('/scouting/teams'),
          fetch('https://ddragon.leagueoflegends.com/api/versions.json').then(r => r.json())
        ]);
        setTeams(teamsRes.data);
        if (teamsRes.data.length) setSelectedTeamId(String(teamsRes.data[0].id));

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
    if (!teamId) return;
    try {
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
      setError('Failed to load team flowcharts');
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
      const response = await api.post(`/scouting/teams/${selectedTeamId}/flowcharts`, payload);
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
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}

      {teams.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>
          <h3>No enemy teams yet</h3>
          <p>Flowcharts are planned against a specific opponent. Add a team on the Scouting page first.</p>
        </div>
      ) : (
        <FlowchartCanvas
          key={selectedTeamId}
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
      )}

      <ConfirmDialog {...confirmDialogProps} />
    </PageBackground>
  );
}

export default Flowcharts;
