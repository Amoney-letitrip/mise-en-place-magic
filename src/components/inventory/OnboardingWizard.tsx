import { useState, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdateProfile } from '@/hooks/use-inventory-data';

interface ScannedRecipe {
  name: string;
  ingredients: Array<{ name: string; qty: number; unit: string }>;
}

interface StockItem {
  name: string;
  unit: string;
  currentStock: string;
  storage: string;
  isPerishable: boolean;
  shelfLifeDays: string;
}

const POS_SYSTEMS = [
  { id: 'square', name: 'Square', icon: '🟦', desc: 'Point of Sale & Payments' },
  { id: 'toast', name: 'Toast', icon: '🍞', desc: 'Restaurant Management' },
  { id: 'clover', name: 'Clover', icon: '🍀', desc: 'Smart POS System' },
  { id: 'lightspeed', name: 'Lightspeed', icon: '⚡', desc: 'Retail & Restaurant POS' },
  { id: 'revel', name: 'Revel', icon: '🔴', desc: 'iPad POS System' },
];

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
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const updateProfile = useUpdateProfile();

  const getUserId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user!.id;
  };

  // Extract unique ingredients from accepted recipes
  const buildStockItems = useCallback(() => {
    const kept = scannedRecipes.filter((_, i) => !removedIndices.has(i));
    const seen = new Map<string, StockItem>();
    for (const r of kept) {
      for (const ing of r.ingredients) {
        const key = ing.name.toLowerCase().trim();
        if (!seen.has(key)) {
          seen.set(key, {
            name: ing.name,
            unit: ing.unit,
            currentStock: '',
            storage: 'room',
            isPerishable: false,
            shelfLifeDays: '',
          });
        }
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [scannedRecipes, removedIndices]);

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
      return { ...r, ingredients: r.ingredients.map((ing, ii) => ii !== ingIdx ? ing : { ...ing, [field]: value }) };
    }));
  }, []);

  const updateScannedRecipeName = useCallback((recipeIdx: number, newName: string) => {
    setScannedRecipes(prev => prev.map((r, ri) => ri === recipeIdx ? { ...r, name: newName } : r));
  }, []);

  const goToStockCount = useCallback(() => {
    const items = buildStockItems();
    setStockItems(items);
    setStep(3);
  }, [buildStockItems]);

  const updateStockItem = useCallback((index: number, field: keyof StockItem, value: any) => {
    setStockItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }, []);

  const saveAndFinish = useCallback(async (connectPOS?: string) => {
    setSaving(true);
    try {
      const userId = await getUserId();
      const kept = scannedRecipes.filter((_, i) => !removedIndices.has(i));

      // 1. Create ingredients from stock items
      const ingredientMap = new Map<string, string>(); // name -> id
      for (const item of stockItems) {
        const { data: ing, error } = await supabase
          .from('ingredients')
          .insert({
            name: item.name,
            unit: item.unit,
            current_stock: parseFloat(item.currentStock) || 0,
            storage_type: item.storage,
            is_perishable: item.isPerishable,
            shelf_life_days: item.shelfLifeDays ? parseInt(item.shelfLifeDays) : null,
            user_id: userId,
          })
          .select()
          .single();
        if (!error && ing) {
          ingredientMap.set(item.name.toLowerCase().trim(), ing.id);
        }
      }

      // 2. Create recipes and link ingredients
      for (const r of kept) {
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
          ingredient_id: ingredientMap.get(ing.name.toLowerCase().trim()) || null,
        }));
        if (ings.length > 0) await supabase.from('recipe_ingredients').insert(ings);
      }

      // 3. Mark onboarding complete
      await updateProfile.mutateAsync({
        restaurant_name: name || undefined,
        onboarding_completed: true,
      });

      qc.invalidateQueries({ queryKey: ['recipes-with-ingredients'] });
      qc.invalidateQueries({ queryKey: ['ingredients'] });
      toast.success('Setup complete! Welcome to Mise en Place 🎉');
    } catch {
      toast.error('Failed to save — please try again');
    } finally {
      setSaving(false);
    }
  }, [scannedRecipes, removedIndices, stockItems, name, updateProfile, qc]);

  const skipMenuAndFinish = useCallback(async () => {
    setSaving(true);
    try {
      await updateProfile.mutateAsync({
        restaurant_name: name || undefined,
        onboarding_completed: true,
      });
      toast.success('Setup complete!');
    } catch {
      toast.error('Failed — please try again');
    } finally {
      setSaving(false);
    }
  }, [name, updateProfile]);

  const activeCount = scannedRecipes.filter((_, i) => !removedIndices.has(i)).length;
  const countedItems = stockItems.filter(i => i.currentStock !== '' && parseFloat(i.currentStock) > 0).length;

  const steps = [
    { title: 'Welcome', icon: '🍽' },
    { title: 'Menu', icon: '📸' },
    { title: 'Recipes', icon: '📋' },
    { title: 'Stock Count', icon: '🔢' },
    { title: 'POS', icon: '💳' },
  ];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => { if (e.target.files?.[0]) scanMenuPhoto(e.target.files[0]); e.target.value = ''; }} />

      <div className="w-full max-w-xl">
        {/* Progress */}
        <div className="flex items-center justify-center gap-1.5 mb-8">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                i < step ? 'bg-primary text-primary-foreground' :
                i === step ? 'bg-primary text-primary-foreground ring-4 ring-primary/20' :
                'bg-muted text-muted-foreground'
              }`}>
                {i < step ? '✓' : s.icon}
              </div>
              {i < steps.length - 1 && (
                <div className={`w-8 h-0.5 rounded ${i < step ? 'bg-primary' : 'bg-border'}`} />
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

            <button className="w-full text-sm text-muted-foreground hover:text-foreground py-2" onClick={skipMenuAndFinish}>
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
            <div className="text-sm text-muted-foreground mb-5">Review and edit them in the next step.</div>
            <Button className="w-full" onClick={() => setStep(2)}>Review Recipes →</Button>
          </div>
        )}

        {/* Step 2: Review Recipes */}
        {step === 2 && (
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm animate-fade-up">
            <h2 className="text-xl font-extrabold text-foreground text-center mb-1">Review Your Recipes</h2>
            <p className="text-muted-foreground text-sm text-center mb-4">
              Edit names, adjust ingredients, or remove items. {activeCount} of {scannedRecipes.length} will be saved.
            </p>

            <div className="max-h-[380px] overflow-y-auto space-y-2 mb-5 pr-1">
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
                        className={`text-xs px-2 py-1 rounded-md border transition-colors shrink-0 ${removed ? 'border-primary/30 text-primary hover:bg-primary/10' : 'border-destructive/30 text-destructive hover:bg-destructive/10'}`}
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
            </div>

            <div className="flex gap-2">
              <Button className="flex-1" size="lg" onClick={goToStockCount} disabled={activeCount === 0}>
                Next: Stock Count →
              </Button>
              <Button variant="outline" onClick={() => { setStep(1); setScanState('idle'); }}>
                ← Back
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: First Stock Count */}
        {step === 3 && (
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm animate-fade-up">
            <h2 className="text-xl font-extrabold text-foreground text-center mb-1">First Stock Count</h2>
            <p className="text-muted-foreground text-sm text-center mb-1">
              Enter how much of each ingredient you currently have on hand.
            </p>
            <p className="text-muted-foreground text-xs text-center mb-4">
              {countedItems} of {stockItems.length} counted · You can update these later
            </p>

            <div className="max-h-[400px] overflow-y-auto space-y-2 mb-5 pr-1">
              {stockItems.map((item, i) => (
                <div key={i} className="border border-border rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-bold text-sm flex-1">{item.name}</span>
                    <span className="text-[11px] text-muted-foreground font-mono">{item.unit}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Qty on Hand</label>
                      <input
                        type="number"
                        className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono"
                        placeholder="0"
                        value={item.currentStock}
                        onChange={e => updateStockItem(i, 'currentStock', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Storage</label>
                      <select
                        className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-background"
                        value={item.storage}
                        onChange={e => updateStockItem(i, 'storage', e.target.value)}
                      >
                        <option value="room">🏠 Room</option>
                        <option value="fridge">❄️ Fridge</option>
                        <option value="freezer">🧊 Freezer</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Perishable?</label>
                      <button
                        className={`w-full px-2 py-1.5 border rounded-md text-sm transition-colors ${item.isPerishable ? 'bg-primary/10 border-primary text-primary' : 'bg-background border-border text-muted-foreground'}`}
                        onClick={() => updateStockItem(i, 'isPerishable', !item.isPerishable)}
                      >
                        {item.isPerishable ? '🌿 Yes' : 'No'}
                      </button>
                    </div>
                    {item.isPerishable && (
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Shelf Life (days)</label>
                        <input
                          type="number"
                          className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono"
                          placeholder="7"
                          value={item.shelfLifeDays}
                          onChange={e => updateStockItem(i, 'shelfLifeDays', e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {stockItems.length === 0 && (
                <div className="text-center text-muted-foreground py-8">No ingredients found</div>
              )}
            </div>

            <div className="flex gap-2">
              <Button className="flex-1" size="lg" onClick={() => setStep(4)}>
                Next: Connect POS →
              </Button>
              <Button variant="outline" onClick={() => setStep(2)}>
                ← Back
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Connect POS */}
        {step === 4 && (
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm animate-fade-up">
            <h2 className="text-xl font-extrabold text-foreground text-center mb-2">Connect Your POS</h2>
            <p className="text-muted-foreground text-sm text-center mb-6">
              Link your point-of-sale system to automatically track sales and deduct inventory.
            </p>

            <div className="grid gap-2.5 mb-6">
              {POS_SYSTEMS.map(pos => (
                <button
                  key={pos.id}
                  className="flex items-center gap-3 p-4 border border-border rounded-xl text-left hover:border-primary/50 hover:bg-primary/5 transition-all group"
                  onClick={() => toast.info(`${pos.name} integration coming soon!`)}
                >
                  <span className="text-2xl">{pos.icon}</span>
                  <div className="flex-1">
                    <div className="font-bold text-sm text-foreground">{pos.name}</div>
                    <div className="text-xs text-muted-foreground">{pos.desc}</div>
                  </div>
                  <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">Connect →</span>
                </button>
              ))}
            </div>

            <div className="bg-muted/50 border border-border rounded-lg px-4 py-3 mb-5 text-center">
              <div className="text-xs text-muted-foreground">
                💡 You can also record sales manually or import CSV files from the Sales tab.
              </div>
            </div>

            <div className="flex gap-2">
              <Button className="flex-1" size="lg" onClick={() => saveAndFinish()} disabled={saving}>
                {saving ? 'Setting up…' : 'Finish Setup 🚀'}
              </Button>
              <Button variant="outline" onClick={() => setStep(3)} disabled={saving}>
                ← Back
              </Button>
            </div>

            <button
              className="w-full text-sm text-muted-foreground hover:text-foreground py-2 mt-2"
              onClick={() => saveAndFinish()}
              disabled={saving}
            >
              Skip POS — I'll connect later
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
