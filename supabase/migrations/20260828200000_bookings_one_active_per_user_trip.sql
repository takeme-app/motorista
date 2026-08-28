-- Uma reserva ATIVA por usuário por viagem.
--
-- Regra de produto: o passageiro escolhe a quantidade de lugares UMA vez; para
-- mudar, cancela e reserva de novo. Não existe caso legítimo de duas reservas
-- ativas da mesma pessoa na mesma viagem — quem leva acompanhantes usa
-- passenger_count na mesma reserva.
--
-- Havia QUATRO caminhos que inserem booking (charge-booking/cartão,
-- create-pix-charge/Pix real, e dois inserts diretos do app no CheckoutScreen
-- para Pix paliativo e dinheiro) e NENHUM checava reserva existente. Em
-- produção um usuário pagou dois Pix de R$ 5,00 na mesma viagem.
--
-- O índice resolve nos quatro de uma vez e também fecha a corrida entre duas
-- requisições simultâneas, que uma checagem em código não pega.
--
-- 'cancelled' fica de fora de propósito: cancelar e reservar de novo é o
-- caminho previsto para trocar a quantidade de lugares.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_active_per_user_trip
  ON public.bookings (user_id, scheduled_trip_id)
  WHERE status IN ('pending', 'paid', 'confirmed');
