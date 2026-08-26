// settlePixCharge — núcleo ÚNICO de liquidação de cobranças Pix.
// Usado por: asaas-webhook, get-pix-charge-status (polling), expire-pix-charges
// e reconcile-pix. Nunca confia no payload de webhook: `fresh` DEVE vir de uma
// re-consulta GET no provedor.
//
// Regras:
//   - guard de valor: pago ≠ esperado ⇒ amount_mismatch + fila (pedido segue
//     pending até expirar);
//   - UPDATE de pix_charges sempre com guard de status (idempotente sob
//     webhooks duplicados/concorrentes);
//   - promoção da entidade por tipo (fase 1: bookings pending→paid);
//   - qualquer desvio (pago após expirar, entidade não promovida, tipo ainda
//     não suportado) vira linha em pix_refunds_pending — dinheiro recebido
//     nunca se perde em silêncio.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ProviderChargeSnapshot } from "./types.ts";
import { createPixProvider } from "./index.ts";
import {
  type PixEntityType,
  promoteEntityPaid,
  UnsupportedEntityError,
} from "./entities.ts";

export type PixChargeRow = {
  id: string;
  provider: "asaas" | "bradesco";
  provider_env: "sandbox" | "production";
  provider_charge_id: string | null;
  entity_type: PixEntityType;
  entity_id: string;
  user_id: string;
  expected_amount_cents: number;
  status: string;
  expires_at: string | null;
};

export const PIX_CHARGE_ROW_COLUMNS =
  "id, provider, provider_env, provider_charge_id, entity_type, entity_id, user_id, expected_amount_cents, status, expires_at";

/** Resultado no formato do payment_webhook_events.processing_result. */
export type SettleResult =
  | "settled"
  | "duplicate"
  | "mismatch"
  | "orphan"
  | "ignored"
  | `error:${string}`;

type RefundQueueInsert = {
  pix_charge_id: string | null;
  entity_type: PixEntityType | null;
  entity_id: string | null;
  user_id: string | null;
  amount_cents: number;
  reason:
    | "paid_after_expiry"
    | "amount_mismatch"
    | "expired_not_realized"
    | "user_cancelled_in_window"
    | "admin_cancelled"
    | "orphan_payment";
  notes?: string | null;
};

/**
 * Enfileira devolução manual com dedup leve: não duplica linha pendente da
 * mesma cobrança+motivo (webhooks reentregues, reconcile diário).
 */
export async function queuePixRefund(
  admin: SupabaseClient,
  row: RefundQueueInsert,
): Promise<void> {
  if (row.pix_charge_id) {
    const { data: existing } = await admin
      .from("pix_refunds_pending")
      .select("id")
      .eq("pix_charge_id", row.pix_charge_id)
      .eq("reason", row.reason)
      .eq("status", "pending")
      .limit(1);
    if (Array.isArray(existing) && existing.length > 0) return;
  }
  const { error } = await admin.from("pix_refunds_pending").insert({
    pix_charge_id: row.pix_charge_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    user_id: row.user_id,
    amount_cents: Math.max(0, Math.floor(row.amount_cents)),
    reason: row.reason,
    notes: row.notes ?? null,
  } as never);
  if (error) {
    console.error("[settlePixCharge] fila de devolução falhou:", error.message, row);
  }
}

