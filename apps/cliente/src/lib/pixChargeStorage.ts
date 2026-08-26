import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { PendingPixChargeParam } from '../navigation/types';

/**
 * Persistência da cobrança Pix real pendente (AsyncStorage) — no MÁXIMO UMA por
 * vez. Permite retomar o pagamento após cold start/foreground
 * (usePendingPixChargeResume). Guard de userId anti-vazamento entre contas no
 * mesmo aparelho (padrão de recentDestinations). Nenhuma função lança.
 */

const STORAGE_KEY = '@takeme/pending_pix_charge';

export type StoredPixCharge = PendingPixChargeParam;

export async function setPendingPixCharge(charge: StoredPixCharge): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(charge));
  } catch {
    // best-effort: sem storage, a retomada só não funciona
  }
}

export async function clearPendingPixCharge(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Cobrança pendente do usuário ATUAL, ainda não expirada. Filtra (e limpa)
 * cobrança expirada; cobrança de OUTRA conta é removida (anti-vazamento).
 * Sem sessão (deslogado), não retorna nada — mas preserva o registro para o
 * caso de o dono logar de novo antes de expirar.
 */
export async function getPendingPixCharge(): Promise<StoredPixCharge | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    let parsed: StoredPixCharge | null = null;
    try {
      const obj: unknown = JSON.parse(raw);
      parsed = obj && typeof obj === 'object' ? (obj as StoredPixCharge) : null;
    } catch {
      parsed = null;
    }
    if (
      !parsed ||
      typeof parsed.pixChargeId !== 'string' ||
      !parsed.pixChargeId ||
      typeof parsed.userId !== 'string' ||
      !parsed.userId ||
      typeof parsed.expiresAt !== 'string' ||
      !parsed.successNav ||
      typeof parsed.successNav !== 'object'
    ) {
      await clearPendingPixCharge();
      return null;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;
    if (!userId) return null;
    if (userId !== parsed.userId) {
      await clearPendingPixCharge();
      return null;
    }

    const expMs = new Date(parsed.expiresAt).getTime();
    if (!Number.isFinite(expMs) || expMs <= Date.now()) {
      await clearPendingPixCharge();
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
