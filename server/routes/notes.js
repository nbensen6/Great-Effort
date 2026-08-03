const express = require('express');
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all notes for user
router.get('/', authenticateToken, (req, res) => {
  try {
    const notes = db.prepare(`
      SELECT * FROM notes
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(req.user.id);

    res.json(notes);
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// Create a note
router.post('/', authenticateToken, (req, res) => {
  try {
    const { title, content, category } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const result = db.prepare(`
      INSERT INTO notes (user_id, title, content, category)
      VALUES (?, ?, ?, ?)
    `).run(req.user.id, title, content || '', category || 'General');

    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json(note);
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// Update a note
router.put('/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, category } = req.body;

    // Verify ownership
    const note = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    db.prepare(`
      UPDATE notes
      SET title = ?, content = ?, category = ?
      WHERE id = ?
    `).run(title || note.title, content || note.content, category || note.category, id);

    const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    res.json(updated);
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Delete a note
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const note = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Get champion notes for user
router.get('/champion', authenticateToken, (req, res) => {
  try {
    const notes = db.prepare(`
      SELECT * FROM champion_notes
      WHERE user_id = ?
    `).all(req.user.id);

    res.json(notes);
  } catch (error) {
    console.error('Error fetching champion notes:', error);
    res.status(500).json({ error: 'Failed to fetch champion notes' });
  }
});

// Save champion note
router.post('/champion', authenticateToken, (req, res) => {
  try {
    const { champion_id, notes } = req.body;

    if (!champion_id) {
      return res.status(400).json({ error: 'Champion ID is required' });
    }

    // Upsert
    db.prepare(`
      INSERT INTO champion_notes (user_id, champion_id, notes, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, champion_id)
      DO UPDATE SET notes = ?, updated_at = CURRENT_TIMESTAMP
    `).run(req.user.id, champion_id, notes || '', notes || '');

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving champion note:', error);
    res.status(500).json({ error: 'Failed to save champion note' });
  }
});

module.exports = router;
