import { useEffect, useRef, useState } from 'react';

export type SmoothLatLng = { latitude: number; longitude: number };

type Options = {
  /**
   * Tempo aproximado para alcançar o `target` a partir do estado atual (ms).
   * 200–280 ms costuma soar fluido sem "atrasar" a percepção do movimento.
   */
  durationMs?: number;
  /**
   * Tempo aproximado para alcançar o `targetHeadingDeg` (ms). Heading muda mais
   * devagar do que coordenada — usar duração maior reduz "tremor" do ícone.
   */
  headingDurationMs?: number;
};

const DEFAULT_DURATION_MS = 240;
// Heading chega em ~2 Hz (GPS) + ~10 Hz (bússola). Antes 200 ms era fluido
// mas absorvia pouco jitter — sample isolado errado virava giro visível ("a
// seta gira do nada"). Subir para 350 ms estende a constante de tempo da
// lerp (assintótica): saltos espúrios se diluem em 2-3 frames antes que o
// próximo fix válido (ou rejeição de jitter no caller) corrija o alvo.
// Continua fluido para curvas reais, que são monotônicas e mantêm o alvo.
const DEFAULT_HEADING_DURATION_MS = 350;
/** Deslocamento mínimo em graus que ainda justifica re-render. */
const COORD_EPSILON = 1e-7;
/** Diferença mínima de heading (graus) que justifica re-render. */
const HEADING_EPSILON = 0.25;

/** Diferença angular mais curta entre dois headings (com sinal). */
function shortestAngleDelta(from: number, to: number): number {
  const d = ((((to - from) % 360) + 540) % 360) - 180;
  return d;
}

/**
 * Interpolação suave entre o último valor exibido e o `target` mais recente,
 * usando `requestAnimationFrame` (~60 fps). Útil para fazer um pin de mapa
 * "deslizar" no estilo Waze entre fixes do GPS.
 *
 * Decisões importantes:
 *  - Mantém referências mutáveis (`useRef`) para current/target e só faz
 *    `setState` quando há diferença mensurável — evita render contínuo
 *    quando o motorista está parado.
 *  - Aceita `target` nulo (sem GPS): zera tudo e retorna `null`.
 *  - O "target" pula sem animação na primeira vez (evita varrer o mapa
 *    do (0,0) inicial até a posição real).
 *  - Heading interpola pelo caminho angular mais curto e tem duração maior.
 */
export function useSmoothCoordinate(
  target: SmoothLatLng | null,
  targetHeadingDeg: number | null,
  options?: Options,
): { coord: SmoothLatLng | null; headingDeg: number | null } {
  const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
  const headingDurationMs = options?.headingDurationMs ?? DEFAULT_HEADING_DURATION_MS;

  const targetRef = useRef<SmoothLatLng | null>(target);
  const currentRef = useRef<SmoothLatLng | null>(target);
  const targetHeadingRef = useRef<number | null>(targetHeadingDeg);
  const currentHeadingRef = useRef<number | null>(targetHeadingDeg);
  const lastFrameAtRef = useRef<number>(Date.now());
  const rafRef = useRef<number | null>(null);

  const [coord, setCoord] = useState<SmoothLatLng | null>(target);
  const [headingDeg, setHeadingDeg] = useState<number | null>(targetHeadingDeg);

  // Atualiza alvos quando o pai entrega novos valores; faz "snap" (sem animar)
  // na primeira vez que sai de null.
  useEffect(() => {
    targetRef.current = target;
    if (!currentRef.current && target) {
      currentRef.current = target;
      setCoord(target);
    }
    if (!target) {
      currentRef.current = null;
      setCoord(null);
    }
  }, [target]);

  useEffect(() => {
    targetHeadingRef.current = targetHeadingDeg;
    if (currentHeadingRef.current == null && targetHeadingDeg != null) {
      currentHeadingRef.current = targetHeadingDeg;
      setHeadingDeg(targetHeadingDeg);
    }
    if (targetHeadingDeg == null) {
      currentHeadingRef.current = null;
      setHeadingDeg(null);
    }
  }, [targetHeadingDeg]);

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

      const curH = currentHeadingRef.current;
      const tgtH = targetHeadingRef.current;
      if (curH != null && tgtH != null) {
        const alphaH = Math.min(1, dt / headingDurationMs);
        const delta = shortestAngleDelta(curH, tgtH);
        if (Math.abs(delta) > HEADING_EPSILON) {
          const nextH = (curH + delta * alphaH + 360) % 360;
          currentHeadingRef.current = nextH;
          setHeadingDeg(nextH);
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
  }, [durationMs, headingDurationMs]);

  return { coord, headingDeg };
}
