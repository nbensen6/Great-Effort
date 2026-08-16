const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.NODE_ENV === 'production'
      ? '/data/uploads'
      : path.join(__dirname, '../uploads');

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'scout-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const { MAX_UPLOAD_BYTES, enforceStorageBudget, storageStatus } = require('../lib/uploads');

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|webm/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    // Browsers send video/mp4 and video/webm; the regex matches the subtype.
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only images (jpg, png, gif, webp) and short clips (mp4, webm) are allowed'));
  }
});

// Get all enemy teams
router.get('/teams', authenticateToken, (req, res) => {
  try {
    const teams = db.prepare(`
      SELECT et.*,
        (SELECT COUNT(*) FROM scouting_notes WHERE team_id = et.id) as notes_count,
        (SELECT COUNT(*) FROM scouting_images WHERE team_id = et.id) as images_count
      FROM enemy_teams et
      ORDER BY et.sort_order ASC, et.updated_at DESC
    `).all();

    res.json(teams);
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

// Create enemy team
router.post('/teams', authenticateToken, (req, res) => {
  try {
    const { name, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Team name is required' });
    }

    const result = db.prepare(`
      INSERT INTO enemy_teams (name, notes)
      VALUES (?, ?)
    `).run(name, notes || '');

    const team = db.prepare('SELECT * FROM enemy_teams WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(team);
  } catch (error) {
    console.error('Error creating team:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// Reorder teams (must be before /teams/:id to avoid param match)
router.put('/teams/reorder', authenticateToken, (req, res) => {
  try {
    const { order } = req.body;
    if (!order || !Array.isArray(order)) {
      return res.status(400).json({ error: 'Order array is required' });
    }

    const update = db.prepare('UPDATE enemy_teams SET sort_order = ? WHERE id = ?');
    const reorder = db.transaction((ids) => {
      ids.forEach((id, index) => update.run(index, id));
    });
    reorder(order);

    res.json({ success: true });
  } catch (error) {
    console.error('Error reordering teams:', error);
    res.status(500).json({ error: 'Failed to reorder teams' });
  }
});

// Update enemy team
router.put('/teams/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { name, notes } = req.body;

    const team = db.prepare('SELECT * FROM enemy_teams WHERE id = ?').get(id);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    db.prepare(`
      UPDATE enemy_teams
      SET name = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name || team.name, notes !== undefined ? notes : team.notes, id);

    const updated = db.prepare('SELECT * FROM enemy_teams WHERE id = ?').get(id);
    res.json(updated);
  } catch (error) {
    console.error('Error updating team:', error);
    res.status(500).json({ error: 'Failed to update team' });
  }
});

// Delete enemy team
router.delete('/teams/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;

    // Delete associated images from filesystem
    const images = db.prepare('SELECT filename FROM scouting_images WHERE team_id = ?').all(id);
    const uploadDir = process.env.NODE_ENV === 'production'
      ? '/data/uploads'
      : path.join(__dirname, '../uploads');

    images.forEach(img => {
      const filepath = path.join(uploadDir, img.filename);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    });

    db.prepare('DELETE FROM enemy_teams WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting team:', error);
    res.status(500).json({ error: 'Failed to delete team' });
  }
});

// Upload team logo
router.post('/teams/:teamId/logo', authenticateToken, upload.single('logo'), enforceStorageBudget, (req, res) => {
  try {
    const { teamId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const team = db.prepare('SELECT * FROM enemy_teams WHERE id = ?').get(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // Delete old logo file if exists
    if (team.logo_filename) {
      const uploadDir = process.env.NODE_ENV === 'production'
        ? '/data/uploads'
        : path.join(__dirname, '../uploads');
      const oldPath = path.join(uploadDir, team.logo_filename);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    db.prepare('UPDATE enemy_teams SET logo_filename = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(req.file.filename, teamId);

    const updated = db.prepare('SELECT * FROM enemy_teams WHERE id = ?').get(teamId);
    res.json(updated);
  } catch (error) {
    console.error('Error uploading logo:', error);
    res.status(500).json({ error: 'Failed to upload logo' });
  }
});

// Delete team logo
router.delete('/teams/:teamId/logo', authenticateToken, (req, res) => {
  try {
    const { teamId } = req.params;

    const team = db.prepare('SELECT * FROM enemy_teams WHERE id = ?').get(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (team.logo_filename) {
      const uploadDir = process.env.NODE_ENV === 'production'
        ? '/data/uploads'
        : path.join(__dirname, '../uploads');
      const filepath = path.join(uploadDir, team.logo_filename);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    }

    db.prepare('UPDATE enemy_teams SET logo_filename = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(teamId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting logo:', error);
    res.status(500).json({ error: 'Failed to delete logo' });
  }
});

// Get notes for a team
router.get('/teams/:teamId/notes', authenticateToken, (req, res) => {
  try {
    const { teamId } = req.params;
    const notes = db.prepare(`
      SELECT sn.*, u.username as author_name
      FROM scouting_notes sn
      LEFT JOIN users u ON sn.user_id = u.id
      WHERE sn.team_id = ?
      ORDER BY sn.created_at DESC
    `).all(teamId);

    res.json(notes);
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// Create note for a team
router.post('/teams/:teamId/notes', authenticateToken, (req, res) => {
  try {
    const { teamId } = req.params;
    const { title, content, category } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const result = db.prepare(`
      INSERT INTO scouting_notes (team_id, user_id, title, content, category)
      VALUES (?, ?, ?, ?, ?)
    `).run(teamId, req.user.id, title, content || '', category || 'General');

    // Update team's updated_at
    db.prepare('UPDATE enemy_teams SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(teamId);

    const note = db.prepare(`
      SELECT sn.*, u.username as author_name
      FROM scouting_notes sn
      LEFT JOIN users u ON sn.user_id = u.id
      WHERE sn.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(note);
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// Update note
router.put('/notes/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, category } = req.body;

    const note = db.prepare('SELECT * FROM scouting_notes WHERE id = ?').get(id);
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    db.prepare(`
      UPDATE scouting_notes
      SET title = ?, content = ?, category = ?
      WHERE id = ?
    `).run(title || note.title, content !== undefined ? content : note.content, category || note.category, id);

    const updated = db.prepare(`
      SELECT sn.*, u.username as author_name
      FROM scouting_notes sn
      LEFT JOIN users u ON sn.user_id = u.id
      WHERE sn.id = ?
    `).get(id);

    res.json(updated);
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Delete note
router.delete('/notes/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM scouting_notes WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Get images for a team
router.get('/teams/:teamId/images', authenticateToken, (req, res) => {
  try {
    const { teamId } = req.params;
    const images = db.prepare(`
      SELECT si.*, u.username as uploaded_by
      FROM scouting_images si
      LEFT JOIN users u ON si.user_id = u.id
      WHERE si.team_id = ?
      ORDER BY si.created_at DESC
    `).all(teamId);

    res.json(images);
  } catch (error) {
    console.error('Error fetching images:', error);
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

// Upload image for a team
router.post('/teams/:teamId/images', authenticateToken, upload.single('image'), enforceStorageBudget, (req, res) => {
  try {
    const { teamId } = req.params;
    const { description } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const result = db.prepare(`
      INSERT INTO scouting_images (team_id, user_id, filename, original_name, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(teamId, req.user.id, req.file.filename, req.file.originalname, description || '');

    // Update team's updated_at
    db.prepare('UPDATE enemy_teams SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(teamId);

    const image = db.prepare(`
      SELECT si.*, u.username as uploaded_by
      FROM scouting_images si
      LEFT JOIN users u ON si.user_id = u.id
      WHERE si.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(image);
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Delete image
router.delete('/images/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;

    const image = db.prepare('SELECT * FROM scouting_images WHERE id = ?').get(id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Delete file from filesystem
    const uploadDir = process.env.NODE_ENV === 'production'
      ? '/data/uploads'
      : path.join(__dirname, '../uploads');
    const filepath = path.join(uploadDir, image.filename);

    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }

    db.prepare('DELETE FROM scouting_images WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Serve uploaded images
router.get('/uploads/:filename', (req, res) => {
  const { filename } = req.params;
  const uploadDir = process.env.NODE_ENV === 'production'
    ? '/data/uploads'
    : path.join(__dirname, '../uploads');
  const filepath = path.join(uploadDir, filename);

  if (fs.existsSync(filepath)) {
    res.sendFile(filepath);
  } else {
    res.status(404).json({ error: 'Image not found' });
  }
});

// ============= ENEMY PLAYERS =============

// Get all players for a team
router.get('/teams/:teamId/players', authenticateToken, (req, res) => {
  try {
    const { teamId } = req.params;
    const players = db.prepare(`
      SELECT * FROM enemy_players
      WHERE team_id = ?
      ORDER BY CASE role
        WHEN 'Top' THEN 1 WHEN 'Jungle' THEN 2 WHEN 'Mid' THEN 3
        WHEN 'ADC' THEN 4 WHEN 'Support' THEN 5 ELSE 6
      END, created_at ASC
    `).all(teamId);

    res.json(players);
  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(500).json({ error: 'Failed to fetch players' });
  }
});

// Batch insert players for a team (replaces existing)
router.post('/teams/:teamId/players', authenticateToken, (req, res) => {
  try {
    const { teamId } = req.params;
    const { players } = req.body;

    if (!players || !Array.isArray(players)) {
      return res.status(400).json({ error: 'Players array is required' });
    }

    // Delete existing players for this team
    db.prepare('DELETE FROM enemy_players WHERE team_id = ?').run(teamId);

    const insert = db.prepare(`
      INSERT INTO enemy_players (team_id, game_name, tag_line, region, puuid, role, rank_tier, rank_division, rank_lp, rank_wins, rank_losses, profile_icon_id, top_champions, champion_mastery, detected_role, last_fetched)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const insertMany = db.transaction((players) => {
      for (const p of players) {
        insert.run(
          teamId,
          p.gameName,
          p.tagLine,
          p.region || 'na',
          p.puuid || null,
          p.role || p.detectedRole || null,
          p.rankTier || null,
          p.rankDivision || null,
          p.rankLp || null,
          p.rankWins ?? null,
          p.rankLosses ?? null,
          p.profileIconId || null,
          p.topChampions ? JSON.stringify(p.topChampions) : null,
          p.championMastery ? JSON.stringify(p.championMastery) : null,
          p.detectedRole || null
        );
      }
    });

    insertMany(players);

    // Update team's updated_at
    db.prepare('UPDATE enemy_teams SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(teamId);

    const saved = db.prepare('SELECT * FROM enemy_players WHERE team_id = ? ORDER BY id ASC').all(teamId);
    res.status(201).json(saved);
  } catch (error) {
    console.error('Error saving players:', error);
    res.status(500).json({ error: 'Failed to save players' });
  }
});

// Update a player's role
router.patch('/players/:id/role', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    db.prepare('UPDATE enemy_players SET role = ? WHERE id = ?').run(role, id);

    const updated = db.prepare('SELECT * FROM enemy_players WHERE id = ?').get(id);
    if (!updated) {
      return res.status(404).json({ error: 'Player not found' });
    }
    res.json(updated);
  } catch (error) {
    console.error('Error updating player role:', error);
    res.status(500).json({ error: 'Failed to update player role' });
  }
});

// Delete a player
router.delete('/players/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM enemy_players WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting player:', error);
    res.status(500).json({ error: 'Failed to delete player' });
  }
});

// ============= SAVED DRAFTS =============

// Get all saved drafts for a team
router.get('/teams/:teamId/drafts', authenticateToken, (req, res) => {
  try {
    const { teamId } = req.params;
    const drafts = db.prepare(`
      SELECT sd.*, u.username as author_name
      FROM saved_drafts sd
      LEFT JOIN users u ON sd.user_id = u.id
      WHERE sd.team_id = ?
      ORDER BY sd.created_at DESC
    `).all(teamId);

    res.json(drafts);
  } catch (error) {
    console.error('Error fetching drafts:', error);
    res.status(500).json({ error: 'Failed to fetch drafts' });
  }
});

// Save a draft for a team
router.post('/teams/:teamId/drafts', authenticateToken, (req, res) => {
  try {
    const { teamId } = req.params;
    const { name, blue_picks, red_picks, blue_bans, red_bans, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Draft name is required' });
    }

    const result = db.prepare(`
      INSERT INTO saved_drafts (team_id, user_id, name, blue_picks, red_picks, blue_bans, red_bans, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      teamId,
      req.user.id,
      name,
      JSON.stringify(blue_picks || []),
      JSON.stringify(red_picks || []),
      JSON.stringify(blue_bans || []),
      JSON.stringify(red_bans || []),
      notes || ''
    );

    // Update team's updated_at
    db.prepare('UPDATE enemy_teams SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(teamId);

    const draft = db.prepare(`
      SELECT sd.*, u.username as author_name
      FROM saved_drafts sd
      LEFT JOIN users u ON sd.user_id = u.id
      WHERE sd.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(draft);
  } catch (error) {
    console.error('Error saving draft:', error);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

// Delete a saved draft
router.delete('/drafts/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM saved_drafts WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting draft:', error);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
});

// ============= DRAFT FLOWCHARTS =============

// A flowchart always travels with the list of teams it is attached to, so the
// UI can show "used against X, Y" without a second round trip.
const selectFlowchart = db.prepare(`
  SELECT df.*, u.username as author_name
  FROM draft_flowcharts df
  LEFT JOIN users u ON df.user_id = u.id
  WHERE df.id = ?
`);

const selectFlowchartTeams = db.prepare(`
  SELECT et.id, et.name, et.logo_filename
  FROM flowchart_teams ft
  JOIN enemy_teams et ON et.id = ft.team_id
  WHERE ft.flowchart_id = ?
  ORDER BY et.sort_order ASC, et.name ASC
`);

const withTeams = (flowchart) => {
  if (!flowchart) return flowchart;
  return { ...flowchart, teams: selectFlowchartTeams.all(flowchart.id) };
};

// Get the whole flowchart library, newest edit first
router.get('/flowcharts', authenticateToken, (req, res) => {
  try {
    const flowcharts = db.prepare(`
      SELECT df.*, u.username as author_name
      FROM draft_flowcharts df
      LEFT JOIN users u ON df.user_id = u.id
      ORDER BY df.updated_at DESC
    `).all();

    res.json(flowcharts.map(withTeams));
  } catch (error) {
    console.error('Error fetching flowcharts:', error);
    res.status(500).json({ error: 'Failed to fetch flowcharts' });
  }
});

// Create a standalone flowchart, optionally attached to teams straight away
router.post('/flowcharts', authenticateToken, (req, res) => {
  try {
    const { name, data, teamIds } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Flowchart name is required' });
    }

    const result = db.prepare(`
      INSERT INTO draft_flowcharts (user_id, name, data)
      VALUES (?, ?, ?)
    `).run(req.user.id, name, JSON.stringify(data || { nodes: [], edges: [] }));

    const flowchartId = result.lastInsertRowid;
    if (Array.isArray(teamIds) && teamIds.length) {
      const attach = db.prepare('INSERT OR IGNORE INTO flowchart_teams (flowchart_id, team_id) VALUES (?, ?)');
      db.transaction((ids) => ids.forEach(id => attach.run(flowchartId, id)))(teamIds);
    }

    res.status(201).json(withTeams(selectFlowchart.get(flowchartId)));
  } catch (error) {
    console.error('Error creating flowchart:', error);
    res.status(500).json({ error: 'Failed to create flowchart' });
  }
});

// Get the flowcharts attached to a team
router.get('/teams/:teamId/flowcharts', authenticateToken, (req, res) => {
  try {
    const { teamId } = req.params;
    const flowcharts = db.prepare(`
      SELECT df.*, u.username as author_name
      FROM draft_flowcharts df
      JOIN flowchart_teams ft ON ft.flowchart_id = df.id
      LEFT JOIN users u ON df.user_id = u.id
      WHERE ft.team_id = ?
      ORDER BY df.updated_at DESC
    `).all(teamId);

    res.json(flowcharts.map(withTeams));
  } catch (error) {
    console.error('Error fetching flowcharts:', error);
    res.status(500).json({ error: 'Failed to fetch flowcharts' });
  }
});

// Create a flowchart already attached to one team
router.post('/teams/:teamId/flowcharts', authenticateToken, (req, res) => {
  try {
    const { teamId } = req.params;
    const { name, data } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Flowchart name is required' });
    }

    const team = db.prepare('SELECT id FROM enemy_teams WHERE id = ?').get(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const flowchartId = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO draft_flowcharts (user_id, name, data)
        VALUES (?, ?, ?)
      `).run(req.user.id, name, JSON.stringify(data || { nodes: [], edges: [] }));

      db.prepare('INSERT OR IGNORE INTO flowchart_teams (flowchart_id, team_id) VALUES (?, ?)')
        .run(result.lastInsertRowid, teamId);
      db.prepare('UPDATE enemy_teams SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(teamId);

      return result.lastInsertRowid;
    })();

    res.status(201).json(withTeams(selectFlowchart.get(flowchartId)));
  } catch (error) {
    console.error('Error creating flowchart:', error);
    res.status(500).json({ error: 'Failed to create flowchart' });
  }
});

// Attach an existing flowchart to a team (the "import" action)
router.post('/teams/:teamId/flowcharts/:flowchartId', authenticateToken, (req, res) => {
  try {
    const { teamId, flowchartId } = req.params;

    const team = db.prepare('SELECT id FROM enemy_teams WHERE id = ?').get(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    const flowchart = selectFlowchart.get(flowchartId);
    if (!flowchart) {
      return res.status(404).json({ error: 'Flowchart not found' });
    }

    db.prepare('INSERT OR IGNORE INTO flowchart_teams (flowchart_id, team_id) VALUES (?, ?)')
      .run(flowchartId, teamId);

    res.json(withTeams(flowchart));
  } catch (error) {
    console.error('Error attaching flowchart:', error);
    res.status(500).json({ error: 'Failed to attach flowchart' });
  }
});

// Detach a flowchart from a team. The flowchart itself is untouched.
router.delete('/teams/:teamId/flowcharts/:flowchartId', authenticateToken, (req, res) => {
  try {
    const { teamId, flowchartId } = req.params;

    db.prepare('DELETE FROM flowchart_teams WHERE flowchart_id = ? AND team_id = ?')
      .run(flowchartId, teamId);

    const flowchart = selectFlowchart.get(flowchartId);
    res.json(flowchart ? withTeams(flowchart) : { success: true });
  } catch (error) {
    console.error('Error detaching flowchart:', error);
    res.status(500).json({ error: 'Failed to detach flowchart' });
  }
});

// Update flowchart
router.put('/flowcharts/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { name, data } = req.body;

    const flowchart = db.prepare('SELECT * FROM draft_flowcharts WHERE id = ?').get(id);
    if (!flowchart) {
      return res.status(404).json({ error: 'Flowchart not found' });
    }

    db.prepare(`
      UPDATE draft_flowcharts
      SET name = ?, data = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name || flowchart.name,
      data ? JSON.stringify(data) : flowchart.data,
      id
    );

    res.json(withTeams(selectFlowchart.get(id)));
  } catch (error) {
    console.error('Error updating flowchart:', error);
    res.status(500).json({ error: 'Failed to update flowchart' });
  }
});

// Delete flowchart
router.delete('/flowcharts/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM draft_flowcharts WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting flowchart:', error);
    res.status(500).json({ error: 'Failed to delete flowchart' });
  }
});

// Upload storage usage, so the UI can show how much room is left for clips.
router.get('/storage', authenticateToken, (req, res) => {
  res.json(storageStatus());
});

module.exports = router;
