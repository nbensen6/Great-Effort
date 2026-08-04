const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database/db');
const jwt = require('jsonwebtoken');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');
const {
  uploadDir, MAX_UPLOAD_BYTES, enforceStorageBudget, storageStatus
} = require('../lib/uploads');

const router = express.Router();

const clipStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, 'clip-' + Date.now() + '-' + Math.round(Math.random() * 1e9) +
       path.extname(file.originalname).toLowerCase());
  }
});

const CLIP_TYPES = /mp4|webm|jpeg|jpg|png|gif|webp/;
const uploadClip = multer({
  storage: clipStorage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = CLIP_TYPES.test(path.extname(file.originalname).toLowerCase());
    const mime = CLIP_TYPES.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Only clips (mp4, webm) and images (jpg, png, gif, webp) are allowed'));
  }
});

// Notes are shared across the team so everyone can read each other's prep.
// Writing stays owner-only: create sets user_id from the token, and update and
// delete both check ownership below.
router.get('/', authenticateToken, (req, res) => {
  try {
    const notes = db.prepare(`
      SELECT n.*, u.username AS author_name
      FROM notes n
      LEFT JOIN users u ON n.user_id = u.id
      ORDER BY n.created_at DESC
    `).all();

    res.json(notes.map(n => ({ ...n, is_mine: n.user_id === req.user.id })));
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

// ============= NOTE CLIPS =============

// Serve an uploaded clip.
//
// <video src> and <img src> are plain browser requests and cannot carry an
// Authorization header, so this route also accepts the same JWT as a query
// parameter. Everything else in the API stays header-only.
function authenticateMedia(req, res, next) {
  if (req.headers.authorization) return authenticateToken(req, res, next);

  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (e) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

router.get('/clips/file/:filename', authenticateMedia, (req, res) => {
  // Reject anything that could escape the upload directory.
  const name = path.basename(req.params.filename);
  const filepath = path.join(uploadDir, name);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(filepath);
});

// How much upload room is left, so the UI can warn before it runs out.
router.get('/clips/storage', authenticateToken, (req, res) => {
  res.json(storageStatus());
});

router.get('/:id/clips', authenticateToken, (req, res) => {
  try {
    const clips = db.prepare(`
      SELECT c.*, u.username AS author_name
      FROM note_clips c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.note_id = ?
      ORDER BY c.created_at DESC
    `).all(req.params.id);
    res.json(clips.map(c => ({ ...c, is_mine: c.user_id === req.user.id })));
  } catch (error) {
    console.error('Error fetching clips:', error);
    res.status(500).json({ error: 'Failed to fetch clips' });
  }
});

// Anyone on the team can attach a clip to any note, matching how notes are
// readable team-wide; deletion stays with whoever uploaded it.
router.post('/:id/clips', authenticateToken, uploadClip.single('clip'), enforceStorageBudget, (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const note = db.prepare('SELECT id FROM notes WHERE id = ?').get(req.params.id);
    if (!note) {
      try { fs.unlinkSync(path.join(uploadDir, req.file.filename)); } catch (e) {}
      return res.status(404).json({ error: 'Note not found' });
    }

    const result = db.prepare(`
      INSERT INTO note_clips (note_id, user_id, filename, original_name, size_bytes)
      VALUES (?, ?, ?, ?, ?)
    `).run(note.id, req.user.id, req.file.filename, req.file.originalname, req.file.size);

    const clip = db.prepare(`
      SELECT c.*, u.username AS author_name FROM note_clips c
      LEFT JOIN users u ON c.user_id = u.id WHERE c.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json({ ...clip, is_mine: true });
  } catch (error) {
    console.error('Error uploading clip:', error);
    res.status(500).json({ error: 'Failed to upload clip' });
  }
});

router.delete('/clips/:clipId', authenticateToken, (req, res) => {
  try {
    const clip = db.prepare('SELECT * FROM note_clips WHERE id = ?').get(req.params.clipId);
    if (!clip) return res.status(404).json({ error: 'Clip not found' });
    if (clip.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    try { fs.unlinkSync(path.join(uploadDir, clip.filename)); } catch (e) {}
    db.prepare('DELETE FROM note_clips WHERE id = ?').run(clip.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting clip:', error);
    res.status(500).json({ error: 'Failed to delete clip' });
  }
});

// Multer rejects (too large, wrong type) arrive here as errors rather than as
// a normal response, so they need translating into something the UI can show.
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `File is too large. Limit is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`
    });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

module.exports = router;
