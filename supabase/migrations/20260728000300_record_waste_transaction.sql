-- Preserve a waste audit trail and keep ingredient/lot quantities consistent.
CREATE TABLE IF NOT EXISTS public.waste_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES public.ingredients(id) ON DELETE SET NULL,
  lot_id UUID REFERENCES public.lots(id) ON DELETE SET NULL,
  ingredient_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity >= 0),
  unit TEXT NOT NULL,
  cost_per_unit NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT 'Expired or spoiled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.waste_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own waste events"
  ON public.waste_events FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS waste_events_user_created_at_idx
  ON public.waste_events(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_waste_transaction(p_lot_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_lot RECORD;
  v_ingredient RECORD;
  v_quantity NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO v_lot
  FROM public.lots
  WHERE id = p_lot_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lot not found';
  END IF;

  SELECT *
  INTO v_ingredient
  FROM public.ingredients
  WHERE id = v_lot.ingredient_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient not found';
  END IF;

  v_quantity := greatest(v_lot.quantity_remaining, 0);
  IF v_quantity = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.lots
  SET quantity_remaining = 0
  WHERE id = v_lot.id;

  UPDATE public.ingredients
  SET current_stock = greatest(current_stock - v_quantity, 0)
  WHERE id = v_ingredient.id
    AND user_id = v_user_id;

  INSERT INTO public.waste_events (
    user_id,
    ingredient_id,
    lot_id,
    ingredient_name,
    quantity,
    unit,
    cost_per_unit
  )
  VALUES (
    v_user_id,
    v_ingredient.id,
    v_lot.id,
    v_ingredient.name,
    v_quantity,
    v_ingredient.unit,
    coalesce(nullif(v_lot.cost_per_unit, 0), v_ingredient.cost_per_unit, 0)
  );

  RETURN v_quantity;
END;
$$;

REVOKE ALL ON FUNCTION public.record_waste_transaction(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_waste_transaction(UUID) TO authenticated;
