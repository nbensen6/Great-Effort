import React, { useState, useEffect } from 'react';
import api from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import { useConfirm } from '../hooks/useConfirm';

const CATEGORIES = ['General', 'Champion', 'Matchup', 'Scrim', 'Strategy'];

function Notes() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedNote, setSelectedNote] = useState(null);
  const [isEditing, setIsEditing] = useState(false);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('General');
  const { confirm, confirmDialogProps } = useConfirm();

  const [clips, setClips] = useState([]);
  const [uploadingClip, setUploadingClip] = useState(false);
  const [storage, setStorage] = useState(null);

  const isVideo = (name) => /\.(mp4|webm)$/i.test(name || '');
  const formatSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

  useEffect(() => {
    fetchNotes();
    api.get('/notes/clips/storage').then(r => setStorage(r.data)).catch(() => {});
  }, []);

  // Clips live on a note, so they reload whenever the selection changes.
  useEffect(() => {
    if (!selectedNote?.id) { setClips([]); return; }
    api.get(`/notes/${selectedNote.id}/clips`)
      .then(r => setClips(r.data))
      .catch(() => setClips([]));
  }, [selectedNote?.id]);

  const handleUploadClip = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedNote?.id) return;

    setUploadingClip(true);
    setError('');
    try {
      const form = new FormData();
      form.append('clip', file);
      const res = await api.post(`/notes/${selectedNote.id}/clips`, form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setClips(prev => [res.data, ...prev]);
      api.get('/notes/clips/storage').then(r => setStorage(r.data)).catch(() => {});
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload clip');
    } finally {
      setUploadingClip(false);
    }
  };

  const handleDeleteClip = async (clip) => {
    const confirmed = await confirm(`Delete "${clip.original_name}"?`, {
      title: 'Delete Clip', confirmText: 'Delete'
    });
    if (!confirmed) return;
    try {
      await api.delete(`/notes/clips/${clip.id}`);
      setClips(prev => prev.filter(c => c.id !== clip.id));
      api.get('/notes/clips/storage').then(r => setStorage(r.data)).catch(() => {});
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete clip');
    }
  };

  const fetchNotes = async () => {
    try {
      const response = await api.get('/notes');
      setNotes(response.data);
    } catch (err) {
      setError('Failed to load notes');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectNote = (note) => {
    setSelectedNote(note);
    setTitle(note.title);
    setContent(note.content);
    setCategory(note.category);
    setIsEditing(false);
  };

  const handleNewNote = () => {
    setSelectedNote(null);
    setTitle('');
    setContent('');
    setCategory('General');
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    setError('');

    try {
      if (selectedNote) {
        await api.put(`/notes/${selectedNote.id}`, { title, content, category });
        setNotes(notes.map(n => n.id === selectedNote.id ? { ...n, title, content, category } : n));
        setSelectedNote({ ...selectedNote, title, content, category });
      } else {
        const response = await api.post('/notes', { title, content, category });
        const newNote = response.data;
        setNotes([newNote, ...notes]);
        setSelectedNote(newNote);
      }
      setIsEditing(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save note');
    }
  };

  const handleDelete = async () => {
    if (!selectedNote) return;
    const confirmed = await confirm('Are you sure you want to delete this note?', {
      title: 'Delete Note',
      confirmText: 'Delete'
    });
    if (!confirmed) return;

    try {
      await api.delete(`/notes/${selectedNote.id}`);
      setNotes(notes.filter(n => n.id !== selectedNote.id));
      setSelectedNote(null);
      setTitle('');
      setContent('');
      setIsEditing(false);
    } catch (err) {
      setError('Failed to delete note');
    }
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  if (loading) return <div className="loading">Loading notes...</div>;

  return (
    <div className="notes-page">
      <h1 style={{marginBottom: '1.5rem'}}>My Notes</h1>

      {error && <div className="error">{error}</div>}

      <div className="notes-container">
        <div className="notes-sidebar card">
          <div className="card-header">
            <h3 className="card-title">Notes</h3>
            <button className="btn btn-primary btn-small" onClick={handleNewNote}>
              + New
            </button>
          </div>

          <div className="notes-list">
            {notes.length === 0 ? (
              <p style={{padding: '1rem', color: 'var(--text-secondary)'}}>
                No notes yet. Click "New" to create one.
              </p>
            ) : (
              notes.map(note => (
                <div
                  key={note.id}
                  className={`note-item ${selectedNote?.id === note.id ? 'active' : ''}`}
                  onClick={() => handleSelectNote(note)}
                >
                  <h4>{note.title}</h4>
                  <small>
                    <span className={`note-author${note.is_mine ? ' mine' : ''}`}>
                      {note.is_mine ? 'You' : (note.author_name || 'Unknown')}
                    </span>
                    {note.category} - {formatDate(note.created_at)}
                  </small>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="note-editor card">
          {selectedNote || isEditing ? (
            <>
              <div className="card-header">
                <div>
                  {isEditing ? (
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Note title..."
                      style={{
                        fontSize: '1.25rem',
                        fontWeight: 'bold',
                        background: 'transparent',
                        border: 'none',
                        borderBottom: '2px solid var(--accent-gold)',
                        color: 'var(--text-primary)',
                        padding: '0.5rem 0',
                        width: '100%'
                      }}
                    />
                  ) : (
                    <h3 className="card-title">{selectedNote?.title}</h3>
                  )}
                </div>
                <div style={{display: 'flex', gap: '0.5rem'}}>
                  {isEditing ? (
                    <>
                      <button className="btn btn-primary btn-small" onClick={handleSave}>
                        Save
                      </button>
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => {
                          if (selectedNote) {
                            handleSelectNote(selectedNote);
                          } else {
                            setIsEditing(false);
                          }
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    // Everyone can read the team's notes; only the author edits.
                    selectedNote && selectedNote.is_mine === false ? (
                      <span className="note-readonly">
                        {selectedNote.author_name || 'Someone else'}'s note
                      </span>
                    ) : (
                    <>
                      <button className="btn btn-secondary btn-small" onClick={() => setIsEditing(true)}>
                        Edit
                      </button>
                      <button className="btn btn-danger btn-small" onClick={handleDelete}>
                        Delete
                      </button>
                    </>
                    )
                  )}
                </div>
              </div>

              {isEditing && (
                <div className="form-group" style={{marginBottom: '1rem'}}>
                  <label>Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={{maxWidth: '200px'}}
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              )}

              {isEditing ? (
                <textarea
                  className="form-group"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Write your note here... (Markdown supported)"
                  style={{width: '100%', minHeight: '400px', padding: '1rem', resize: 'vertical'}}
                />
              ) : (
                <div style={{whiteSpace: 'pre-wrap', lineHeight: '1.8'}}>
                  {selectedNote?.content || <em style={{color: 'var(--text-secondary)'}}>No content</em>}
                </div>
              )}

              {!isEditing && selectedNote && (
                <div className="note-clips">
                  <div className="note-clips-head">
                    <h4>Clips &amp; images</h4>
                    <div className="note-clips-actions">
                      {storage && (
                        <span className="note-clips-storage">
                          {formatSize(storage.usedBytes)} of {formatSize(storage.budgetBytes)} used
                        </span>
                      )}
                      <input
                        type="file"
                        id="clipUpload"
                        accept="video/mp4,video/webm,image/*"
                        style={{ display: 'none' }}
                        onChange={handleUploadClip}
                      />
                      <button
                        className="btn btn-primary btn-small"
                        disabled={uploadingClip}
                        onClick={() => document.getElementById('clipUpload').click()}
                      >
                        {uploadingClip ? 'Uploading...' : '+ Add clip'}
                      </button>
                    </div>
                  </div>

                  {clips.length === 0 ? (
                    <p className="note-clips-empty">
                      No clips yet. Attach a short mp4/webm (up to 40MB) or a screenshot.
                    </p>
                  ) : (
                    <div className="note-clips-grid">
                      {clips.map(clip => (
                        <div key={clip.id} className="note-clip-card">
                          {isVideo(clip.filename) ? (
                            <video src={`/api/notes/clips/file/${clip.filename}`} controls preload="metadata" />
                          ) : (
                            <img src={`/api/notes/clips/file/${clip.filename}`} alt={clip.original_name} />
                          )}
                          <div className="note-clip-meta">
                            <span title={clip.original_name}>{clip.original_name}</span>
                            <small>
                              {clip.is_mine ? 'You' : clip.author_name} · {formatSize(clip.size_bytes)}
                            </small>
                          </div>
                          {clip.is_mine && (
                            <button className="btn btn-danger btn-small"
                              onClick={() => handleDeleteClip(clip)}>Delete</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!isEditing && selectedNote && (
                <div style={{marginTop: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)'}}>
                  Category: {selectedNote.category} | Created: {formatDate(selectedNote.created_at)}
                </div>
              )}
            </>
          ) : (
            <div style={{textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)'}}>
              <p>Select a note from the list or create a new one.</p>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}

export default Notes;
