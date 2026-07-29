import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import type { PosIntegration, PosMenuItem, RecipePosMapping } from '@/lib/types';

type Ingredient = Database['public']['Tables']['ingredients']['Row'];
type IngredientInsert = Database['public']['Tables']['ingredients']['Insert'];
type Lot = Database['public']['Tables']['lots']['Row'];
type LotInsert = Database['public']['Tables']['lots']['Insert'];
type RecipeInsert = Database['public']['Tables']['recipes']['Insert'];

const getUserId = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
};

export const useIngredients = () =>
  useQuery({
    queryKey: ['ingredients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ingredients')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as Ingredient[];
    },
  });

export const useLots = () =>
  useQuery({
    queryKey: ['lots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lots')
        .select('*')
        .order('received_at', { ascending: true });
      if (error) throw error;
      return data as Lot[];
    },
  });

export const useUpdateIngredient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Ingredient> }) => {
      const { error } = await supabase
        .from('ingredients')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingredients'] }),
  });
};

export const useCreateIngredient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ingredient: Omit<IngredientInsert, 'user_id'>) => {
      const userId = await getUserId();
      const { data, error } = await supabase
        .from('ingredients')
        .insert({ ...ingredient, user_id: userId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingredients'] }),
  });
};

export const useDeleteIngredient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Delete recipe_ingredient links first
      await supabase.from('recipe_ingredients').delete().eq('ingredient_id', id);
      // Lots cascade via FK, but delete explicitly to be safe
      await supabase.from('lots').delete().eq('ingredient_id', id);
      const { error } = await supabase.from('ingredients').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      qc.invalidateQueries({ queryKey: ['lots'] });
      qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
    },
  });
};

export const useDeleteRecipe = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('recipe_ingredients').delete().eq('recipe_id', id);
      const { error } = await supabase.from('recipes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
    },
  });
};

export const useWipeIngredientsAndRecipes = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const userId = await getUserId();

      const steps = [
        () => supabase.from('recipe_ingredients').delete().eq('user_id', userId),
        () => supabase.from('lots').delete().eq('user_id', userId),
        () => supabase.from('recipes').delete().eq('user_id', userId),
        () => supabase.from('ingredients').delete().eq('user_id', userId),
      ];

      for (const step of steps) {
        const { error } = await step();
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      qc.invalidateQueries({ queryKey: ['lots'] });
      qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
    },
  });
};

export const useUpdateLot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Lot> }) => {
      const { error } = await supabase
        .from('lots')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lots'] }),
  });
};

export const useCreateLot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lot: Omit<LotInsert, 'user_id'>) => {
      const userId = await getUserId();
      const { data, error } = await supabase
        .from('lots')
        .insert({ ...lot, user_id: userId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lots'] }),
  });
};

export const useRecordWaste = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lotId: string) => {
      const { data, error } = await supabase.rpc('record_waste_transaction', {
        p_lot_id: lotId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      qc.invalidateQueries({ queryKey: ['lots'] });
      qc.invalidateQueries({ queryKey: ['waste-events'] });
    },
  });
};

export const useBulkUpdateIngredients = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ updates, fefo }: {
      updates: Array<{ id: string; current_stock: number }>;
      fefo: boolean;
    }) => {
      const { error } = await supabase.rpc('reconcile_inventory_counts', {
        p_updates: updates,
        p_fefo: fefo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      qc.invalidateQueries({ queryKey: ['lots'] });
    },
  });
};

export const useSales = () =>
  useQuery({
    queryKey: ['sales'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

export const useRecipesWithIngredients = () =>
  useQuery({
    queryKey: ['recipes-with-ingredients'],
    queryFn: async () => {
      const { data: recipes, error: re } = await supabase
        .from('recipes')
        .select('*')
        .order('name');
      if (re) throw re;

      const { data: recipeIngs, error: rie } = await supabase
        .from('recipe_ingredients')
        .select('*');
      if (rie) throw rie;

      return (recipes ?? []).map((r) => ({
        ...r,
        ingredients: (recipeIngs ?? []).filter((ri) => ri.recipe_id === r.id),
      }));
    },
  });

export const useVendors = () =>
  useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendors')
        .select('*')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

export const useProfile = () =>
  useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const userId = await getUserId();
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export const useEnsureProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const userId = await getUserId();
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();
      if (existing) return existing;
      const { data, error } = await supabase
        .from('profiles')
        .insert({ id: userId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });
};

export const useUpdateProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: { restaurant_name?: string; onboarding_completed?: boolean }) => {
      const userId = await getUserId();
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });
};

