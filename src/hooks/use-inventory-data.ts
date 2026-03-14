import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type Ingredient = Database['public']['Tables']['ingredients']['Row'];
type IngredientInsert = Database['public']['Tables']['ingredients']['Insert'];
type Lot = Database['public']['Tables']['lots']['Row'];
type LotInsert = Database['public']['Tables']['lots']['Insert'];

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
    mutationFn: async (ingredient: IngredientInsert) => {
      const { data, error } = await supabase
        .from('ingredients')
        .insert(ingredient)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingredients'] }),
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
    mutationFn: async (lot: LotInsert) => {
      const { data, error } = await supabase
        .from('lots')
        .insert(lot)
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
      for (const u of updates) {
        const { error } = await supabase
          .from('ingredients')
          .update({ current_stock: u.current_stock })
          .eq('id', u.id);
        if (error) throw error;
      }
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
