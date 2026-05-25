import {
  DEFAULT_PLATFORM_FEE_PCT,
  resolvePlatformFeePct,
  type PlatformFeeServiceType,
} from '@take-me/shared';
import { supabase } from './supabase';

function readDefaultAdminPct(raw: unknown): number {
  if (raw && typeof raw === 'object') {
    const obj = raw as { percentage?: unknown; value?: unknown };
    const pct = Number(obj.percentage ?? obj.value);
    if (Number.isFinite(pct) && pct >= 0) return pct;
  }
  return DEFAULT_PLATFORM_FEE_PCT;
}

export async function fetchPlatformFeePctForService(
  serviceType: PlatformFeeServiceType,
): Promise<number> {
  try {
    const { data } = await (supabase as { from: (table: string) => any })
      .from('platform_settings')
      .select('key, value')
      .in('key', ['default_admin_pct', 'platform_fee_pct_by_service']);
    const rows = Array.isArray(data) ? data : [];
    const defaultRow = rows.find((row: { key?: string }) => row.key === 'default_admin_pct');
    const byServiceRow = rows.find((row: { key?: string }) => row.key === 'platform_fee_pct_by_service');
    const fallbackPct = readDefaultAdminPct((defaultRow as { value?: unknown } | undefined)?.value);
    return resolvePlatformFeePct(
      (byServiceRow as { value?: unknown } | undefined)?.value,
      serviceType,
      fallbackPct,
    );
  } catch {
    return DEFAULT_PLATFORM_FEE_PCT;
  }
}
