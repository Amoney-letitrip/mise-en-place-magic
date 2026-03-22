import { useState, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdateProfile } from '@/hooks/use-inventory-data';

interface ScannedRecipe {
  name: string;
  menu_price?: number;
  ingredients: Array<{ name: string; qty: number; unit: string }>;
}

interface StockItem {
  name: string;
  unit: string;
  currentStock: string;
  storage: string;
  isPerishable: boolean;
  shelfLifeDays: string;
}

const POS_SYSTEMS = [
  { id: 'square', name: 'Square', icon: '🟦', desc: 'Point of Sale & Payments' },
  { id: 'toast', name: 'Toast', icon: '🍞', desc: 'Restaurant Management' },
  { id: 'clover', name: 'Clover', icon: '🍀', desc: 'Smart POS System' },
  { id: 'lightspeed', name: 'Lightspeed', icon: '⚡', desc: 'Retail & Restaurant POS' },
  { id: 'revel', name: 'Revel', icon: '🔴', desc: 'iPad POS System' },
];

// ── Seed Data ──────────────────────────────────────────────

const SEED_VENDORS = [
  { name: 'Sysco', email: 'orders@sysco.com', lead_time_days: 2, notes: null },
  { name: 'US Foods', email: 'orders@usfoods.com', lead_time_days: 2, notes: null },
  { name: 'Local Bakery', email: null, lead_time_days: 1, notes: null },
  { name: 'Restaurant Depot', email: null, lead_time_days: 0, notes: 'Cash & carry' },
];

const SEED_INGREDIENTS: Array<{
  name: string; unit: string; current_stock: number; threshold: number; reorder_qty: number;
  vendor: string; cost_per_unit: number; is_perishable: boolean; shelf_life_days: number | null; storage_type: string;
}> = [
  { name: 'Ground Beef 80/20', unit: 'lbs', current_stock: 45, threshold: 20, reorder_qty: 50, vendor: 'Sysco', cost_per_unit: 3.89, is_perishable: true, shelf_life_days: 5, storage_type: 'fridge' },
  { name: 'Chicken Breast', unit: 'lbs', current_stock: 30, threshold: 15, reorder_qty: 40, vendor: 'Sysco', cost_per_unit: 3.29, is_perishable: true, shelf_life_days: 4, storage_type: 'fridge' },
  { name: 'Bacon', unit: 'lbs', current_stock: 18, threshold: 8, reorder_qty: 20, vendor: 'Sysco', cost_per_unit: 5.49, is_perishable: true, shelf_life_days: 10, storage_type: 'fridge' },
  { name: 'Eggs', unit: 'pcs', current_stock: 180, threshold: 60, reorder_qty: 180, vendor: 'US Foods', cost_per_unit: 0.28, is_perishable: true, shelf_life_days: 21, storage_type: 'fridge' },
  { name: 'American Cheese', unit: 'pcs', current_stock: 120, threshold: 40, reorder_qty: 100, vendor: 'Sysco', cost_per_unit: 0.15, is_perishable: true, shelf_life_days: 30, storage_type: 'fridge' },
  { name: 'Shredded Mozzarella', unit: 'lbs', current_stock: 12, threshold: 5, reorder_qty: 15, vendor: 'Sysco', cost_per_unit: 4.19, is_perishable: true, shelf_life_days: 14, storage_type: 'fridge' },
  { name: 'Whole Milk', unit: 'gal', current_stock: 6, threshold: 2, reorder_qty: 6, vendor: 'US Foods', cost_per_unit: 3.99, is_perishable: true, shelf_life_days: 7, storage_type: 'fridge' },
  { name: 'Butter', unit: 'lbs', current_stock: 10, threshold: 4, reorder_qty: 12, vendor: 'US Foods', cost_per_unit: 3.49, is_perishable: true, shelf_life_days: 30, storage_type: 'fridge' },
  { name: 'Lettuce', unit: 'heads', current_stock: 15, threshold: 6, reorder_qty: 12, vendor: 'US Foods', cost_per_unit: 1.89, is_perishable: true, shelf_life_days: 5, storage_type: 'fridge' },
  { name: 'Tomatoes', unit: 'lbs', current_stock: 20, threshold: 8, reorder_qty: 20, vendor: 'US Foods', cost_per_unit: 2.29, is_perishable: true, shelf_life_days: 5, storage_type: 'fridge' },
  { name: 'Onions', unit: 'lbs', current_stock: 25, threshold: 10, reorder_qty: 25, vendor: 'Restaurant Depot', cost_per_unit: 0.99, is_perishable: false, shelf_life_days: null, storage_type: 'room' },
  { name: 'Potatoes', unit: 'lbs', current_stock: 50, threshold: 20, reorder_qty: 50, vendor: 'Restaurant Depot', cost_per_unit: 0.69, is_perishable: false, shelf_life_days: null, storage_type: 'room' },
  { name: 'Hamburger Buns', unit: 'pcs', current_stock: 72, threshold: 24, reorder_qty: 72, vendor: 'Local Bakery', cost_per_unit: 0.35, is_perishable: true, shelf_life_days: 3, storage_type: 'room' },
  { name: 'White Bread', unit: 'loaves', current_stock: 8, threshold: 3, reorder_qty: 8, vendor: 'Local Bakery', cost_per_unit: 2.49, is_perishable: true, shelf_life_days: 4, storage_type: 'room' },
  { name: 'Hot Dog Franks', unit: 'pcs', current_stock: 48, threshold: 16, reorder_qty: 48, vendor: 'Sysco', cost_per_unit: 0.65, is_perishable: true, shelf_life_days: 14, storage_type: 'fridge' },
  { name: 'French Fries (frozen)', unit: 'lbs', current_stock: 40, threshold: 15, reorder_qty: 40, vendor: 'Sysco', cost_per_unit: 1.59, is_perishable: false, shelf_life_days: null, storage_type: 'freezer' },
  { name: 'Pancake Mix', unit: 'lbs', current_stock: 15, threshold: 5, reorder_qty: 15, vendor: 'Restaurant Depot', cost_per_unit: 1.29, is_perishable: false, shelf_life_days: null, storage_type: 'room' },
  { name: 'Maple Syrup', unit: 'oz', current_stock: 128, threshold: 32, reorder_qty: 128, vendor: 'Restaurant Depot', cost_per_unit: 0.12, is_perishable: false, shelf_life_days: null, storage_type: 'room' },
  { name: 'Coffee (ground)', unit: 'lbs', current_stock: 10, threshold: 4, reorder_qty: 10, vendor: 'US Foods', cost_per_unit: 7.99, is_perishable: false, shelf_life_days: null, storage_type: 'room' },
  { name: 'Pie Shells (frozen)', unit: 'pcs', current_stock: 8, threshold: 3, reorder_qty: 8, vendor: 'Sysco', cost_per_unit: 2.19, is_perishable: false, shelf_life_days: null, storage_type: 'freezer' },
  { name: 'Cooking Oil', unit: 'gal', current_stock: 5, threshold: 2, reorder_qty: 5, vendor: 'Restaurant Depot', cost_per_unit: 8.99, is_perishable: false, shelf_life_days: null, storage_type: 'room' },
  { name: 'Ketchup', unit: 'oz', current_stock: 128, threshold: 32, reorder_qty: 128, vendor: 'Restaurant Depot', cost_per_unit: 0.04, is_perishable: false, shelf_life_days: null, storage_type: 'room' },
  { name: 'Mustard', unit: 'oz', current_stock: 64, threshold: 16, reorder_qty: 64, vendor: 'Restaurant Depot', cost_per_unit: 0.03, is_perishable: false, shelf_life_days: null, storage_type: 'room' },
  { name: 'Salt', unit: 'lbs', current_stock: 5, threshold: 2, reorder_qty: 5, vendor: 'Restaurant Depot', cost_per_unit: 0.49, is_perishable: false, shelf_life_days: null, storage_type: 'room' },
];

