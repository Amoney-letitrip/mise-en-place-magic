import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdateProfile } from '@/hooks/use-inventory-data';

interface ScannedRecipe {
  name: string;
  ingredients: Array<{ name: string; qty: number; unit: string }>;
}

interface OnboardingWizardProps {
  restaurantName: string | null;
}

export const OnboardingWizard = ({ restaurantName: initialName }: OnboardingWizardProps) => {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName || '');
  const [scanState, setScanState] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle');
  const [scannedRecipes, setScannedRecipes] = useState<ScannedRecipe[]>([]);
  const [removedIndices, setRemovedIndices] = useState<Set<number>>(new Set());
  const [menuPreviewUrl, setMenuPreviewUrl] = useState<string | null>(null);
  const [menuUrlInput, setMenuUrlInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const updateProfile = useUpdateProfile();

  const getUserId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user!.id;
  };

  const scanMenuPhoto = useCallback(async (file: File) => {
    setScanState('scanning');
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
      const recipes = fnData?.recipes || [];
      setScannedRecipes(recipes);
      setRemovedIndices(new Set());
      setScanState('done');
      toast.success(`Found ${recipes.length} menu items`);
    } catch {
      setScanState('error');
      toast.error('Scan failed — please try again');
    }
  }, []);

  const scanMenuUrl = useCallback(async (url: string) => {
    setScanState('scanning');
    setMenuPreviewUrl(null);
    try {
      const { data: fnData, error: fnError } = await supabase.functions.invoke('scan-menu', {
        body: { type: 'url', url },
      });
      if (fnError) throw fnError;
      const recipes = fnData?.recipes || [];
      setScannedRecipes(recipes);
      setRemovedIndices(new Set());
      setScanState('done');
      toast.success(`Found ${recipes.length} menu items`);
    } catch {
      setScanState('error');
      toast.error('Scan failed — try uploading a photo instead');
    }
  }, []);

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

  const updateScannedRecipeName = useCallback((recipeIdx: number, newName: string) => {
    setScannedRecipes(prev => prev.map((r, ri) => ri === recipeIdx ? { ...r, name: newName } : r));
  }, []);

  const saveRecipesAndFinish = useCallback(async () => {
    try {
      const userId = await getUserId();
      const toSave = scannedRecipes.filter((_, i) => !removedIndices.has(i));

      for (const r of toSave) {
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

      await updateProfile.mutateAsync({
        restaurant_name: name || undefined,
        onboarding_completed: true,
      });

      qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
      toast.success('Setup complete!');
    } catch {
      toast.error('Failed to save — please try again');
    }
  }, [scannedRecipes, removedIndices, name, updateProfile, qc]);

  const skipAndFinish = useCallback(async () => {
    await updateProfile.mutateAsync({
      restaurant_name: name || undefined,
      onboarding_completed: true,
    });
    toast.success('Setup complete!');
  }, [name, updateProfile]);

  const activeCount = scannedRecipes.filter((_, i) => !removedIndices.has(i)).length;

  const steps = [
    { title: 'Welcome', icon: '🍽' },
    { title: 'Upload Menu', icon: '📸' },
    { title: 'Review', icon: '✅' },
  ];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => { if (e.target.files?.[0]) scanMenuPhoto(e.target.files[0]); e.target.value = ''; }} />

      <div className="w-full max-w-lg">
        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                i < step ? 'bg-primary text-primary-foreground' :
                i === step ? 'bg-primary text-primary-foreground ring-4 ring-primary/20' :
                'bg-muted text-muted-foreground'
              }`}>
                {i < step ? '✓' : s.icon}
              </div>
              {i < steps.length - 1 && (
                <div className={`w-12 h-0.5 rounded ${i < step ? 'bg-primary' : 'bg-border'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className="bg-card border border-border rounded-2xl p-8 text-center shadow-sm animate-fade-up">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🍽</div>
            <h1 className="text-2xl font-extrabold text-foreground mb-2">Welcome to Mise en Place</h1>
            <p className="text-muted-foreground text-sm mb-6">Let's set up your restaurant inventory in a few simple steps.</p>

            <div className="text-left mb-6">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Restaurant Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2.5 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                placeholder="e.g. Tony's Bistro"
                autoFocus
              />
            </div>

            <Button className="w-full" size="lg" onClick={() => setStep(1)}>
              Get Started →
            </Button>
          </div>
        )}

        {/* Step 1: Upload Menu */}
        {step === 1 && scanState === 'idle' && (
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm animate-fade-up">
            <h2 className="text-xl font-extrabold text-foreground text-center mb-2">Upload Your Menu</h2>
            <p className="text-muted-foreground text-sm text-center mb-6">
              Our AI will read your menu and extract all dishes with estimated ingredients.
            </p>

            <div className="grid grid-cols-1 gap-3 mb-4">
              <div
                className="border-2 border-dashed border-primary/30 rounded-xl p-6 text-center cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-all"
                onClick={() => fileRef.current?.click()}
              >
                <div className="text-3xl mb-2">📸</div>
                <div className="font-bold text-sm text-foreground mb-1">Upload a photo or PDF</div>
                <div className="text-xs text-muted-foreground">Take a photo of your printed menu, or upload a PDF</div>
              </div>

              <div className="border-2 border-dashed border-accent-foreground/20 rounded-xl p-6 text-center">
                <div className="text-3xl mb-2">🔗</div>
                <div className="font-bold text-sm text-foreground mb-2">Or paste your menu URL</div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="https://yourrestaurant.com/menu"
                    value={menuUrlInput}
                    onChange={e => setMenuUrlInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && menuUrlInput.trim()) scanMenuUrl(menuUrlInput.trim()); }}
                  />
                  <Button disabled={!menuUrlInput.trim()} onClick={() => scanMenuUrl(menuUrlInput.trim())}>
                    Scan
                  </Button>
                </div>
              </div>
            </div>

            <button
              className="w-full text-sm text-muted-foreground hover:text-foreground py-2"
              onClick={skipAndFinish}
            >
              Skip for now — I'll add recipes manually
            </button>
          </div>
        )}

        {/* Scanning */}
        {step === 1 && scanState === 'scanning' && (
          <div className="bg-card border border-border rounded-2xl p-12 text-center shadow-sm animate-fade-up">
            {menuPreviewUrl && (
              <img src={menuPreviewUrl} alt="Menu" className="w-full max-w-[280px] h-[180px] object-cover rounded-lg mb-5 border border-border mx-auto" />
            )}
            <div className="text-4xl mb-3 animate-pulse">🤖</div>
            <div className="font-bold text-lg text-foreground mb-1.5">AI is reading your menu…</div>
            <div className="text-sm text-muted-foreground">Identifying dishes and estimating ingredient quantities</div>
            <div className="mt-5 h-1.5 bg-border rounded-full overflow-hidden max-w-[280px] mx-auto">
              <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
          </div>
        )}

        {/* Error */}
        {step === 1 && scanState === 'error' && (
          <div className="bg-card border border-destructive/30 rounded-2xl p-8 text-center shadow-sm animate-fade-up">
            <div className="text-4xl mb-3">⚠️</div>
            <div className="font-bold text-base text-destructive mb-1.5">Scan failed</div>
            <div className="text-sm text-muted-foreground mb-5">The link may block automated access. Try a photo instead.</div>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => { setScanState('idle'); setMenuUrlInput(''); }}>Try again</Button>
              <Button onClick={() => fileRef.current?.click()}>📸 Upload photo</Button>
            </div>
          </div>
        )}

        {/* Done scanning → advance to review */}
        {step === 1 && scanState === 'done' && (
          <div className="bg-card border border-border rounded-2xl p-8 text-center shadow-sm animate-fade-up">
            <div className="text-4xl mb-3">🎉</div>
            <div className="font-bold text-lg text-foreground mb-1.5">Found {scannedRecipes.length} menu items!</div>
            <div className="text-sm text-muted-foreground mb-5">Review and edit them before we save.</div>
            <Button className="w-full" onClick={() => setStep(2)}>Review Recipes →</Button>
          </div>
        )}

        {/* Step 2: Review & Verify */}
        {step === 2 && (
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm animate-fade-up">
            <h2 className="text-xl font-extrabold text-foreground text-center mb-1">Review Your Recipes</h2>
            <p className="text-muted-foreground text-sm text-center mb-4">
              Edit names, adjust ingredients, or remove items. {activeCount} of {scannedRecipes.length} will be saved as drafts.
            </p>

            <div className="max-h-[400px] overflow-y-auto space-y-2 mb-5 pr-1">
              {scannedRecipes.map((r, i) => {
                const removed = removedIndices.has(i);
                return (
                  <div key={i} className={`border rounded-lg p-3 transition-all ${removed ? 'border-border/30 opacity-40' : 'border-border'}`}>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
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
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
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
                <div className="text-center text-muted-foreground py-8">No recipes found</div>
              )}
            </div>

            <div className="flex gap-2">
              <Button className="flex-1" size="lg" onClick={saveRecipesAndFinish} disabled={activeCount === 0}>
                Save {activeCount} Recipe{activeCount !== 1 ? 's' : ''} & Start 🚀
              </Button>
              <Button variant="outline" onClick={() => { setStep(1); setScanState('idle'); }}>
                ← Back
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
