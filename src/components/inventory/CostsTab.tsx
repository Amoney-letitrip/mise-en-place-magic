import { StatusTag, Mono, SectionHead } from './StatusTag';
import { fmtN } from '@/lib/inventory-utils';
import type { Database } from '@/integrations/supabase/types';

type Ingredient = Database['public']['Tables']['ingredients']['Row'];

interface RecipeWithIngredients {
  id: string;
  name: string;
  status: string;
  ingredients: Array<{ ingredient_id: string | null; qty: number; unit: string }>;
}

interface CostsTabProps {
  ingredients: Ingredient[];
  recipes: RecipeWithIngredients[];
}

export const CostsTab = ({ ingredients, recipes }: CostsTabProps) => {
  const totalIngCost = ingredients.reduce((sum, ing) => sum + ing.current_stock * ing.cost_per_unit, 0);

  const recipeMargins = recipes.filter(r => r.status === 'verified').map(r => {
    const cost = r.ingredients.reduce((s, ri) => {
      if (!ri.ingredient_id) return s;
      const ing = ingredients.find(i => i.id === ri.ingredient_id);
      return s + ri.qty * (ing?.cost_per_unit ?? 0);
    }, 0);
    const menuPrices: Record<string, number> = { 'Classic Burger': 14.99, 'Margherita Pizza': 16.99 };
    const price = menuPrices[r.name] || 12.99;
    return { name: r.name, cost, price, margin: price - cost, pct: cost / price * 100 };
  });

  const avgFoodCostPct = recipeMargins.length > 0
    ? recipeMargins.reduce((s, r) => s + r.pct, 0) / recipeMargins.length
    : 0;

  return (
    <div className="animate-fade-up">
      <SectionHead title="Cost Analytics" sub="Owner view — food cost, margins, and waste" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-4">
        <div className={`bg-card border rounded-lg p-4 ${avgFoodCostPct > 35 ? 'bg-red-50/50 border-red-200' : 'bg-emerald-50/50 border-emerald-200'}`}>
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">🥩 Avg Food Cost %</div>
          <div className={`text-4xl font-extrabold leading-none mb-1 ${avgFoodCostPct > 35 ? 'text-destructive' : 'text-emerald-600'}`}>{avgFoodCostPct.toFixed(1)}%</div>
          <div className="text-[11px] text-muted-foreground">Target: under 30%</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">📦 Inventory Value</div>
          <div className="text-4xl font-extrabold leading-none mb-1 text-foreground">${totalIngCost.toFixed(0)}</div>
          <div className="text-[11px] text-muted-foreground">current on-hand stock</div>
        </div>
        <div className="bg-amber-50/50 border border-amber-200 rounded-lg p-4">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">🗑 Est. Waste Value</div>
          <div className="text-4xl font-extrabold leading-none mb-1 text-amber-600">$0</div>
          <div className="text-[11px] text-muted-foreground">from expired lots</div>
        </div>
      </div>

      {/* Recipe Cost Breakdown */}
      <div className="bg-card border border-border rounded-lg overflow-hidden mb-3.5">
        <div className="px-4 py-3 border-b border-border/30 font-bold text-sm">Recipe Cost Breakdown</div>
        {recipeMargins.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-[13px]">No verified recipes yet — verify recipes to see cost breakdown</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Recipe</th>
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Ingredient Cost</th>
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Menu Price</th>
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Food Cost %</th>
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Gross Margin</th>
                </tr>
              </thead>
              <tbody>
                {recipeMargins.map(r => (
                  <tr key={r.name} className="border-b border-border/30">
                    <td className="px-3.5 py-2.5 font-semibold">{r.name}</td>
                    <td className="px-3.5 py-2.5"><Mono>${r.cost.toFixed(2)}</Mono></td>
                    <td className="px-3.5 py-2.5"><Mono className="text-emerald-600">${r.price.toFixed(2)}</Mono></td>
                    <td className="px-3.5 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-[60px] h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${r.pct > 35 ? 'bg-destructive' : r.pct > 30 ? 'bg-warning' : 'bg-stock-good'}`} style={{ width: `${Math.min(100, r.pct)}%` }} />
                        </div>
                        <span className={`font-bold text-[13px] ${r.pct > 35 ? 'text-destructive' : r.pct > 30 ? 'text-amber-600' : 'text-emerald-600'}`}>{r.pct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-3.5 py-2.5"><span className="font-bold text-emerald-600">${r.margin.toFixed(2)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ingredient Unit Costs */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30">
          <div className="font-bold text-sm">Ingredient Unit Costs</div>
          <div className="text-xs text-muted-foreground mt-0.5">Edit to keep margins accurate</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Ingredient</th>
                <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Unit</th>
                <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Cost / Unit</th>
                <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">On Hand</th>
                <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Stock Value</th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map(ing => (
                <tr key={ing.id} className="border-b border-border/30">
                  <td className="px-3.5 py-2.5 font-semibold">{ing.name}</td>
                  <td className="px-3.5 py-2.5"><StatusTag variant="slate">{ing.unit}</StatusTag></td>
                  <td className="px-3.5 py-2.5"><Mono>${ing.cost_per_unit.toFixed(3)}</Mono></td>
                  <td className="px-3.5 py-2.5"><Mono>{fmtN(ing.current_stock)}</Mono></td>
                  <td className="px-3.5 py-2.5"><Mono>${(ing.current_stock * ing.cost_per_unit).toFixed(2)}</Mono></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