const SEED_RECIPES: Array<{
  name: string; menu_price: number;
  ingredients: Array<{ name: string; qty: number; unit: string }>;
}> = [
  { name: 'Classic Burger', menu_price: 12.99, ingredients: [
    { name: 'Ground Beef 80/20', qty: 0.375, unit: 'lbs' }, { name: 'Hamburger Buns', qty: 1, unit: 'pcs' },
    { name: 'American Cheese', qty: 1, unit: 'pcs' }, { name: 'Lettuce', qty: 0.5, unit: 'heads' },
    { name: 'Tomatoes', qty: 0.25, unit: 'lbs' }, { name: 'Onions', qty: 0.15, unit: 'lbs' },
    { name: 'Ketchup', qty: 1, unit: 'oz' }, { name: 'Mustard', qty: 0.5, unit: 'oz' },
  ]},
  { name: 'Bacon Cheeseburger', menu_price: 14.99, ingredients: [
    { name: 'Ground Beef 80/20', qty: 0.375, unit: 'lbs' }, { name: 'Bacon', qty: 0.125, unit: 'lbs' },
    { name: 'Hamburger Buns', qty: 1, unit: 'pcs' }, { name: 'American Cheese', qty: 2, unit: 'pcs' },
    { name: 'Lettuce', qty: 0.5, unit: 'heads' }, { name: 'Tomatoes', qty: 0.25, unit: 'lbs' },
    { name: 'Onions', qty: 0.15, unit: 'lbs' }, { name: 'Ketchup', qty: 1, unit: 'oz' },
  ]},
  { name: 'Grilled Chicken Sandwich', menu_price: 11.99, ingredients: [
    { name: 'Chicken Breast', qty: 0.375, unit: 'lbs' }, { name: 'Hamburger Buns', qty: 1, unit: 'pcs' },
    { name: 'Lettuce', qty: 0.5, unit: 'heads' }, { name: 'Tomatoes', qty: 0.25, unit: 'lbs' },
  ]},
  { name: 'Club Sandwich', menu_price: 12.49, ingredients: [
    { name: 'Chicken Breast', qty: 0.25, unit: 'lbs' }, { name: 'Bacon', qty: 0.125, unit: 'lbs' },
    { name: 'White Bread', qty: 0.25, unit: 'loaves' }, { name: 'Lettuce', qty: 0.5, unit: 'heads' },
    { name: 'Tomatoes', qty: 0.25, unit: 'lbs' },
  ]},
  { name: 'Two Eggs Any Style', menu_price: 8.99, ingredients: [
    { name: 'Eggs', qty: 2, unit: 'pcs' }, { name: 'Butter', qty: 0.03125, unit: 'lbs' },
    { name: 'White Bread', qty: 0.17, unit: 'loaves' }, { name: 'Potatoes', qty: 0.25, unit: 'lbs' },
  ]},
  { name: 'Pancake Stack', menu_price: 9.49, ingredients: [
    { name: 'Pancake Mix', qty: 0.375, unit: 'lbs' }, { name: 'Eggs', qty: 1, unit: 'pcs' },
    { name: 'Whole Milk', qty: 0.015625, unit: 'gal' }, { name: 'Butter', qty: 0.0625, unit: 'lbs' },
    { name: 'Maple Syrup', qty: 3, unit: 'oz' },
  ]},
  { name: 'Hot Dog', menu_price: 6.99, ingredients: [
    { name: 'Hot Dog Franks', qty: 1, unit: 'pcs' }, { name: 'Hamburger Buns', qty: 1, unit: 'pcs' },
    { name: 'Ketchup', qty: 1, unit: 'oz' }, { name: 'Mustard', qty: 1, unit: 'oz' },
    { name: 'Onions', qty: 0.1, unit: 'lbs' },
  ]},
  { name: 'Cheeseburger Deluxe', menu_price: 13.99, ingredients: [
    { name: 'Ground Beef 80/20', qty: 0.5, unit: 'lbs' }, { name: 'Hamburger Buns', qty: 1, unit: 'pcs' },
    { name: 'American Cheese', qty: 2, unit: 'pcs' }, { name: 'Lettuce', qty: 0.5, unit: 'heads' },
    { name: 'Tomatoes', qty: 0.25, unit: 'lbs' }, { name: 'Onions', qty: 0.15, unit: 'lbs' },
    { name: 'French Fries (frozen)', qty: 0.375, unit: 'lbs' }, { name: 'Cooking Oil', qty: 0.00390625, unit: 'gal' },
  ]},
  { name: 'French Fries', menu_price: 4.99, ingredients: [
    { name: 'French Fries (frozen)', qty: 0.5, unit: 'lbs' }, { name: 'Cooking Oil', qty: 0.0078125, unit: 'gal' },
    { name: 'Salt', qty: 0.1, unit: 'lbs' },
  ]},
  { name: 'Coffee', menu_price: 2.49, ingredients: [
    { name: 'Coffee (ground)', qty: 0.03125, unit: 'lbs' }, { name: 'Whole Milk', qty: 0.0078125, unit: 'gal' },
  ]},
];

