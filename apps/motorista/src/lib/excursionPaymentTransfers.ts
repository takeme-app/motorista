import type { SupabaseClient } from '@supabase/supabase-js';

export type ExcursionPaymentTransferSource = 'payout' | 'excursion';

export type ExcursionPaymentTransfer = {
  id: string;
  amount_cents: number;
  paid_at: string;
  source: ExcursionPaymentTransferSource;
};

type ExcursionRow = {
  id: string;
  driver_id: string | null;
  preparer_id: string | null;
  worker_payout_cents: number | null;
  preparer_payout_cents: number | null;
  boarding_volta_done_at: string | null;
  boarding_ida_done_at: string | null;
  updated_at: string | null;
};

/**
 * Ganhos do trabalhador de excursões no intervalo.
 * - Payouts pagos no período (fonte oficial) → source 'payout' +
 * - Excursões CONCLUÍDAS do trabalhador (driver e/ou preparador) cujo payout AINDA não foi pago,
 *   creditando a parcela do seu papel. Excursões já pagas são excluídas (paidExcursionIds) para
 *   não duplicar. Mesma estratégia da tela de corridas (driverPaymentTransfers.ts).
 *
 * Divisão (igual ao split criado no stripe-webhook):
 *   driver    = worker_payout_cents − preparer_payout_cents
 *   preparador = preparer_payout_cents
 */
export async function fetchExcursionPaymentTransfers(
  supabase: SupabaseClient,
  userId: string,
  startIso: string,
  endIso: string,
): Promise<ExcursionPaymentTransfer[]> {
  // Payouts pagos no período + excursões concluídas cujo payout ainda não foi pago. NÃO retorna
  // cedo: senão uma excursão concluída some assim que outro repasse do período é pago. Dedupe por
  // entity_id (paidKeys) evita dupla contagem.
  const { data: payoutsData } = await (supabase as any)
    .from('payouts')
    .select('id, worker_amount_cents, paid_at, entity_type, entity_id')
    .eq('worker_id', userId)
    .eq('status', 'paid')
    .gte('paid_at', startIso)
    .lte('paid_at', endIso)
    .order('paid_at', { ascending: false });

  const payoutRows = (payoutsData ?? []) as {
    id: string; worker_amount_cents: number; paid_at: string; entity_type: string | null; entity_id: string | null;
  }[];

  const payoutTransfers: ExcursionPaymentTransfer[] = payoutRows.map((p) => ({
    id: p.id,
    amount_cents: p.worker_amount_cents,
    paid_at: p.paid_at,
    source: 'payout' as const,
  }));

  const paidExcursionIds = new Set(
    payoutRows.filter((p) => p.entity_type === 'excursion' && p.entity_id).map((p) => p.entity_id as string),
  );

  const { data: completed } = await (supabase as any)
    .from('excursion_requests')
    .select(
      'id, driver_id, preparer_id, worker_payout_cents, preparer_payout_cents, boarding_volta_done_at, boarding_ida_done_at, updated_at',
    )
    .eq('status', 'completed')
    .or(`driver_id.eq.${userId},preparer_id.eq.${userId}`);

  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();

  const transfers: ExcursionPaymentTransfer[] = [];
  for (const r of (completed ?? []) as ExcursionRow[]) {
    if (paidExcursionIds.has(r.id)) continue; // já contabilizada como payout pago
    const completedAt = r.boarding_volta_done_at ?? r.boarding_ida_done_at ?? r.updated_at;
    if (!completedAt) continue;
    const ts = new Date(completedAt).getTime();
    if (Number.isNaN(ts) || ts < startMs || ts > endMs) continue;

    const total = Number(r.worker_payout_cents) || 0;
    const prep = Number(r.preparer_payout_cents) || 0;
    let share = 0;
    if (r.driver_id === userId) share += Math.max(0, total - prep);
    if (r.preparer_id === userId) share += prep;
    if (share <= 0) continue;

    transfers.push({
      id: `exc-${r.id}`,
      amount_cents: share,
      paid_at: completedAt,
      source: 'excursion',
    });
  }

  return [...payoutTransfers, ...transfers].sort(
    (a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime(),
  );
}
