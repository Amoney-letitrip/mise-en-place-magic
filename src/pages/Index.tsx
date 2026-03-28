import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAppState } from '@/hooks/use-app-state';
import { useIsMobile } from '@/hooks/use-mobile';
import { useProfile, useEnsureProfile } from '@/hooks/use-inventory-data';
import { AppNav } from '@/components/inventory/AppNav';
import { MobileNav } from '@/components/inventory/MobileNav';
import { DashboardTab } from '@/components/inventory/DashboardTab';
import { InventoryTab } from '@/components/inventory/InventoryTab';
import { OrdersTab } from '@/components/inventory/OrdersTab';
import { SalesTab } from '@/components/inventory/SalesTab';
import { RecipesTab } from '@/components/inventory/RecipesTab';
import { CostsTab } from '@/components/inventory/CostsTab';
import { OnboardingWizard } from '@/components/inventory/OnboardingWizard';
import type { TabId } from '@/lib/types';

const Index = () => {
  const state = useAppState();
  const isMobile = useIsMobile();
  const { data: profile, isLoading: loadingProfile } = useProfile();
  const ensureProfile = useEnsureProfile();

  // Create profile if it doesn't exist
  useEffect(() => {
    if (!loadingProfile && profile === null) {
      ensureProfile.mutate();
    }
  }, [loadingProfile, profile]);

  const capBadge = (n: number) => n > 99 ? 99 : n;
  const navItems: Array<{ id: TabId; label: string; badge?: number | null; badgeLabel?: string }> = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'inventory', label: 'Inventory', badge: capBadge(state.lowItems.length) || null, badgeLabel: state.lowItems.length > 99 ? '99+' : undefined },
    { id: 'orders', label: 'Orders', badge: capBadge(state.orderDraft.filter(v => v.anyDue).length) || null },
    { id: 'sales', label: 'Sales', badge: capBadge(state.flaggedSales.length) || null },
    { id: 'recipes', label: 'Recipes', badge: capBadge(state.draftRecipes.length) || null, badgeLabel: state.draftRecipes.length > 99 ? '99+' : undefined },
    { id: 'costs', label: 'Costs' },
  ];

  // Loading state
  if (state.isLoading || loadingProfile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🍽</div>
          <div className="text-muted-foreground">Loading…</div>
        </div>
      </div>
    );
  }

  // Show onboarding if not completed
  if (profile && !profile.onboarding_completed) {
    return <OnboardingWizard restaurantName={profile.restaurant_name} />;
  }

  return (
    <div className={`min-h-screen bg-background ${isMobile ? 'pb-[70px]' : ''}`}>
      <AppNav
        tab={state.tab}
        setTab={state.setTab}
        fefo={state.fefo}
        setFefo={state.setFefo}
        navItems={navItems}
        restaurantName={profile?.restaurant_name}
      />

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
            restaurantName={profile?.restaurant_name}
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
            ingredients={state.ingredients}
            lots={state.lots}
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
            setTab={state.setTab}
          />
        )}
      </div>

      {isMobile && <MobileNav tab={state.tab} setTab={state.setTab} navItems={navItems} />}
    </div>
  );
};

export default Index;
