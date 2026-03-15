import { useState, useRef, useCallback } from 'react';
import { StatusTag, SectionHead } from './StatusTag';
import { Button } from '@/components/ui/button';
import type { Database } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

type Ingredient = Database['public']['Tables']['ingredients']['Row'];

interface RecipeWithIngredients {
  id: string;
  name: string;
  status: string;
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

interface RecipesTabProps {
  recipes: RecipeWithIngredients[];
  ingredients: Ingredient[];
  fefo: boolean;
  draftRecipes: RecipeWithIngredients[];
}

export const RecipesTab = ({ recipes, ingredients, fefo, draftRecipes }: RecipesTabProps) => {
  const [subTab, setSubTab] = useState<'list' | 'calibration'>('list');
  const [selectedRId, setSelectedRId] = useState<string | null>(null);
  const [menuScanState, setMenuScanState] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle');
  const [menuPreviewUrl, setMenuPreviewUrl] = useState<string | null>(null);
  const [menuUrlInput, setMenuUrlInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const selectedRecipe = recipes.find(r => r.id === selectedRId);

  const scanMenuPhoto = useCallback(async (file: File) => {
    setMenuScanState('scanning');
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
      const newRecipes = fnData?.recipes || [];

      // Insert recipes into DB
      for (const r of newRecipes) {
        const { data: recipe, error: re } = await supabase.from('recipes').insert({ name: r.name, status: 'draft' }).select().single();
        if (re || !recipe) continue;
        const ings = (r.ingredients || []).map((ing: any) => ({
          recipe_id: recipe.id,
          name: ing.name,
          qty: ing.qty,
          unit: ing.unit,
          confidence: 0.75,
        }));
        if (ings.length > 0) await supabase.from('recipe_ingredients').insert(ings);
      }

      qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
      setMenuScanState('done');
      toast.success(`AI scanned menu — ${newRecipes.length} draft recipes created`);
    } catch (err) {
      console.error(err);
      setMenuScanState('error');
      toast.error('Scan failed — please try again');
    }
  }, [qc]);

  const scanMenuUrl = useCallback(async (url: string) => {
    setMenuScanState('scanning');
    setMenuPreviewUrl(null);
    try {
      const { data: fnData, error: fnError } = await supabase.functions.invoke('scan-menu', {
        body: { type: 'url', url },
      });
      if (fnError) throw fnError;
      const newRecipes = fnData?.recipes || [];

      for (const r of newRecipes) {
        const { data: recipe, error: re } = await supabase.from('recipes').insert({ name: r.name, status: 'draft' }).select().single();
        if (re || !recipe) continue;
        const ings = (r.ingredients || []).map((ing: any) => ({
          recipe_id: recipe.id,
          name: ing.name,
          qty: ing.qty,
          unit: ing.unit,
          confidence: 0.75,
        }));
        if (ings.length > 0) await supabase.from('recipe_ingredients').insert(ings);
      }

      qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
      setMenuScanState('done');
      toast.success(`Menu scanned — ${newRecipes.length} draft recipes created`);
    } catch (err) {
      console.error(err);
      setMenuScanState('error');
      toast.error('Scan failed — try uploading a photo instead');
    }
  }, [qc]);

  const verifyRecipe = useCallback(async (id: string) => {
    const r = recipes.find(x => x.id === id);
    const { error } = await supabase.from('recipes').update({ status: 'verified', verified_by: 'Manager', verified_date: new Date().toLocaleDateString() }).eq('id', id);
    if (error) { toast.error('Failed to verify'); return; }
    qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
    toast.success(`"${r?.name}" verified`);
    setSelectedRId(null);
  }, [recipes, qc]);

  const updateRecipeIngredient = useCallback(async (riId: string, updates: Record<string, any>) => {
    await supabase.from('recipe_ingredients').update(updates).eq('id', riId);
    qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
  }, [qc]);

  return (
    <div className="animate-fade-up">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) scanMenuPhoto(e.target.files[0]); e.target.value = ''; }} />

      {!selectedRId ? (
        <>
          <SectionHead
            title="Recipes"
            sub={`${recipes.filter(r => r.status === 'verified').length} verified · ${draftRecipes.length} draft`}
            action={recipes.length > 0 ? <Button onClick={() => { setMenuScanState('idle'); setMenuPreviewUrl(null); setMenuUrlInput(''); }}>📸 Re-scan Menu</Button> : undefined}
          />

          {recipes.length > 0 && (
            <div className="border-b border-border mb-4 flex gap-5">
              <button onClick={() => setSubTab('list')} className={`pb-2 text-[13px] font-semibold border-b-2 transition-colors ${subTab === 'list' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}>
                Recipe List
              </button>
              <button onClick={() => setSubTab('calibration')} className={`pb-2 text-[13px] font-semibold border-b-2 transition-colors ${subTab === 'calibration' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}>
                Calibration
              </button>
            </div>
          )}

          {/* EMPTY STATE */}
          {recipes.length === 0 && menuScanState !== 'scanning' && menuScanState !== 'error' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* Photo Upload */}
              <div
                className="bg-blue-50/50 border border-dashed border-blue-200 rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <div className="text-5xl mb-3.5">📸</div>
                <div className="font-extrabold text-base text-primary mb-2">Upload a photo</div>
                <div className="text-[13px] text-primary/80 mb-5 leading-relaxed">
                  Take a photo of your printed menu, or upload any image of your menu
                </div>
                <Button className="w-full" onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>Choose Photo</Button>
                <div className="mt-2.5 text-[11px] text-primary/40">JPG, PNG, HEIC · printed or handwritten</div>
              </div>

              {/* URL Input */}
              <div className="bg-emerald-50/50 border border-dashed border-emerald-200 rounded-lg p-8 text-center">
                <div className="text-5xl mb-3.5">🔗</div>
                <div className="font-extrabold text-base text-emerald-700 mb-2">Paste a menu link</div>
                <div className="text-[13px] text-emerald-600 mb-5 leading-relaxed">
                  Link to your website, Yelp, Google, OpenTable, or any page with your menu
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
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                    disabled={!menuUrlInput.trim()}
                    onClick={() => { if (menuUrlInput.trim()) scanMenuUrl(menuUrlInput.trim()); }}
                  >
                    Scan Menu URL
                  </Button>
                </div>
                <div className="mt-2.5 text-[11px] text-emerald-300">Works with Yelp, Google, Squarespace, Toast, etc.</div>
              </div>
            </div>
          )}

          {/* SCANNING STATE */}
          {menuScanState === 'scanning' && (
            <div className="bg-card border border-border rounded-lg p-12 text-center">
              {menuPreviewUrl ? (
                <img src={menuPreviewUrl} alt="Menu" className="w-full max-w-[320px] h-[200px] object-cover rounded-lg mb-5 border border-border mx-auto" />
              ) : (
                <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg mb-5 text-[13px] text-emerald-700 font-mono max-w-[400px] break-all">
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

          {/* ERROR STATE */}
          {menuScanState === 'error' && recipes.length === 0 && (
            <div className="bg-card border border-red-200 rounded-lg p-8 text-center bg-red-50/50">
              <div className="text-4xl mb-3">⚠️</div>
              <div className="font-bold text-base text-destructive mb-1.5">Scan failed</div>
              <div className="text-[13px] text-muted-foreground mb-5">The link may block automated access. Try uploading a screenshot instead.</div>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" onClick={() => { setMenuScanState('idle'); setMenuUrlInput(''); }}>Try a different URL</Button>
                <Button onClick={() => fileRef.current?.click()}>📸 Upload photo instead</Button>
              </div>
            </div>
          )}

          {/* RECIPE LIST */}
          {recipes.length > 0 && subTab === 'list' && (
            <>
              {draftRecipes.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 mb-3 text-[13px] text-amber-700 flex gap-2">
                  💡 <strong>{draftRecipes.length} unverified recipe{draftRecipes.length > 1 ? 's' : ''}</strong> — verify so sales start tracking inventory.
                </div>
              )}

              <div className="grid gap-2.5">
                {recipes.map(r => (
                  <div
                    key={r.id}
                    className={`bg-card border rounded-lg p-4 cursor-pointer transition-colors hover:border-primary/50 ${r.status === 'draft' ? 'border-amber-200' : 'border-border'}`}
                    onClick={() => setSelectedRId(r.id)}
                  >
                    <div className="flex justify-between items-start gap-3.5">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="font-bold text-[15px]">{r.name}</span>
                          {r.status === 'verified' ? <StatusTag variant="green">✓ Verified</StatusTag> : <StatusTag variant="yellow">Draft — needs verification</StatusTag>}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {r.ingredients.map(ing => (
                            <span key={ing.id} className="inline-flex items-center gap-1 bg-muted/50 border border-border/50 rounded-md px-2 py-0.5 text-[11px] font-mono text-foreground">
                              {ing.name} {ing.qty}{ing.unit}
                            </span>
                          ))}
                        </div>
                        {r.verified_by && <div className="mt-1.5 text-[11px] text-muted-foreground">Verified by {r.verified_by} · {r.verified_date}</div>}
                      </div>
                      <Button
                        variant={r.status === 'draft' ? 'default' : 'outline'}
                        size="sm"
                        className={r.status === 'draft' ? 'bg-orange hover:bg-orange/90' : ''}
                        onClick={e => { e.stopPropagation(); setSelectedRId(r.id); }}
                      >
                        {r.status === 'draft' ? 'Review →' : 'Edit'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* CALIBRATION */}
          {recipes.length > 0 && subTab === 'calibration' && (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3.5 py-2.5 mb-3.5 text-[13px] text-primary">
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
          <div className="flex items-center gap-2.5 mb-4">
            <h1 className="text-xl font-extrabold text-foreground">{selectedRecipe.name}</h1>
            {selectedRecipe.status === 'verified'
              ? <StatusTag variant="green">✓ Verified — {fefo ? 'FEFO' : 'FIFO'} tracking active</StatusTag>
              : <StatusTag variant="yellow">⚠ Draft — inventory not tracked</StatusTag>}
          </div>

          <div className="bg-card border border-border rounded-lg p-4 mb-3">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Ingredients per serving — link to your stock</div>
            <div className="grid gap-2">
              {selectedRecipe.ingredients.map((ing) => {
                return (
                  <div key={ing.id} className="flex items-center gap-2 p-2.5 bg-muted/50 rounded-lg border border-border/50">
                    <select
                      className="flex-[2] text-xs border border-border rounded-md px-2 py-1.5 bg-card"
                      value={ing.ingredient_id || ''}
                      onChange={e => updateRecipeIngredient(ing.id, { ingredient_id: e.target.value || null })}
                    >
                      <option value="">— {ing.name} (link to stock)</option>
                      {ingredients.map(mi => <option key={mi.id} value={mi.id}>{mi.name} ({mi.unit})</option>)}
                    </select>
                    <input
                      className="w-[70px] text-right px-2 py-1.5 border border-border rounded-md text-[13px] bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
                      value={ing.qty}
                      type="number"
                      onChange={e => updateRecipeIngredient(ing.id, { qty: parseFloat(e.target.value) || 0 })}
                    />
                    <input
                      className="w-[60px] px-2 py-1.5 border border-border rounded-md text-[13px] bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
                      value={ing.unit}
                      onChange={e => updateRecipeIngredient(ing.id, { unit: e.target.value })}
                    />
                    <button
                      className="w-7 h-7 border border-border rounded-md text-muted-foreground hover:text-foreground flex items-center justify-center flex-shrink-0"
                      onClick={async () => {
                        await supabase.from('recipe_ingredients').delete().eq('id', ing.id);
                        qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
                      }}
                    >×</button>
                  </div>
                );
              })}
            </div>
            <button
              className="mt-2 text-primary font-semibold text-[13px] flex items-center gap-1 hover:underline"
              onClick={async () => {
                await supabase.from('recipe_ingredients').insert({ recipe_id: selectedRecipe.id, name: 'New ingredient', qty: 1, unit: 'oz' });
                qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
              }}
            >
              + Add Ingredient
            </button>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setSelectedRId(null)}>Save Draft</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => verifyRecipe(selectedRecipe.id)}
            >
              {selectedRecipe.status !== 'verified' ? '✓ Verify — Activate Inventory Tracking' : '✓ Re-verify'}
            </Button>
          </div>

          {selectedRecipe.status === 'draft' && (
            <div className="mt-2.5 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              💡 Once verified, each sale of "{selectedRecipe.name}" depletes ingredients using {fefo ? 'FEFO' : 'FIFO'} lot logic.
            </div>
          )}
        </>
      )}
    </div>
  );
};
