-- Dois motivos novos na fila de devolução Pix.
--
-- 'duplicate_payment': o mesmo usuário pagou duas cobranças para a mesma
-- viagem (aconteceu em produção antes do guard no create-pix-charge). É
-- devolução devida, independente da janela de cancelamento.
--
-- 'cancelled_outside_window': cancelou com menos que a janela gratuita, então
-- NÃO há devolução — a linha existe só como rastro de que a plataforma reteve
-- aquele valor. Entra na fila já com status 'dismissed' (nada a fazer); sem
-- isso o Pix retido não deixava registro nenhum e não havia como auditar uma
-- reclamação depois.
ALTER TABLE public.pix_refunds_pending
  DROP CONSTRAINT IF EXISTS pix_refunds_pending_reason_check;

ALTER TABLE public.pix_refunds_pending
  ADD CONSTRAINT pix_refunds_pending_reason_check CHECK (
    reason = ANY (ARRAY[
      'paid_after_expiry',
      'amount_mismatch',
      'expired_not_realized',
      'user_cancelled_in_window',
      'cancelled_outside_window',
      'duplicate_payment',
      'driver_cancelled',
      'admin_cancelled',
      'orphan_payment'
    ])
  );
