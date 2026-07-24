-- Permite ao admin (anon key + is_admin()) CRIAR uma reserva para outro usuário
-- na viagem — feature "Adicionar passageiro" do painel admin. Antes só existia
-- INSERT com `auth.uid() = user_id` (o próprio cliente), então o admin não
-- conseguia criar reserva para um passageiro. O trigger de capacidade
-- (bookings_manage_trip_capacity) continua barrando overbooking e dando baixa
-- em seats_available automaticamente.
-- IMPORTANTE: aplicar esta policy em produção (via Supabase SQL Editor ou CLI)
-- antes de usar o botão "Adicionar passageiro" no painel admin. Sem ela, o
-- INSERT do admin é barrado pela RLS.

DROP POLICY IF EXISTS "Admin can insert bookings" ON public.bookings;
CREATE POLICY "Admin can insert bookings" ON public.bookings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
