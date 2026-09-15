-- Vazamento de dados entre usuários.
--
-- Três policies chamadas "Authenticated admin can read all X" foram escritas
-- com `auth.role() = 'authenticated'` em vez de `is_admin()`. Como toda sessão
-- logada tem role 'authenticated', na prática QUALQUER usuário do app lia a
-- tabela inteira. Medido antes da remoção, com a identidade de um cliente
-- comum: 19 reservas visíveis (18 de outras pessoas) e 5 encomendas (3 de
-- outras pessoas) — endereços, valores e dados de passageiro de estranhos.
--
-- Cada tabela já tinha a cobertura correta por baixo, verificada em transação
-- revertida com as consultas reais dos apps:
--   bookings        dono (user_id), motorista da viagem, admin (is_admin_v2)
--   shipments       dono, motorista (ofertada/preferida/viagem/base), admin
--   scheduled_trips dono do cronograma, listagem de ativas, passageiro com
--                   reserva, admin
--
-- Depois: cliente passou a ver só a própria reserva; motorista seguiu vendo as
-- 4 reservas das viagens dele e as 21 viagens do cronograma; a listagem de
-- viagens ativas para o cliente continuou intacta.
DROP POLICY IF EXISTS "Authenticated admin can read all bookings" ON public.bookings;
DROP POLICY IF EXISTS "Authenticated admin can read all shipments" ON public.shipments;
DROP POLICY IF EXISTS "Authenticated admin can read all trips" ON public.scheduled_trips;
