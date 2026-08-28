import type { SupabaseClient } from '@supabase/supabase-js';

export type DriverPaymentTransferSource = 'payout' | 'booking' | 'completed_trip' | 'shipment';

export type DriverPaymentTransfer = {
  id: string;
  amount_cents: number;
  paid_at: string;
  source: DriverPaymentTransferSource;
  /**
   * Corrida paga por Pix cujo repasse ainda não saiu. Aparece na lista para o
   * motorista ver que a corrida existe, mas NÃO entra em nenhuma soma de
   * "recebido" — quem soma precisa filtrar por isto.
   */
  pending?: boolean;
};

/** Só o que o motorista de fato já recebeu (exclui Pix aguardando repasse). */
export function sumReceivedCents(list: DriverPaymentTransfer[]): number {
  return list.reduce((sum, t) => (t.pending ? sum : sum + t.amount_cents), 0);
}

type BookingRow = {
  id: string;
  amount_cents: number;
  worker_earning_cents?: number | null;
  status: string;
  paid_at: string | null;
  payment_method?: string | null;
};

/**
 * Pix é o único método em que a PLATAFORMA retém o dinheiro: o passageiro paga
 * para a conta da Take Me e o repasse ao motorista é feito por fora. Enquanto o
 * payout não estiver 'paid', esse valor NÃO é "recebido" — aparece em "A receber
 * da plataforma". (No cartão o split cai direto na conta do motorista; no
 * dinheiro ele recebe em mãos — nos dois casos o ganho sintético está correto.)
 *
 * Estas corridas continuam NA LISTA, marcadas com `pending`: sumir com elas
 * fazia o histórico dizer "nenhuma transferência neste mês" para quem tinha
 * rodado. Ficam de fora apenas das somas.
 */
function platformHoldsMoney(paymentMethod: string | null | undefined): boolean {
  return String(paymentMethod ?? '').trim().toLowerCase() === 'pix';
}

type CompletedTripRow = {
  id: string;
  updated_at: string;
  bookings: BookingRow[] | null;
};

function workerCents(row: { amount_cents: number; worker_earning_cents?: number | null }): number {
  const w = typeof row.worker_earning_cents === 'number' && Number.isFinite(row.worker_earning_cents)
    ? row.worker_earning_cents
    : null;
  if (w != null && w > 0) return w;
  return Number(row.amount_cents) || 0;
}

/**
 * Lista transferências/ganhos do motorista no intervalo.
 * - Payouts pagos no período (fonte oficial de repasse) +
 * - Ganhos sintéticos de serviços concluídos cujo payout AINDA não foi pago (reservas pagas,
 *   viagens concluídas, encomendas e encomendas de dependentes entregues). Entidades que já têm
 *   payout pago são excluídas dos sintéticos (paidKeys) para não duplicar.
 *
 * Fórmula dos ganhos: usa `worker_earning_cents` (split do PDF) quando disponível, com
 * fallback para `amount_cents` em bookings antigos (anteriores ao alinhamento de preços).
 */
