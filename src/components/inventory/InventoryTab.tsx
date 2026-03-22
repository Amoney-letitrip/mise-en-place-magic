import { useState, useMemo } from 'react';
import { StatusTag, StockBar, FreshBadge, Mono, SectionHead } from './StatusTag';
import { Button } from '@/components/ui/button';
import { diffDays, fmtDate, fmtN, buildCycleList, DISCREPANCY_REASONS } from '@/lib/inventory-utils';
import type { Database } from '@/integrations/supabase/types';
import { LotsModal } from './LotsModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useDeleteIngredient } from '@/hooks/use-inventory-data';

type Ingredient = Database['public']['Tables']['ingredients']['Row'];
type Lot = Database['public']['Tables']['lots']['Row'];

interface InventoryTabProps {
  ingredients: Ingredient[];
  lots: Lot[];
  forecasts: Record<string, any>;
  fefo: boolean;
  expiredLots: Lot[];
  lowItems: Ingredient[];
  logWaste: (lot: Lot) => void;
  onUpdateIngredients?: (updates: Array<{ id: string; current_stock: number }>) => void;
}

export const InventoryTab = ({
  ingredients, lots, forecasts, fefo, expiredLots, lowItems, logWaste, onUpdateIngredients,
}: InventoryTabProps) => {
  const [subTab, setSubTab] = useState<'list' | 'count'>('list');
  const [lotsModal, setLotsModal] = useState<Ingredient | null>(null);
  const [cycleItems, setCycleItems] = useState<any[] | null>(null);
  const [cycleSubmitted, setCycleSubmitted] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Ingredient | null>(null);
  const deleteIngredient = useDeleteIngredient();

  const now = new Date();

  const computedCycle = useMemo(() =>
    cycleItems || buildCycleList(ingredients as any, lots as any),
    [cycleItems, ingredients, lots]
  );

  const startCount = () => {
    setCycleItems(buildCycleList(ingredients as any, lots as any));
    setCycleSubmitted(false);
    setSubTab('count');
  };

  const submitCount = () => {
    if (!cycleItems) return;
    const updates: Array<{ id: string; current_stock: number }> = [];
    cycleItems.forEach(item => {
      if (item.counted == null || item.counted === '') return;
      const diff = parseFloat(item.counted) - item.systemQty;
      if (diff === 0) return;
      const ing = ingredients.find(i => i.id === item.ingredientId);
      if (!ing) return;
      updates.push({ id: ing.id, current_stock: Math.max(0, ing.current_stock + diff) });
    });
    if (updates.length > 0 && onUpdateIngredients) {
      onUpdateIngredients(updates);
    }
    setCycleSubmitted(true);
  };

  const ingLots = (ingId: string) =>
    lots
      .filter(l => l.ingredient_id === ingId && l.quantity_remaining > 0)
      .sort((a, b) => {
        const ing = ingredients.find(i => i.id === ingId);
        if (fefo && ing?.is_perishable && a.expires_at && b.expires_at) {
          return new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime();
        }
        return new Date(a.received_at).getTime() - new Date(b.received_at).getTime();
      });

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteIngredient.mutateAsync(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete ingredient');
    }
  };

  return (
    <div className="animate-fade-up">
      <SectionHead
        title="Inventory"
        sub={`${ingredients.length} ingredients · ${lowItems.length} low · ${fefo ? 'FEFO' : 'FIFO'}`}
        action={
          <div className="flex gap-2">
            {subTab === 'list' && !cycleSubmitted && (
              <Button variant="outline" onClick={startCount}>🔢 Daily Count</Button>
            )}
            <Button>+ Add Ingredient</Button>
          </div>
        }
      />

      {/* Sub-tabs */}
      <div className="border-b border-border mb-4 flex gap-5">
        <button
          onClick={() => setSubTab('list')}
          className={`pb-2 text-[13px] font-semibold border-b-2 transition-colors ${subTab === 'list' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}
        >
          Stock List
        </button>
        <button
          onClick={() => { if (!cycleItems) startCount(); else setSubTab('count'); }}
          className={`pb-2 text-[13px] font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${subTab === 'count' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}
        >
          Daily Count
          {cycleSubmitted && <StatusTag variant="green">Done ✓</StatusTag>}
        </button>
      </div>

      {/* STOCK LIST */}
      {subTab === 'list' && (
        <>
          {lowItems.length > 0 && (
            <div className="bg-red-50 border border-red-300 rounded-lg px-3.5 py-2.5 mb-3 text-[13px] text-red-700 flex gap-2">
              🚨 <strong>{lowItems.length <= 3 ? lowItems.map(i => i.name).join(', ') : `${lowItems.slice(0, 3).map(i => i.name).join(', ')} +${lowItems.length - 3} more`}</strong> below reorder threshold
            </div>
          )}

          {expiredLots.length > 0 && (
            <div className="bg-red-50 border border-red-300 rounded-lg px-3.5 py-2.5 mb-3 text-[13px] text-red-700 flex justify-between items-center">
              <span>❌ {expiredLots.length} expired lot{expiredLots.length > 1 ? 's' : ''} — log waste to remove</span>
              <div className="flex gap-1.5">
                {expiredLots.map(lot => {
                  const ing = ingredients.find(i => i.id === lot.ingredient_id);
                  return (
                    <Button key={lot.id} variant="destructive" size="sm" onClick={() => logWaste(lot)}>
                      Log {ing?.name} waste
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5 whitespace-nowrap">Ingredient</th>
                    <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5 whitespace-nowrap">Storage</th>
                    <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5 whitespace-nowrap">Stock</th>
                    <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5 whitespace-nowrap">Freshness</th>
                    <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5 whitespace-nowrap">Forecast</th>
                    <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5 whitespace-nowrap">Calib.</th>
                    <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5 whitespace-nowrap">Lots</th>
                    <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5 whitespace-nowrap"></th>
                  </tr>
                </thead>
                <tbody>
                  {ingredients.map(ing => {
                    const fc = forecasts[ing.id];
                    const iLots = ingLots(ing.id);
                    const worstLot = iLots.find(l => l.expires_at && diffDays(new Date(l.expires_at), now) <= 2);
                    const expLot = iLots.find(l => l.expires_at && diffDays(new Date(l.expires_at), now) < 0);
                    return (
                      <tr key={ing.id} className={`border-b border-border/30 hover:bg-muted/30 ${ing.current_stock <= ing.threshold ? 'bg-red-50/30' : ''}`}>
                        <td className="px-3.5 py-2.5">
                          <div className="font-semibold flex items-center gap-1.5">
                            {ing.name}
                            {ing.is_perishable && <span title="Perishable" className="text-[11px]">🌿</span>}
                          </div>
                          {ing.shelf_life_days && <div className="text-[11px] text-muted-foreground/60">{ing.shelf_life_days}d shelf life</div>}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <StatusTag variant={ing.storage_type === 'fridge' ? 'blue' : ing.storage_type === 'freezer' ? 'purple' : 'gray'}>
                            {ing.storage_type === 'fridge' ? '❄️ Fridge' : ing.storage_type === 'freezer' ? '🧊 Freezer' : '🏠 Room'}
                          </StatusTag>
                        </td>
                        <td className="px-3.5 py-2.5">
                          <Mono className={ing.current_stock <= ing.threshold ? 'text-destructive font-semibold' : ''}>{fmtN(ing.current_stock)} {ing.unit}</Mono>
                          <StockBar current={ing.current_stock} threshold={ing.threshold} />
                        </td>
                        <td className="px-3.5 py-2.5">
                          {!ing.is_perishable
                            ? <span className="text-xs text-muted-foreground/40">N/A</span>
                            : expLot ? <StatusTag variant="red">Lot expired</StatusTag>
                            : worstLot ? <FreshBadge expiresAt={worstLot.expires_at} />
                            : iLots.length > 0 ? <StatusTag variant="green">All good</StatusTag>
                            : <span className="text-xs text-muted-foreground/40">No lots</span>}
                        </td>
                        <td className="px-3.5 py-2.5 min-w-[110px]">
                          {fc && fc.daysLeft !== Infinity ? (
                            <div>
                              <StatusTag variant={fc.daysLeft <= 2 ? 'red' : fc.daysLeft <= 5 ? 'yellow' : 'green'}>
                                {Math.round(fc.daysLeft)}d left
                              </StatusTag>
                              {fc.stockoutDate && <div className="text-[11px] text-muted-foreground mt-0.5">Stockout {fmtDate(fc.stockoutDate)}</div>}
                            </div>
                          ) : <span className="text-xs text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <span className={`font-mono text-[11px] font-bold px-2 py-0.5 rounded-md ${
                            ing.calib_factor > 1.1 ? 'text-red-600 bg-red-50' :
                            ing.calib_factor < 0.9 ? 'text-amber-600 bg-amber-50' :
                            'text-green-600 bg-green-50'
                          }`}>
                            {ing.calib_factor.toFixed(2)}×
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5">
                          {iLots.length > 0 ? (
                            <button
                              onClick={() => setLotsModal(ing)}
                              className="text-[11px] font-medium text-foreground border border-border rounded-md px-2 py-0.5 hover:bg-muted transition-colors"
                            >
                              {iLots.length} lot{iLots.length !== 1 ? 's' : ''}
                            </button>
                          ) : <span className="text-xs text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <div className="flex gap-1.5">
                            {ing.vendor && <Button variant="outline" size="sm">Reorder</Button>}
                            <button
                              onClick={() => setDeleteTarget(ing)}
                              className="text-muted-foreground/50 hover:text-destructive transition-colors p-1"
                              title="Delete ingredient"
                            >
                              🗑
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* DAILY COUNT */}
      {subTab === 'count' && (
        <div className="grid grid-cols-[1fr_300px] gap-3.5">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-border bg-muted/30 flex justify-between items-center">
              <span className="text-[13px] text-muted-foreground">Exception items: low stock + high variance + expiring + high value</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={startCount}>↻ Refresh</Button>
                {!cycleSubmitted && (
                  <Button size="sm" disabled={computedCycle.every(i => i.counted === null)} onClick={submitCount}>
                    Submit Count
                  </Button>
                )}
              </div>
            </div>
            {cycleSubmitted && (
              <div className="px-3.5 py-2.5 bg-emerald-50 border-b border-emerald-200 text-[13px] text-emerald-700">
                ✓ Count submitted — inventory reconciled
              </div>
            )}
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Ingredient</th>
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Flags</th>
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">System Qty</th>
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Physical Count</th>
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Δ</th>
                  <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Reason</th>
                </tr>
              </thead>
              <tbody>
                {computedCycle.map((item, idx) => {
                  const diff = item.counted != null && item.counted !== '' ? parseFloat(String(fmtN(parseFloat(item.counted) - item.systemQty))) : null;
                  const hasDiff = diff !== null && diff !== 0;
                  return (
                    <tr key={item.id} className={`border-b border-border/30 ${hasDiff ? 'bg-amber-50/50' : ''}`}>
                      <td className="px-3.5 py-2.5 font-semibold">{item.name}</td>
                      <td className="px-3.5 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {(item.tags || []).map((t: string) => (
                            <StatusTag key={t} variant={t === 'low-stock' ? 'red' : t === 'expiring' ? 'orange' : t === 'variance' ? 'yellow' : 'slate'}>
                              {t === 'low-stock' ? 'Low' : t === 'expiring' ? 'Expiring' : t === 'variance' ? 'Variance' : '$'}
                            </StatusTag>
                          ))}
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5"><Mono>{fmtN(item.systemQty)}</Mono></td>
                      <td className="px-3.5 py-2.5">
                        <input
                          type="number"
                          className={`w-20 text-right px-2 py-1.5 border rounded-md text-[13px] bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${hasDiff ? 'border-warning' : 'border-border'}`}
                          placeholder="Count…"
                          disabled={cycleSubmitted}
                          value={item.counted ?? ''}
                          onChange={e => setCycleItems(prev => (prev || computedCycle).map((it, i) => i === idx ? { ...it, counted: e.target.value === '' ? null : e.target.value } : it))}
                        />
                      </td>
                      <td className="px-3.5 py-2.5">
                        {diff !== null && (
                          <Mono className={`font-bold ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {diff > 0 ? '+' : ''}{diff}
                          </Mono>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5">
                        {hasDiff && (
                          <select
                            className="text-xs border border-border rounded-md px-2 py-1 bg-card"
                            value={item.reason || ''}
                            disabled={cycleSubmitted}
                            onChange={e => setCycleItems(prev => (prev || computedCycle).map((it, i) => i === idx ? { ...it, reason: e.target.value } : it))}
                          >
                            <option value="">Reason…</option>
                            {DISCREPANCY_REASONS.map(r => <option key={r}>{r}</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-2.5">
            <div className="bg-card border border-border rounded-lg p-3.5">
              <div className="font-bold text-sm mb-2">Variances</div>
              {computedCycle.filter(i => i.counted != null && i.counted !== '').length === 0
                ? <div className="text-xs text-muted-foreground">Enter counts to see variances</div>
                : computedCycle.map(item => {
                    const d = item.counted != null && item.counted !== '' ? parseFloat(String(fmtN(parseFloat(item.counted) - item.systemQty))) : null;
                    if (d === null || d === 0) return null;
                    return (
                      <div key={item.id} className="flex justify-between py-1.5 border-b border-border/30">
                        <span className="text-[13px] font-medium">{item.name}</span>
                        <Mono className={d > 0 ? 'text-green-600' : 'text-destructive'}>{d > 0 ? '+' : ''}{d} {item.unit}</Mono>
                      </div>
                    );
                  })}
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3.5">
              <div className="font-bold text-[13px] text-emerald-700 mb-2">What happens on submit</div>
              <ul className="text-xs text-emerald-700 leading-relaxed pl-4 list-disc">
                <li>Inventory totals updated</li>
                <li>Lots reconciled ({fefo ? 'FEFO' : 'FIFO'})</li>
                <li>Synthetic lot added for increases</li>
                <li>Variances feed calibration</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Lots Modal */}
      {lotsModal && (
        <LotsModal
          ingredient={lotsModal}
          lots={ingLots(lotsModal.id)}
          fefo={fefo}
          onClose={() => setLotsModal(null)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              This will also remove all lots and recipe links for this ingredient. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleteIngredient.isPending}>
              {deleteIngredient.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
