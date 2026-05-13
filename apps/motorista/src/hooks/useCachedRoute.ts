/**
 * Combina rota online (Mapbox/Google/OSRM via `route.ts`) com cache persistido.
 *
 * Comportamento:
 *  1. Lê o cache na montagem → entrega `coordinates` imediatamente (UX rápida).
 *  2. Se `online`, dispara `fetchRoute()` em background → atualiza estado e
 *     regrava cache com novo `waypointsHash`.
 *  3. Se `!online` e há cache válido → usa cache (`source: 'cache'`).
 *  4. Se `!online` e sem cache → `source: 'none'` (a tela mostra fallback).
 *
 * Idempotência: o `cacheKey` controla quando refazer fetch. Se mudar (`shipment-x`
 * → `shipment-y`), o hook ressincroniza.
 */
import { useEffect, useRef, useState } from 'react';
import {
  getCachedRoute,
  hashWaypoints,
  setCachedRoute,
  type CachedRoutePoint,
} from '../lib/routeCache';
import type { RouteResult, RoutePoint } from '../lib/route';

export type CachedRouteSource = 'fresh' | 'cache' | 'none';

export type UseCachedRouteState = {
  coordinates: CachedRoutePoint[];
  durationSeconds: number;
  source: CachedRouteSource;
  loading: boolean;
};

type Options = {
  /** Identificador estável (`trip-<id>` | `shipment-<id>`). `null` desabilita. */
  cacheKey: string | null | undefined;
  /** Lista de waypoints da rota (>= 2 pontos). */
  waypoints: RoutePoint[] | null | undefined;
  /** Estado de rede atual. */
  online: boolean;
  /** Função que faz o fetch online. Recebe os waypoints já validados. */
  fetchRoute: (points: RoutePoint[]) => Promise<RouteResult | null>;
  /** TTL do cache em ms. Default 24h. */
  ttlMs?: number;
};

const INITIAL: UseCachedRouteState = {
  coordinates: [],
  durationSeconds: 0,
  source: 'none',
  loading: true,
};

export function useCachedRoute({
  cacheKey,
  waypoints,
  online,
  fetchRoute,
  ttlMs,
}: Options): UseCachedRouteState {
  const [state, setState] = useState<UseCachedRouteState>(INITIAL);
  const lastHashRef = useRef<string | null>(null);

  useEffect(() => {
    if (!cacheKey || !waypoints || waypoints.length < 2) {
      setState({ coordinates: [], durationSeconds: 0, source: 'none', loading: false });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));

    void (async () => {
      const expectedHash = await hashWaypoints(waypoints);
      lastHashRef.current = expectedHash;

      const cached = await getCachedRoute(cacheKey, ttlMs);
      const cacheValid = cached && cached.waypointsHash === expectedHash;

      if (!cancelled && cacheValid && cached) {
        setState({
          coordinates: cached.coordinates,
          durationSeconds: cached.durationSeconds,
          source: 'cache',
          loading: online,
        });
      } else if (!cancelled) {
        setState({ coordinates: [], durationSeconds: 0, source: 'none', loading: online });
      }

      if (!online) {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false }));
        return;
      }

      try {
        const fresh = await fetchRoute(waypoints);
        if (cancelled) return;
        if (fresh && fresh.coordinates.length >= 2) {
          await setCachedRoute(cacheKey, {
            coordinates: fresh.coordinates,
            durationSeconds: fresh.durationSeconds,
            computedAt: Date.now(),
            waypointsHash: expectedHash,
          });
          if (cancelled) return;
          setState({
            coordinates: fresh.coordinates,
            durationSeconds: fresh.durationSeconds,
            source: 'fresh',
            loading: false,
          });
        } else if (!cacheValid) {
          setState({ coordinates: [], durationSeconds: 0, source: 'none', loading: false });
        } else {
          setState((prev) => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, waypoints, online, fetchRoute, ttlMs]);

  return state;
}
