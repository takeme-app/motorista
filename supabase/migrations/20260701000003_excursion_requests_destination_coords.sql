-- ExcursionRequestFormScreen.tsx insere `destination_lat`/`destination_lng`
-- (geocode via Mapbox quando o usuário digita um destino livre). A tabela
-- só tinha `destination` (text), então o INSERT falhava com
-- "Could not find the 'destination_lat' column of 'excursion_requests'".

ALTER TABLE public.excursion_requests
  ADD COLUMN IF NOT EXISTS destination_lat double precision NULL,
  ADD COLUMN IF NOT EXISTS destination_lng double precision NULL;
