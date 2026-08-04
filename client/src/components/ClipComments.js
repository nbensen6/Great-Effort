import React, { useEffect, useState } from 'react';
import api from '../services/api';

// Discussion thread attached to a single clip, so VOD feedback sits next to the
// moment it is about instead of in the note body.
function ClipComments({ clipId }) {
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get(`/notes/clips/${clipId}/comments`)
      .then(r => { if (!cancelled) setComments(r.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clipId]);

  const submit = async (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    setError('');
    try {
      const res = await api.post(`/notes/clips/${clipId}/comments`, { body });
      setComments(prev => [...prev, res.data]);
      setDraft('');
      setOpen(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to post comment');
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/notes/clips/comments/${id}`);
      setComments(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete comment');
    }
  };

  const when = (s) => new Date(s).toLocaleString('en-US',
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <div className="clip-chat">
      <button className="clip-chat-toggle" onClick={() => setOpen(o => !o)}>
        {open ? '▾' : '▸'} Discussion ({comments.length})
      </button>

      {open && (
        <>
          <div className="clip-chat-thread">
            {comments.length === 0 ? (
              <p className="clip-chat-empty">No comments yet.</p>
            ) : comments.map(c => (
              <div key={c.id} className={`clip-chat-msg${c.is_mine ? ' mine' : ''}`}>
                <div className="clip-chat-meta">
                  <strong>{c.is_mine ? 'You' : (c.author_name || 'Unknown')}</strong>
                  <span>{when(c.created_at)}</span>
                  {c.is_mine && (
                    <button className="clip-chat-del" title="Delete"
                      onClick={() => remove(c.id)}>&times;</button>
                  )}
                </div>
                <div className="clip-chat-body">{c.body}</div>
              </div>
            ))}
          </div>

          {error && <div className="clip-chat-error">{error}</div>}

          <form className="clip-chat-form" onSubmit={submit}>
            <input
              type="text"
              value={draft}
              maxLength={2000}
              placeholder="Add a comment..."
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="btn btn-primary btn-small"
              disabled={posting || !draft.trim()}>
              {posting ? '...' : 'Post'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

export default ClipComments;
