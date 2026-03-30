import { StatusTag, Mono, SectionHead } from './StatusTag';
import { fmtN } from '@/lib/inventory-utils';
import type { Database } from '@/integrations/supabase/types';
import type { TabId } from '@/lib/types';

type Ingredient = Database['public']['Tables']['ingredients']['Row'];
type Lot = Database['public']['Tables']['lots']['Row'];

interface RecipeWithIngredients {
  id: string;
  name: string;
  status: string;
  menu_price: number;
  ingredients: Array<{ ingredient_id: string | null; qty: number; unit: string }>;
}

interface CostsTabProps {
  ingredients: Ingredient[];
  recipes: RecipeWithIngredients[];
  setTab?: (tab: TabId) => void;
  expiredLots?: Lot[];
}

export const CostsTab = ({ ingredients, recipes, setTab, expiredLots = [] }: CostsTabProps) => {
  const totalIngCost = ingredients.reduce((sum, ing) => sum + ing.current_stock * ing.cost_per_unit, 0);

  const wasteValue = expiredLots.reduce((sum, lot) => {
    const ing = ingredients.find(i => i.id === lot.ingredient_id);
    return sum + lot.quantity_remaining * (ing?.cost_per_unit ?? 0);
  }, 0);

  const recipeMargins = recipes.filter(r => r.status === 'verified').map(r => {
    const cost = r.ingredients.reduce((s, ri) => {
      if (!ri.ingredient_id) return s;
      const ing = ingredients.find(i => i.id === ri.ingredient_id);
      return s + ri.qty * (ing?.cost_per_unit ?? 0);
    }, 0);
    const price = r.menu_price || 0;
    const hasPrice = price > 0;
    return { id: r.id, name: r.name, cost, price, margin: price - cost, pct: hasPrice ? (cost / price * 100) : 0, hasPrice };
  });

  const pricedRecipes = recipeMargins.filter(r => r.hasPrice);
  const avgFoodCostPct = pricedRecipes.length > 0
    ? pricedRecipes.reduce((s, r) => s + r.pct, 0) / pricedRecipes.length
    : 0;

  return (
    <div className="animate-fade-up">
      <SectionHead title="Cost Analytics" sub="Owner view — food cost, margins, and waste" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-4">
        <div className={`bg-card border rounded-lg p-4 ${avgFoodCostPct > 35 ? 'bg-red-50/50 border-red-200' : pricedRecipes.length > 0 ? 'bg-emerald-50/50 border-emerald-200' : 'border-border'}`}>
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">🥩 Avg Food Cost %</div>
          <div className={`text-4xl font-extrabold leading-none mb-1 ${pricedRecipes.length === 0 ? 'text-muted-foreground/30' : avgFoodCostPct > 35 ? 'text-destructive' : 'text-emerald-600'}`}>
            {pricedRecipes.length === 0 ? '—' : `${avgFoodCostPct.toFixed(1)}%`}
          </div>
          <div className="text-[11px] text-muted-foreground">{pricedRecipes.length === 0 ? 'Set menu prices to calculate' : 'Target: under 30%'}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">📦 Inventory Value</div>
          <div className="text-4xl font-extrabold leading-none mb-1 text-foreground">${totalIngCost.toFixed(0)}</div>
          <div className="text-[11px] text-muted-foreground">current on-hand stock</div>
        </div>
        <div className={`rounded-lg p-4 ${wasteValue > 0 ? 'bg-amber-50/50 border border-amber-200' : 'bg-card border border-border'}`}>
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">🗑 Est. Waste Value</div>
          <div className={`text-4xl font-extrabold leading-none mb-1 ${wasteValue > 0 ? 'text-amber-600' : 'text-muted-foreground/30'}`}>
            ${wasteValue.toFixed(2)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {expiredLots.length > 0 ? `${expiredLots.length} expired lot${expiredLots.length !== 1 ? 's' : ''}` : 'No expired lots'}
          </div>
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
                    <td className="px-3.5 py-2.5">
                      {r.hasPrice ? (
                        <Mono className="text-emerald-600">${r.price.toFixed(2)}</Mono>
                      ) : (
                        <button
                          className="text-xs text-primary hover:underline font-semibold"
                          onClick={() => setTab?.('recipes')}
                        >
                          Set price →
                        </button>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5">
                      {r.hasPrice ? (
                        <div className="flex items-center gap-2">
                          <div className="w-[60px] h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${r.pct > 35 ? 'bg-destructive' : r.pct > 30 ? 'bg-warning' : 'bg-stock-good'}`} style={{ width: `${Math.min(100, r.pct)}%` }} />
                          </div>
                          <span className={`font-bold text-[13px] ${r.pct > 35 ? 'text-destructive' : r.pct > 30 ? 'text-amber-600' : 'text-emerald-600'}`}>{r.pct.toFixed(1)}%</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5">
                      {r.hasPrice ? (
                        <span className="font-bold text-emerald-600">${r.margin.toFixed(2)}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
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
        {ingredients.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-[13px]">
            No ingredients yet — add ingredients to track unit costs and inventory value
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
};
