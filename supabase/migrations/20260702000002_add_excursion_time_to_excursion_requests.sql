-- Horário desejado da excursão (separado da data). scheduled_departure_at é da
-- operação (admin); este é o horário solicitado pelo cliente no formulário.
ALTER TABLE public.excursion_requests
  ADD COLUMN IF NOT EXISTS excursion_time time;
