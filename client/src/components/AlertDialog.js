import React from 'react';
import ReactDOM from 'react-dom';

function AlertDialog({ open, title, message, buttonText = 'OK', variant = 'error', onClose }) {
  if (!open) return null;

  const iconMap = {
    error: '⚠️',
    info: 'ℹ️',
    success: '✅'
  };

  return ReactDOM.createPortal(
    <div className="confirm-dialog-backdrop" onClick={onClose}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="confirm-dialog-title">
          {iconMap[variant] || ''} {title || (variant === 'error' ? 'Error' : 'Notice')}
        </h3>
        <p className="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-actions">
          <button className="confirm-dialog-btn confirm-dialog-btn-primary" onClick={onClose}>
            {buttonText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default AlertDialog;
