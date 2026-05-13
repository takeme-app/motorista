import { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export type AdminPermissions = Record<string, boolean>;

const ALL_GRANTED: AdminPermissions = {
  inicio: true, viagens: true, passageiros: true, motoristas: true,
  destinos: true, encomendas: true, preparadores: true, promocoes: true,
  pagamentos: true, atendimento: true, notificacoes: true, avaliacoes: true,
  analytics: true, configuracoes: true,
};

/** Map de path do menu → chave de permissão */
export const PATH_TO_PERMISSION: Record<string, string> = {
  '/': 'inicio',
  '/viagens': 'viagens',
  '/passageiros': 'passageiros',
  '/motoristas': 'motoristas',
  '/destinos': 'destinos',
  '/encomendas': 'encomendas',
  '/preparadores': 'preparadores',
  '/promocoes': 'promocoes',
  '/pagamentos': 'pagamentos',
  '/atendimentos': 'atendimento',
  '/notificacoes': 'notificacoes',
  '/avaliacoes': 'avaliacoes',
  '/analytics': 'analytics',
  '/configuracoes': 'configuracoes',
};

export function useAdminPermissions() {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const isAdmin = session?.user?.app_metadata?.role === 'admin';
  const [permissions, setPermissions] = useState<AdminPermissions>(ALL_GRANTED);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured || !userId || !isAdmin) {
      setPermissions(ALL_GRANTED);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await (supabase as any)
        .from('user_preferences')
        .select('value')
        .eq('user_id', userId)
        .eq('key', 'admin_permissions')
        .maybeSingle();
      if (cancelled) return;
      if (data?.value && typeof data.value === 'object') {
        // Merge with ALL_GRANTED to ensure new modules default to true
        setPermissions({ ...ALL_GRANTED, ...data.value });
      } else {
        // No permissions set → admin type gets all, suporte gets limited
        setPermissions(ALL_GRANTED);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, isAdmin]);

  const canAccess = (pathOrKey: string): boolean => {
    const key = PATH_TO_PERMISSION[pathOrKey] || pathOrKey;
    return permissions[key] !== false;
  };

  return { permissions, loading, canAccess };
}