const DAILY_SALES: Record<string, number> = {
  'Classic Burger': 5, 'Bacon Cheeseburger': 3, 'Two Eggs Any Style': 6,
  'Pancake Stack': 4, 'Coffee': 15, 'French Fries': 8, 'Hot Dog': 2,
  'Grilled Chicken Sandwich': 3, 'Club Sandwich': 2, 'Cheeseburger Deluxe': 2,
};

function generateSeedSales(userId: string) {
  const sales: Array<{ item: string; qty: number; status: string; source: string; user_id: string; created_at: string }> = [];
  const now = new Date();
  for (let day = 6; day >= 0; day--) {
    const date = new Date(now);
    date.setDate(date.getDate() - day);
    for (const [item, avg] of Object.entries(DAILY_SALES)) {
      const variance = Math.floor(Math.random() * 5) - 2; // -2 to +2
      const qty = Math.max(1, avg + variance);
      const hour = 7 + Math.floor(Math.random() * 14); // 7am-9pm
      const min = Math.floor(Math.random() * 60);
      const ts = new Date(date);
      ts.setHours(hour, min, 0, 0);
      sales.push({ item, qty, status: 'processed', source: 'Demo', user_id: userId, created_at: ts.toISOString() });
    }
  }
  return sales;
}

function computeRemainingStock(originalStock: number, ingName: string, sales: Array<{ item: string; qty: number }>) {
  const recipe = SEED_RECIPES.find(r => r.ingredients.some(i => i.name === ingName));
  if (!recipe) return originalStock;
  let totalUsed = 0;
  for (const sale of sales) {
    const r = SEED_RECIPES.find(x => x.name === sale.item);
    if (!r) continue;
    const ri = r.ingredients.find(i => i.name === ingName);
    if (!ri) continue;
    totalUsed += ri.qty * sale.qty;
  }
  return Math.max(0, Math.round((originalStock - totalUsed) * 1000) / 1000);
}

