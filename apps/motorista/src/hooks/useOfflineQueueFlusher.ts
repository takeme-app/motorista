/**
 * Faz o flush da fila offline de mutações sempre que a rede volta.
 *
 * Monte UMA instância em alto nível (RootNavigator/App) — múltiplos hooks
 * disparariam flushes paralelos, e embora `flushQueue` seja serializado por
 * uma flag interna, evitamos o trabalho extra.
 */
import { useEffect, useRef } from 'react';
import { useNetworkStatus } from './useNetworkStatus';
import { flushQueue } from '../lib/offlineQueue';

export function useOfflineQueueFlusher(): void {
  const { online } = useNetworkStatus();
  const wasOnlineRef = useRef<boolean | null>(null);

  useEffect(() => {
    // Estado inicial: dispara um flush logo na 1ª resolução, não importando o
    // valor (cobre o caso de sair do app offline com itens enfileirados).
    if (wasOnlineRef.current === null) {
      wasOnlineRef.current = online;
      if (online) void flushQueue();
      return;
    }
    if (!wasOnlineRef.current && online) {
      void flushQueue();
    }
    wasOnlineRef.current = online;
  }, [online]);
}
