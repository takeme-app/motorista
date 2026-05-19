-- Adiciona dependent_shipments ao publication supabase_realtime para que
-- a subscription do TripDetailScreen receba inserts/updates em tempo real.
-- bookings, scheduled_trips e shipments já estavam publicados.
ALTER PUBLICATION supabase_realtime ADD TABLE public.dependent_shipments;
