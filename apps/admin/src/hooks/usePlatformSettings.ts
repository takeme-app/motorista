import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// ── Types ────────────────────────────────────────────────────────────
interface PlatformSetting {
  key: string;
  value: any;
}

interface UsePlatformSettingsReturn {
  settings: Record<string, any>;
  loading: boolean;
  /** Atualiza um setting. LANÇA se a escrita falhar — quem chama precisa saber. */
  updateSetting: (key: string, value: any) => Promise<void>;
  /** Busca o valor de um setting */
  getSetting: (key: string, defaultValue?: any) => any;
  refresh: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────
export function usePlatformSettings(): UsePlatformSettingsReturn {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(() => {
    setLoading(true);
    (supabase as any)
      .from('platform_settings')
      .select('key, value')
      .then(({ data, error }: any) => {
        if (!error && data) {
          const map: Record<string, any> = {};
          data.forEach((row: PlatformSetting) => {
            const v = row.value;
            if (v && typeof v === 'object') {
              if ('value' in v) map[row.key] = (v as any).value;
              else if ('percentage' in v) map[row.key] = (v as any).percentage;
              else map[row.key] = v;
            } else {
              map[row.key] = v;
            }
          });
          setSettings(map);
        }
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSetting = useCallback(async (key: string, value: any) => {
    const { data: session } = await (supabase as any).auth.getSession();
    const userId = session?.session?.user?.id;

    // Mantém o formato já em uso na BD: default_admin_pct usa { percentage },
    // demais chaves seguem { value: ... }. Isto garante compatibilidade com
    // RPCs que leem value->>'percentage'.
    const payload = key === 'default_admin_pct' ? { percentage: value } : { value };

    const { error } = await (supabase as any)
      .from('platform_settings')
      .upsert({
        key,
        value: payload,
        updated_at: new Date().toISOString(),
        updated_by: userId || null,
      }, { onConflict: 'key' });

    if (error) {
      // Antes o erro era engolido: o upsert falhava (RLS, rede, permissão), a
      // função resolvia normalmente e a tela mostrava "Salvo com sucesso!"
      // sobre uma configuração que nunca foi gravada. Reproduzido bloqueando
      // as escritas: 8 chamadas com 403 e o sucesso aparecendo mesmo assim.
      console.error(`[usePlatformSettings] falha ao salvar '${key}':`, error.message);
      throw new Error(error.message || `Não foi possível salvar '${key}'.`);
    }
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const getSetting = useCallback((key: string, defaultValue?: any) => {
    return settings[key] ?? defaultValue;
  }, [settings]);

  return { settings, loading, updateSetting, getSetting, refresh: fetchSettings };
}
