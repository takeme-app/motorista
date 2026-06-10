-- Motivo e comprovante (opcional) da ausência justificada de passageiro de excursão.
-- Preenchidos na nova tela "Justificar ausência" (app motorista, preparador de excursão).
ALTER TABLE public.excursion_passengers
  ADD COLUMN IF NOT EXISTS absence_reason text,
  ADD COLUMN IF NOT EXISTS absence_attachment_url text;
