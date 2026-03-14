import { useState, useMemo, useCallback } from 'react';
import { useIngredients, useLots, useSales, useRecipesWithIngredients, useVendors, useUpdateIngredient, useUpdateLot, useCreateLot, useBulkUpdateIngredients } from '@/hooks/use-inventory-data';
import { computeForecast, diffDays, buildCycleList, depleteOrdered, addDays } from '@/lib/inventory-utils';
import type { TabId } from '@/lib/types';
import { toast } from 'sonner';

export const useAppState = () => {
  const [tab, setTab] = useState<TabId>('dashboard');
  const [fefo, setFefo] = useState(true);
  const [targetDays, setTargetDays] = useState(7);

  const { data: ingredients = [], isLoading: loadingIngredients } = useIngredients();
  const { data: lots = [], isLoading: loadingLots } = useLots();
  const { data: sales = [], isLoading: loadingSales } = useSales();
  const { data: recipes = [], isLoading: loadingRecipes } = useRecipesWithIngredients();
  const { data: vendors = [] } = useVendors();

  const updateIngredient = useUpdateIngredient();
  const updateLot = useUpdateLot();
  const createLot = useCreateLot();
  const bulkUpdateIngredients = useBulkUpdateIngredients();

  const isLoading = loadingIngredients || loadingLots || loadingSales || loadingRecipes;

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

  const salesByItem = useMemo(() => {
    const counts: Record<string, number> = {};
    sales.filter(s => s.status === 'processed').forEach(s => {
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
      const names = [...new Set(expiringLots.map(l => ingredients.find(i => i.id === l.ingredient_id)?.name))].filter(Boolean);
      s.push({ icon: '⚡', text: `Use up expiring stock today (${names.join(', ')})`, tab: 'inventory' });
    }
    if (draftRecipes.length > 0) {
      s.push({ icon: '📋', text: `Verify ${draftRecipes.map(r => r.name).join(', ')} — unverified recipes skip inventory tracking`, tab: 'recipes' });
    }
    return s.slice(0, 5);
  }, [orderDraft, expiredLots, expiringLots, draftRecipes, ingredients]);

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
