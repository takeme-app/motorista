-- Dedup do push "Motorista a caminho" por user_id.
--
-- Hoje notify_passengers_driver_journey_started() faz 3 INSERTs separados
-- em public.notifications (bookings, dependent_shipments, shipments). Um
-- mesmo user_id que figure em mais de uma fonte (ex.: cliente tem booking
-- e shipment na mesma scheduled_trip) recebe 2-3 pushes idênticos no
-- mesmo instante.
--
-- Solução: consolidar em um único INSERT com DISTINCT ON (user_id),
-- priorizando booking > dependent_shipment > shipment para escolher a
-- categoria/rota mais relevante de deeplink.

CREATE OR REPLACE FUNCTION public.notify_passengers_driver_journey_started()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  WITH targets AS (
    SELECT
      b.user_id,
      'DriverOnTheWay'::text AS route,
      'travel_updates'::text AS category,
      jsonb_build_object('tripId', NEW.id, 'bookingId', b.id) AS params,
      1 AS prio
    FROM public.bookings b
    WHERE b.scheduled_trip_id = NEW.id
      AND b.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT
      ds.user_id,
      'DependentShipmentDetail',
      'travel_updates',
      jsonb_build_object('dependentShipmentId', ds.id),
      2
    FROM public.dependent_shipments ds
    WHERE ds.scheduled_trip_id = NEW.id
      AND ds.status IN ('confirmed', 'in_progress')
    UNION ALL
    SELECT
      s.user_id,
      'ShipmentDetail',
      'shipments_deliveries',
      jsonb_build_object('shipmentId', s.id),
      3
    FROM public.shipments s
    WHERE s.scheduled_trip_id = NEW.id
      AND s.status IN ('confirmed', 'in_progress')
  ),
  dedup AS (
    SELECT DISTINCT ON (user_id)
      user_id, route, category, params
    FROM targets
    WHERE user_id IS NOT NULL
    ORDER BY user_id, prio
  )
  INSERT INTO public.notifications (user_id, title, message, category, target_app_slug, data)
  SELECT
    user_id,
    'Motorista a caminho',
    format('O motorista iniciou a viagem rumo a %s. Acompanhe no app.', dest_preview),
    category,
    'cliente',
    jsonb_build_object('route', route, 'params', params)
  FROM dedup;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_passengers_driver_journey_started() IS
  'Notifica clientes (bookings, dependent_shipments e shipments) quando o motorista inicia a viagem. Consolida em um único INSERT por user_id (DISTINCT ON), priorizando booking > dependent_shipment > shipment para evitar pushes duplicados ao mesmo cliente.';
