import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AppAlertModal } from '../components/AppAlertModal';

type SecondaryButton = { label: string; onPress: () => void };

type ShowAlertOptions = {
  buttonLabel?: string;
  onClose?: () => void;
  secondaryButton?: SecondaryButton;
};

type AppAlertContextValue = {
  showAlert: (title: string, message: string, options?: ShowAlertOptions) => void;
};

const AppAlertContext = createContext<AppAlertContextValue | null>(null);

export function AppAlertProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [buttonLabel, setButtonLabel] = useState('OK');
  const [secondaryButton, setSecondaryButton] = useState<SecondaryButton | undefined>(undefined);
  const onCloseRef = useRef<(() => void) | undefined>(undefined);

  const showAlert = useCallback(
    (t: string, m: string, options?: ShowAlertOptions) => {
      setTitle(t);
      setMessage(m);
      setButtonLabel(options?.buttonLabel ?? 'OK');
      setSecondaryButton(options?.secondaryButton);
      onCloseRef.current = options?.onClose;
      setVisible(true);
    },
    []
  );

  const onClose = useCallback(() => {
    onCloseRef.current?.();
    onCloseRef.current = undefined;
    setVisible(false);
  }, []);

  return (
    <AppAlertContext.Provider value={{ showAlert }}>
      {children}
      <AppAlertModal
        visible={visible}
        onClose={onClose}
        title={title}
        message={message}
        buttonLabel={buttonLabel}
        secondaryButton={secondaryButton}
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
