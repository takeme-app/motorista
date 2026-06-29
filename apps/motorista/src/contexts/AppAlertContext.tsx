import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AppAlertModal } from '../components/AppAlertModal';

type ShowAlertOptions = { buttonLabel?: string; onClose?: () => void };
type ShowConfirmOptions = {
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  destructive?: boolean;
};

type AppAlertContextValue = {
  showAlert: (title: string, message: string, options?: ShowAlertOptions) => void;
  showConfirm: (title: string, message: string, options?: ShowConfirmOptions) => void;
};

const AppAlertContext = createContext<AppAlertContextValue | null>(null);

export function AppAlertProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [buttonLabel, setButtonLabel] = useState('OK');
  const [confirmLabel, setConfirmLabel] = useState<string | undefined>(undefined);
  const [cancelLabel, setCancelLabel] = useState<string | undefined>(undefined);
  const [destructive, setDestructive] = useState(false);
  const onCloseRef = useRef<(() => void) | undefined>(undefined);
  const onConfirmRef = useRef<(() => void) | undefined>(undefined);

  const showAlert = useCallback(
    (t: string, m: string, options?: ShowAlertOptions) => {
      setTitle(t);
      setMessage(m);
      setButtonLabel(options?.buttonLabel ?? 'OK');
      setConfirmLabel(undefined);
      setCancelLabel(undefined);
      setDestructive(false);
      onConfirmRef.current = undefined;
      onCloseRef.current = options?.onClose;
      setVisible(true);
    },
    []
  );

  const showConfirm = useCallback(
    (t: string, m: string, options?: ShowConfirmOptions) => {
      setTitle(t);
      setMessage(m);
      setConfirmLabel(options?.confirmLabel ?? 'Confirmar');
      setCancelLabel(options?.cancelLabel ?? 'Cancelar');
      setDestructive(options?.destructive ?? false);
      onConfirmRef.current = options?.onConfirm;
      onCloseRef.current = options?.onCancel;
      setVisible(true);
    },
    []
  );

  const onClose = useCallback(() => {
    onCloseRef.current?.();
    onCloseRef.current = undefined;
    onConfirmRef.current = undefined;
    setVisible(false);
  }, []);

  const onConfirm = useCallback(() => {
    const fn = onConfirmRef.current;
    onConfirmRef.current = undefined;
    onCloseRef.current = undefined;
    setVisible(false);
    fn?.();
  }, []);

  return (
    <AppAlertContext.Provider value={{ showAlert, showConfirm }}>
      {children}
      <AppAlertModal
        visible={visible}
        onClose={onClose}
        title={title}
        message={message}
        buttonLabel={buttonLabel}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        onConfirm={onConfirm}
        destructive={destructive}
      />
    </AppAlertContext.Provider>
  );
}

export function useAppAlert(): AppAlertContextValue {
  const ctx = useContext(AppAlertContext);
  if (!ctx) {
    throw new Error('useAppAlert must be used within AppAlertProvider');
  }
  return ctx;
}
