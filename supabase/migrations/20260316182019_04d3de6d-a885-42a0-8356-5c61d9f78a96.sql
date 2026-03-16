
-- Clear seed data
DELETE FROM recipe_ingredients;
DELETE FROM recipes;
DELETE FROM sales;
DELETE FROM lots;
DELETE FROM ingredients;
DELETE FROM vendors;

-- Add user_id to all tables
ALTER TABLE ingredients ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE lots ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE recipes ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE recipe_ingredients ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE sales ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE vendors ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create profiles table
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_name text,
  onboarding_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- Update RLS: ingredients
DROP POLICY "Anyone can read ingredients" ON ingredients;
DROP POLICY "Anyone can insert ingredients" ON ingredients;
DROP POLICY "Anyone can update ingredients" ON ingredients;
DROP POLICY "Anyone can delete ingredients" ON ingredients;
CREATE POLICY "Users read own ingredients" ON ingredients FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own ingredients" ON ingredients FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own ingredients" ON ingredients FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users delete own ingredients" ON ingredients FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Update RLS: lots
DROP POLICY "Anyone can read lots" ON lots;
DROP POLICY "Anyone can insert lots" ON lots;
DROP POLICY "Anyone can update lots" ON lots;
DROP POLICY "Anyone can delete lots" ON lots;
CREATE POLICY "Users read own lots" ON lots FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own lots" ON lots FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own lots" ON lots FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users delete own lots" ON lots FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Update RLS: recipes
DROP POLICY "Anyone can read recipes" ON recipes;
DROP POLICY "Anyone can insert recipes" ON recipes;
DROP POLICY "Anyone can update recipes" ON recipes;
DROP POLICY "Anyone can delete recipes" ON recipes;
CREATE POLICY "Users read own recipes" ON recipes FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own recipes" ON recipes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own recipes" ON recipes FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users delete own recipes" ON recipes FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Update RLS: recipe_ingredients
DROP POLICY "Anyone can read recipe_ingredients" ON recipe_ingredients;
DROP POLICY "Anyone can insert recipe_ingredients" ON recipe_ingredients;
DROP POLICY "Anyone can update recipe_ingredients" ON recipe_ingredients;
DROP POLICY "Anyone can delete recipe_ingredients" ON recipe_ingredients;
CREATE POLICY "Users read own recipe_ingredients" ON recipe_ingredients FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own recipe_ingredients" ON recipe_ingredients FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own recipe_ingredients" ON recipe_ingredients FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users delete own recipe_ingredients" ON recipe_ingredients FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Update RLS: sales
DROP POLICY "Anyone can read sales" ON sales;
DROP POLICY "Anyone can insert sales" ON sales;
DROP POLICY "Anyone can update sales" ON sales;
DROP POLICY "Anyone can delete sales" ON sales;
CREATE POLICY "Users read own sales" ON sales FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own sales" ON sales FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own sales" ON sales FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users delete own sales" ON sales FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Update RLS: vendors
DROP POLICY "Anyone can read vendors" ON vendors;
DROP POLICY "Anyone can insert vendors" ON vendors;
DROP POLICY "Anyone can update vendors" ON vendors;
DROP POLICY "Anyone can delete vendors" ON vendors;
CREATE POLICY "Users read own vendors" ON vendors FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own vendors" ON vendors FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own vendors" ON vendors FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users delete own vendors" ON vendors FOR DELETE TO authenticated USING (user_id = auth.uid());
