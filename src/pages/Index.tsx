import { useAppState } from '@/hooks/use-app-state';
import { AppNav } from '@/components/inventory/AppNav';
import { DashboardTab } from '@/components/inventory/DashboardTab';
import { InventoryTab } from '@/components/inventory/InventoryTab';
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
          <div className="animate-fade-up text-center py-20">
            <div className="text-4xl mb-3">📦</div>
            <h2 className="text-lg font-bold text-foreground mb-1">Orders</h2>
            <p className="text-muted-foreground text-sm">Coming next — purchase orders & vendor management</p>
          </div>
        )}

        {state.tab === 'sales' && (
          <div className="animate-fade-up text-center py-20">
            <div className="text-4xl mb-3">📊</div>
            <h2 className="text-lg font-bold text-foreground mb-1">Sales</h2>
            <p className="text-muted-foreground text-sm">Coming next — sales recording & POS integration</p>
          </div>
        )}

        {state.tab === 'recipes' && (
          <div className="animate-fade-up text-center py-20">
            <div className="text-4xl mb-3">📋</div>
            <h2 className="text-lg font-bold text-foreground mb-1">Recipes</h2>
            <p className="text-muted-foreground text-sm">Coming next — AI menu scanning & recipe management</p>
          </div>
        )}

        {state.tab === 'costs' && (
          <div className="animate-fade-up text-center py-20">
            <div className="text-4xl mb-3">💰</div>
            <h2 className="text-lg font-bold text-foreground mb-1">Costs</h2>
            <p className="text-muted-foreground text-sm">Coming next — food cost analytics & margins</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