function toPaidAtIso(fresh: ProviderChargeSnapshot): string {
  if (fresh.paidAt) {
    const ms = Date.parse(fresh.paidAt);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

/**
 * Liquida `charge` a partir do snapshot `fresh` re-consultado no provedor.
 * Idempotente: chamadas repetidas/concorrentes convergem para 'duplicate'.
 */
export async function settlePixCharge(
  admin: SupabaseClient,
  charge: PixChargeRow,
  fresh: ProviderChargeSnapshot,
): Promise<SettleResult> {
  // create em voo: webhook chegou antes do UPDATE pós-createCharge — completa o vínculo.
  if (!charge.provider_charge_id && fresh.providerChargeId) {
    await admin
      .from("pix_charges")
      .update({ provider_charge_id: fresh.providerChargeId, updated_at: new Date().toISOString() } as never)
      .eq("id", charge.id)
      .is("provider_charge_id", null);
  }

  if (fresh.status !== "paid") {
    // Não pago (pending/expired/refunded no provedor): nada a liquidar aqui.
    // Expiração é do cron; refund é fila manual.
    return "ignored";
  }

  const nowIso = new Date().toISOString();
  const paidAtIso = toPaidAtIso(fresh);
  const paidAmount = fresh.paidAmountCents ?? charge.expected_amount_cents;

  if (charge.status === "paid") return "duplicate";

  // Já registrada como desvio (mismatch/órfã): a fila manual já existe.
  if (charge.status === "amount_mismatch" || charge.status === "paid_orphan") {
    return "duplicate";
  }

  if (charge.status === "pending") {
    // Guard de valor: pago ≠ esperado ⇒ NÃO promove o pedido (segue pending até expirar).
    if (paidAmount !== charge.expected_amount_cents) {
      const { data: updated } = await admin
        .from("pix_charges")
        .update({
          status: "amount_mismatch",
          paid_amount_cents: paidAmount,
          paid_at: paidAtIso,
          failure_reason:
            `valor pago (${paidAmount}) difere do esperado (${charge.expected_amount_cents})`,
          updated_at: nowIso,
        } as never)
        .eq("id", charge.id)
        .eq("status", "pending")
        .select("id");
      if (!Array.isArray(updated) || updated.length === 0) return "duplicate";
      await queuePixRefund(admin, {
        pix_charge_id: charge.id,
        entity_type: charge.entity_type,
        entity_id: charge.entity_id,
        user_id: charge.user_id,
        amount_cents: paidAmount,
        reason: "amount_mismatch",
      });
      return "mismatch";
    }

    // Caminho feliz: pix_charges pending→paid (guard) + promoção da entidade.
    const { data: updated, error: updErr } = await admin
      .from("pix_charges")
      .update({
        status: "paid",
        paid_amount_cents: paidAmount,
        paid_at: paidAtIso,
        updated_at: nowIso,
      } as never)
      .eq("id", charge.id)
      .eq("status", "pending")
      .select("id");
    if (updErr) return `error:${updErr.message}`;
    if (!Array.isArray(updated) || updated.length === 0) return "duplicate";

    try {
      const { promoted } = await promoteEntityPaid(
        admin,
        charge.entity_type,
        charge.entity_id,
        paidAtIso,
      );
      if (!promoted) {
        // Cobrança paga mas o pedido já saiu de pending (ex.: cancelado numa
        // corrida com a expiração) — devolução manual.
        await admin
          .from("pix_charges")
          .update({
            failure_reason: "pago, mas o pedido não estava mais pending (não promovido)",
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", charge.id);
        await queuePixRefund(admin, {
          pix_charge_id: charge.id,
          entity_type: charge.entity_type,
          entity_id: charge.entity_id,
          user_id: charge.user_id,
          amount_cents: paidAmount,
          reason: "paid_after_expiry",
          notes: "pedido não estava mais pending na promoção",
        });
        return "orphan";
      }
      return "settled";
    } catch (e) {
      if (e instanceof UnsupportedEntityError) {
        console.error("[settlePixCharge]", e.message, charge.id);
        await queuePixRefund(admin, {
          pix_charge_id: charge.id,
          entity_type: charge.entity_type,
          entity_id: charge.entity_id,
          user_id: charge.user_id,
          amount_cents: paidAmount,
          reason: "orphan_payment",
          notes: e.message,
        });
        return "error:unsupported_entity";
      }
      return `error:${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // Pago DEPOIS de terminal (expired/cancelled/create_failed): pedido segue
  // como está; cobrança vira paid_orphan + fila de devolução.
  const { data: updated } = await admin
    .from("pix_charges")
    .update({
      status: "paid_orphan",
      paid_amount_cents: paidAmount,
      paid_at: paidAtIso,
      failure_reason: `pagamento recebido com cobrança ${charge.status}`,
      updated_at: nowIso,
    } as never)
    .eq("id", charge.id)
    .eq("status", charge.status)
    .select("id");
  if (!Array.isArray(updated) || updated.length === 0) return "duplicate";
  await queuePixRefund(admin, {
    pix_charge_id: charge.id,
    entity_type: charge.entity_type,
    entity_id: charge.entity_id,
    user_id: charge.user_id,
    amount_cents: paidAmount,
    reason: charge.status === "expired" ? "paid_after_expiry" : "orphan_payment",
    notes: `cobrança estava '${charge.status}' quando o pagamento chegou`,
  });
  return "orphan";
}

/**
 * Re-consulta o provedor da PRÓPRIA linha (nunca o da flag) e liquida.
 * Usado por get-pix-charge-status, expire-pix-charges e reconcile-pix.
 */
export async function refreshAndSettlePixCharge(
  admin: SupabaseClient,
  charge: PixChargeRow,
): Promise<{ fresh: ProviderChargeSnapshot; result: SettleResult }> {
  if (!charge.provider_charge_id) {
    return {
      fresh: {
        providerChargeId: "",
        status: "unknown",
        paidAmountCents: null,
        paidAt: null,
        externalReference: null,
        raw: null,
      },
      result: "ignored",
    };
  }
  const provider = createPixProvider(admin, charge.provider);
  const fresh = await provider.getChargeStatus(charge.provider_charge_id);
  const result = await settlePixCharge(admin, charge, fresh);
  return { fresh, result };
}
