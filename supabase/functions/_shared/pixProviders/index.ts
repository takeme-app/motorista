// Fábrica + resolução do provedor Pix efetivo.
//
// REGRA (fechada no plano): a escolha em platform_settings.pix_provider governa
// SÓ a CRIAÇÃO de cobranças novas. Webhook, polling de status, expiração e
// reconciliação operam pelo pix_charges.provider gravado na própria linha —
// trocar o provedor no admin NÃO abandona cobranças em andamento.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { PixMode, PixProvider, PixProviderName, PixProviderSetting } from "./types.ts";
import { AsaasProvider } from "./asaas.ts";
import { BradescoProvider } from "./bradesco.ts";

const DEFAULT_CHARGE_TTL_MINUTES = 15;

const FAILSAFE_SETTING: PixProviderSetting = {
  mode: "palliative",
  test_provider: null,
  allowlist_user_ids: [],
  charge_ttl_minutes: DEFAULT_CHARGE_TTL_MINUTES,
};

function isProviderName(v: unknown): v is PixProviderName {
  return v === "asaas" || v === "bradesco";
}

/**
 * Lê platform_settings.pix_provider (shape FLAT do contrato compartilhado).
 * Desembrulha defensivamente `raw?.value ?? raw` para não repetir o bug do
 * process-payouts (config gravada como {value} nunca ter efeito).
 * Chave ausente ou parse com erro ⇒ palliative (fail-safe).
 */
export async function readPixProviderSetting(admin: SupabaseClient): Promise<PixProviderSetting> {
  try {
    const { data, error } = await admin
      .from("platform_settings")
      .select("value")
      .eq("key", "pix_provider")
      .maybeSingle();
    if (error || !data) return FAILSAFE_SETTING;

    const raw = (data as { value?: unknown }).value;
    const source =
      raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>) &&
        (raw as { value?: unknown }).value != null
        ? (raw as { value?: unknown }).value
        : raw;
    if (!source || typeof source !== "object") return FAILSAFE_SETTING;

    const obj = source as Record<string, unknown>;
    const mode: PixMode =
      obj.mode === "asaas" || obj.mode === "bradesco" ? obj.mode : "palliative";
    const testProvider = isProviderName(obj.test_provider) ? obj.test_provider : null;
    const allowlist = Array.isArray(obj.allowlist_user_ids)
      ? obj.allowlist_user_ids.filter((id): id is string => typeof id === "string")
      : [];
    const ttl = Number(obj.charge_ttl_minutes);
    return {
      mode,
      test_provider: testProvider,
      allowlist_user_ids: allowlist,
      charge_ttl_minutes:
        Number.isFinite(ttl) && ttl >= 1 && ttl <= 120 ? Math.floor(ttl) : DEFAULT_CHARGE_TTL_MINUTES,
    };
  } catch (e) {
    console.warn("[pixProviders] leitura de pix_provider falhou (fail-safe palliative):", e);
    return FAILSAFE_SETTING;
  }
}

/**
 * Modo efetivo para um usuário (MESMA regra no app e no servidor):
 *   allowlist_user_ids.includes(userId) && test_provider ? test_provider : mode
 * Permite pilotar um provedor real com contas do time enquanto todos seguem no
 * paliativo (e, no futuro, testar Bradesco com Asaas já no ar).
 */
export function resolveEffectivePixMode(setting: PixProviderSetting, userId: string): PixMode {
  if (setting.test_provider && setting.allowlist_user_ids.includes(userId)) {
    return setting.test_provider;
  }
  return setting.mode;
}

/**
 * Fábrica com guard de secrets: lança PixProviderUnavailableError se o provedor
 * escolhido não tem env configurado (ou não está implementado).
 */
export function createPixProvider(admin: SupabaseClient, name: PixProviderName): PixProvider {
  if (name === "asaas") return new AsaasProvider(admin);
  return new BradescoProvider(admin);
}

export type ActivePixProviderResolution =
  | { mode: "palliative"; setting: PixProviderSetting }
  | { mode: PixProviderName; provider: PixProvider; setting: PixProviderSetting };

/**
 * Resolve o provedor ATIVO para criação de cobrança deste usuário.
 * palliative ⇒ quem chama devolve 409 pix_provider_not_active (o app cai no
 * fluxo paliativo). Provedor real sem secrets ⇒ PixProviderUnavailableError.
 */
export async function resolveActivePixProvider(
  admin: SupabaseClient,
  userId: string,
): Promise<ActivePixProviderResolution> {
  const setting = await readPixProviderSetting(admin);
  const mode = resolveEffectivePixMode(setting, userId);
  if (mode === "palliative") return { mode, setting };
  return { mode, provider: createPixProvider(admin, mode), setting };
}
