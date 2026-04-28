-- Record a sale and deduct stock in one database transaction.
-- If the sale would overdraw stock, the row is recorded as flagged and stock is left unchanged.

CREATE OR REPLACE FUNCTION public.convert_recipe_qty(
  p_qty NUMERIC,
  p_from TEXT,
  p_to TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  from_unit TEXT := lower(trim(coalesce(p_from, '')));
  to_unit TEXT := lower(trim(coalesce(p_to, '')));
BEGIN
  IF from_unit = to_unit THEN
    RETURN p_qty;
  END IF;

  IF from_unit = 'oz' AND to_unit = 'g' THEN
    RETURN p_qty * 28.3495;
  ELSIF from_unit = 'g' AND to_unit = 'oz' THEN
    RETURN p_qty / 28.3495;
  ELSIF from_unit = 'tbsp' AND to_unit = 'ml' THEN
    RETURN p_qty * 15;
  ELSIF from_unit = 'ml' AND to_unit = 'tbsp' THEN
    RETURN p_qty / 15;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_sale_transaction(
  p_item TEXT,
  p_qty INTEGER,
  p_source TEXT DEFAULT 'Manual',
  p_fefo BOOLEAN DEFAULT true
)
RETURNS TABLE(status TEXT, reason TEXT, sale_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_qty INTEGER := greatest(coalesce(p_qty, 1), 1);
  v_recipe RECORD;
  v_line RECORD;
  v_lot RECORD;
  v_issue TEXT;
  v_sale_id UUID;
  v_remaining NUMERIC;
  v_take NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO v_recipe
  FROM public.recipes
  WHERE user_id = v_user_id
    AND lower(name) = lower(trim(p_item))
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.sales (item, qty, status, reason, source, user_id)
    VALUES (trim(p_item), v_qty, 'flagged', 'Menu item not found', coalesce(p_source, 'Manual'), v_user_id)
    RETURNING id INTO v_sale_id;

    RETURN QUERY SELECT 'flagged'::TEXT, 'Menu item not found'::TEXT, v_sale_id;
    RETURN;
  END IF;

  IF v_recipe.status <> 'verified' THEN
    INSERT INTO public.sales (item, qty, status, reason, source, user_id)
    VALUES (v_recipe.name, v_qty, 'flagged', 'Recipe not verified', coalesce(p_source, 'Manual'), v_user_id)
    RETURNING id INTO v_sale_id;

    RETURN QUERY SELECT 'flagged'::TEXT, 'Recipe not verified'::TEXT, v_sale_id;
    RETURN;
  END IF;

  FOR v_line IN
    SELECT
      ri.name AS recipe_ingredient_name,
      ri.ingredient_id,
      ri.qty,
      ri.unit AS recipe_unit,
      i.name AS ingredient_name,
      i.unit AS ingredient_unit,
      i.current_stock,
      public.convert_recipe_qty(ri.qty * v_qty, ri.unit, i.unit) AS deduct_qty
    FROM public.recipe_ingredients ri
    LEFT JOIN public.ingredients i
      ON i.id = ri.ingredient_id
     AND i.user_id = v_user_id
    WHERE ri.recipe_id = v_recipe.id
      AND ri.user_id = v_user_id
  LOOP
    IF v_line.ingredient_id IS NULL OR v_line.ingredient_name IS NULL THEN
      v_issue := concat_ws('; ', v_issue, v_line.recipe_ingredient_name || ' is not linked to inventory');
    ELSIF v_line.deduct_qty IS NULL THEN
      v_issue := concat_ws('; ', v_issue, v_line.ingredient_name || ' unit mismatch: ' || v_line.recipe_unit || ' to ' || v_line.ingredient_unit);
    ELSIF v_line.deduct_qty > v_line.current_stock THEN
      v_issue := concat_ws(
        '; ',
        v_issue,
        v_line.ingredient_name || ' needs ' || round(v_line.deduct_qty, 2) || ' ' || v_line.ingredient_unit ||
          ', only ' || round(v_line.current_stock, 2) || ' available'
      );
    END IF;
  END LOOP;

  IF v_issue IS NOT NULL THEN
    INSERT INTO public.sales (item, qty, status, reason, source, user_id)
    VALUES (v_recipe.name, v_qty, 'flagged', 'Inventory check failed: ' || v_issue, coalesce(p_source, 'Manual'), v_user_id)
    RETURNING id INTO v_sale_id;

    RETURN QUERY SELECT 'flagged'::TEXT, ('Inventory check failed: ' || v_issue)::TEXT, v_sale_id;
    RETURN;
  END IF;

  INSERT INTO public.sales (item, qty, status, reason, source, user_id)
  VALUES (v_recipe.name, v_qty, 'processed', NULL, coalesce(p_source, 'Manual'), v_user_id)
  RETURNING id INTO v_sale_id;

  FOR v_line IN
    SELECT
      ri.ingredient_id,
      i.unit AS ingredient_unit,
      i.is_perishable,
      public.convert_recipe_qty(ri.qty * v_qty, ri.unit, i.unit) AS deduct_qty
    FROM public.recipe_ingredients ri
    JOIN public.ingredients i
      ON i.id = ri.ingredient_id
     AND i.user_id = v_user_id
    WHERE ri.recipe_id = v_recipe.id
      AND ri.user_id = v_user_id
    FOR UPDATE OF i
  LOOP
    UPDATE public.ingredients
    SET current_stock = current_stock - v_line.deduct_qty
    WHERE id = v_line.ingredient_id
      AND user_id = v_user_id;

    v_remaining := v_line.deduct_qty;

    FOR v_lot IN
      SELECT id, quantity_remaining
      FROM public.lots
      WHERE user_id = v_user_id
        AND ingredient_id = v_line.ingredient_id
        AND quantity_remaining > 0
      ORDER BY
        CASE WHEN p_fefo AND v_line.is_perishable AND expires_at IS NOT NULL THEN expires_at END ASC NULLS LAST,
        received_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_lot.quantity_remaining, v_remaining);

      UPDATE public.lots
      SET quantity_remaining = round(quantity_remaining - v_take, 3)
      WHERE id = v_lot.id;

      v_remaining := v_remaining - v_take;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT 'processed'::TEXT, NULL::TEXT, v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_recipe_qty(NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_recipe_qty(NUMERIC, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.record_sale_transaction(TEXT, INTEGER, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_sale_transaction(TEXT, INTEGER, TEXT, BOOLEAN) TO authenticated;
