const express = require('express');
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all team compositions
router.get('/', authenticateToken, (req, res) => {
  try {
    const comps = db.prepare(`
      SELECT tc.*, u.username as author_name
      FROM team_compositions tc
      LEFT JOIN users u ON tc.user_id = u.id
      ORDER BY tc.created_at DESC
    `).all();

    res.json(comps);
  } catch (error) {
    console.error('Error fetching compositions:', error);
    res.status(500).json({ error: 'Failed to fetch compositions' });
  }
});

// Create a new composition
router.post('/', authenticateToken, (req, res) => {
  try {
    const { name, description, top_champion, jungle_champion, mid_champion, adc_champion, support_champion, tags } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Composition name is required' });
    }

    const result = db.prepare(`
      INSERT INTO team_compositions (user_id, name, description, top_champion, jungle_champion, mid_champion, adc_champion, support_champion, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      name,
      description || '',
      top_champion || null,
      jungle_champion || null,
      mid_champion || null,
      adc_champion || null,
      support_champion || null,
      tags || ''
    );

    const comp = db.prepare(`
      SELECT tc.*, u.username as author_name
      FROM team_compositions tc
      LEFT JOIN users u ON tc.user_id = u.id
      WHERE tc.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(comp);
  } catch (error) {
    console.error('Error creating composition:', error);
    res.status(500).json({ error: 'Failed to create composition' });
  }
});

// Update a composition
router.put('/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, top_champion, jungle_champion, mid_champion, adc_champion, support_champion, tags } = req.body;

    const comp = db.prepare('SELECT * FROM team_compositions WHERE id = ?').get(id);
    if (!comp) {
      return res.status(404).json({ error: 'Composition not found' });
    }

    db.prepare(`
      UPDATE team_compositions
      SET name = ?, description = ?, top_champion = ?, jungle_champion = ?, mid_champion = ?, adc_champion = ?, support_champion = ?, tags = ?
      WHERE id = ?
    `).run(
      name || comp.name,
      description !== undefined ? description : comp.description,
      top_champion !== undefined ? top_champion : comp.top_champion,
      jungle_champion !== undefined ? jungle_champion : comp.jungle_champion,
      mid_champion !== undefined ? mid_champion : comp.mid_champion,
      adc_champion !== undefined ? adc_champion : comp.adc_champion,
      support_champion !== undefined ? support_champion : comp.support_champion,
      tags !== undefined ? tags : comp.tags,
      id
    );

    const updated = db.prepare(`
      SELECT tc.*, u.username as author_name
      FROM team_compositions tc
      LEFT JOIN users u ON tc.user_id = u.id
      WHERE tc.id = ?
    `).get(id);

    res.json(updated);
  } catch (error) {
    console.error('Error updating composition:', error);
    res.status(500).json({ error: 'Failed to update composition' });
  }
});

// Delete a composition
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM team_compositions WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting composition:', error);
    res.status(500).json({ error: 'Failed to delete composition' });
  }
});

// Get composition suggestions based on player champion pools
router.get('/suggestions', authenticateToken, (req, res) => {
  try {
    const players = db.prepare(`
      SELECT * FROM players ORDER BY
        CASE role
          WHEN 'Top' THEN 1
          WHEN 'Jungle' THEN 2
          WHEN 'Mid' THEN 3
          WHEN 'ADC' THEN 4
          WHEN 'Support' THEN 5
          ELSE 6
        END
    `).all();

    // Get each player's champion pool and op.gg data
    const suggestions = players.map(player => ({
      role: player.role,
      summoner_name: player.summoner_name,
      champion_pool: player.champion_pool ? player.champion_pool.split(',').map(c => c.trim()) : [],
      opgg_username: player.opgg_username,
      opgg_region: player.opgg_region
    }));

    res.json(suggestions);
  } catch (error) {
    console.error('Error getting suggestions:', error);
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

module.exports = router;
