import { useMemo, useState } from 'react';
import { Plus, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Mono, StatusTag } from './StatusTag';
import {
  useConfirmRecipePosMapping,
  useCreateRecipeFromPosItem,
  usePosIntegrations,
  usePosMenuItemsWithMappings,
  useSyncDemoPOSMenu,
} from '@/hooks/use-inventory-data';
import type { PosMenuItem } from '@/lib/types';

interface RecipeOption {
  id: string;
  name: string;
  status: string;
}

interface PosMenuSyncProps {
  recipes: RecipeOption[];
}

const POS_PROVIDERS = [
  { id: 'manual_demo', name: 'Manual Upload / Demo' },
  { id: 'square', name: 'Square' },
  { id: 'toast', name: 'Toast' },
  { id: 'clover', name: 'Clover' },
];

const providerLabel = (provider: string) =>
  POS_PROVIDERS.find(item => item.id === provider)?.name ?? provider;

const formatPrice = (cents: number | null) =>
  typeof cents === 'number' ? `$${(cents / 100).toFixed(2)}` : 'N/A';

const mappingVariant = (status?: string | null) => {
  if (status === 'confirmed') return 'green';
  if (status === 'suggested') return 'yellow';
  if (status === 'ignored') return 'slate';
  return 'gray';
};

