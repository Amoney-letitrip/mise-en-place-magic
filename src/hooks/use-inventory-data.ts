import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type Ingredient = Database['public']['Tables']['ingredients']['Row'];
type IngredientInsert = Database['public']['Tables']['ingredients']['Insert'];
type Lot = Database['public']['Tables']['lots']['Row'];
type LotInsert = Database['public']['Tables']['lots']['Insert'];

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

export const useBulkUpdateIngredients = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Array<{ id: string; current_stock: number }>) => {
      const results = await Promise.all(
        updates.map(u =>
          supabase
            .from('ingredients')
            .update({ current_stock: u.current_stock })
            .eq('id', u.id)
        )
      );
      const failed = results.find(r => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingredients'] }),
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
    mutationFn: async (posType: 'square' | 'clover' | 'toast' | 'lightspeed') => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
      const redirectUri = `${SUPABASE_URL}/functions/v1/pos-oauth-callback`;
      const state = btoa(JSON.stringify({
        userId: user.id,
        posType,
        redirectTo: window.location.origin,
      }));

      const CLIENT_IDS: Record<string, string> = {
        square: import.meta.env.VITE_SQUARE_CLIENT_ID || '',
        clover: import.meta.env.VITE_CLOVER_CLIENT_ID || '',
        toast: import.meta.env.VITE_TOAST_CLIENT_ID || '',
        lightspeed: import.meta.env.VITE_LIGHTSPEED_CLIENT_ID || '',
      };

      const OAUTH_URLS: Record<string, string> = {
        square: `https://connect.squareup.com/oauth2/authorize?client_id=${CLIENT_IDS.square}&scope=PAYMENTS_READ+ORDERS_READ&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
        clover: `https://www.clover.com/oauth/v2/authorize?client_id=${CLIENT_IDS.clover}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
        toast: `https://ws-api.toasttab.com/authentication/v1/authentication/login?client_id=${CLIENT_IDS.toast}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
        lightspeed: `https://cloud.lightspeedapp.com/oauth/authorize.php?response_type=code&client_id=${CLIENT_IDS.lightspeed}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
      };

      const oauthUrl = OAUTH_URLS[posType];
      window.location.href = oauthUrl;
    },
  });
};

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
