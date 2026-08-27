import { supabase } from './supabase';

/**
 * Descoberta do modo do Pix: lê `platform_settings.pix_provider` (contrato
 * compartilhado, shape FLAT):
 *
 *   { "mode": "palliative" | "asaas" | "bradesco",
 *     "test_provider": "asaas" | "bradesco" | null,
 *     "allowlist_user_ids": ["uuid", ...],
 *     "charge_ttl_minutes": 15 }
 *
 * Provedor efetivo para o usuário (mesma regra do servidor):
 *   allowlist_user_ids.includes(userId) && test_provider ? test_provider : mode
 *
 * Chave ausente, leitura com erro ou timeout ⇒ 'palliative' (fail-safe: se a
 * flag real estiver ativa, o guard do servidor rejeita o insert paliativo e o
 * retry — que invalida este cache — relê a flag).
 */
export type PixProviderMode = 'palliative' | 'asaas' | 'bradesco';

const VALID_MODES: readonly PixProviderMode[] = ['palliative', 'asaas', 'bradesco'];
const CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 3_000;

let cache: { mode: PixProviderMode; userId: string | null; at: number } | null = null;

function asMode(value: unknown): PixProviderMode | null {
  return typeof value === 'string' && (VALID_MODES as readonly string[]).includes(value)
    ? (value as PixProviderMode)
    : null;
}

/** Invalida o cache (ex.: servidor respondeu `pix_provider_not_active` — a flag mudou). */
export function invalidatePixProviderModeCache(): void {
  cache = null;
}

/**
 * Modo efetivo do Pix para o usuário logado. Cache de 30s, timeout ~3s.
 * Nunca lança; fallback sempre 'palliative'.
 */
export async function fetchPixProviderMode(): Promise<PixProviderMode> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;

    if (cache && cache.userId === userId && Date.now() - cache.at < CACHE_TTL_MS) {
      return cache.mode;
    }

    const result = await Promise.race([
      (supabase as { from: (t: string) => any })
        .from('platform_settings')
        .select('value')
        .eq('key', 'pix_provider')
        .maybeSingle(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS)),
    ]);
    // Timeout/erro: não cacheia — a próxima chamada tenta de novo.
    if (!result || typeof result !== 'object' || (result as { error?: unknown }).error) {
      return 'palliative';
    }

    const rawValue = (result as { data?: { value?: unknown } | null }).data?.value ?? null;
    // Unwrap defensivo: o contrato é flat, mas se alguém embrulhar em {value}
    // (bug conhecido do usePlatformSettings do admin), ainda funcionamos.
    const wrapped =
      rawValue && typeof rawValue === 'object' && 'value' in (rawValue as Record<string, unknown>)
        ? (rawValue as { value: unknown }).value
        : rawValue;
    const cfg =
      wrapped && typeof wrapped === 'object' ? (wrapped as Record<string, unknown>) : null;

    const mode = asMode(cfg?.mode) ?? 'palliative';
    const testProvider = asMode(cfg?.test_provider);
    const allowlist = Array.isArray(cfg?.allowlist_user_ids)
      ? (cfg.allowlist_user_ids as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];

    const effective: PixProviderMode =
      userId != null && testProvider != null && allowlist.includes(userId) ? testProvider : mode;

    cache = { mode: effective, userId, at: Date.now() };
    return effective;
  } catch {
    return 'palliative';
  }
}
