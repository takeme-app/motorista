import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from './supabase';

export type LiveDriverCoords = {
  latitude: number;
  longitude: number;
  updatedAt: string | null;
};

export type UseScheduledTripLiveLocationOptions = {
  /**
   * Idade máxima (ms) antes do último fix ser considerado "stale".
   * Default 120000 (2 min) — o motorista publica a cada 2s, então 2 min cobre
   * quedas longas de rede sem disparar falso-positivo.
   */
  staleAfterMs?: number;
};

const DEFAULT_STALE_AFTER_MS = 120_000;

/**
 * Lê `scheduled_trip_live_locations` e mantém atualizado via Supabase Realtime.
 * O app motorista publica posição enquanto `scheduled_trips.status='active'`
 * ou `driver_journey_started_at` está setado.
 *
 * Retorno:
 *  - `coords`: última posição (ou null se ninguém publicou ainda).
 *  - `isStale`: true quando `updatedAt` é mais antigo que `staleAfterMs`.
 *  - `ageMs`: idade do último fix em ms (null se sem coords).
 *  - `loading`, `refetch`: utilitários originais.
 */
export function useScheduledTripLiveLocation(
  scheduledTripId: string | undefined | null,
  options?: UseScheduledTripLiveLocationOptions,
): {
  coords: LiveDriverCoords | null;
  loading: boolean;
  isStale: boolean;
  ageMs: number | null;
  refetch: () => Promise<void>;
} {
  const staleAfterMs = options?.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const [coords, setCoords] = useState<LiveDriverCoords | null>(null);
  const [loading, setLoading] = useState(false);
  /**
   * Tick que re-avalia `isStale`/`ageMs` sem novas leituras do banco. 30 s é
   * granular o suficiente para a UI atualizar o texto "há Xmin" sem custo.
   */
  const [, setStalenessTick] = useState(0);

  const applyRow = useCallback((row: { latitude: number; longitude: number; updated_at?: string | null } | null) => {
    if (
      !row ||
      typeof row.latitude !== 'number' ||
      typeof row.longitude !== 'number' ||
      !Number.isFinite(row.latitude) ||
      !Number.isFinite(row.longitude)
    ) {
      setCoords(null);
      return;
    }
    setCoords({
      latitude: row.latitude,
      longitude: row.longitude,
      updatedAt: row.updated_at ?? null,
    });
  }, []);

  const refetch = useCallback(async () => {
    if (!scheduledTripId) {
      setCoords(null);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('scheduled_trip_live_locations')
        .select('latitude, longitude, updated_at')
        .eq('scheduled_trip_id', scheduledTripId)
        .maybeSingle();
      if (error) {
        setCoords(null);
        return;
      }
      applyRow(data as { latitude: number; longitude: number; updated_at?: string | null } | null);
    } finally {
      setLoading(false);
    }
  }, [scheduledTripId, applyRow]);

  useEffect(() => {
    if (!scheduledTripId) {
      setCoords(null);
      return;
    }
    void refetch();

    const channel = supabase
      .channel(`slt-live-${scheduledTripId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'scheduled_trip_live_locations',
          filter: `scheduled_trip_id=eq.${scheduledTripId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as {
            latitude?: number;
            longitude?: number;
            updated_at?: string | null;
          } | null;
          if (payload.eventType === 'DELETE' || !row) {
            setCoords(null);
            return;
          }
          applyRow({
            latitude: row.latitude as number,
            longitude: row.longitude as number,
            updated_at: row.updated_at ?? null,
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [scheduledTripId, refetch, applyRow]);

  useEffect(() => {
    const id = setInterval(() => setStalenessTick((n) => (n + 1) & 0xffff), 30_000);
    return () => clearInterval(id);
  }, []);

  const { ageMs, isStale } = useMemo(() => {
    if (!coords?.updatedAt) return { ageMs: null as number | null, isStale: false };
    const t = Date.parse(coords.updatedAt);
    if (!Number.isFinite(t)) return { ageMs: null as number | null, isStale: false };
    const age = Math.max(0, Date.now() - t);
    return { ageMs: age, isStale: age > staleAfterMs };
  }, [coords, staleAfterMs]);

  return { coords, loading, isStale, ageMs, refetch };
}
