-- Preenche automaticamente a tabela `holidays` (usada pelo adicional de feriado da rota,
-- holiday_surcharge_pct) com os feriados nacionais do Brasil — fixos e móveis (base na Páscoa).
-- Idempotente via ON CONFLICT (holiday_date): nunca sobrescreve nem duplica feriados já cadastrados.
-- Agendado mensalmente por pg_cron para manter o ano atual e o próximo sempre populados.
-- (Aplicado em produção via MCP; este arquivo versiona a mudança.)

-- 1. Domingo de Páscoa (algoritmo de Computus / Meeus-Jones-Butcher, calendário gregoriano).
CREATE OR REPLACE FUNCTION public.easter_sunday(p_year int)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int;
  mo int; da int;
BEGIN
  a := p_year % 19;
  b := p_year / 100;
  c := p_year % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  mo := (h + l - 7 * m + 114) / 31;
  da := ((h + l - 7 * m + 114) % 31) + 1;
  RETURN make_date(p_year, mo, da);
END;
$$;

-- 2. Insere os feriados nacionais brasileiros de um ano. Retorna quantos foram efetivamente inseridos.
CREATE OR REPLACE FUNCTION public.populate_brazilian_holidays(p_year int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_easter date := public.easter_sunday(p_year);
  v_inserted int;
BEGIN
  WITH base(d, nome) AS (
    VALUES
      (make_date(p_year, 1, 1),   'Confraternização Universal (Ano Novo)'),
      (v_easter - 47,             'Carnaval'),
      (v_easter - 2,              'Sexta-feira Santa'),
      (make_date(p_year, 4, 21),  'Tiradentes'),
      (make_date(p_year, 5, 1),   'Dia do Trabalho'),
      (v_easter + 60,             'Corpus Christi'),
      (make_date(p_year, 9, 7),   'Independência do Brasil'),
      (make_date(p_year, 10, 12), 'Nossa Senhora Aparecida'),
      (make_date(p_year, 11, 2),  'Finados'),
      (make_date(p_year, 11, 15), 'Proclamação da República'),
      (make_date(p_year, 12, 25), 'Natal')
  ),
  todos AS (
    SELECT d, nome FROM base
    UNION ALL
    -- Feriado nacional desde a Lei 14.759/2023 (vigência a partir de 2024).
    SELECT make_date(p_year, 11, 20), 'Dia da Consciência Negra'
    WHERE p_year >= 2024
  ),
  ins AS (
    INSERT INTO public.holidays (holiday_date, name, is_active)
    SELECT d, nome, true FROM todos
    ON CONFLICT (holiday_date) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;
  RETURN v_inserted;
END;
$$;

-- 3. Wrapper para o cron: garante ano atual + próximo.
CREATE OR REPLACE FUNCTION public.populate_brazilian_holidays_auto()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  y int := extract(year FROM now())::int;
BEGIN
  PERFORM public.populate_brazilian_holidays(y);
  PERFORM public.populate_brazilian_holidays(y + 1);
END;
$$;

-- 4. Agenda mensal (dia 1, 04:00 UTC). Idempotente — re-agenda sem duplicar.
SELECT cron.unschedule('populate-brazilian-holidays')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'populate-brazilian-holidays');

SELECT cron.schedule(
  'populate-brazilian-holidays',
  '0 4 1 * *',
  'SELECT public.populate_brazilian_holidays_auto();'
);

-- 5. Popula imediatamente o ano atual e os dois próximos.
SELECT public.populate_brazilian_holidays(extract(year FROM now())::int);
SELECT public.populate_brazilian_holidays(extract(year FROM now())::int + 1);
SELECT public.populate_brazilian_holidays(extract(year FROM now())::int + 2);
