import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import VideoBackground from '../components/VideoBackground';
import ConfirmDialog from '../components/ConfirmDialog';
import { useConfirm } from '../hooks/useConfirm';

function Announcements() {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const { confirm, confirmDialogProps } = useConfirm();

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  const fetchAnnouncements = async () => {
    try {
      const response = await api.get('/announcements');
      setAnnouncements(response.data);
    } catch (err) {
      setError('Failed to load announcements');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setError('Title and content are required');
      return;
    }

    setError('');

    try {
      const response = await api.post('/announcements', { title, content });
      setAnnouncements([response.data, ...announcements]);
      setTitle('');
      setContent('');
      setShowForm(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create announcement');
    }
  };

  const handleDelete = async (id) => {
    const confirmed = await confirm('Are you sure you want to delete this announcement?', {
      title: 'Delete Announcement',
      confirmText: 'Delete'
    });
    if (!confirmed) return;

    try {
      await api.delete(`/announcements/${id}`);
      setAnnouncements(announcements.filter(a => a.id !== id));
    } catch (err) {
      setError('Failed to delete announcement');
    }
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const isAdmin = user?.role === 'admin';

  if (loading) return <div className="loading">Loading announcements...</div>;

  return (
    <VideoBackground videoSrc="/videos/DragonsLoop.mp4">
      <div className="announcements-page">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
          <h1>Announcements</h1>
        {isAdmin && !showForm && (
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            + New Announcement
          </button>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {showForm && isAdmin && (
        <div className="card mb-3">
          <h3 className="card-title">New Announcement</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Announcement title..."
              />
            </div>
            <div className="form-group">
              <label>Content</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your announcement..."
                style={{minHeight: '150px'}}
              />
            </div>
            <div style={{display: 'flex', gap: '0.5rem'}}>
              <button type="submit" className="btn btn-primary">Post</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {announcements.length === 0 ? (
        <div className="card" style={{textAlign: 'center', padding: '3rem'}}>
          <p>No announcements yet.</p>
          {isAdmin && (
            <p style={{color: 'var(--text-secondary)', marginTop: '1rem'}}>
              Click "New Announcement" to post the first one.
            </p>
          )}
        </div>
      ) : (
        announcements.map(announcement => (
          <div key={announcement.id} className="card announcement-card">
            <div className="card-header">
              <h3 className="card-title">{announcement.title}</h3>
              {isAdmin && (
                <button
                  className="btn btn-danger btn-small"
                  onClick={() => handleDelete(announcement.id)}
                >
                  Delete
                </button>
              )}
            </div>
            <div style={{whiteSpace: 'pre-wrap', lineHeight: '1.8'}}>
              {announcement.content}
            </div>
            <div className="announcement-meta">
              <span>Posted by {announcement.author_name || 'Admin'}</span>
              <span>{formatDate(announcement.created_at)}</span>
            </div>
          </div>
          ))
        )}
      </div>
      <ConfirmDialog {...confirmDialogProps} />
    </VideoBackground>
  );
}

export default Announcements;