export const PosMenuSync = ({ recipes }: PosMenuSyncProps) => {
  const [provider, setProvider] = useState('manual_demo');
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<Record<string, string>>({});

  const { data: integrations = [], isLoading: loadingIntegrations, isError: integrationsFailed } = usePosIntegrations();
  const { data: posItems = [], isLoading: loadingItems, isError: itemsFailed } = usePosMenuItemsWithMappings();
  const syncDemoPOSMenu = useSyncDemoPOSMenu();
  const confirmMapping = useConfirmRecipePosMapping();
  const createRecipe = useCreateRecipeFromPosItem();

  const recipesById = useMemo(
    () => new Map(recipes.map(recipe => [recipe.id, recipe])),
    [recipes],
  );

  const visibleItems = useMemo(
    () => posItems.filter(item => item.provider === provider),
    [posItems, provider],
  );

  const integration = integrations.find(item => item.provider === provider);
  const status = integration?.status ?? 'not_connected';
  const lastSyncedAt = integration?.last_synced_at
    ? new Date(integration.last_synced_at).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    : null;

  const recipeNameForItem = (item: PosMenuItem) => {
    const mapping = posItems.find(posItem => posItem.id === item.id)?.mapping;
    return mapping ? recipesById.get(mapping.recipe_id)?.name ?? 'Recipe missing' : 'Unmapped';
  };

  const selectedRecipeForItem = (item: PosMenuItem) => {
    const mapping = posItems.find(posItem => posItem.id === item.id)?.mapping;
    return selectedRecipeIds[item.id] ?? mapping?.recipe_id ?? '';
  };

  const handleSync = async () => {
    if (provider !== 'manual_demo') {
      toast.info(`${providerLabel(provider)} menu sync is stubbed for now. Use Manual Upload / Demo to test the flow.`);
      return;
    }

    try {
      await syncDemoPOSMenu.mutateAsync(provider);
      toast.success('Demo POS menu items synced');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed sync');
    }
  };

  const handleSaveMapping = async (item: PosMenuItem) => {
    const recipeId = selectedRecipeForItem(item);
    if (!recipeId) {
      toast.error('Choose a recipe first');
      return;
    }

    try {
      const currentScore = posItems.find(posItem => posItem.id === item.id)?.mapping?.confidence_score ?? 1;
      await confirmMapping.mutateAsync({
        posMenuItemId: item.id,
        recipeId,
        confidenceScore: currentScore,
      });
      toast.success('Mapping saved successfully');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save mapping');
    }
  };

  const handleCreateRecipe = async (item: PosMenuItem) => {
    try {
      const recipe = await createRecipe.mutateAsync(item);
      setSelectedRecipeIds(current => ({ ...current, [item.id]: recipe.id }));
      toast.success(`Draft recipe created for ${item.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create recipe');
    }
  };

  const isLoading = loadingIntegrations || loadingItems;
  const failed = integrationsFailed || itemsFailed;

  return (
    <div className="space-y-3.5">
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <div className="font-bold text-sm">POS menu sync</div>
            <p className="text-xs text-muted-foreground max-w-2xl">
              POS items are the sellable menu source. Recipes hold ingredient deduction logic. Mappings connect the two.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {POS_PROVIDERS.map(item => (
                  <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleSync} disabled={syncDemoPOSMenu.isPending}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {syncDemoPOSMenu.isPending ? 'Syncing...' : 'Sync Menu Items'}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusTag variant={status === 'connected' ? 'green' : status === 'error' ? 'red' : 'slate'}>
            {status === 'connected' ? 'Connected' : status === 'error' ? 'Sync error' : 'No POS connected'}
          </StatusTag>
          <span>{providerLabel(provider)}</span>
          {lastSyncedAt && <span>Last synced {lastSyncedAt}</span>}
        </div>
      </div>

      {failed && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">
          Failed sync data load. Please try again.
        </div>
      )}

      {!failed && isLoading && (
        <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
          Loading POS menu items...
        </div>
      )}

      {!failed && !isLoading && visibleItems.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-6 text-center">
          <div className="font-semibold text-sm mb-1">No menu items synced yet</div>
          <p className="text-xs text-muted-foreground">
            Choose Manual Upload / Demo and sync sample items to test POS recipe mapping.
          </p>
        </div>
      )}

      {!failed && !isLoading && visibleItems.length > 0 && recipes.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">
          No recipes available yet. Create recipes from POS items below, or use menu scan in Recipes to draft them first.
        </div>
      )}

      {!failed && !isLoading && visibleItems.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">POS item</th>
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Category</th>
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Price</th>
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Active</th>
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Mapped recipe</th>
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Mapping</th>
                  <th className="text-right text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map(item => {
                  const mapping = item.mapping;
                  const selectedRecipeId = selectedRecipeForItem(item);

                  return (
                    <tr key={item.id} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="px-3.5 py-3 font-semibold">{item.name}</td>
                      <td className="px-3.5 py-3 text-muted-foreground">{item.category || 'Uncategorized'}</td>
                      <td className="px-3.5 py-3"><Mono>{formatPrice(item.price_cents)}</Mono></td>
                      <td className="px-3.5 py-3">
                        <StatusTag variant={item.is_active ? 'green' : 'slate'}>
                          {item.is_active ? 'Active' : 'Inactive'}
                        </StatusTag>
                      </td>
                      <td className="px-3.5 py-3 min-w-[220px]">
                        <Select
                          value={selectedRecipeId || undefined}
                          onValueChange={(recipeId) => setSelectedRecipeIds(current => ({ ...current, [item.id]: recipeId }))}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder={recipeNameForItem(item)} />
                          </SelectTrigger>
                          <SelectContent>
                            {recipes.map(recipe => (
                              <SelectItem key={recipe.id} value={recipe.id}>
                                {recipe.name}{recipe.status === 'draft' ? ' (draft)' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3.5 py-3">
                        <StatusTag variant={mappingVariant(mapping?.mapping_status)}>
                          {mapping?.mapping_status ?? 'unmapped'}
                        </StatusTag>
                        {mapping?.confidence_score != null && (
                          <span className="ml-2 text-[11px] text-muted-foreground">
                            {Math.round(mapping.confidence_score * 100)}%
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            disabled={!selectedRecipeId || confirmMapping.isPending}
                            onClick={() => handleSaveMapping(item)}
                          >
                            <Save className="h-3.5 w-3.5 mr-1.5" />
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8"
                            disabled={createRecipe.isPending}
                            onClick={() => handleCreateRecipe(item)}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1.5" />
                            Create recipe
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
