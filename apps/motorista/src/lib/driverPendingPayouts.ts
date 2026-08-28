import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Repasses que a PLATAFORMA deve ao motorista.
 *
 * Espelho do "saldo devido à plataforma" (corridas em dinheiro, onde o motorista
 * recebeu em mãos e deve a taxa). Aqui é o contrário: em corridas pagas por Pix
 * o dinheiro cai na conta da Take Me e o repasse é feito por fora — então o
 * motorista fica CREDOR até o financeiro pagar.
 *
 * Conta apenas `payouts` já criados (nascem na conclusão da viagem, via
 * fn_create_payouts_on_trip_complete) que ainda não foram pagos:
 *   pending    → aguardando processamento do repasse
 *   processing → repasse em andamento (lote manual Pix)
 * `paid` não entra: já virou "recebido" na soma do topo da tela.
 */
export type PendingPayoutsSummary = {
  totalCents: number;
  count: number;
  /** Chave Pix cadastrada — destino do repasse. Null quando falta cadastrar. */
  pixKey: string | null;
  /** Não foi possível consultar (rede/RLS): a UI mostra aviso em vez de R$ 0,00. */
  unavailable: boolean;
};

const EMPTY: PendingPayoutsSummary = {
  totalCents: 0,
  count: 0,
  pixKey: null,
  unavailable: false,
};

export async function fetchDriverPendingPayouts(
  supabase: SupabaseClient,
  workerId: string,
): Promise<PendingPayoutsSummary> {
  try {
    const [payoutsRes, workerRes] = await Promise.all([
      supabase
        .from('payouts')
        .select('worker_amount_cents')
        .eq('worker_id', workerId)
        .in('status', ['pending', 'processing']),
      supabase.from('worker_profiles').select('pix_key').eq('id', workerId).maybeSingle(),
    ]);

    if (payoutsRes.error) return { ...EMPTY, unavailable: true };

    const rows = (payoutsRes.data ?? []) as { worker_amount_cents: number | null }[];
    const totalCents = rows.reduce((sum, r) => sum + (Number(r.worker_amount_cents) || 0), 0);
    const pixKey =
      ((workerRes.data as { pix_key?: string | null } | null)?.pix_key ?? '').trim() || null;

    return { totalCents, count: rows.length, pixKey, unavailable: false };
  } catch {
    return { ...EMPTY, unavailable: true };
  }
}