// ── Component ──────────────────────────────────────────────

interface OnboardingWizardProps {
  restaurantName: string | null;
}

export const OnboardingWizard = ({ restaurantName: initialName }: OnboardingWizardProps) => {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName || '');
  const [scanState, setScanState] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle');
  const [scannedRecipes, setScannedRecipes] = useState<ScannedRecipe[]>([]);
  const [removedIndices, setRemovedIndices] = useState<Set<number>>(new Set());
  const [menuPreviewUrl, setMenuPreviewUrl] = useState<string | null>(null);
  const [menuUrlInput, setMenuUrlInput] = useState('');
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const updateProfile = useUpdateProfile();

  const getUserId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user!.id;
  };

  const buildStockItems = useCallback(() => {
    const kept = scannedRecipes.filter((_, i) => !removedIndices.has(i));
    const seen = new Map<string, StockItem>();
    for (const r of kept) {
      for (const ing of r.ingredients) {
        const key = ing.name.toLowerCase().trim();
        if (!seen.has(key)) {
          const isFridge = ['beef', 'chicken', 'bacon', 'cheese', 'milk', 'butter', 'eggs', 'lettuce', 'tomato', 'cream'].some(k => key.includes(k));
          const isFreezer = ['frozen', 'ice cream'].some(k => key.includes(k));
          seen.set(key, {
            name: ing.name,
            unit: ing.unit,
            currentStock: '',
            storage: isFreezer ? 'freezer' : isFridge ? 'fridge' : 'room',
            isPerishable: isFridge,
            shelfLifeDays: '',
          });
        }
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [scannedRecipes, removedIndices]);

  const scanMenuPhoto = useCallback(async (file: File) => {
    setScanState('scanning');
    setMenuPreviewUrl(URL.createObjectURL(file));
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(',')[1]);
        r.onerror = () => rej(new Error('Read failed'));
        r.readAsDataURL(file);
      });
      const mediaType = file.type || 'image/jpeg';
      const { data: fnData, error: fnError } = await supabase.functions.invoke('scan-menu', {
        body: { type: 'photo', base64, mediaType },
      });
      if (fnError) throw fnError;
      const recipes = fnData?.recipes || [];
      setScannedRecipes(recipes);
      setRemovedIndices(new Set());
      setScanState('done');
      toast.success(`Found ${recipes.length} menu items`);
    } catch {
      setScanState('error');
      toast.error('Scan failed — please try again');
    }
  }, []);

  const scanMenuUrl = useCallback(async (url: string) => {
    setScanState('scanning');
    setMenuPreviewUrl(null);
    try {
      const { data: fnData, error: fnError } = await supabase.functions.invoke('scan-menu', {
        body: { type: 'url', url },
      });
      if (fnError) throw fnError;
      const recipes = fnData?.recipes || [];
      setScannedRecipes(recipes);
      setRemovedIndices(new Set());
      setScanState('done');
      toast.success(`Found ${recipes.length} menu items`);
    } catch {
      setScanState('error');
      toast.error('Scan failed — try uploading a photo instead');
    }
  }, []);

  const toggleRemoveRecipe = useCallback((index: number) => {
    setRemovedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const updateScannedIngredient = useCallback((recipeIdx: number, ingIdx: number, field: string, value: any) => {
    setScannedRecipes(prev => prev.map((r, ri) => {
      if (ri !== recipeIdx) return r;
      return { ...r, ingredients: r.ingredients.map((ing, ii) => ii !== ingIdx ? ing : { ...ing, [field]: value }) };
    }));
  }, []);

  const updateScannedRecipeName = useCallback((recipeIdx: number, newName: string) => {
    setScannedRecipes(prev => prev.map((r, ri) => ri === recipeIdx ? { ...r, name: newName } : r));
  }, []);

  const updateScannedRecipePrice = useCallback((recipeIdx: number, price: string) => {
    setScannedRecipes(prev => prev.map((r, ri) => ri === recipeIdx ? { ...r, menu_price: parseFloat(price) || 0 } : r));
  }, []);

  const goToStockCount = useCallback(() => {
    const items = buildStockItems();
    setStockItems(items);
    setStep(3);
  }, [buildStockItems]);

  const updateStockItem = useCallback((index: number, field: keyof StockItem, value: any) => {
    setStockItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }, []);

  const skipSectionStock = useCallback((storageType: string) => {
    setStockItems(prev => prev.map(item =>
      item.storage === storageType && item.currentStock === '' ? { ...item, currentStock: '0' } : item
    ));
  }, []);

  // Grouped stock items by storage type
  const groupedStockItems = useMemo(() => {
    const groups: Array<{ label: string; icon: string; type: string; items: Array<StockItem & { originalIndex: number }> }> = [
      { label: 'Fridge', icon: '❄️', type: 'fridge', items: [] },
      { label: 'Freezer', icon: '🧊', type: 'freezer', items: [] },
      { label: 'Dry Storage', icon: '🏠', type: 'room', items: [] },
    ];
    stockItems.forEach((item, idx) => {
      const group = groups.find(g => g.type === item.storage) || groups[2];
      group.items.push({ ...item, originalIndex: idx });
    });
    groups.forEach(g => g.items.sort((a, b) => a.name.localeCompare(b.name)));
    return groups.filter(g => g.items.length > 0);
  }, [stockItems]);

  const saveAndFinish = useCallback(async () => {
    setSaving(true);
    try {
      const userId = await getUserId();
      const kept = scannedRecipes.filter((_, i) => !removedIndices.has(i));
      const hasData = kept.length > 0 || stockItems.length > 0;

      if (!hasData) {
        // Seed demo diner data
        // 1. Create vendors
        for (const v of SEED_VENDORS) {
          await supabase.from('vendors').insert({ ...v, user_id: userId });
        }

        // 2. Generate sales first to compute remaining stock
        const salesData = generateSeedSales(userId);

        // 3. Create ingredients with post-sale stock
        const ingredientMap = new Map<string, string>();
        for (const ing of SEED_INGREDIENTS) {
          const remaining = computeRemainingStock(ing.current_stock, ing.name, salesData);
          const { data: created } = await supabase
            .from('ingredients')
            .insert({ ...ing, current_stock: remaining, user_id: userId })
            .select('id')
            .single();
          if (created) ingredientMap.set(ing.name, created.id);
        }

        // 4. Create lots (1 per ingredient, received 7 days ago)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        for (const ing of SEED_INGREDIENTS) {
          const ingId = ingredientMap.get(ing.name);
          if (!ingId) continue;
          const remaining = computeRemainingStock(ing.current_stock, ing.name, salesData);
          const expiresAt = ing.is_perishable && ing.shelf_life_days
            ? new Date(sevenDaysAgo.getTime() + ing.shelf_life_days * 86400000).toISOString()
            : null;
          await supabase.from('lots').insert({
            ingredient_id: ingId,
            lot_label: `Opening-${ing.name.replace(/\s+/g, '-')}`,
            received_at: sevenDaysAgo.toISOString(),
            expires_at: expiresAt,
            quantity_received: ing.current_stock,
            quantity_remaining: remaining,
            user_id: userId,
          });
        }

        // 5. Create recipes (all verified)
        for (const r of SEED_RECIPES) {
          const { data: recipe } = await supabase
            .from('recipes')
            .insert({ name: r.name, status: 'verified', verified_by: 'Manager', verified_date: new Date().toLocaleDateString(), menu_price: r.menu_price, user_id: userId })
            .select('id')
            .single();
          if (!recipe) continue;
          const ings = r.ingredients.map(ri => ({
            recipe_id: recipe.id,
            name: ri.name,
            qty: ri.qty,
            unit: ri.unit,
            confidence: 1,
            user_id: userId,
            ingredient_id: ingredientMap.get(ri.name) || null,
          }));
          await supabase.from('recipe_ingredients').insert(ings);
        }

        // 6. Insert sales
        // Batch insert in chunks of 50
        for (let i = 0; i < salesData.length; i += 50) {
          await supabase.from('sales').insert(salesData.slice(i, i + 50));
        }
      } else {
        // Normal flow: save user-scanned data
        const ingredientMap = new Map<string, string>();
        for (const item of stockItems) {
          const { data: ing } = await supabase
            .from('ingredients')
            .insert({
              name: item.name,
              unit: item.unit,
              current_stock: parseFloat(item.currentStock) || 0,
              storage_type: item.storage,
              is_perishable: item.isPerishable,
              shelf_life_days: item.shelfLifeDays ? parseInt(item.shelfLifeDays) : null,
              user_id: userId,
            })
            .select()
            .single();
          if (ing) ingredientMap.set(item.name.toLowerCase().trim(), ing.id);
        }
        for (const r of kept) {
          const { data: recipe } = await supabase
            .from('recipes')
            .insert({ name: r.name, status: 'draft', menu_price: r.menu_price || 0, user_id: userId })
            .select()
            .single();
          if (!recipe) continue;
          const ings = (r.ingredients || []).map((ing) => ({
            recipe_id: recipe.id,
            name: ing.name,
            qty: ing.qty,
            unit: ing.unit,
            confidence: 0.75,
            user_id: userId,
            ingredient_id: ingredientMap.get(ing.name.toLowerCase().trim()) || null,
          }));
          if (ings.length > 0) await supabase.from('recipe_ingredients').insert(ings);
        }
      }

      // Mark onboarding complete
      await updateProfile.mutateAsync({
        restaurant_name: name || undefined,
        onboarding_completed: true,
      });

      qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      qc.invalidateQueries({ queryKey: ['lots'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['vendors'] });
      toast.success(hasData ? 'Setup complete! Welcome to Mise en Place 🎉' : 'Demo data loaded! Explore your diner dashboard 🎉');
    } catch (e) {
      console.error(e);
      toast.error('Failed to save — please try again');
    } finally {
      setSaving(false);
    }
  }, [scannedRecipes, removedIndices, stockItems, name, updateProfile, qc]);

  const skipMenuAndFinish = useCallback(async () => {
    // Skip to POS step which will then trigger saveAndFinish with empty data → seed
    setStep(4);
  }, []);

  const activeCount = scannedRecipes.filter((_, i) => !removedIndices.has(i)).length;
  const countedItems = stockItems.filter(i => i.currentStock !== '' && parseFloat(i.currentStock) > 0).length;

  const steps = [
    { title: 'Welcome', icon: '🍽' },
    { title: 'Menu', icon: '📸' },
    { title: 'Recipes', icon: '📋' },
    { title: 'Stock Count', icon: '🔢' },
    { title: 'POS', icon: '💳' },
  ];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => { if (e.target.files?.[0]) scanMenuPhoto(e.target.files[0]); e.target.value = ''; }} />

      <div className="w-full max-w-xl">
        {/* Progress */}
        <div className="flex items-center justify-center gap-1.5 mb-8">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                i < step ? 'bg-primary text-primary-foreground' :
                i === step ? 'bg-primary text-primary-foreground ring-4 ring-primary/20' :
                'bg-muted text-muted-foreground'
              }`}>
                {i < step ? '✓' : s.icon}
              </div>
              {i < steps.length - 1 && (
                <div className={`w-8 h-0.5 rounded ${i < step ? 'bg-primary' : 'bg-border'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className="bg-card border border-border rounded-2xl p-8 text-center shadow-sm animate-fade-up">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🍽</div>
            <h1 className="text-2xl font-extrabold text-foreground mb-2">Welcome to Mise en Place</h1>
            <p className="text-muted-foreground text-sm mb-6">Let's set up your restaurant inventory in a few simple steps.</p>
            <div className="text-left mb-6">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Restaurant Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2.5 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                placeholder="e.g. Tony's Bistro"
                autoFocus
              />
            </div>
            <Button className="w-full" size="lg" onClick={() => setStep(1)}>
              Get Started →
            </Button>
          </div>
        )}

        {/* Step 1: Upload Menu */}
        {step === 1 && scanState === 'idle' && (
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm animate-fade-up">
            <h2 className="text-xl font-extrabold text-foreground text-center mb-2">Upload Your Menu</h2>
            <p className="text-muted-foreground text-sm text-center mb-6">
              Our AI will read your menu and extract all dishes with estimated ingredients.
            </p>
            <div className="grid grid-cols-1 gap-3 mb-4">
              <div
                className="border-2 border-dashed border-primary/30 rounded-xl p-6 text-center cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-all"
                onClick={() => fileRef.current?.click()}
              >
                <div className="text-3xl mb-2">📸</div>
                <div className="font-bold text-sm text-foreground mb-1">Upload a photo or PDF</div>
                <div className="text-xs text-muted-foreground">Take a photo of your printed menu, or upload a PDF</div>
              </div>
              <div className="border-2 border-dashed border-accent-foreground/20 rounded-xl p-6 text-center">
                <div className="text-3xl mb-2">🔗</div>
                <div className="font-bold text-sm text-foreground mb-2">Or paste your menu URL</div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="https://yourrestaurant.com/menu"
                    value={menuUrlInput}
                    onChange={e => setMenuUrlInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && menuUrlInput.trim()) scanMenuUrl(menuUrlInput.trim()); }}
                  />
                  <Button disabled={!menuUrlInput.trim()} onClick={() => scanMenuUrl(menuUrlInput.trim())}>
                    Scan
                  </Button>
                </div>
              </div>
            </div>
            <button className="w-full text-sm text-muted-foreground hover:text-foreground py-2" onClick={skipMenuAndFinish}>
              Skip — load demo diner data instead
            </button>
          </div>
        )}

        {/* Scanning */}
        {step === 1 && scanState === 'scanning' && (
          <div className="bg-card border border-border rounded-2xl p-12 text-center shadow-sm animate-fade-up">
            {menuPreviewUrl && (
              <img src={menuPreviewUrl} alt="Menu" className="w-full max-w-[280px] h-[180px] object-cover rounded-lg mb-5 border border-border mx-auto" />
            )}
            <div className="text-4xl mb-3 animate-pulse">🤖</div>
            <div className="font-bold text-lg text-foreground mb-1.5">AI is reading your menu…</div>
            <div className="text-sm text-muted-foreground">Identifying dishes and estimating ingredient quantities</div>
            <div className="mt-5 h-1.5 bg-border rounded-full overflow-hidden max-w-[280px] mx-auto">
              <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
          </div>
        )}

        {/* Error */}
        {step === 1 && scanState === 'error' && (
          <div className="bg-card border border-destructive/30 rounded-2xl p-8 text-center shadow-sm animate-fade-up">
            <div className="text-4xl mb-3">⚠️</div>
            <div className="font-bold text-base text-destructive mb-1.5">Scan failed</div>
            <div className="text-sm text-muted-foreground mb-5">The link may block automated access. Try a photo instead.</div>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => { setScanState('idle'); setMenuUrlInput(''); }}>Try again</Button>
              <Button onClick={() => fileRef.current?.click()}>📸 Upload photo</Button>
            </div>
          </div>
        )}

        {/* Done scanning → advance to review */}
        {step === 1 && scanState === 'done' && (
          <div className="bg-card border border-border rounded-2xl p-8 text-center shadow-sm animate-fade-up">
            <div className="text-4xl mb-3">🎉</div>
            <div className="font-bold text-lg text-foreground mb-1.5">Found {scannedRecipes.length} menu items!</div>
            <div className="text-sm text-muted-foreground mb-5">Review and edit them in the next step.</div>
            <Button className="w-full" onClick={() => setStep(2)}>Review Recipes →</Button>
          </div>
        )}

        {/* Step 2: Review Recipes with Menu Price */}
        {step === 2 && (
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm animate-fade-up">
            <h2 className="text-xl font-extrabold text-foreground text-center mb-1">Review Your Recipes</h2>
            <p className="text-muted-foreground text-sm text-center mb-4">
              Edit names, set menu prices, adjust ingredients. {activeCount} of {scannedRecipes.length} will be saved.
            </p>
            <div className="max-h-[380px] overflow-y-auto space-y-2 mb-5 pr-1">
              {scannedRecipes.map((r, i) => {
                const removed = removedIndices.has(i);
                return (
                  <div key={i} className={`border rounded-lg p-3 transition-all ${removed ? 'border-border/30 opacity-40' : 'border-border'}`}>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          className={`font-bold text-sm bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none px-0 py-0.5 flex-1 ${removed ? 'line-through' : ''}`}
                          value={r.name}
                          onChange={e => updateScannedRecipeName(i, e.target.value)}
                          disabled={removed}
                        />
                        {!removed && (
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] text-muted-foreground font-bold">$</span>
                            <input
                              type="number"
                              className="w-16 text-sm bg-transparent border-b border-border focus:border-primary focus:outline-none text-right font-mono px-0 py-0.5"
                              placeholder="0.00"
                              value={r.menu_price || ''}
                              onChange={e => updateScannedRecipePrice(i, e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                      <button
                        className={`text-xs px-2 py-1 rounded-md border transition-colors shrink-0 ${removed ? 'border-primary/30 text-primary hover:bg-primary/10' : 'border-destructive/30 text-destructive hover:bg-destructive/10'}`}
                        onClick={() => toggleRemoveRecipe(i)}
                      >
                        {removed ? '↩ Restore' : '✕ Remove'}
                      </button>
                    </div>
                    {!removed && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {r.ingredients.map((ing, j) => (
                          <div key={j} className="flex items-center gap-1.5 bg-muted/50 rounded-md px-2 py-1">
                            <input
                              className="flex-1 text-[11px] bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none font-mono"
                              value={ing.name}
                              onChange={e => updateScannedIngredient(i, j, 'name', e.target.value)}
                            />
                            <input
                              type="number"
                              className="w-12 text-[11px] bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none text-center font-mono"
                              value={ing.qty}
                              onChange={e => updateScannedIngredient(i, j, 'qty', parseFloat(e.target.value) || 0)}
                            />
                            <input
                              className="w-10 text-[11px] bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none text-center font-mono"
                              value={ing.unit}
                              onChange={e => updateScannedIngredient(i, j, 'unit', e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" size="lg" onClick={goToStockCount} disabled={activeCount === 0}>
                Next: Stock Count →
              </Button>
              <Button variant="outline" onClick={() => { setStep(1); setScanState('idle'); }}>
                ← Back
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: First Stock Count — grouped by storage */}
        {step === 3 && (
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm animate-fade-up">
            <h2 className="text-xl font-extrabold text-foreground text-center mb-1">First Stock Count</h2>
            <p className="text-muted-foreground text-sm text-center mb-1">
              Enter how much of each ingredient you currently have on hand.
            </p>
            <p className="text-muted-foreground text-xs text-center mb-4">
              {countedItems} of {stockItems.length} counted · You can update these later
            </p>

            <div className="max-h-[400px] overflow-y-auto space-y-4 mb-5 pr-1">
              {groupedStockItems.map(group => (
                <div key={group.type}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-bold text-sm text-foreground flex items-center gap-1.5">
                      {group.icon} {group.label}
                      <span className="text-xs text-muted-foreground font-normal">({group.items.length})</span>
                    </div>
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => skipSectionStock(group.type)}
                    >
                      Skip — I'll count later
                    </button>
                  </div>
                  <div className="space-y-2">
                    {group.items.map(item => (
                      <div key={item.originalIndex} className="border border-border rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-bold text-sm flex-1">{item.name}</span>
                          <span className="text-[11px] text-muted-foreground font-mono">{item.unit}</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Qty on Hand</label>
                            <input
                              type="number"
                              className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono"
                              placeholder="0"
                              value={item.currentStock}
                              onChange={e => updateStockItem(item.originalIndex, 'currentStock', e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Storage</label>
                            <select
                              className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-background"
                              value={item.storage}
                              onChange={e => updateStockItem(item.originalIndex, 'storage', e.target.value)}
                            >
                              <option value="room">🏠 Room</option>
                              <option value="fridge">❄️ Fridge</option>
                              <option value="freezer">🧊 Freezer</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Perishable?</label>
                            <button
                              className={`w-full px-2 py-1.5 border rounded-md text-sm transition-colors ${item.isPerishable ? 'bg-primary/10 border-primary text-primary' : 'bg-background border-border text-muted-foreground'}`}
                              onClick={() => updateStockItem(item.originalIndex, 'isPerishable', !item.isPerishable)}
                            >
                              {item.isPerishable ? '🌿 Yes' : 'No'}
                            </button>
                          </div>
                          {item.isPerishable && (
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Shelf Life (days)</label>
                              <input
                                type="number"
                                className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono"
                                placeholder="7"
                                value={item.shelfLifeDays}
                                onChange={e => updateStockItem(item.originalIndex, 'shelfLifeDays', e.target.value)}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {stockItems.length === 0 && (
                <div className="text-center text-muted-foreground py-8">No ingredients found</div>
              )}
            </div>

            <div className="flex gap-2">
              <Button className="flex-1" size="lg" onClick={() => setStep(4)}>
                Next: Connect POS →
              </Button>
              <Button variant="outline" onClick={() => setStep(2)}>
                ← Back
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Connect POS */}
        {step === 4 && (
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm animate-fade-up">
            <h2 className="text-xl font-extrabold text-foreground text-center mb-2">Connect Your POS</h2>
            <p className="text-muted-foreground text-sm text-center mb-6">
              Link your point-of-sale system to automatically track sales and deduct inventory.
            </p>
            <div className="grid gap-2.5 mb-6">
              {POS_SYSTEMS.map(pos => (
                <button
                  key={pos.id}
                  className="flex items-center gap-3 p-4 border border-border rounded-xl text-left hover:border-primary/50 hover:bg-primary/5 transition-all group"
                  onClick={() => toast.info(`${pos.name} integration coming soon!`)}
                >
                  <span className="text-2xl">{pos.icon}</span>
                  <div className="flex-1">
                    <div className="font-bold text-sm text-foreground">{pos.name}</div>
                    <div className="text-xs text-muted-foreground">{pos.desc}</div>
                  </div>
                  <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">Connect →</span>
                </button>
              ))}
            </div>
            <div className="bg-muted/50 border border-border rounded-lg px-4 py-3 mb-5 text-center">
              <div className="text-xs text-muted-foreground">
                💡 You can also record sales manually or import CSV files from the Sales tab.
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" size="lg" onClick={() => saveAndFinish()} disabled={saving}>
                {saving ? 'Setting up…' : 'Finish Setup 🚀'}
              </Button>
              {scannedRecipes.length > 0 && (
                <Button variant="outline" onClick={() => setStep(3)} disabled={saving}>
                  ← Back
                </Button>
              )}
            </div>
            <button
              className="w-full text-sm text-muted-foreground hover:text-foreground py-2 mt-2"
              onClick={() => saveAndFinish()}
              disabled={saving}
            >
              Skip POS — I'll connect later
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
