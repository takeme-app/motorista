import { useEffect } from 'react';
import type { NavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';
import {
  applyNotificationDeeplink,
  parseNotificationDeeplink,
} from '../lib/notificationDeeplink';
import { registerClienteForegroundNotifications } from '../lib/foregroundNotificationHandler';

type NavRef = React.RefObject<NavigationContainerRef<RootStackParamList> | null>;

/**
 * Registra listeners do Firebase Messaging e encaminha o payload para o
 * resolvedor de deeplink (`applyNotificationDeeplink`).
 *
 * - `onNotificationOpenedApp`: app em background/foreground → usuário tocou na push.
 * - `getInitialNotification`: app estava fechado e foi aberto pela push.
 * - `onMessage` (via Notifee): foreground — cria notificação local para o
 *   sistema exibir o banner/heads-up e propaga o toque pelo `onForegroundEvent`.
 *
 * Espelha apps/motorista/src/navigation/NotificationDeeplinkHandler.tsx.
 * Sem-op em Web/bundles sem o módulo nativo.
 */
export function NotificationDeeplinkHandler({ navigationRef }: { navigationRef: NavRef }) {
  useEffect(() => {
    let unsubOpened: (() => void) | undefined;
    let unsubForeground: (() => void) | undefined;
    let cancelled = false;

    const applyFromRawData = (data: unknown) => {
      const link = parseNotificationDeeplink(data);
      if (link) applyNotificationDeeplink(navigationRef, link);
    };

    (async () => {
      try {
        const { default: messaging } = await import('@react-native-firebase/messaging');

        const initial = await messaging().getInitialNotification();
        if (!cancelled && initial?.data) {
          // Pequeno delay para aguardar NavigationContainer pronto.
          setTimeout(() => applyFromRawData(initial.data), 250);
        }

        unsubOpened = messaging().onNotificationOpenedApp((msg) => {
          applyFromRawData(msg?.data);
        });

        unsubForeground = await registerClienteForegroundNotifications(
          applyFromRawData,
        );
      } catch {
        /* Web ou bundle sem módulo nativo: sem-op. */
      }
    })();

    return () => {
      cancelled = true;
      unsubOpened?.();
      unsubForeground?.();
    };
  }, [navigationRef]);

  return null;
}