export const useCreateVendor = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vendor: { name: string; email?: string | null; phone?: string | null; lead_time_days?: number; notes?: string | null }) => {
      const userId = await getUserId();
      const { data, error } = await supabase
        .from('vendors')
        .insert({ ...vendor, user_id: userId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  });
};

export const useUpdateVendor = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: { name?: string; email?: string | null; phone?: string | null; lead_time_days?: number; notes?: string | null } }) => {
      const { error } = await supabase
        .from('vendors')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  });
};

// ─── POS Connections ──────────────────────────────────────────────────────────

export interface POSConnection {
  id: string;
  user_id: string;
  pos_type: 'square' | 'clover' | 'toast' | 'lightspeed';
  merchant_id: string | null;
  location_id: string | null;
  status: 'connected' | 'disconnected' | 'error';
  error_message: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
}

export const usePOSConnections = () =>
  useQuery({
    queryKey: ['pos_connections'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pos_connections')
        .select('id,user_id,pos_type,merchant_id,location_id,status,error_message,connected_at,last_sync_at');
      if (error) throw error;
      return (data ?? []) as POSConnection[];
    },
  });

export const useDisconnectPOS = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (posType: string) => {
      const userId = await getUserId();
      const { error } = await supabase
        .from('pos_connections')
        .update({
          status: 'disconnected',
          access_token: null,
          refresh_token: null,
          connected_at: null,
        })
        .eq('user_id', userId)
        .eq('pos_type', posType);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos_connections'] }),
  });
};

