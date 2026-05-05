CREATE TABLE IF NOT EXISTS public.shipment_driver_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments (id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shipment_id)
);

CREATE INDEX IF NOT EXISTS idx_shipment_driver_ratings_shipment_id
  ON public.shipment_driver_ratings (shipment_id);

CREATE INDEX IF NOT EXISTS idx_shipment_driver_ratings_driver_id
  ON public.shipment_driver_ratings (driver_id);

ALTER TABLE public.shipment_driver_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workers read own shipment_driver_ratings" ON public.shipment_driver_ratings;
CREATE POLICY "Workers read own shipment_driver_ratings"
  ON public.shipment_driver_ratings FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

DROP POLICY IF EXISTS "Clients read shipment_driver_ratings for own shipments" ON public.shipment_driver_ratings;
CREATE POLICY "Clients read shipment_driver_ratings for own shipments"
  ON public.shipment_driver_ratings FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.shipments s
      WHERE s.id = shipment_driver_ratings.shipment_id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Workers insert shipment_driver_ratings" ON public.shipment_driver_ratings;
CREATE POLICY "Workers insert shipment_driver_ratings"
  ON public.shipment_driver_ratings FOR INSERT TO authenticated
  WITH CHECK (
    driver_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.shipments s
      WHERE s.id = shipment_driver_ratings.shipment_id
        AND (
          (s.driver_id = auth.uid() AND s.status = 'delivered')
          OR (s.preparer_id = auth.uid() AND s.delivered_to_base_at IS NOT NULL)
        )
    )
  );

DROP POLICY IF EXISTS "Workers update own shipment_driver_ratings" ON public.shipment_driver_ratings;
CREATE POLICY "Workers update own shipment_driver_ratings"
  ON public.shipment_driver_ratings FOR UPDATE TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (
    driver_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.shipments s
      WHERE s.id = shipment_driver_ratings.shipment_id
        AND (
          (s.driver_id = auth.uid() AND s.status = 'delivered')
          OR (s.preparer_id = auth.uid() AND s.delivered_to_base_at IS NOT NULL)
        )
    )
  );

DROP POLICY IF EXISTS "Admin can read all shipment_driver_ratings" ON public.shipment_driver_ratings;
CREATE POLICY "Admin can read all shipment_driver_ratings"
  ON public.shipment_driver_ratings FOR SELECT
  USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE ON public.shipment_driver_ratings TO authenticated;
GRANT ALL ON public.shipment_driver_ratings TO service_role;

COMMENT ON TABLE public.shipment_driver_ratings IS
  'Avaliação opcional do trabalhador após envio: motorista na entrega final ou preparador após depósito na base.';
