-- Motivo próprio para "o motorista cancelou a viagem inteira".
--
-- cancel-scheduled-trip gateia o estorno por stripe_payment_intent_id; uma
-- reserva paga por Pix não tem PaymentIntent e passava batido, sem deixar nada
-- na fila de devolução. Agora ela entra aqui — com motivo próprio, porque o
-- financeiro precisa distinguir isso de desistência do passageiro.

ALTER TABLE public.pix_refunds_pending
  DROP CONSTRAINT IF EXISTS pix_refunds_pending_reason_check;

ALTER TABLE public.pix_refunds_pending
  ADD CONSTRAINT pix_refunds_pending_reason_check CHECK (
    reason = ANY (ARRAY[
      'paid_after_expiry',
      'amount_mismatch',
      'expired_not_realized',
      'user_cancelled_in_window',
      'driver_cancelled',
      'admin_cancelled',
      'orphan_payment'
    ])
  );
