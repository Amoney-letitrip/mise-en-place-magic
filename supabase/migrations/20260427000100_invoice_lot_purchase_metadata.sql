-- Track invoice-imported purchase metadata on lots.
ALTER TABLE public.lots
  ADD COLUMN IF NOT EXISTS cost_per_unit NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vendor TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Vendor names should only need to be unique inside a user's account.
ALTER TABLE public.vendors
  DROP CONSTRAINT IF EXISTS vendors_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS vendors_user_name_unique
  ON public.vendors (user_id, lower(name));
