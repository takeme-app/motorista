-- Remove a camada genérica de notificação do CLIENTE ("Sua atividade de X mudou
-- de status"), que sobrepunha as notificações específicas e disparava várias
-- vezes. As específicas de fase + driver_accepted agora cobrem tudo (aceite,
-- andamento, entrega/conclusão, cancelamentos por motorista/admin/expiração).
-- Os triggers do MOTORISTA (notify_driver_activity_status_changed) ficam intactos.
DROP TRIGGER IF EXISTS trg_notify_client_activity_bookings ON public.bookings;
DROP TRIGGER IF EXISTS trg_notify_client_activity_shipments ON public.shipments;
DROP TRIGGER IF EXISTS trg_notify_client_activity_dependent_shipments ON public.dependent_shipments;
DROP TRIGGER IF EXISTS trg_notify_client_activity_excursion_requests ON public.excursion_requests;
