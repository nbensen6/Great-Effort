import { useState, useCallback, useRef } from 'react';

export function useConfirm() {
  const [state, setState] = useState({ open: false, title: '', message: '', variant: 'danger' });
  const resolveRef = useRef(null);

  const confirm = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        open: true,
        message,
        title: options.title || 'Confirm',
        variant: options.variant || 'danger',
        confirmText: options.confirmText || 'Delete',
        cancelText: options.cancelText || 'Cancel',
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    resolveRef.current = null;
    setState(s => ({ ...s, open: false }));
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    resolveRef.current = null;
    setState(s => ({ ...s, open: false }));
  }, []);

  return {
    confirm,
    confirmDialogProps: {
      open: state.open,
      title: state.title,
      message: state.message,
      variant: state.variant,
      confirmText: state.confirmText,
      cancelText: state.cancelText,
      onConfirm: handleConfirm,
      onCancel: handleCancel
    }
  };
}

export function useAlert() {
  const [state, setState] = useState({ open: false, title: '', message: '', variant: 'error' });
  const resolveRef = useRef(null);

  const showAlert = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        open: true,
        message,
        title: options.title || '',
        variant: options.variant || 'error',
      });
    });
  }, []);

  const handleClose = useCallback(() => {
    resolveRef.current?.();
    resolveRef.current = null;
    setState(s => ({ ...s, open: false }));
  }, []);

  return {
    showAlert,
    alertDialogProps: {
      open: state.open,
      title: state.title,
      message: state.message,
      variant: state.variant,
      onClose: handleClose
    }
  };
}
