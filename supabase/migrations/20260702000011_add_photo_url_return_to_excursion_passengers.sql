-- Foto separada do embarque de VOLTA (a ida usa photo_url; a volta usa photo_url_return).
ALTER TABLE public.excursion_passengers
  ADD COLUMN IF NOT EXISTS photo_url_return text;

COMMENT ON COLUMN public.excursion_passengers.photo_url_return IS
  'Caminho da foto tirada no embarque de volta (retorno). A foto da ida fica em photo_url.';
