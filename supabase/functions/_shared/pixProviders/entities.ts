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
 * Fase 1: bookings pending→paid espelhando o stripe-webhook (guard idempotente
 * `.eq('status','pending')`) + pix_paid_at. Demais tipos lançam
 * UnsupportedEntityError — o chamador registra na fila + log.
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

  // shipment / dependent_shipment / excursion: fases 2+.
  throw new UnsupportedEntityError(entityType);
}
