
-- Create timestamp update function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Ingredients table
CREATE TABLE public.ingredients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pcs',
  current_stock NUMERIC NOT NULL DEFAULT 0,
  threshold NUMERIC NOT NULL DEFAULT 0,
  reorder_qty NUMERIC NOT NULL DEFAULT 0,
  vendor TEXT,
  vendor_email TEXT,
  is_perishable BOOLEAN NOT NULL DEFAULT false,
  shelf_life_days INTEGER,
  storage_type TEXT NOT NULL DEFAULT 'room' CHECK (storage_type IN ('fridge', 'freezer', 'room')),
  calib_factor NUMERIC NOT NULL DEFAULT 1.0,
  cost_per_unit NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read ingredients" ON public.ingredients FOR SELECT USING (true);
CREATE POLICY "Anyone can insert ingredients" ON public.ingredients FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update ingredients" ON public.ingredients FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete ingredients" ON public.ingredients FOR DELETE USING (true);

CREATE TRIGGER update_ingredients_updated_at
  BEFORE UPDATE ON public.ingredients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Lots table
CREATE TABLE public.lots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  lot_label TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  quantity_received NUMERIC NOT NULL DEFAULT 0,
  quantity_remaining NUMERIC NOT NULL DEFAULT 0,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read lots" ON public.lots FOR SELECT USING (true);
CREATE POLICY "Anyone can insert lots" ON public.lots FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update lots" ON public.lots FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete lots" ON public.lots FOR DELETE USING (true);

CREATE INDEX idx_lots_ingredient_id ON public.lots(ingredient_id);

-- Recipes table
CREATE TABLE public.recipes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'verified')),
  verified_by TEXT,
  verified_date TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read recipes" ON public.recipes FOR SELECT USING (true);
CREATE POLICY "Anyone can insert recipes" ON public.recipes FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update recipes" ON public.recipes FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete recipes" ON public.recipes FOR DELETE USING (true);

CREATE TRIGGER update_recipes_updated_at
  BEFORE UPDATE ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Recipe ingredients
CREATE TABLE public.recipe_ingredients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES public.ingredients(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  qty NUMERIC NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'pcs',
  confidence NUMERIC NOT NULL DEFAULT 1.0
);

ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read recipe_ingredients" ON public.recipe_ingredients FOR SELECT USING (true);
CREATE POLICY "Anyone can insert recipe_ingredients" ON public.recipe_ingredients FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update recipe_ingredients" ON public.recipe_ingredients FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete recipe_ingredients" ON public.recipe_ingredients FOR DELETE USING (true);

CREATE INDEX idx_recipe_ingredients_recipe_id ON public.recipe_ingredients(recipe_id);

-- Sales table
CREATE TABLE public.sales (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'flagged' CHECK (status IN ('processed', 'flagged')),
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'Manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read sales" ON public.sales FOR SELECT USING (true);
CREATE POLICY "Anyone can insert sales" ON public.sales FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update sales" ON public.sales FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete sales" ON public.sales FOR DELETE USING (true);

-- Vendors table
CREATE TABLE public.vendors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  email TEXT,
  phone TEXT,
  lead_time_days INTEGER NOT NULL DEFAULT 2,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read vendors" ON public.vendors FOR SELECT USING (true);
CREATE POLICY "Anyone can insert vendors" ON public.vendors FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update vendors" ON public.vendors FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete vendors" ON public.vendors FOR DELETE USING (true);
