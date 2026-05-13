/**
 * Cache persistido de rotas (polyline + duração) para uso offline.
 *
 * Indexado por chave estável (`trip-<id>` ou `shipment-<id>`). Hidratamos a
 * polyline imediatamente ao abrir uma tela; se houver internet, sobrescrevemos
 * com a versão fresca em background.
 *
 * Validade: TTL de 24h evita rota antiga em horários/tráfego diferentes.
 * Identidade: `waypointsHash` invalida o cache se as paradas mudarem
 * (motorista reorganizou ou trocou destino).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type CachedRoutePoint = { latitude: number; longitude: number };

export type CachedRoute = {
  coordinates: CachedRoutePoint[];
  durationSeconds: number;
  computedAt: number;
  waypointsHash: string;
};

const PREFIX = 'route:';
const INDEX_KEY = 'route:__index__';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function storageKey(id: string): string {
  return `${PREFIX}${id}`;
}

/** Hash estável de uma sequência de waypoints (5 casas decimais → ~1m). */
export async function hashWaypoints(points: CachedRoutePoint[]): Promise<string> {
  const normalized = points
    .map((p) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`)
    .join('|');
  /** Lazy + tolerante: dev clients antigos podem não ter ExpoCrypto nativo. Fallback usa a própria string. */
  try {
    const Crypto = await import('expo-crypto');
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, normalized);
  } catch {
    return normalized;
  }
}

async function readIndex(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(ids));
  } catch {
    // Storage cheio: ignoramos — o pior caso é não conseguir limpar pelo índice.
  }
}

export async function getCachedRoute(
  id: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<CachedRoute | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRoute;
    if (!parsed?.coordinates?.length) return null;
    if (Date.now() - parsed.computedAt > ttlMs) {
      await clearCachedRoute(id);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function setCachedRoute(id: string, route: CachedRoute): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(id), JSON.stringify(route));
    const index = await readIndex();
    if (!index.includes(id)) {
      index.push(id);
      await writeIndex(index);
    }
  } catch {
    // Falha silenciosa: cache é otimização, não bloqueia o fluxo.
  }
}

export async function clearCachedRoute(id: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(id));
    const index = await readIndex();
    const next = index.filter((x) => x !== id);
    if (next.length !== index.length) await writeIndex(next);
  } catch {
    // ignore
  }
}

export async function clearAllCachedRoutes(): Promise<void> {
  try {
    const index = await readIndex();
    await Promise.all(index.map((id) => AsyncStorage.removeItem(storageKey(id))));
    await AsyncStorage.removeItem(INDEX_KEY);
  } catch {
    // ignore
  }
}

/** Apenas para diagnóstico/UI de suporte. */
export async function getCachedRouteIds(): Promise<string[]> {
  return readIndex();
}
