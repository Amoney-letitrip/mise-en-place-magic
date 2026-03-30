import { useState, useRef, useCallback, useMemo } from 'react';
import { StatusTag, SectionHead } from './StatusTag';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Database } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useDeleteRecipe, useUpdateRecipe } from '@/hooks/use-inventory-data';

type Ingredient = Database['public']['Tables']['ingredients']['Row'];

interface RecipeWithIngredients {
  id: string;
  name: string;
  status: string;
  menu_price: number;
  verified_by: string | null;
  verified_date: string | null;
  created_at: string;
  updated_at: string;
  ingredients: Array<{
    id: string;
    recipe_id: string;
    ingredient_id: string | null;
    name: string;
    qty: number;
    unit: string;
    confidence: number;
  }>;
}

interface ScannedRecipe {
  name: string;
  ingredients: Array<{ name: string; qty: number; unit: string }>;
}

interface RecipesTabProps {
  recipes: RecipeWithIngredients[];
  ingredients: Ingredient[];
  fefo: boolean;
  draftRecipes: RecipeWithIngredients[];
}

export const RecipesTab = ({ recipes, ingredients, fefo, draftRecipes }: RecipesTabProps) => {
  const [subTab, setSubTab] = useState<'list' | 'calibration'>('list');
  const [selectedRId, setSelectedRId] = useState<string | null>(null);
  const [menuScanState, setMenuScanState] = useState<'idle' | 'scanning' | 'review' | 'done' | 'error'>('idle');
  const [showScanUI, setShowScanUI] = useState(false);
  const [menuPreviewUrl, setMenuPreviewUrl] = useState<string | null>(null);
  const [menuUrlInput, setMenuUrlInput] = useState('');
  const [scannedRecipes, setScannedRecipes] = useState<ScannedRecipe[]>([]);
  const [removedIndices, setRemovedIndices] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<RecipeWithIngredients | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'verified'>('all');
  const [bulkAction, setBulkAction] = useState<'verifyAll' | 'deleteAllDrafts' | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const deleteRecipe = useDeleteRecipe();
  const updateRecipeMut = useUpdateRecipe();

  const selectedRecipe = recipes.find(r => r.id === selectedRId);

  const getUserId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    return user.id;
  };

  const getUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    return user;
  };

  const dedupeRecipes = useCallback((rawRecipes: ScannedRecipe[]) => {
    const seen = new Set<string>();
    const deduped: ScannedRecipe[] = [];
    for (const r of rawRecipes) {
      const key = r.name.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
    }
    const removed = rawRecipes.length - deduped.length;
    if (removed > 0) toast.info(`Removed ${removed} duplicate item${removed > 1 ? 's' : ''}`);
    return deduped;
  }, []);

  const scanMenuPhoto = useCallback(async (file: File) => {
    setMenuScanState('scanning');
    setShowScanUI(true);
    setMenuPreviewUrl(URL.createObjectURL(file));
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(',')[1]);
        r.onerror = () => rej(new Error('Read failed'));
        r.readAsDataURL(file);
      });
      const mediaType = file.type || 'image/jpeg';
      const { data: fnData, error: fnError } = await supabase.functions.invoke('scan-menu', {
        body: { type: 'photo', base64, mediaType },
      });
      if (fnError) throw fnError;
      const newRecipes = dedupeRecipes(fnData?.recipes || []);
      setScannedRecipes(newRecipes);
      setRemovedIndices(new Set());
      setMenuScanState('review');
      toast.success(`Found ${newRecipes.length} menu items — review before saving`);
    } catch (err) {
      console.error(err);
      setMenuScanState('error');
      toast.error('Scan failed — please try again');
    }
  }, [dedupeRecipes]);

  const scanMenuUrl = useCallback(async (url: string) => {
    setMenuScanState('scanning');
    setShowScanUI(true);
    setMenuPreviewUrl(null);
    try {
      const { data: fnData, error: fnError } = await supabase.functions.invoke('scan-menu', {
        body: { type: 'url', url },
      });
      if (fnError) throw fnError;
      const newRecipes = dedupeRecipes(fnData?.recipes || []);
      setScannedRecipes(newRecipes);
      setRemovedIndices(new Set());
      setMenuScanState('review');
      toast.success(`Found ${newRecipes.length} menu items — review before saving`);
    } catch (err) {
      console.error(err);
      setMenuScanState('error');
      toast.error('Scan failed — try uploading a photo instead');
    }
  }, [dedupeRecipes]);

  const saveScannedRecipes = useCallback(async () => {
    try {
      const userId = await getUserId();
      const toSave = scannedRecipes.filter((_, i) => !removedIndices.has(i));

      // Check for existing recipes by name
      const existingNames = new Set(recipes.map(r => r.name.toLowerCase().trim()));
      const filtered = toSave.filter(r => !existingNames.has(r.name.toLowerCase().trim()));
      const skipped = toSave.length - filtered.length;
      if (skipped > 0) toast.info(`Skipped ${skipped} recipe${skipped > 1 ? 's' : ''} that already exist`);

      for (const r of filtered) {
        const { data: recipe, error: re } = await supabase
          .from('recipes')
          .insert({ name: r.name, status: 'draft', user_id: userId })
          .select()
          .single();
        if (re || !recipe) continue;
        const ings = (r.ingredients || []).map((ing) => ({
          recipe_id: recipe.id,
          name: ing.name,
          qty: ing.qty,
          unit: ing.unit,
          confidence: 0.75,
          user_id: userId,
        }));
        if (ings.length > 0) await supabase.from('recipe_ingredients').insert(ings);
      }
      qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
      setMenuScanState('done');
      setShowScanUI(false);
      setScannedRecipes([]);
      setRemovedIndices(new Set());
      toast.success(`${filtered.length} draft recipes created — verify them to start tracking inventory`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to save recipes');
    }
  }, [scannedRecipes, removedIndices, qc, recipes]);

  const toggleRemoveRecipe = useCallback((index: number) => {
    setRemovedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const updateScannedIngredient = useCallback((recipeIdx: number, ingIdx: number, field: string, value: any) => {
    setScannedRecipes(prev => prev.map((r, ri) => {
      if (ri !== recipeIdx) return r;
      return {
        ...r,
        ingredients: r.ingredients.map((ing, ii) => {
          if (ii !== ingIdx) return ing;
          return { ...ing, [field]: value };
        }),
      };
    }));
  }, []);

  const updateScannedRecipeName = useCallback((recipeIdx: number, name: string) => {
    setScannedRecipes(prev => prev.map((r, ri) => ri === recipeIdx ? { ...r, name } : r));
  }, []);

  const openRescan = useCallback(() => {
    setShowScanUI(true);
    setMenuScanState('idle');
    setMenuPreviewUrl(null);
    setMenuUrlInput('');
    setScannedRecipes([]);
    setRemovedIndices(new Set());
  }, []);

  const verifyRecipe = useCallback(async (id: string) => {
    const r = recipes.find(x => x.id === id);
    if (!r) return;
    let verifiedBy = 'Manager';
    try {
      const user = await getUser();
      verifiedBy = user.email || user.id;
      const userId = user.id;
      for (const ri of r.ingredients) {
        if (ri.ingredient_id) continue;
        const { data: existing } = await supabase
          .from('ingredients')
          .select('id')
          .eq('user_id', userId)
          .ilike('name', ri.name)
          .maybeSingle();
        let ingredientId = existing?.id;
        if (!ingredientId) {
          const { data: newIng } = await supabase
            .from('ingredients')
            .insert({ name: ri.name, unit: ri.unit, user_id: userId, current_stock: 0 })
            .select('id')
            .single();
          ingredientId = newIng?.id;
        }
        if (ingredientId) {
          await supabase.from('recipe_ingredients').update({ ingredient_id: ingredientId }).eq('id', ri.id);
        }
      }
    } catch (e) {
      console.error('Auto-link ingredients failed:', e);
    }
    const { error } = await supabase.from('recipes').update({
      status: 'verified',
      verified_by: verifiedBy,
      verified_date: new Date().toISOString().split('T')[0],
    }).eq('id', id);
    if (error) { toast.error('Failed to verify'); return; }
    qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
    qc.invalidateQueries({ queryKey: ['ingredients'] });
    toast.success(`"${r.name}" verified — ingredients added to inventory`);
    setSelectedRId(null);
  }, [recipes, qc]);

  const verifyAllDrafts = useCallback(async () => {
    setBulkAction(null);
    const drafts = recipes.filter(r => r.status === 'draft');
    setBulkProgress({ current: 0, total: drafts.length });
    try {
      const user = await getUser();
      const userId = user.id;
      const verifiedBy = user.email || user.id;
      const verifiedDate = new Date().toISOString().split('T')[0];
      for (let i = 0; i < drafts.length; i++) {
        const r = drafts[i];
        setBulkProgress({ current: i + 1, total: drafts.length });
        for (const ri of r.ingredients) {
          if (ri.ingredient_id) continue;
          const { data: existing } = await supabase
            .from('ingredients')
            .select('id')
            .eq('user_id', userId)
            .ilike('name', ri.name)
            .maybeSingle();
          let ingredientId = existing?.id;
          if (!ingredientId) {
            const { data: newIng } = await supabase
              .from('ingredients')
              .insert({ name: ri.name, unit: ri.unit, user_id: userId, current_stock: 0 })
              .select('id')
              .single();
            ingredientId = newIng?.id;
          }
          if (ingredientId) {
            await supabase.from('recipe_ingredients').update({ ingredient_id: ingredientId }).eq('id', ri.id);
          }
        }
        await supabase.from('recipes').update({
          status: 'verified',
          verified_by: verifiedBy,
          verified_date: verifiedDate,
        }).eq('id', r.id);
      }
      qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      toast.success(`${drafts.length} recipes verified!`);
    } catch (e) {
      console.error(e);
      toast.error('Bulk verify failed');
    } finally {
      setBulkProgress(null);
    }
  }, [recipes, qc]);

  const deleteAllDrafts = useCallback(async () => {
    setBulkAction(null);
    const drafts = recipes.filter(r => r.status === 'draft');
    setBulkProgress({ current: 0, total: drafts.length });
    try {
      for (let i = 0; i < drafts.length; i++) {
        setBulkProgress({ current: i + 1, total: drafts.length });
        await supabase.from('recipe_ingredients').delete().eq('recipe_id', drafts[i].id);
        await supabase.from('recipes').delete().eq('id', drafts[i].id);
      }
      qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
      toast.success(`${drafts.length} draft recipes deleted`);
    } catch (e) {
      console.error(e);
      toast.error('Bulk delete failed');
    } finally {
      setBulkProgress(null);
    }
  }, [recipes, qc]);

  const updateRecipeIngredient = useCallback(async (riId: string, updates: Record<string, any>) => {
    await supabase.from('recipe_ingredients').update(updates).eq('id', riId);
    qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
  }, [qc]);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteRecipe.mutateAsync(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      setSelectedRId(null);
    } catch {
      toast.error('Failed to delete recipe');
    }
  };

  const saveMenuPrice = useCallback(async (recipeId: string, priceStr: string) => {
    const price = parseFloat(priceStr) || 0;
    await updateRecipeMut.mutateAsync({ id: recipeId, updates: { menu_price: price } });
  }, [updateRecipeMut]);

  const showScanArea = showScanUI || recipes.length === 0;
  const activeScannedCount = scannedRecipes.filter((_, i) => !removedIndices.has(i)).length;

  // Filtered recipes
  const filteredRecipes = useMemo(() => {
    let list = recipes;
    if (filterStatus === 'draft') list = list.filter(r => r.status === 'draft');
    else if (filterStatus === 'verified') list = list.filter(r => r.status === 'verified');
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(r => r.name.toLowerCase().includes(q));
    }
    return list;
  }, [recipes, filterStatus, searchQuery]);

  const verifiedCount = recipes.filter(r => r.status === 'verified').length;

  return (
    <div className="animate-fade-up">
      <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => { if (e.target.files?.[0]) scanMenuPhoto(e.target.files[0]); e.target.value = ''; }} />

      {/* Bulk progress overlay */}
      {bulkProgress && (
        <div className="fixed inset-0 bg-background/80 z-50 flex items-center justify-center">
          <div className="bg-card border border-border rounded-xl p-8 text-center shadow-lg max-w-sm">
            <div className="text-3xl mb-3 animate-pulse">⏳</div>
            <div className="font-bold text-foreground mb-1">Processing… {bulkProgress.current}/{bulkProgress.total}</div>
            <div className="h-2 bg-muted rounded-full overflow-hidden mt-3">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      {!selectedRId ? (
        <>
          <SectionHead
            title="Recipes"
            sub={`${verifiedCount} verified · ${draftRecipes.length} draft`}
            action={recipes.length > 0 && !showScanUI ? (
              <div className="flex gap-2 flex-wrap">
                {draftRecipes.length > 0 && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setBulkAction('verifyAll')}>✓ Verify All ({draftRecipes.length})</Button>
                    <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setBulkAction('deleteAllDrafts')}>🗑 Delete Drafts</Button>
                  </>
                )}
                <Button size="sm" onClick={openRescan}>📸 Scan Menu</Button>
              </div>
            ) : undefined}
          />

          {recipes.length > 0 && !showScanUI && (
            <div className="border-b border-border mb-4 flex gap-5">
              <button onClick={() => setSubTab('list')} className={`pb-2 text-[13px] font-semibold border-b-2 transition-colors ${subTab === 'list' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}>
                Recipe List
              </button>
              <button onClick={() => setSubTab('calibration')} className={`pb-2 text-[13px] font-semibold border-b-2 transition-colors ${subTab === 'calibration' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}>
                Calibration
              </button>
            </div>
          )}

          {/* SCAN UI */}
          {showScanArea && menuScanState === 'idle' && (
            <div>
              {recipes.length > 0 && (
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-foreground">Scan a New Menu</h3>
                  <Button variant="ghost" size="sm" onClick={() => setShowScanUI(false)}>✕ Cancel</Button>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div
                  className="bg-primary/5 border border-dashed border-primary/30 rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                  onClick={() => fileRef.current?.click()}
                >
                  <div className="text-5xl mb-3.5">📸</div>
                  <div className="font-extrabold text-base text-foreground mb-2">Upload a photo or PDF</div>
                  <div className="text-[13px] text-muted-foreground mb-5 leading-relaxed">
                    Take a photo of your printed menu, or upload a PDF
                  </div>
                  <Button className="w-full" onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>Choose File</Button>
                  <div className="mt-2.5 text-[11px] text-muted-foreground">JPG, PNG, HEIC, PDF</div>
                </div>
                <div className="bg-accent/30 border border-dashed border-accent-foreground/20 rounded-lg p-8 text-center">
                  <div className="text-5xl mb-3.5">🔗</div>
                  <div className="font-extrabold text-base text-foreground mb-2">Paste a menu link</div>
                  <div className="text-[13px] text-muted-foreground mb-5 leading-relaxed">
                    Link to your website, Yelp, Google, or any page with your menu
                  </div>
                  <div className="flex flex-col gap-2">
                    <input
                      className="w-full px-3 py-2 border border-border rounded-md text-[13px] bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 text-left"
                      placeholder="https://yourrestaurant.com/menu"
                      value={menuUrlInput}
                      onChange={e => setMenuUrlInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && menuUrlInput.trim()) scanMenuUrl(menuUrlInput.trim()); }}
                    />
                    <Button
                      disabled={!menuUrlInput.trim()}
                      onClick={() => { if (menuUrlInput.trim()) scanMenuUrl(menuUrlInput.trim()); }}
                    >
                      Scan Menu URL
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SCANNING STATE */}
          {showScanArea && menuScanState === 'scanning' && (
            <div className="bg-card border border-border rounded-lg p-12 text-center">
              {menuPreviewUrl ? (
                <img src={menuPreviewUrl} alt="Menu" className="w-full max-w-[320px] h-[200px] object-cover rounded-lg mb-5 border border-border mx-auto" />
              ) : (
                <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent/50 border border-border rounded-lg mb-5 text-[13px] text-foreground font-mono max-w-[400px] break-all">
                  🔗 {menuUrlInput}
                </div>
              )}
              <div className="text-4xl mb-3 animate-pulse">🤖</div>
              <div className="font-bold text-lg text-foreground mb-1.5">AI is reading your menu…</div>
              <div className="text-[13px] text-muted-foreground">Identifying dishes and estimating ingredient quantities</div>
              <div className="mt-5 h-1 bg-border rounded-full overflow-hidden max-w-[300px] mx-auto">
                <div className="h-full bg-primary rounded-full" style={{ animation: 'pulse-scan 1.5s ease-in-out infinite' }} />
              </div>
            </div>
          )}

          {/* REVIEW STATE */}
          {showScanArea && menuScanState === 'review' && (
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-extrabold text-lg text-foreground">Review Scanned Recipes</h3>
                  <p className="text-[13px] text-muted-foreground mt-0.5">
                    Edit names, adjust ingredients, or remove items before saving. {activeScannedCount} of {scannedRecipes.length} will be saved.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setMenuScanState('idle'); setScannedRecipes([]); }}>
                    ← Re-scan
                  </Button>
                </div>
              </div>
              <div className="max-h-[500px] overflow-y-auto space-y-3 mb-5 pr-1">
                {scannedRecipes.map((r, i) => {
                  const removed = removedIndices.has(i);
                  return (
                    <div key={i} className={`border rounded-lg p-3.5 transition-all ${removed ? 'border-border/30 opacity-40' : 'border-border'}`}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <input
                          className={`font-bold text-sm bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none px-0 py-0.5 flex-1 ${removed ? 'line-through' : ''}`}
                          value={r.name}
                          onChange={e => updateScannedRecipeName(i, e.target.value)}
                          disabled={removed}
                        />
                        <button
                          className={`text-xs px-2 py-1 rounded-md border transition-colors ${removed ? 'border-primary/30 text-primary hover:bg-primary/10' : 'border-destructive/30 text-destructive hover:bg-destructive/10'}`}
                          onClick={() => toggleRemoveRecipe(i)}
                        >
                          {removed ? '↩ Restore' : '✕ Remove'}
                        </button>
                      </div>
                      {!removed && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {r.ingredients.map((ing, j) => (
                            <div key={j} className="flex items-center gap-1.5 bg-muted/50 rounded-md px-2 py-1">
                              <input
                                className="flex-1 text-[11px] bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none font-mono"
                                value={ing.name}
                                onChange={e => updateScannedIngredient(i, j, 'name', e.target.value)}
                              />
                              <input
                                type="number"
                                className="w-12 text-[11px] bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none text-center font-mono"
                                value={ing.qty}
                                onChange={e => updateScannedIngredient(i, j, 'qty', parseFloat(e.target.value) || 0)}
                              />
                              <input
                                className="w-10 text-[11px] bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none text-center font-mono"
                                value={ing.unit}
                                onChange={e => updateScannedIngredient(i, j, 'unit', e.target.value)}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {scannedRecipes.length === 0 && (
                  <div className="text-center text-muted-foreground py-8">No recipes were found in the scan</div>
                )}
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" size="lg" onClick={saveScannedRecipes} disabled={activeScannedCount === 0}>
                  Save {activeScannedCount} Recipe{activeScannedCount !== 1 ? 's' : ''} as Drafts
                </Button>
                <Button variant="outline" onClick={() => { setShowScanUI(false); setMenuScanState('idle'); setScannedRecipes([]); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* ERROR STATE */}
          {showScanArea && menuScanState === 'error' && (
            <div className="bg-card border border-destructive/30 rounded-lg p-8 text-center">
              <div className="text-4xl mb-3">⚠️</div>
              <div className="font-bold text-base text-destructive mb-1.5">Scan failed</div>
              <div className="text-[13px] text-muted-foreground mb-5">The link may block automated access. Try uploading a photo or PDF instead.</div>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" onClick={() => { setMenuScanState('idle'); setMenuUrlInput(''); }}>Try a different URL</Button>
                <Button onClick={() => fileRef.current?.click()}>📸 Upload photo instead</Button>
                {recipes.length > 0 && <Button variant="ghost" onClick={() => { setShowScanUI(false); setMenuScanState('idle'); }}>Cancel</Button>}
              </div>
            </div>
          )}

          {/* RECIPE LIST — compact view with search & filter */}
          {recipes.length > 0 && !showScanUI && subTab === 'list' && (
            <>
              {/* Search bar */}
              <div className="mb-3">
                <Input
                  placeholder="Search recipes…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="max-w-sm"
                />
              </div>

              {/* Filter tabs */}
              <div className="flex gap-2 mb-3">
                {(['all', 'draft', 'verified'] as const).map(f => {
                  const count = f === 'all' ? recipes.length : f === 'draft' ? draftRecipes.length : verifiedCount;
                  return (
                    <button
                      key={f}
                      onClick={() => setFilterStatus(f)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${filterStatus === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                    >
                      {f === 'all' ? 'All' : f === 'draft' ? 'Drafts' : 'Verified'} ({count})
                    </button>
                  );
                })}
              </div>

              {draftRecipes.length > 0 && filterStatus !== 'verified' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 mb-3 text-[13px] text-amber-700 flex gap-2">
                  💡 <strong>{draftRecipes.length} unverified recipe{draftRecipes.length > 1 ? 's' : ''}</strong> — verify so sales start tracking inventory.
                </div>
              )}

              {/* Compact recipe list */}
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Recipe</th>
                      <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Status</th>
                      <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Price</th>
                      <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Ingredients</th>
                      <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecipes.map(r => (
                      <tr
                        key={r.id}
                        className={`border-b border-border/30 hover:bg-muted/30 cursor-pointer ${r.status === 'draft' ? 'bg-amber-50/30' : ''}`}
                        onClick={() => setSelectedRId(r.id)}
                      >
                        <td className="px-3.5 py-2.5 font-semibold">{r.name}</td>
                        <td className="px-3.5 py-2.5">
                          {r.status === 'verified' ? <StatusTag variant="green">✓ Verified</StatusTag> : <StatusTag variant="yellow">Draft</StatusTag>}
                        </td>
                        <td className="px-3.5 py-2.5">
                          {r.menu_price > 0 ? <span className="font-mono text-xs">${r.menu_price.toFixed(2)}</span> : <span className="text-muted-foreground/40 text-xs">—</span>}
                        </td>
                        <td className="px-3.5 py-2.5 text-muted-foreground text-xs">{r.ingredients.length} ingredient{r.ingredients.length !== 1 ? 's' : ''}</td>
                        <td className="px-3.5 py-2.5">
                          <Button
                            variant={r.status === 'draft' ? 'default' : 'outline'}
                            size="sm"
                            className={r.status === 'draft' ? 'bg-orange hover:bg-orange/90' : ''}
                            onClick={e => { e.stopPropagation(); setSelectedRId(r.id); }}
                          >
                            {r.status === 'draft' ? 'Review →' : 'Edit'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {filteredRecipes.length === 0 && (
                      <tr><td colSpan={5} className="px-3.5 py-8 text-center text-muted-foreground">No recipes match your search</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* CALIBRATION */}
          {recipes.length > 0 && !showScanUI && subTab === 'calibration' && (
            <>
              <div className="bg-primary/10 border border-primary/20 rounded-lg px-3.5 py-2.5 mb-3.5 text-[13px] text-primary">
                ⚠ Calibration factors adjust forecasts only — recipes are never automatically changed.
              </div>
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Ingredient</th>
                      <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Factor</th>
                      <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ingredients.filter(i => i.calib_factor !== 1).map(ing => {
                      const dev = Math.abs(ing.calib_factor - 1);
                      return (
                        <tr key={ing.id} className="border-b border-border/30">
                          <td className="px-3.5 py-2.5 font-semibold">{ing.name}</td>
                          <td className="px-3.5 py-2.5">
                            <span className={`font-mono text-[13px] font-bold ${ing.calib_factor > 1.1 ? 'text-destructive' : ing.calib_factor < 0.9 ? 'text-amber-600' : 'text-emerald-600'}`}>
                              {ing.calib_factor.toFixed(2)}×
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5">
                            {ing.calib_factor > 1.1 && <StatusTag variant="red">↑ Over {Math.round(dev * 100)}%</StatusTag>}
                            {ing.calib_factor < 0.9 && <StatusTag variant="yellow">↓ Under {Math.round(dev * 100)}%</StatusTag>}
                            {ing.calib_factor >= 0.9 && ing.calib_factor <= 1.1 && dev > 0.02 && <StatusTag variant="orange">~ {Math.round(dev * 100)}% off</StatusTag>}
                            {dev <= 0.02 && <StatusTag variant="green">✓ Stable</StatusTag>}
                          </td>
                        </tr>
                      );
                    })}
                    {ingredients.filter(i => i.calib_factor !== 1).length === 0 && (
                      <tr><td colSpan={3} className="px-3.5 py-8 text-center text-muted-foreground">All calibration factors at 1.0 — no variances detected</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      ) : selectedRecipe && (
        /* RECIPE DETAIL */
        <>
          <button className="text-muted-foreground text-[13px] font-semibold mb-3.5 flex items-center gap-1 hover:text-foreground" onClick={() => setSelectedRId(null)}>
            ← Back to Recipes
          </button>
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="text-xl font-extrabold text-foreground">{selectedRecipe.name}</h1>
            {selectedRecipe.status === 'verified'
              ? <StatusTag variant="green">✓ Verified — {fefo ? 'FEFO' : 'FIFO'} tracking active</StatusTag>
              : <StatusTag variant="yellow">⚠ Draft — inventory not tracked</StatusTag>}
          </div>

          {/* Menu Price */}
          <div className="flex items-center gap-2 mb-4">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Menu Price $</label>
            <input
              type="number"
              className="w-24 px-2 py-1 border border-border rounded-md text-sm bg-card font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
              defaultValue={selectedRecipe.menu_price || ''}
              placeholder="0.00"
              onBlur={e => saveMenuPrice(selectedRecipe.id, e.target.value)}
            />
          </div>

          <div className="bg-card border border-border rounded-lg p-4 mb-3">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Ingredients per serving — link to your stock</div>
            <div className="grid gap-2">
              {selectedRecipe.ingredients.map((ing) => (
                <div key={ing.id} className="flex items-center gap-2 p-2.5 bg-muted/50 rounded-lg border border-border/50">
                  <select
                    className="flex-[2] text-xs border border-border rounded-md px-2 py-1.5 bg-card"
                    value={ing.ingredient_id || ''}
                    onChange={e => updateRecipeIngredient(ing.id, { ingredient_id: e.target.value || null })}
                  >
                    <option value="">— Unlinked —</option>
                    {ingredients.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                  </select>
                  <input
                    type="number"
                    className="w-20 text-xs border border-border rounded-md px-2 py-1.5 bg-card text-center font-mono"
                    value={ing.qty}
                    onChange={e => updateRecipeIngredient(ing.id, { qty: parseFloat(e.target.value) || 0 })}
                  />
                  <input
                    className="w-16 text-xs border border-border rounded-md px-2 py-1.5 bg-card text-center"
                    value={ing.unit}
                    onChange={e => updateRecipeIngredient(ing.id, { unit: e.target.value })}
                  />
                  {ing.ingredient_id ? (
                    <StatusTag variant="green">✓ Linked</StatusTag>
                  ) : (
                    <StatusTag variant="yellow">⚠</StatusTag>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            {selectedRecipe.status === 'draft' && (
              <Button onClick={() => verifyRecipe(selectedRecipe.id)}>
                ✓ Verify Recipe
              </Button>
            )}
            <Button variant="outline" onClick={() => setSelectedRId(null)}>
              Close
            </Button>
            <Button
              variant="outline"
              className="text-destructive border-destructive/30 hover:bg-destructive/10 ml-auto"
              onClick={() => setDeleteTarget(selectedRecipe)}
            >
              🗑 Delete Recipe
            </Button>
          </div>
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{deleteTarget?.name}"?</DialogTitle>
            <DialogDescription>
              This will permanently delete this recipe and all its ingredient links. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleteRecipe.isPending}>
              {deleteRecipe.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Action Confirmation Dialog */}
      <Dialog open={!!bulkAction} onOpenChange={open => { if (!open) setBulkAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {bulkAction === 'verifyAll' ? `Verify all ${draftRecipes.length} draft recipes?` : `Delete all ${draftRecipes.length} draft recipes?`}
            </DialogTitle>
            <DialogDescription>
              {bulkAction === 'verifyAll'
                ? 'This will auto-link ingredients and start inventory tracking for all draft recipes.'
                : 'This will permanently delete all draft recipes. This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAction(null)}>Cancel</Button>
            <Button
              variant={bulkAction === 'deleteAllDrafts' ? 'destructive' : 'default'}
              onClick={bulkAction === 'verifyAll' ? verifyAllDrafts : deleteAllDrafts}
            >
              {bulkAction === 'verifyAll' ? `Verify ${draftRecipes.length} Recipes` : `Delete ${draftRecipes.length} Drafts`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
