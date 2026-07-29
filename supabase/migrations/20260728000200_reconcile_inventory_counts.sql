-- Reconcile physical counts and lot totals in one transaction so ingredient
-- stock cannot diverge from the lots used by FEFO/FIFO sale deduction.
CREATE OR REPLACE FUNCTION public.reconcile_inventory_counts(
  p_updates JSONB,
  p_fefo BOOLEAN DEFAULT true
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_update JSONB;
  v_ingredient RECORD;
  v_lot RECORD;
  v_target NUMERIC;
  v_lot_total NUMERIC;
  v_remaining NUMERIC;
  v_take NUMERIC;
  v_updated INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'Updates must be an array';
  END IF;

  IF jsonb_array_length(p_updates) > 500 THEN
    RAISE EXCEPTION 'Too many count updates';
  END IF;

  FOR v_update IN SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    v_target := greatest(coalesce((v_update->>'current_stock')::NUMERIC, 0), 0);

    SELECT id, name, unit, is_perishable
    INTO v_ingredient
    FROM public.ingredients
    WHERE id = (v_update->>'id')::UUID
      AND user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ingredient not found';
    END IF;

    SELECT coalesce(sum(quantity_remaining), 0)
    INTO v_lot_total
    FROM public.lots
    WHERE user_id = v_user_id
      AND ingredient_id = v_ingredient.id
      AND quantity_remaining > 0;

    IF v_lot_total > v_target THEN
      v_remaining := v_lot_total - v_target;

      FOR v_lot IN
        SELECT id, quantity_remaining
        FROM public.lots
        WHERE user_id = v_user_id
          AND ingredient_id = v_ingredient.id
          AND quantity_remaining > 0
        ORDER BY
          CASE WHEN p_fefo AND v_ingredient.is_perishable AND expires_at IS NOT NULL THEN expires_at END ASC NULLS LAST,
          received_at ASC
        FOR UPDATE
      LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := least(v_lot.quantity_remaining, v_remaining);

        UPDATE public.lots
        SET quantity_remaining = round(quantity_remaining - v_take, 3)
        WHERE id = v_lot.id;

        v_remaining := v_remaining - v_take;
      END LOOP;
    ELSIF v_lot_total < v_target THEN
      INSERT INTO public.lots (
        ingredient_id,
        lot_label,
        received_at,
        quantity_received,
        quantity_remaining,
        source,
        user_id
      )
      VALUES (
        v_ingredient.id,
        'Count-' || to_char(current_date, 'YYYYMMDD'),
        now(),
        round(v_target - v_lot_total, 3),
        round(v_target - v_lot_total, 3),
        'Cycle count adjustment',
        v_user_id
      );
    END IF;

    UPDATE public.ingredients
    SET current_stock = round(v_target, 3)
    WHERE id = v_ingredient.id
      AND user_id = v_user_id;

    v_updated := v_updated + 1;
  END LOOP;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_inventory_counts(JSONB, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_inventory_counts(JSONB, BOOLEAN) TO authenticated;