export const useInitiatePOSOAuth = () => {
  return useMutation({
    mutationFn: async ({
      posType,
      clientId: providedClientId,
      clientSecret,
    }: {
      posType: 'square' | 'clover' | 'toast' | 'lightspeed';
      clientId?: string;
      clientSecret?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
      const redirectUri = `${SUPABASE_URL}/functions/v1/pos-oauth-callback`;

      const CLIENT_ID_KEYS: Record<string, string> = {
        square:     'VITE_SQUARE_CLIENT_ID',
        clover:     'VITE_CLOVER_CLIENT_ID',
        toast:      'VITE_TOAST_CLIENT_ID',
        lightspeed: 'VITE_LIGHTSPEED_CLIENT_ID',
      };

      const clientId = providedClientId?.trim() || (import.meta.env as Record<string, string>)[CLIENT_ID_KEYS[posType]];
      if (!clientId) {
        throw new Error(
          `${posType.charAt(0).toUpperCase() + posType.slice(1)} client ID is not configured. ` +
          `Enter it in the connection form.`
        );
      }

      const state = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { error: stateError } = await supabase
        .from('pos_oauth_states')
        .insert({
          state,
          user_id: user.id,
          pos_type: posType,
          provider_client_id: clientId,
          provider_client_secret: clientSecret?.trim() || null,
          redirect_origin: window.location.origin,
          expires_at: expiresAt,
        });
      if (stateError) throw stateError;

      const OAUTH_URLS: Record<string, string> = {
        square:     `https://connect.squareup.com/oauth2/authorize?client_id=${clientId}&scope=PAYMENTS_READ+ORDERS_READ&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
        clover:     `https://www.clover.com/oauth/v2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
        toast:      `https://ws-api.toasttab.com/authentication/v1/authentication/login?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
        lightspeed: `https://cloud.lightspeedapp.com/oauth/authorize.php?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
      };

      window.location.href = OAUTH_URLS[posType];
    },
  });
};

// ─── POS menu sync and recipe mapping ────────────────────────────────────────

const DEMO_POS_ITEMS = [
  { external_item_id: 'demo-blt', name: 'BLT', category: 'Sandwiches', price_cents: 1195 },
  { external_item_id: 'demo-turkey-club', name: 'Turkey Club', category: 'Sandwiches', price_cents: 1395 },
  { external_item_id: 'demo-pancakes', name: 'Pancakes', category: 'Breakfast', price_cents: 1095 },
  { external_item_id: 'demo-western-omelet', name: 'Western Omelet', category: 'Breakfast', price_cents: 1295 },
  { external_item_id: 'demo-cheeseburger', name: 'Cheeseburger', category: 'Burgers', price_cents: 1495 },
  { external_item_id: 'demo-chicken-caesar-wrap', name: 'Chicken Caesar Wrap', category: 'Wraps', price_cents: 1395 },
  { external_item_id: 'demo-coffee', name: 'Coffee', category: 'Drinks', price_cents: 350 },
  { external_item_id: 'demo-iced-coffee', name: 'Iced Coffee', category: 'Drinks', price_cents: 450 },
];

const normalizeMenuName = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const nameSimilarity = (left: string, right: string) => {
  const a = normalizeMenuName(left);
  const b = normalizeMenuName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.86;

  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  const intersection = [...aTokens].filter(token => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
};

const buildSuggestedMappings = async (userId: string, posItems: PosMenuItem[]) => {
  if (posItems.length === 0) return;

  const { data: recipes, error: recipesError } = await supabase
    .from('recipes')
    .select('id,name')
    .eq('user_id', userId);
  if (recipesError) throw recipesError;
  if (!recipes?.length) return;

  const itemIds = posItems.map(item => item.id);
  const { data: existingMappings, error: mappingsError } = await supabase
    .from('recipe_pos_mappings')
    .select('*')
    .in('pos_menu_item_id', itemIds);
  if (mappingsError) throw mappingsError;

  const mappedItemIds = new Set((existingMappings ?? []).map(mapping => mapping.pos_menu_item_id));
  const suggestions = posItems.flatMap(item => {
    if (mappedItemIds.has(item.id)) return [];

    const best = recipes
      .map(recipe => ({ recipe, score: nameSimilarity(item.name, recipe.name) }))
      .sort((a, b) => b.score - a.score)[0];

    if (!best || best.score < 0.6) return [];
    return [{
      user_id: userId,
      recipe_id: best.recipe.id,
      pos_menu_item_id: item.id,
      confidence_score: Number(best.score.toFixed(2)),
      mapping_status: 'suggested' as const,
    }];
  });

  if (suggestions.length > 0) {
    const { error } = await supabase.from('recipe_pos_mappings').insert(suggestions);
    if (error) throw error;
  }
};

export interface PosMenuItemWithMapping extends PosMenuItem {
  mapping: RecipePosMapping | null;
}

export const usePosIntegrations = () =>
  useQuery({
    queryKey: ['pos_integrations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pos_integrations')
        .select('id,user_id,provider,status,external_location_id,last_synced_at,created_at,updated_at')
        .order('provider');
      if (error) throw error;
      return (data ?? []) as PosIntegration[];
    },
  });

export const usePosMenuItemsWithMappings = () =>
  useQuery({
    queryKey: ['pos_menu_items_with_mappings'],
    queryFn: async () => {
      const { data: items, error: itemsError } = await supabase
        .from('pos_menu_items')
        .select('*')
        .order('name');
      if (itemsError) throw itemsError;

      const itemIds = (items ?? []).map(item => item.id);
      if (itemIds.length === 0) return [] as PosMenuItemWithMapping[];

      const { data: mappings, error: mappingsError } = await supabase
        .from('recipe_pos_mappings')
        .select('*')
        .in('pos_menu_item_id', itemIds)
        .order('mapping_status');
      if (mappingsError) throw mappingsError;

      const mappingByItem = new Map<string, RecipePosMapping>();
      (mappings ?? []).forEach(mapping => {
        const existing = mappingByItem.get(mapping.pos_menu_item_id);
        if (!existing || mapping.mapping_status === 'confirmed') {
          mappingByItem.set(mapping.pos_menu_item_id, mapping as RecipePosMapping);
        }
      });

      return (items ?? []).map(item => ({
        ...(item as PosMenuItem),
        mapping: mappingByItem.get(item.id) ?? null,
      }));
    },
  });

export const useSyncDemoPOSMenu = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (provider = 'manual_demo') => {
      const userId = await getUserId();
      const syncedAt = new Date().toISOString();

      const { error: integrationError } = await supabase
        .from('pos_integrations')
        .upsert({
          user_id: userId,
          provider,
          status: 'connected',
          external_location_id: 'demo-location',
          last_synced_at: syncedAt,
        }, { onConflict: 'user_id,provider' });
      if (integrationError) throw integrationError;

      const rows = DEMO_POS_ITEMS.map(item => ({
        ...item,
        user_id: userId,
        provider,
        external_variation_id: null,
        is_active: true,
        raw_payload: item,
        last_synced_at: syncedAt,
      }));

      const { error: itemsError } = await supabase
        .from('pos_menu_items')
        .upsert(rows, { onConflict: 'user_id,provider,external_item_id,external_variation_id' });
      if (itemsError) throw itemsError;

      const { data: syncedItems, error: syncedItemsError } = await supabase
        .from('pos_menu_items')
        .select('*')
        .eq('user_id', userId)
        .eq('provider', provider);
      if (syncedItemsError) throw syncedItemsError;

      await buildSuggestedMappings(userId, (syncedItems ?? []) as PosMenuItem[]);
      return syncedItems ?? [];
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pos_integrations'] });
      qc.invalidateQueries({ queryKey: ['pos_menu_items_with_mappings'] });
    },
  });
};

