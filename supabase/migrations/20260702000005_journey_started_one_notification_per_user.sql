-- "Motorista a caminho": antes inseria 1 notificação por pedido (booking +
-- dependente + shipment) do trip, então um mesmo usuário com mais de um pedido
-- recebia 2-3 idênticas. Agora insere no máximo UMA por usuário (prioridade
-- booking > dependente > shipment) e respeita should_notify_user.
CREATE OR REPLACE FUNCTION public.notify_passengers_driver_journey_started()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  dest_preview text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF NEW.driver_journey_started_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.driver_journey_started_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  dest_preview := left(coalesce(NEW.destination_address, 'destino'), 100);

  INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
  SELECT s.user_id,
         'Motorista a caminho',
         format('O motorista iniciou a viagem rumo a %s. Acompanhe no app.', dest_preview),
         s.category,
         'cliente',
         s.data
  FROM (
    SELECT DISTINCT ON (cand.user_id) cand.user_id, cand.category, cand.data
    FROM (
      SELECT b.user_id, 1 AS prio, 'travel_updates'::text AS category,
             jsonb_build_object('route','DriverOnTheWay','params',jsonb_build_object('tripId',NEW.id,'bookingId',b.id)) AS data
      FROM public.bookings b
      WHERE b.scheduled_trip_id = NEW.id AND b.status IN ('paid','confirmed')
      UNION ALL
      SELECT ds.user_id, 2, 'travel_updates'::text,
             jsonb_build_object('route','DependentShipmentDetail','params',jsonb_build_object('dependentShipmentId',ds.id))
      FROM public.dependent_shipments ds
      WHERE ds.scheduled_trip_id = NEW.id AND ds.status IN ('confirmed','in_progress')
      UNION ALL
      SELECT s2.user_id, 3, 'shipments_deliveries'::text,
             jsonb_build_object('route','ShipmentDetail','params',jsonb_build_object('shipmentId',s2.id))
      FROM public.shipments s2
      WHERE s2.scheduled_trip_id = NEW.id AND s2.status IN ('confirmed','in_progress')
    ) cand
    WHERE cand.user_id IS NOT NULL
    ORDER BY cand.user_id, cand.prio
  ) s
  WHERE public.should_notify_user(s.user_id, s.category);

  RETURN NEW;
END;
$function$;
