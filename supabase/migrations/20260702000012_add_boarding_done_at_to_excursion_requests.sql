-- Marca quando o preparador FINALIZOU o embarque de cada fase (ida/volta).
-- check_in_*_started_at = fase aberta; boarding_*_done_at = fase finalizada.
ALTER TABLE public.excursion_requests
  ADD COLUMN IF NOT EXISTS boarding_ida_done_at timestamptz,
  ADD COLUMN IF NOT EXISTS boarding_volta_done_at timestamptz;

COMMENT ON COLUMN public.excursion_requests.boarding_ida_done_at IS
  'Quando o embarque de ida foi finalizado pelo preparador (tela de sucesso).';
COMMENT ON COLUMN public.excursion_requests.boarding_volta_done_at IS
  'Quando o embarque de volta foi finalizado pelo preparador.';
