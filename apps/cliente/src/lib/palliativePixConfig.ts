import { supabase } from './supabase';
import { PIX_COPIA_E_COLA } from '../config/pixPaliativo';

export type PalliativePixConfig = {
  /** Copia-e-cola Pix (chave Take Me). */
  copiaECola: string;
  /** QR estático: URL http(s) OU data URI base64 (ex.: data:image/png;base64,...). Vazio = usar asset bundlado. */
  qrImageUrl: string | null;
};

/**
 * Lê a config do Pix paliativo de `platform_settings.pix_palliative` (editável pelo admin,
 * sem rebuild). Fallback: a constante do app. Nunca lança.
 */
export async function fetchPalliativePixConfig(): Promise<PalliativePixConfig> {
  try {
    const { data } = await (supabase as { from: (t: string) => any })
      .from('platform_settings')
      .select('value')
      .eq('key', 'pix_palliative')
      .maybeSingle();
    const raw = (data?.value ?? null) as { copia_e_cola?: unknown; qr_image_url?: unknown } | null;
    const copia = typeof raw?.copia_e_cola === 'string' ? raw.copia_e_cola.trim() : '';
    const qr = typeof raw?.qr_image_url === 'string' ? raw.qr_image_url.trim() : '';
    return {
      copiaECola: copia || PIX_COPIA_E_COLA,
      qrImageUrl: qr || null,
    };
  } catch {
    return { copiaECola: PIX_COPIA_E_COLA, qrImageUrl: null };
  }
}
