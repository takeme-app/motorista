// Promoção de entidade por tipo + normalização dos dicionários de payment_method.
//
// Os 3 dicionários de payment_method do banco:
//   bookings            → 'card' | 'pix' | 'cash'
//   shipments/dependent → 'credito' | 'debito' | 'pix' | 'dinheiro' (sem CHECK)
//   excursion_requests  → 'credit_card' | 'debit_card' | 'pix' | 'cash'
// Todos aceitam o literal 'pix' (verificado no plano) — a normalização importa
// só para GATES que comparam método, não para o valor gravado.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type PixEntityType = "booking" | "shipment" | "dependent_shipment" | "excursion";

export const ENTITY_TABLE: Record<PixEntityType, string> = {
  booking: "bookings",
  shipment: "shipments",
  dependent_shipment: "dependent_shipments",
  excursion: "excursion_requests",
};

/** Literal de payment_method para Pix — igual nos 3 dicionários. */
export function pixPaymentMethodLiteral(_entityType: PixEntityType): string {
  return "pix";
}

/** Entidade ainda sem promoção implementada (fases 2+). O webhook NUNCA vira 500 por isso. */
export class UnsupportedEntityError extends Error {
  constructor(entityType: string) {
    super(`Promoção de entidade '${entityType}' ainda não suportada (fases 2+).`);
    this.name = "UnsupportedEntityError";
  }
}

export type PromoteResult = { promoted: boolean };

/**
 * Promove a entidade após a liquidação da cobrança Pix.
 * bookings: pending→paid espelhando o stripe-webhook (guard idempotente
 * `.eq('status','pending')`) + pix_paid_at. shipments e dependent_shipments:
 * só pix_paid_at (o status já é o final; o portão está nos gatilhos).
 * excursion: quoted→approved + confirmed_at + payouts (é o único fluxo cujo
 * pedido já existia antes do pagamento).
 */
export async function promoteEntityPaid(
  admin: SupabaseClient,
  entityType: PixEntityType,
  entityId: string,
  paidAtIso: string,
): Promise<PromoteResult> {
  if (entityType === "booking") {
    const { data, error } = await admin
      .from("bookings")
      .update({
        status: "paid",
        paid_at: paidAtIso,
        pix_paid_at: paidAtIso,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", entityId)
      .eq("status", "pending")
      .select("id");
    if (error) throw new Error(`promoção do booking falhou: ${error.message}`);
    return { promoted: Array.isArray(data) && data.length > 0 };
  }

  if (entityType === "shipment") {
    // A encomenda já nasceu com o status final ('confirmed' ou 'pending_review')
    // — o que a segurava era o portão do gatilho de fila, que não oferta
    // enquanto pix_paid_at estiver nulo. Marcar o pagamento é, portanto, o que
    // LIBERA a oferta ao motorista: o próprio trigger reavalia no UPDATE
    // (migration shipment_pix_real_queue_gate) e abre a fila.
    //
    // Guard idempotente em pix_paid_at IS NULL: webhook e polling podem chegar
    // juntos, e abrir a fila duas vezes bagunçaria o rodízio de ofertas.
    const { data, error } = await admin
      .from("shipments")
      .update({
        pix_paid_at: paidAtIso,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", entityId)
      .is("pix_paid_at", null)
      .select("id");
    if (error) throw new Error(`promoção da encomenda falhou: ${error.message}`);
    return { promoted: Array.isArray(data) && data.length > 0 };
  }

  if (entityType === "dependent_shipment") {
    // Como a encomenda, o envio de dependente já nasce com o status final
    // ('pending_review') — o que o segurava era o portão do gatilho de
    // notificação, que não avisa o motorista enquanto pix_paid_at for nulo.
    // Marcar o pagamento é, portanto, o que dispara a notificação: o próprio
    // gatilho reavalia no UPDATE (migration
    // dependent_shipment_pix_real_notify_gate).
    //
    // Guard idempotente em pix_paid_at IS NULL: webhook e polling podem chegar
    // juntos, e notificar duas vezes encheria o motorista de push repetido.
    const { data, error } = await admin
      .from("dependent_shipments")
      .update({
        pix_paid_at: paidAtIso,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", entityId)
      .is("pix_paid_at", null)
      .select("id");
    if (error) throw new Error(`promoção do envio de dependente falhou: ${error.message}`);
    return { promoted: Array.isArray(data) && data.length > 0 };
  }

  if (entityType === "excursion") {
    // A excursão é o único fluxo em que o pedido JÁ EXISTE antes do pagamento:
    // o cliente pede, o preparador orça (status 'quoted') e o pagamento aprova.
    // Por isso aqui a liquidação faz a transição de status de verdade —
    // espelhando o stripe-webhook (cartão) e o confirm-excursion-cash
    // (dinheiro), inclusive a criação dos payouts do motorista e do preparador,
    // que só existem a partir da aprovação.
    const { data, error } = await admin
      .from("excursion_requests")
      .update({
        status: "approved",
        payment_method: "pix",
        confirmed_at: paidAtIso,
        pix_paid_at: paidAtIso,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", entityId)
      .eq("status", "quoted")
      .is("pix_paid_at", null)
      .select(
        "id, driver_id, preparer_id, total_amount_cents, worker_payout_cents, preparer_payout_cents",
      )
      .maybeSingle();
    if (error) throw new Error(`aprovação da excursão falhou: ${error.message}`);
    if (!data) return { promoted: false };

    const exc = data as {
      id: string;
      driver_id: string | null;
      preparer_id: string | null;
      total_amount_cents: number | null;
      worker_payout_cents: number | null;
      preparer_payout_cents: number | null;
    };

    // Invariante do fluxo: driverAmount + preparerAmount == worker_payout_cents.
    const workerTotal = Number(exc.worker_payout_cents) || 0;
    const preparerAmount = Math.max(0, Number(exc.preparer_payout_cents) || 0);
    const driverAmount = Math.max(0, workerTotal - preparerAmount);
    const grossTotal = Number(exc.total_amount_cents) || workerTotal;

    const payoutsToInsert: Array<Record<string, unknown>> = [];
    if (exc.driver_id && driverAmount > 0) {
      payoutsToInsert.push({
        worker_id: exc.driver_id,
        entity_type: "excursion",
        entity_id: exc.id,
        gross_amount_cents: grossTotal,
        worker_amount_cents: driverAmount,
        admin_amount_cents: 0,
        payout_method: "pix",
        status: "pending",
      });
    }
    if (exc.preparer_id && preparerAmount > 0) {
      payoutsToInsert.push({
        worker_id: exc.preparer_id,
        entity_type: "excursion",
        entity_id: exc.id,
        gross_amount_cents: grossTotal,
        worker_amount_cents: preparerAmount,
        admin_amount_cents: 0,
        payout_method: "pix",
        status: "pending",
      });
    }

    if (payoutsToInsert.length === 0) {
      console.warn(
        `[promoteEntityPaid] excursão ${exc.id} aprovada sem payouts (driver/preparer ausentes ou valores zero).`,
      );
      return { promoted: true };
    }

    const { error: payoutsErr } = await admin.from("payouts").insert(payoutsToInsert as never);
    if (payoutsErr) {
      // A excursão JÁ está aprovada e paga — não desfazer por causa da fila de
      // repasse. O admin resolve pelo painel; devolver promoted:false aqui
      // mandaria o dinheiro do cliente para a fila de devolução por engano.
      console.error(
        `[promoteEntityPaid] falha ao inserir payouts da excursão ${exc.id}:`,
        payoutsErr.message,
      );
    }
    return { promoted: true };
  }

  throw new UnsupportedEntityError(entityType);
}