export const useConfirmRecipePosMapping = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ posMenuItemId, recipeId, confidenceScore = 1 }: {
      posMenuItemId: string;
      recipeId: string;
      confidenceScore?: number;
    }) => {
      const userId = await getUserId();

      const { error: deleteError } = await supabase
        .from('recipe_pos_mappings')
        .delete()
        .eq('user_id', userId)
        .eq('pos_menu_item_id', posMenuItemId);
      if (deleteError) throw deleteError;

      const { error } = await supabase
        .from('recipe_pos_mappings')
        .insert({
          user_id: userId,
          recipe_id: recipeId,
          pos_menu_item_id: posMenuItemId,
          confidence_score: confidenceScore,
          mapping_status: 'confirmed',
        });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos_menu_items_with_mappings'] }),
  });
};

export const useCreateRecipeFromPosItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (posItem: PosMenuItem) => {
      const userId = await getUserId();
      const recipe: RecipeInsert = {
        name: posItem.name,
        status: 'draft',
        menu_price: posItem.price_cents ? posItem.price_cents / 100 : 0,
        user_id: userId,
      };

      const { data: createdRecipe, error: recipeError } = await supabase
        .from('recipes')
        .insert(recipe)
        .select()
        .single();
      if (recipeError) throw recipeError;

      const { error: deleteError } = await supabase
        .from('recipe_pos_mappings')
        .delete()
        .eq('user_id', userId)
        .eq('pos_menu_item_id', posItem.id);
      if (deleteError) throw deleteError;

      const { error: mappingError } = await supabase
        .from('recipe_pos_mappings')
        .insert({
          user_id: userId,
          recipe_id: createdRecipe.id,
          pos_menu_item_id: posItem.id,
          confidence_score: 1,
          mapping_status: 'confirmed',
        });
      if (mappingError) throw mappingError;

      return createdRecipe;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
      qc.invalidateQueries({ queryKey: ['pos_menu_items_with_mappings'] });
    },
  });
};

// ─── Daily summaries ──────────────────────────────────────────────────────────

interface DailySummary {
  id: string;
  user_id: string;
  summary_text: string;
  created_at: string;
}

export const useDailySummary = () =>
  useQuery({
    queryKey: ['daily_summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_summaries')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as DailySummary | null);
    },
  });

// ─── Recipe mutations ─────────────────────────────────────────────────────────

export const useUpdateRecipe = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase
        .from('recipes')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] }),
  });
};
