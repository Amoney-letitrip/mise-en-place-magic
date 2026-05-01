export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
  threshold: number;
  reorder_qty: number;
  vendor: string | null;
  vendor_email: string | null;
  is_perishable: boolean;
  shelf_life_days: number | null;
  storage_type: 'fridge' | 'freezer' | 'room';
  calib_factor: number;
  cost_per_unit: number;
  created_at: string;
  updated_at: string;
}

export interface Lot {
  id: string;
  ingredient_id: string;
  lot_label: string;
  received_at: string;
  expires_at: string | null;
  quantity_received: number;
  quantity_remaining: number;
  source: string;
  created_at: string;
}

export interface Recipe {
  id: string;
  name: string;
  status: 'draft' | 'verified';
  verified_by: string | null;
  verified_date: string | null;
  created_at: string;
}

export interface RecipeIngredient {
  id: string;
  recipe_id: string;
  ingredient_id: string | null;
  name: string;
  qty: number;
  unit: string;
  confidence: number;
}

export interface PosIntegration {
  id: string;
  user_id: string;
  provider: string;
  status: 'not_connected' | 'connected' | 'syncing' | 'error';
  access_token: string | null;
  refresh_token: string | null;
  external_location_id: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PosMenuItem {
  id: string;
  user_id: string;
  provider: string;
  external_item_id: string;
  external_variation_id: string | null;
  name: string;
  category: string | null;
  price_cents: number | null;
  is_active: boolean;
  raw_payload: Record<string, unknown> | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipePosMapping {
  id: string;
  user_id: string;
  recipe_id: string;
  pos_menu_item_id: string;
  confidence_score: number | null;
  mapping_status: 'unmapped' | 'suggested' | 'confirmed' | 'ignored';
  created_at: string;
  updated_at: string;
}

export interface Sale {
  id: string;
  item: string;
  qty: number;
  status: 'processed' | 'flagged';
  reason: string | null;
  source: string;
  created_at: string;
}

export interface Vendor {
  name: string;
  email: string | null;
  phone: string | null;
  lead_time_days: number;
  notes: string | null;
}

export interface Forecast {
  adu: number;
  daysLeft: number;
  stockoutDate: Date | null;
  orderByDate: Date | null;
  recommendedQty: number;
  orderDue: boolean;
}

export interface CycleCountItem {
  id: string;
  ingredientId: string;
  name: string;
  unit: string;
  systemQty: number;
  counted: number | null;
  reason: string | null;
  tags: string[];
}

export type TabId = 'dashboard' | 'overview' | 'inventory' | 'orders' | 'sales' | 'recipes' | 'costs';
export type IngSubTab = 'list' | 'count';
