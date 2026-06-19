-- Adiciona data de retorno da excursão para permitir calcular diária preparador × dias.
-- PDF "Fórmulas de Preços App Takeme": preparador de excursão = daily_rate_cents × (volta − ida) + adicionais.

alter table public.excursion_requests
  add column if not exists scheduled_return_at timestamptz;

comment on column public.excursion_requests.scheduled_return_at is
  'Data/hora prevista de retorno da excursão. Usada pela BO para calcular diária × dias no orçamento do preparador.';
