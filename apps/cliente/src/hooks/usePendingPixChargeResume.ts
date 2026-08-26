import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import { CommonActions, type NavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import {
  getPendingPixCharge,
  clearPendingPixCharge,
  type StoredPixCharge,
} from '../lib/pixChargeStorage';
import { getPixChargeStatus } from '../lib/pixCharge';

type NavRef = React.RefObject<NavigationContainerRef<RootStackParamList> | null>;

/**
 * Retomada da cobrança Pix real pendente (padrão do NotificationDeeplinkHandler:
 * montado no RootNavigator, junto do NavigationContainer). Cold start e volta ao
 * foreground:
 *  - paga  → limpa e navega direto para a tela de sucesso (id/valor do servidor);
 *  - pendente → alerta "Pagamento Pix pendente" com opção de retomar a tela;
 *  - expirada/cancelada/terminal → limpa silenciosamente.
 * `getPendingPixCharge()` já filtra cobrança expirada e de outra conta.
 */
export function usePendingPixChargeResume(navigationRef: NavRef) {
  const promptedForRef = useRef<string | null>(null);
  const checkingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const navigateResume = (stored: StoredPixCharge) => {
      const nav = navigationRef.current;
      if (!nav) return;
      nav.dispatch(
        CommonActions.navigate({
          name: 'TripStack',
          params: { screen: 'PixPayment', params: { resume: true, stored } },
        }),
      );
    };

    const navigatePaid = (stored: StoredPixCharge, entityIdFromServer: string | null) => {
      const nav = navigationRef.current;
      if (!nav) return;
      const sn = stored.successNav;
      const bookingId = (entityIdFromServer && entityIdFromServer.trim()) || stored.entityId;
      nav.dispatch(
        CommonActions.navigate({
          name: 'TripStack',
          params: {
            screen: 'PaymentConfirmed',
            params: {
              booking: {
                booking_id: bookingId,
                origin_address: sn.originAddress,
                destination_address: sn.destinationAddress,
                departure: sn.departure,
                arrival: sn.arrival,
                amount_cents: stored.amountCents,
                driver_name: sn.driverName,
              },
              immediateTrip: sn.immediateTrip,
              tripLive: {
                driverName: sn.driverName,
                rating: sn.driverRating,
                vehicleLabel: sn.vehicleLabel,
                amountCents: stored.amountCents,
                bookingId: bookingId || undefined,
                scheduledTripId: sn.scheduledTripId,
                origin: sn.origin,
                destination: sn.destination,
              },
              paymentMethod: 'pix',
            },
          },
        }),
      );
    };

    const check = async () => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      try {
        const stored = await getPendingPixCharge();
        if (cancelled || !stored) return;
        // Se a tela do Pix já está aberta, ela mesma cuida do ciclo de vida.
        if (navigationRef.current?.getCurrentRoute()?.name === 'PixPayment') return;

        const res = await getPixChargeStatus(stored.pixChargeId);
        if (cancelled) return;

        if (res.ok && res.status === 'paid') {
          await clearPendingPixCharge();
          navigatePaid(stored, res.entityId);
          return;
        }
        if (res.ok && res.status !== 'pending') {
          // expired/cancelled/paid_orphan/amount_mismatch/create_failed → limpa.
          await clearPendingPixCharge();
          return;
        }

        // Pendente (ou status indisponível agora): oferece a retomada — uma vez
        // por cobrança nesta sessão do app, para não importunar.
        if (promptedForRef.current === stored.pixChargeId) return;
        promptedForRef.current = stored.pixChargeId;
        Alert.alert(
          'Pagamento Pix pendente',
          'Você tem um pagamento Pix em andamento. Deseja retomar para concluir?',
          [
            { text: 'Agora não', style: 'cancel' },
            { text: 'Retomar', onPress: () => navigateResume(stored) },
          ],
        );
      } catch {
        /* nunca derruba o app por causa da retomada */
      } finally {
        checkingRef.current = false;
      }
    };

    // Cold start: pequeno delay para o NavigationContainer estar pronto
    // (mesma estratégia do NotificationDeeplinkHandler).
    const startTimer = setTimeout(() => {
      void check();
    }, 1500);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check();
    });
    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      sub.remove();
    };
  }, [navigationRef]);
}