export async function fetchDriverPaymentTransfers(
  supabase: SupabaseClient,
  userId: string,
  startIso: string,
  endIso: string
): Promise<DriverPaymentTransfer[]> {
  // Repasses oficiais já pagos no período (fonte da verdade). NÃO retornamos cedo aqui:
  // serviços concluídos cujo payout ainda não foi pago precisam aparecer também. Para evitar
  // dupla contagem, os ganhos sintéticos abaixo excluem entidades que já têm payout pago
  // (via paidKeys = '<entity_type>:<entity_id>').
  const { data: payoutsData } = await supabase
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

  const payoutTransfers: DriverPaymentTransfer[] = payoutRows.map((p) => ({
    id: p.id,
    amount_cents: p.worker_amount_cents,
    paid_at: p.paid_at,
    source: 'payout' as const,
  }));

  const paidKeys = new Set(
    payoutRows
      .filter((p) => p.entity_type && p.entity_id)
      .map((p) => `${p.entity_type}:${p.entity_id}`),
  );

  const { data: paidBookings } = await supabase
    .from('bookings')
    .select('id, amount_cents, worker_earning_cents, paid_at, status, payment_method, scheduled_trips!inner(driver_id)')
    .eq('scheduled_trips.driver_id', userId)
    .eq('status', 'paid')
    .gte('paid_at', startIso)
    .lte('paid_at', endIso)
    .order('paid_at', { ascending: false });

  const bookingTransfers: DriverPaymentTransfer[] = (paidBookings ?? [])
    .filter((b: BookingRow) => !paidKeys.has(`booking:${b.id}`))
    .map((b: BookingRow) => ({
      id: b.id,
      amount_cents: workerCents(b),
      paid_at: b.paid_at as string,
      source: 'booking' as const,
      ...(platformHoldsMoney(b.payment_method) ? { pending: true } : {}),
    }));

  const listedPaidBookingIds = new Set(bookingTransfers.map((t) => t.id));

  const { data: completedTrips } = await supabase
    .from('scheduled_trips')
    .select('id, updated_at, bookings(id, amount_cents, worker_earning_cents, status, paid_at, payment_method)')
    .eq('driver_id', userId)
    .eq('status', 'completed')
    .gte('updated_at', startIso)
    .lte('updated_at', endIso);

  const tripTransfers: DriverPaymentTransfer[] = [];

  for (const trip of (completedTrips ?? []) as CompletedTripRow[]) {
    const rows = trip.bookings ?? [];
    let extra = 0;
    let extraPending = 0;
    for (const b of rows) {
      if (b.status !== 'confirmed' && b.status !== 'paid') continue;
      if (listedPaidBookingIds.has(b.id)) continue;
      if (paidKeys.has(`booking:${b.id}`)) continue; // já contabilizada como payout pago
      // Pix e recebido vão em linhas separadas: somar juntos criaria um valor
      // que é parte "na mão" e parte "a receber", impossível de rotular.
      if (platformHoldsMoney(b.payment_method)) extraPending += workerCents(b);
      else extra += workerCents(b);
    }
    if (extra > 0) {
      tripTransfers.push({
        id: `st-${trip.id}`,
        amount_cents: extra,
        paid_at: trip.updated_at,
        source: 'completed_trip',
      });
    }
    if (extraPending > 0) {
      tripTransfers.push({
        id: `st-pix-${trip.id}`,
        amount_cents: extraPending,
        paid_at: trip.updated_at,
        source: 'completed_trip',
        pending: true,
      });
    }
  }

  // Encomendas (shipments) entregues pelo motorista no período. O ganho é worker_earning_cents
  // (perna base->destino ou entrega direta). As que já têm payout pago são excluídas (paidKeys),
  // aparecendo só como payout — sem dupla contagem.
  const { data: deliveredShipments } = await supabase
    .from('shipments')
    .select('id, amount_cents, worker_earning_cents, delivered_at, payment_method')
    .eq('driver_id', userId)
    .eq('status', 'delivered')
    .gte('delivered_at', startIso)
    .lte('delivered_at', endIso)
    .order('delivered_at', { ascending: false });

  const shipmentTransfers: DriverPaymentTransfer[] = ((deliveredShipments ?? []) as Array<{
    id: string; amount_cents: number; worker_earning_cents?: number | null; delivered_at: string | null; payment_method?: string | null;
  }>)
    .filter((s) => s.delivered_at && !paidKeys.has(`shipment:${s.id}`))
    .map((s) => ({
      id: `sh-${s.id}`,
      amount_cents: workerCents(s),
      paid_at: s.delivered_at as string,
      source: 'shipment' as const,
      ...(platformHoldsMoney(s.payment_method) ? { pending: true } : {}),
    }));

  // Encomendas de dependentes entregues via a viagem do motorista (driver vem de scheduled_trips).
  const { data: deliveredDepShipments } = await supabase
    .from('dependent_shipments')
    .select('id, amount_cents, worker_earning_cents, delivered_at, payment_method, scheduled_trips!inner(driver_id)')
    .eq('scheduled_trips.driver_id', userId)
    .eq('status', 'delivered')
    .gte('delivered_at', startIso)
    .lte('delivered_at', endIso)
    .order('delivered_at', { ascending: false });

  const depShipmentTransfers: DriverPaymentTransfer[] = ((deliveredDepShipments ?? []) as Array<{
    id: string; amount_cents: number; worker_earning_cents?: number | null; delivered_at: string | null; payment_method?: string | null;
  }>)
    .filter((s) => s.delivered_at)
    .map((s) => ({
      id: `dsh-${s.id}`,
      amount_cents: workerCents(s),
      paid_at: s.delivered_at as string,
      source: 'shipment' as const,
      ...(platformHoldsMoney(s.payment_method) ? { pending: true } : {}),
    }));

  const combined = [
    ...payoutTransfers,
    ...bookingTransfers,
    ...tripTransfers,
    ...shipmentTransfers,
    ...depShipmentTransfers,
  ].sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());

  return combined;
}
