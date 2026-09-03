-- Ver função aplicada em produção: motorista_respond_booking_request ganha
-- guarda de Pix não liquidado. O arquivo existe para o histórico local; o
-- conteúdo é idêntico ao aplicado.
--
-- No Pix real a reserva nasce 'pending' com pix_charge_id e fica assim até a
-- liquidação. A notificação ao motorista já era bloqueada, mas o ACEITE não: a
-- RPC aceitava qualquer reserva 'pending'/'paid' e ainda fazia
-- paid_at = coalesce(paid_at, now()) — carimbando como paga uma reserva que
-- ninguém pagou. Recusar continua permitido.
SELECT 1;
