import { useAppState } from '@/hooks/use-app-state';
import { AppNav } from '@/components/inventory/AppNav';
import { DashboardTab } from '@/components/inventory/DashboardTab';
import { InventoryTab } from '@/components/inventory/InventoryTab';
import { OrdersTab } from '@/components/inventory/OrdersTab';
import { SalesTab } from '@/components/inventory/SalesTab';
import { RecipesTab } from '@/components/inventory/RecipesTab';
import { CostsTab } from '@/components/inventory/CostsTab';
import type { TabId } from '@/lib/types';

const Index = () => {
  const state = useAppState();

  const navItems: Array<{ id: TabId; label: string; badge?: number | null }> = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'inventory', label: 'Inventory', badge: state.lowItems.length || null },
    { id: 'orders', label: 'Orders', badge: state.orderDraft.filter(v => v.anyDue).length || null },
    { id: 'sales', label: 'Sales', badge: state.flaggedSales.length || null },
    { id: 'recipes', label: 'Recipes', badge: state.draftRecipes.length || null },
    { id: 'costs', label: 'Costs' },
  ];

  if (state.isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppNav tab={state.tab} setTab={state.setTab} fefo={state.fefo} setFefo={state.setFefo} navItems={navItems} />
        <div className="max-w-content mx-auto px-4 py-20 text-center">
          <div className="text-4xl mb-4 animate-pulse">🍽</div>
          <div className="text-muted-foreground">Loading inventory…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppNav tab={state.tab} setTab={state.setTab} fefo={state.fefo} setFefo={state.setFefo} navItems={navItems} />

      <div className="max-w-content mx-auto px-4 py-5">
        {state.tab === 'dashboard' && (
          <DashboardTab
            ingredients={state.ingredients}
            orderDraft={state.orderDraft}
            stockoutRisk={state.stockoutRisk}
            expiredLots={state.expiredLots}
            expiringLots={state.expiringLots}
            suggestions={state.suggestions}
            fefo={state.fefo}
            setTab={state.setTab}
          />
        )}

        {state.tab === 'inventory' && (
          <InventoryTab
            ingredients={state.ingredients}
            lots={state.lots}
            forecasts={state.forecasts}
            fefo={state.fefo}
            expiredLots={state.expiredLots}
            lowItems={state.lowItems}
            logWaste={state.logWaste}
            onUpdateIngredients={updates => state.bulkUpdateIngredients.mutate(updates)}
          />
        )}

        {state.tab === 'orders' && (
          <OrdersTab
            orderDraft={state.orderDraft}
            vendors={state.vendors}
            forecasts={state.forecasts}
            targetDays={state.targetDays}
            setTargetDays={state.setTargetDays}
          />
        )}

        {state.tab === 'sales' && (
          <SalesTab
            sales={state.sales}
            recipes={state.recipes}
            flaggedSales={state.flaggedSales}
            fefo={state.fefo}
          />
        )}

        {state.tab === 'recipes' && (
          <RecipesTab
            recipes={state.recipes}
            ingredients={state.ingredients}
            fefo={state.fefo}
            draftRecipes={state.draftRecipes}
          />
        )}

        {state.tab === 'costs' && (
          <CostsTab
            ingredients={state.ingredients}
            recipes={state.recipes}
          />
        )}
      </div>
    </div>
  );
};

export default Index;
