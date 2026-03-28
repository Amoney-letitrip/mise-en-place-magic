import { useState, useMemo, useCallback } from 'react';
import { useIngredients, useLots, useSales, useRecipesWithIngredients, useVendors, useUpdateIngredient, useUpdateLot, useCreateLot, useBulkUpdateIngredients } from '@/hooks/use-inventory-data';
import { computeForecast, diffDays } from '@/lib/inventory-utils';
import type { TabId } from '@/lib/types';
import { toast } from 'sonner';

const SALES_LOOKBACK_DAYS = 7;

export const useAppState = () => {
  const [tab, setTab] = useState<TabId>('dashboard');
  const [fefo, setFefo] = useState(true);
  const [targetDays, setTargetDays] = useState(7);

  const { data: ingredients = [], isLoading: loadingIngredients, error: errorIngredients } = useIngredients();
  const { data: lots = [], isLoading: loadingLots, error: errorLots } = useLots();
  const { data: sales = [], isLoading: loadingSales, error: errorSales } = useSales();
  const { data: recipes = [], isLoading: loadingRecipes, error: errorRecipes } = useRecipesWithIngredients();
  const { data: vendors = [] } = useVendors();

  const updateIngredient = useUpdateIngredient();
  const updateLot = useUpdateLot();
  const createLot = useCreateLot();
  const bulkUpdateIngredients = useBulkUpdateIngredients();

  const isLoading = loadingIngredients || loadingLots || loadingSales || loadingRecipes;
  const hasError = !!(errorIngredients || errorLots || errorSales || errorRecipes);

  const now = new Date();

  const expiredLots = useMemo(() =>
    lots.filter(l => l.quantity_remaining > 0 && l.expires_at && diffDays(new Date(l.expires_at), now) < 0),
    [lots]
  );

  const expiringLots = useMemo(() =>
    lots.filter(l => l.quantity_remaining > 0 && l.expires_at && {
      d: diffDays(new Date(l.expires_at), now)
    }).filter(l => {
      const d = diffDays(new Date(l.expires_at!), now);
      return d >= 0 && d <= 2;
    }),
    [lots]
  );

  const lowItems = useMemo(() =>
    ingredients.filter(i => i.current_stock <= i.threshold),
    [ingredients]
  );

  const draftRecipes = useMemo(() =>
    recipes.filter(r => r.status === 'draft'),
    [recipes]
  );

  const flaggedSales = useMemo(() =>
    sales.filter(s => s.status === 'flagged'),
    [sales]
  );

  // Only count sales from the last 7 days for ADU forecast
  const salesByItem = useMemo(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - SALES_LOOKBACK_DAYS);
    const counts: Record<string, number> = {};
    sales
      .filter(s => s.status === 'processed' && new Date(s.created_at) >= sevenDaysAgo)
      .forEach(s => {
        counts[s.item] = (counts[s.item] || 0) + s.qty;
      });
    return counts;
  }, [sales]);

  const forecasts = useMemo(() => {
    const m: Record<string, ReturnType<typeof computeForecast>> = {};
    ingredients.forEach(ing => {
      const vendor = vendors.find(v => v.name === ing.vendor);
      const lead = vendor?.lead_time_days ?? 2;
      m[ing.id] = computeForecast(
        ing as any,
        recipes.map(r => ({
          ...r,
          name: r.name,
          ingredients: r.ingredients.map(ri => ({
            ingredient_id: ri.ingredient_id,
            qty: ri.qty,
            unit: ri.unit,
          })),
        })),
        salesByItem,
        targetDays,
        lead
      );
    });
    return m;
  }, [ingredients, recipes, salesByItem, targetDays, vendors]);

  const orderDraft = useMemo(() => {
    const byV: Record<string, { vendor: string; items: any[]; anyDue: boolean }> = {};
    ingredients.forEach(ing => {
      if (!ing.vendor) return;
      const fc = forecasts[ing.id];
      if (!fc || fc.recommendedQty <= 0) return;
      if (!byV[ing.vendor]) byV[ing.vendor] = { vendor: ing.vendor, items: [], anyDue: false };
      byV[ing.vendor].items.push({ ...ing, ...fc });
      if (fc.orderDue) byV[ing.vendor].anyDue = true;
    });
    return Object.values(byV).sort((a, b) => (b.anyDue ? 1 : 0) - (a.anyDue ? 1 : 0));
  }, [ingredients, forecasts]);

  const stockoutRisk = useMemo(() =>
    ingredients.filter(ing => {
      const fc = forecasts[ing.id];
      if (!fc || fc.daysLeft === Infinity) return false;
      const vendor = vendors.find(v => v.name === ing.vendor);
      return fc.daysLeft <= ((vendor?.lead_time_days ?? 2) + 1);
    }),
    [ingredients, forecasts, vendors]
  );

  const suggestions = useMemo(() => {
    const s: Array<{ icon: string; text: string; tab: TabId }> = [];
    const dueVendors = orderDraft.filter(v => v.anyDue);
    if (dueVendors.length > 0) {
      s.push({ icon: '📦', text: `Send ${dueVendors.length} purchase order${dueVendors.length > 1 ? 's' : ''} — ${dueVendors.map(v => v.vendor).join(', ')}`, tab: 'orders' });
    }
    if (expiredLots.length > 0) {
      s.push({ icon: '🗑', text: `Log waste for ${expiredLots.length} expired lot${expiredLots.length > 1 ? 's' : ''}`, tab: 'inventory' });
    }
    if (expiringLots.length > 0) {
      s.push({ icon: '⚡', text: `${expiringLots.length} ingredient${expiringLots.length > 1 ? 's' : ''} expiring soon — use or log waste`, tab: 'inventory' });
    }
    if (draftRecipes.length > 0) {
      s.push({ icon: '📋', text: `${draftRecipes.length} recipe${draftRecipes.length > 1 ? 's' : ''} need${draftRecipes.length === 1 ? 's' : ''} verification — verify to start tracking inventory`, tab: 'recipes' });
    }
    return s.slice(0, 5);
  }, [orderDraft, expiredLots, expiringLots, draftRecipes]);

  const logWaste = useCallback(async (lot: typeof lots[0]) => {
    const ing = ingredients.find(i => i.id === lot.ingredient_id);
    if (!ing) return;
    await updateIngredient.mutateAsync({
      id: ing.id,
      updates: { current_stock: Math.max(0, ing.current_stock - lot.quantity_remaining) },
    });
    await updateLot.mutateAsync({
      id: lot.id,
      updates: { quantity_remaining: 0 },
    });
    toast.success('Waste logged');
  }, [ingredients, updateIngredient, updateLot]);

  return {
    tab, setTab, fefo, setFefo, targetDays, setTargetDays,
    ingredients, lots, sales, recipes, vendors,
    isLoading,
    expiredLots, expiringLots, lowItems, draftRecipes, flaggedSales,
    salesByItem, forecasts, orderDraft, stockoutRisk, suggestions,
    logWaste,
    updateIngredient, updateLot, createLot, bulkUpdateIngredients,
  };
};
