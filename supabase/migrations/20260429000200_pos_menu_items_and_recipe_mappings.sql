-- POS menu items are the source of truth for sellable items.
-- Recipes remain the ingredient deduction logic.
-- Recipe/POS mappings bridge future POS sales to inventory deduction.

CREATE TABLE IF NOT EXISTS public.pos_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_connected',
  access_token TEXT,
  refresh_token TEXT,
  external_location_id TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);

ALTER TABLE public.pos_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own pos_integrations"
  ON public.pos_integrations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own pos_integrations"
  ON public.pos_integrations FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own pos_integrations"
  ON public.pos_integrations FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users delete own pos_integrations"
  ON public.pos_integrations FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER update_pos_integrations_updated_at
  BEFORE UPDATE ON public.pos_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.pos_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_item_id TEXT NOT NULL,
  external_variation_id TEXT,
  name TEXT NOT NULL,
  category TEXT,
  price_cents INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  raw_payload JSONB,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT(user_id, provider, external_item_id, external_variation_id)
);

ALTER TABLE public.pos_menu_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own pos_menu_items"
  ON public.pos_menu_items FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own pos_menu_items"
  ON public.pos_menu_items FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own pos_menu_items"
  ON public.pos_menu_items FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users delete own pos_menu_items"
  ON public.pos_menu_items FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER update_pos_menu_items_updated_at
  BEFORE UPDATE ON public.pos_menu_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS pos_menu_items_user_provider_idx
  ON public.pos_menu_items(user_id, provider);

CREATE TABLE IF NOT EXISTS public.recipe_pos_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  pos_menu_item_id UUID NOT NULL REFERENCES public.pos_menu_items(id) ON DELETE CASCADE,
  confidence_score NUMERIC,
  mapping_status TEXT NOT NULL DEFAULT 'unmapped'
    CHECK (mapping_status IN ('unmapped', 'suggested', 'confirmed', 'ignored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(recipe_id, pos_menu_item_id)
);

ALTER TABLE public.recipe_pos_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own recipe_pos_mappings"
  ON public.recipe_pos_mappings FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own recipe_pos_mappings"
  ON public.recipe_pos_mappings FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own recipe_pos_mappings"
  ON public.recipe_pos_mappings FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users delete own recipe_pos_mappings"
  ON public.recipe_pos_mappings FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER update_recipe_pos_mappings_updated_at
  BEFORE UPDATE ON public.recipe_pos_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS recipe_pos_mappings_user_idx
  ON public.recipe_pos_mappings(user_id);

CREATE INDEX IF NOT EXISTS recipe_pos_mappings_pos_menu_item_id_idx
  ON public.recipe_pos_mappings(pos_menu_item_id);
