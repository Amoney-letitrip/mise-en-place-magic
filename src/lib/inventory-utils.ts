import type { Ingredient, Lot, Forecast, CycleCountItem } from './types';

// ── Date helpers ──
export const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const diffDays = (a: Date, b: Date): number => (a.getTime() - b.getTime()) / 86400000;

export const fmtDate = (d: Date | string): string =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export const fmtN = (n: number): number | string =>
  typeof n !== 'number' || isNaN(n) ? '—' as any : Number.isInteger(n) ? n : parseFloat(n.toFixed(1));

export const roundUp = (n: number, step = 1): number => Math.ceil(n / step) * step;

// ── Unit conversion ──
const CONVS: Record<string, (v: number) => number> = {
  'oz→g': (v) => v * 28.3495,
  'g→oz': (v) => v / 28.3495,
  'tbsp→ml': (v) => v * 15,
  'ml→tbsp': (v) => v / 15,
};

export const convertUnit = (val: number, from: string, to: string): number | null =>
  from === to ? val : (CONVS[`${from}→${to}`]?.(val) ?? null);

export const unitsCompatible = (a: string, b: string): boolean =>
  a === b || [`${a}→${b}`, `${b}→${a}`].some((k) => k in CONVS);

// ── Forecast ──
export const computeForecast = (
  ing: Ingredient,
  recipes: Array<{ status: string; ingredients: Array<{ ingredient_id: string | null; qty: number; unit: string }> }>,
  salesByItem: Record<string, number>,
  targetDays: number,
  leadDays: number
): Forecast => {
  const cf = ing.calib_factor ?? 1;
  const now = new Date();
  let theo = 0;

  recipes
    .filter((r) => r.status === 'verified')
    .forEach((r) => {
      const recipeName = (r as any).name;
      const daily = (salesByItem[recipeName] || 0) / 7;
      r.ingredients.forEach((ri) => {
        if (ri.ingredient_id !== ing.id) return;
        let q = ri.qty;
        if (ri.unit !== ing.unit) {
          const c = convertUnit(ri.qty, ri.unit, ing.unit);
          if (c === null) return;
          q = c;
        }
        theo += q * daily;
      });
    });

  const adu = theo * cf;
  const safe = adu > 0 ? adu : null;
  const daysLeft = safe ? Math.max(0, ing.current_stock / safe) : Infinity;
  const stockoutDate = safe ? addDays(now, daysLeft) : null;
  const orderByDate = safe ? addDays(stockoutDate!, -leadDays) : null;
  const needed = safe ? targetDays * adu : ing.reorder_qty;
  const recommendedQty = Math.max(0, roundUp(needed - ing.current_stock, 1));
  const orderDue = orderByDate ? diffDays(orderByDate, now) <= 0 : false;

  return { adu, daysLeft, stockoutDate, orderByDate, recommendedQty, orderDue };
};

// ── FIFO/FEFO lot depletion ──
export const depleteOrdered = (
  lots: Lot[],
  ingId: string,
  qty: number,
  fefo: boolean,
  perishable: boolean
): Lot[] => {
  const copy = lots.map((l) => ({ ...l }));
  const now = new Date();
  copy
    .filter((l) => l.ingredient_id === ingId && l.quantity_remaining > 0)
    .sort((a, b) =>
      fefo && perishable && a.expires_at && b.expires_at
        ? new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime()
        : new Date(a.received_at).getTime() - new Date(b.received_at).getTime()
    )
    .forEach((lot) => {
      if (qty <= 0) return;
      const idx = copy.findIndex((l) => l.id === lot.id);
      const take = Math.min(copy[idx].quantity_remaining, qty);
      copy[idx].quantity_remaining = parseFloat((copy[idx].quantity_remaining - take).toFixed(1));
      qty -= take;
    });
  return copy;
};

// ── Cycle count builder (exception-based) ──
export const buildCycleList = (
  ingredients: Ingredient[],
  lots: Lot[],
  calibData?: Array<{ ingredientId: string; factor: number }>
): CycleCountItem[] => {
  const now = new Date();
  const map = new Map<string, CycleCountItem>();

  const add = (ing: Ingredient, tag: string) => {
    if (!map.has(ing.id)) {
      map.set(ing.id, {
        id: ing.id,
        ingredientId: ing.id,
        name: ing.name,
        unit: ing.unit,
        systemQty: ing.current_stock,
        counted: null,
        reason: null,
        tags: [],
      });
    }
    map.get(ing.id)!.tags.push(tag);
  };

  // Low stock items
  ingredients.filter((i) => i.current_stock <= i.threshold).forEach((i) => add(i, 'low-stock'));

  // Variance items
  if (calibData) {
    ingredients.forEach((i) => {
      const c = calibData.find((x) => x.ingredientId === i.id);
      if (c && Math.abs(c.factor - 1) > 0.08) add(i, 'variance');
    });
  }

  // Expiring lots
  const expIds = new Set(
    lots
      .filter((l) => l.quantity_remaining > 0 && l.expires_at && diffDays(new Date(l.expires_at), now) <= 2)
      .map((l) => l.ingredient_id)
  );
  ingredients.filter((i) => expIds.has(i.id)).forEach((i) => add(i, 'expiring'));

  // High-value items
  [...ingredients]
    .sort((a, b) => b.reorder_qty - a.reorder_qty)
    .slice(0, 5)
    .forEach((i) => add(i, 'high-value'));

  return Array.from(map.values());
};

export const DISCREPANCY_REASONS = [
  'Waste / Spoilage',
  'Theft',
  'Over-portioning',
  'Mis-receive',
  'Count error',
  'Unknown',
];

export const getStockColor = (current: number, threshold: number): string => {
  if (current <= threshold) return 'danger';
  const pct = (current / (threshold * 3)) * 100;
  return pct > 60 ? 'good' : 'warning';
};

export const getFreshnessDays = (expiresAt: string | null): number | null => {
  if (!expiresAt) return null;
  return Math.round(diffDays(new Date(expiresAt), new Date()));
};
