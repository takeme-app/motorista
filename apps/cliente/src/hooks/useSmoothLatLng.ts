import { useEffect, useRef, useState } from 'react';

export type SmoothLatLng = { latitude: number; longitude: number };

type Options = {
  /**
   * Tempo aproximado para alcançar o `target` a partir do estado atual (ms).
   * Como a interpolação é exponencial (lerp por frame), 600 ms suaviza saltos
   * de 2s entre fixes do motorista sem amarrar a posição visual ao passado.
   */
  durationMs?: number;
  /**
   * Distância (metros) acima da qual a interpolação é descartada e o pin
   * "salta" direto. Evita o pin "voar" pela tela quando a rede do motorista
   * volta depois de muito tempo offline (último fix em A, novo em B distante).
   */
  snapDistanceMeters?: number;
};

const DEFAULT_DURATION_MS = 600;
const DEFAULT_SNAP_DISTANCE_M = 500;
/** Deslocamento mínimo em graus que ainda justifica re-render. */
const COORD_EPSILON = 1e-7;

/** Aproximação rápida em metros (boa o bastante para o threshold de snap). */
function approxDistanceMeters(a: SmoothLatLng, b: SmoothLatLng): number {
  const dLat = (b.latitude - a.latitude) * 111_000;
  const meanLatRad = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const dLng = (b.longitude - a.longitude) * 111_000 * Math.max(0.1, Math.cos(meanLatRad));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * Interpola suavemente entre o último valor exibido e o `target` mais recente
 * usando `requestAnimationFrame` (~60 fps). Faz o pin do motorista no mapa
 * deslizar entre fixes do Realtime em vez de pular.
 *
 * - Mantém refs mutáveis e só faz `setState` quando há diferença mensurável.
 * - Aceita `target = null` (sem fix ainda): retorna `null`.
 * - Primeira transição de null → coord faz snap (sem animar do (0,0)).
 * - Saltos > `snapDistanceMeters` também fazem snap.
 */
export function useSmoothLatLng(
  target: SmoothLatLng | null,
  options?: Options,
): { coord: SmoothLatLng | null } {
  const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
  const snapDistanceMeters = options?.snapDistanceMeters ?? DEFAULT_SNAP_DISTANCE_M;

  const targetRef = useRef<SmoothLatLng | null>(target);
  const currentRef = useRef<SmoothLatLng | null>(target);
  const lastFrameAtRef = useRef<number>(Date.now());
  const rafRef = useRef<number | null>(null);

  const [coord, setCoord] = useState<SmoothLatLng | null>(target);

  useEffect(() => {
    if (!target) {
      targetRef.current = null;
      currentRef.current = null;
      setCoord(null);
      return;
    }
    // Primeira amostra ou salto grande: snap direto.
    const cur = currentRef.current;
    if (!cur) {
      targetRef.current = target;
      currentRef.current = target;
      setCoord(target);
      return;
    }
    if (approxDistanceMeters(cur, target) > snapDistanceMeters) {
      targetRef.current = target;
      currentRef.current = target;
      setCoord(target);
      return;
    }
    targetRef.current = target;
  }, [target, snapDistanceMeters]);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      // Limita o passo para evitar saltos quando o app fica em background.
      const dt = Math.min(80, Math.max(0, now - lastFrameAtRef.current));
      lastFrameAtRef.current = now;

      const cur = currentRef.current;
      const tgt = targetRef.current;
      if (cur && tgt) {
        const alpha = Math.min(1, dt / durationMs);
        const dLat = tgt.latitude - cur.latitude;
        const dLng = tgt.longitude - cur.longitude;
        if (Math.abs(dLat) > COORD_EPSILON || Math.abs(dLng) > COORD_EPSILON) {
          const next: SmoothLatLng = {
            latitude: cur.latitude + dLat * alpha,
            longitude: cur.longitude + dLng * alpha,
          };
          currentRef.current = next;
          setCoord(next);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    lastFrameAtRef.current = Date.now();
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [durationMs]);

  return { coord };
}
