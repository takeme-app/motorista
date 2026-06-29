import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

/**
 * Indica se há notificações não lidas para o app cliente (target_app_slug='cliente').
 * Recalcula em focus + assinatura realtime na tabela `notifications`.
 *
 * Espelha apps/motorista/src/hooks/useUnreadNotifications.ts para paridade
 * cliente↔motorista. Retorna boolean (presente/ausente) — UI usa badge dot.
 */
export function useUnreadNotifications(): boolean {
  const [hasUnread, setHasUnread] = useState(false);

  const fetchUnread = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      setHasUnread(false);
      return;
    }
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('target_app_slug', 'cliente')
      .is('read_at', null);
    if (error) {
      setHasUnread(false);
      return;
    }
    setHasUnread((count ?? 0) > 0);
  }, []);

  useEffect(() => {
    void fetchUnread();
  }, [fetchUnread]);

  useFocusEffect(
    useCallback(() => {
      void fetchUnread();
    }, [fetchUnread]),
  );

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user?.id) return;

      channel = supabase
        .channel(`unread_notif_cliente_${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            void fetchUnread();
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [fetchUnread]);

  return hasUnread;
}
