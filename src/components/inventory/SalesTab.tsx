import { useState, useRef, useCallback, useEffect } from 'react';
import { StatusTag, Mono, SectionHead } from './StatusTag';
import { Button } from '@/components/ui/button';
import type { Database } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { convertUnit } from '@/lib/inventory-utils';
import { usePOSConnections, useDisconnectPOS, useInitiatePOSOAuth } from '@/hooks/use-inventory-data';

type Sale = Database['public']['Tables']['sales']['Row'];
type Ingredient = Database['public']['Tables']['ingredients']['Row'];
type Lot = Database['public']['Tables']['lots']['Row'];

const POS_SYSTEMS = [
  { id: 'square' as const,     name: 'Square',     color: '#00A8E0', desc: 'Point of Sale & Payments' },
  { id: 'toast' as const,      name: 'Toast',      color: '#FF4C00', desc: 'Restaurant Management Platform' },
  { id: 'clover' as const,     name: 'Clover',     color: '#1DA462', desc: 'Smart POS System' },
  { id: 'lightspeed' as const, name: 'Lightspeed', color: '#FFC72C', desc: 'Retail & Restaurant POS' },
];

const HISTORY_PAGE_SIZE = 20;

const parseSalesCSV = (text: string) =>
  text.trim().split('\n').map(l => l.trim()).filter(Boolean).map(row => {
    const [item, qtyStr] = row.split(',').map(s => s.trim());
    const qty = parseInt(qtyStr);
    return (!item || isNaN(qty) || qty <= 0) ? null : { item, qty };
  }).filter(Boolean) as Array<{ item: string; qty: number }>;

interface RecipeWithIngredients {
  id: string;
  name: string;
  status: string;
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

interface SalesTabProps {
  sales: Sale[];
  recipes: RecipeWithIngredients[];
  flaggedSales: Sale[];
  fefo: boolean;
  ingredients: Ingredient[];
  lots: Lot[];
}

export const SalesTab = ({ sales, recipes, flaggedSales, fefo, ingredients, lots }: SalesTabProps) => {
  const [subTab, setSubTab] = useState<'record' | 'history' | 'pos'>('record');
  const [saleForm, setSaleForm] = useState({ item: '', qty: '1' });
  const [saleResult, setSaleResult] = useState<{ status: string; reason?: string | null } | null>(null);
  const [csvText, setCsvText] = useState('');
  const [csvResult, setCsvResult] = useState<{ err?: string; processed?: number; flagged?: number; total?: number } | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const saleTimer = useRef<NodeJS.Timeout | null>(null);
  const qc = useQueryClient();

  const { data: posConnections = [] } = usePOSConnections();
  const disconnectPOS = useDisconnectPOS();
  const initiatePOSOAuth = useInitiatePOSOAuth();

  // Always-current refs to avoid stale closures in async sale recording
  const ingredientsRef = useRef(ingredients);
  const lotsRef = useRef(lots);
  const fefoRef = useRef(fefo);
  useEffect(() => { ingredientsRef.current = ingredients; }, [ingredients]);
  useEffect(() => { lotsRef.current = lots; }, [lots]);
  useEffect(() => { fefoRef.current = fefo; }, [fefo]);

  // Check for ?pos_connected= or ?pos_error= in URL after OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('pos_connected');
    const error = params.get('pos_error');
    if (connected) {
      toast.success(`${connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully!`);
      qc.invalidateQueries({ queryKey: ['pos_connections'] });
      window.history.replaceState({}, '', window.location.pathname);
      setSubTab('pos');
    } else if (error) {
      toast.error(`POS connection failed: ${error.replace(/_/g, ' ')}`);
      window.history.replaceState({}, '', window.location.pathname);
      setSubTab('pos');
    }
  }, [qc]);

  const itemPopularity = (() => {
    const counts: Record<string, number> = {};
    sales.filter(s => s.status === 'processed').forEach(s => { counts[s.item] = (counts[s.item] || 0) + s.qty; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  })();

  const deductInventory = useCallback(async (recipe: RecipeWithIngredients, saleQty: number) => {
    const currentIngredients = ingredientsRef.current;
    const currentLots = lotsRef.current;
    const currentFefo = fefoRef.current;

    for (const ri of recipe.ingredients) {
      if (!ri.ingredient_id) continue;
      const ing = currentIngredients.find(i => i.id === ri.ingredient_id);
      if (!ing) continue;

      let deductQty = ri.qty * saleQty;
      if (ri.unit !== ing.unit) {
        const converted = convertUnit(deductQty, ri.unit, ing.unit);
        if (converted === null) continue;
        deductQty = converted;
      }

      const newStock = Math.max(0, ing.current_stock - deductQty);
      await supabase.from('ingredients').update({ current_stock: newStock }).eq('id', ing.id);

      let remaining = deductQty;
      const ingLots = currentLots
        .filter(l => l.ingredient_id === ing.id && l.quantity_remaining > 0)
        .sort((a, b) =>
          currentFefo && ing.is_perishable && a.expires_at && b.expires_at
            ? new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime()
            : new Date(a.received_at).getTime() - new Date(b.received_at).getTime()
        );

      for (const lot of ingLots) {
        if (remaining <= 0) break;
        const take = Math.min(lot.quantity_remaining, remaining);
        await supabase.from('lots').update({
          quantity_remaining: parseFloat((lot.quantity_remaining - take).toFixed(1))
        }).eq('id', lot.id);
        remaining -= take;
      }
    }

    qc.invalidateQueries({ queryKey: ['ingredients'] });
    qc.invalidateQueries({ queryKey: ['lots'] });
  }, [qc]);

  const recordSale = useCallback(async (itemName: string, qty: number, source = 'Manual') => {
    const recipe = recipes.find(r => r.name.toLowerCase() === itemName.toLowerCase());
    let status = 'flagged';
    let reason: string | null = null;
    if (!recipe) reason = 'Menu item not found';
    else if (recipe.status !== 'verified') reason = 'Recipe not verified';
    else status = 'processed';

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error('Not authenticated'); return { status: 'error', reason: 'Not authenticated' }; }

    const { error } = await supabase.from('sales').insert({ item: itemName, qty, status, reason, source, user_id: user.id });
    if (error) { toast.error('Failed to record sale'); return { status: 'error', reason: error.message }; }

    if (status === 'processed' && recipe) {
      await deductInventory(recipe, qty);
    }

    qc.invalidateQueries({ queryKey: ['sales'] });
    return { status, reason };
  }, [recipes, qc, deductInventory]);

  const doRecordSale = async () => {
    if (!saleForm.item.trim()) return;
    if (saleTimer.current) clearTimeout(saleTimer.current);
    const r = await recordSale(saleForm.item, parseInt(saleForm.qty) || 1);
    setSaleResult(r);
    saleTimer.current = setTimeout(() => setSaleResult(null), 4000);
    if (r.status === 'processed') toast.success(`${saleForm.item} ×${saleForm.qty} recorded — inventory updated`);
  };

  const importCSV = async () => {
    const rows = parseSalesCSV(csvText);
    if (!rows.length) { setCsvResult({ err: 'No valid rows. Format: item name,quantity' }); return; }
    let p = 0, f = 0;
    for (const { item, qty } of rows) {
      const r = await recordSale(item, qty, 'CSV');
      if (r.status === 'processed') p++; else f++;
    }
    setCsvResult({ processed: p, flagged: f, total: rows.length });
    setCsvText('');
    toast.success(`CSV: ${p} processed, ${f} flagged`);
  };

  const handleDisconnect = async (posType: string) => {
    setDisconnecting(posType);
    try {
      await disconnectPOS.mutateAsync(posType);
      toast.success(`${posType.charAt(0).toUpperCase() + posType.slice(1)} disconnected`);
    } catch {
      toast.error('Failed to disconnect');
    } finally {
      setDisconnecting(null);
    }
  };

  const handleConnect = (posType: 'square' | 'clover' | 'toast' | 'lightspeed') => {
    initiatePOSOAuth.mutate(posType, {
      onError: (err) => toast.error(`Could not start OAuth: ${err.message}`),
    });
  };

  const connectedCount = posConnections.filter(c => c.status === 'connected').length;

  return (
    <div className="animate-fade-up">
      <SectionHead title="Sales" sub="Record sales, import CSV, or sync your POS" />

      {/* Sub-tabs */}
      <div className="border-b border-border mb-4 flex gap-5">
        <button onClick={() => setSubTab('record')} className={`pb-2 text-[13px] font-semibold border-b-2 transition-colors ${subTab === 'record' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}>
          Record
        </button>
        <button onClick={() => setSubTab('history')} className={`pb-2 text-[13px] font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${subTab === 'history' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}>
          History
          {flaggedSales.length > 0 && <StatusTag variant="yellow">{flaggedSales.length} flagged</StatusTag>}
        </button>
        <button onClick={() => setSubTab('pos')} className={`pb-2 text-[13px] font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${subTab === 'pos' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}>
          POS
          {connectedCount > 0
            ? <StatusTag variant="green">{connectedCount} connected</StatusTag>
            : <StatusTag variant="slate">Not connected</StatusTag>}
        </button>
      </div>

      {/* RECORD */}
      {subTab === 'record' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="font-bold text-sm mb-3">Manual Entry</div>
            <div className="grid gap-2.5 mb-3">
              <div>
                <label className="block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Menu Item</label>
                <input
                  list="menu-dl"
                  className="w-full px-3 py-2 border border-border rounded-md text-[13px] bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="Type or select…"
                  value={saleForm.item}
                  onChange={e => setSaleForm(f => ({ ...f, item: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && doRecordSale()}
                />
                <datalist id="menu-dl">{recipes.map(r => <option key={r.id} value={r.name} />)}</datalist>
              </div>
              <div>
                <label className="block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Qty</label>
                <input
                  type="number"
                  min={1}
                  className="w-full px-3 py-2 border border-border rounded-md text-[13px] bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
                  value={saleForm.qty}
                  onChange={e => setSaleForm(f => ({ ...f, qty: e.target.value }))}
                />
              </div>
              <Button className="w-full" onClick={doRecordSale}>Record Sale</Button>
            </div>
            {saleResult && (
              <div className={`p-2.5 rounded-lg text-[13px] animate-fade-up ${saleResult.status === 'processed' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-amber-50 border border-amber-200 text-amber-700'}`}>
                {saleResult.status === 'processed' ? `✓ Ingredients deducted (${fefo ? 'FEFO' : 'FIFO'})` : `⚠ Flagged: ${saleResult.reason}`}
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <div className="font-bold text-sm mb-1">Import CSV</div>
            <div className="text-xs text-muted-foreground mb-2.5">One row per sale: <Mono>item name,quantity</Mono></div>
            <div className="bg-muted/50 rounded-md p-2 font-mono text-[11px] text-muted-foreground mb-2.5">
              Classic Burger,3{'\n'}Margherita Pizza,2
            </div>
            <textarea
              className="w-full px-3 py-2 border border-border rounded-md text-[13px] font-mono bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y mb-2.5"
              rows={4}
              placeholder={'Classic Burger,3\nMargherita Pizza,2'}
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
            />
            <Button className="w-full" disabled={!csvText.trim()} onClick={importCSV}>Import</Button>
            {csvResult && (
              <div className={`mt-2 p-2.5 rounded-lg text-[13px] ${csvResult.err ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-emerald-50 border border-emerald-200 text-emerald-700'}`}>
                {csvResult.err || `✓ ${csvResult.processed}/${csvResult.total} processed · ${csvResult.flagged} flagged`}
              </div>
            )}
          </div>

          {itemPopularity.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-4 md:col-span-2">
              <div className="font-bold text-sm mb-3 flex items-center gap-2">
                📈 Expected Top Sellers Today
                <StatusTag variant="blue">Based on sales history</StatusTag>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                {itemPopularity.slice(0, 5).map(([item, total], rank) => {
                  const maxQty = itemPopularity[0][1];
                  const pct = Math.round((total / maxQty) * 100);
                  const r = recipes.find(re => re.name === item);
                  return (
                    <div key={item} className="p-3 bg-muted/50 rounded-lg border border-border/50">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-semibold text-[13px]">{item}</span>
                        <span className="text-[11px] font-bold text-muted-foreground">#{rank + 1}</span>
                      </div>
                      <div className="h-1 bg-border rounded-full overflow-hidden mb-1.5">
                        <div className={`h-full rounded-full ${rank === 0 ? 'bg-primary' : rank === 1 ? 'bg-primary/70' : 'bg-primary/40'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-muted-foreground">{total} sold</span>
                        {r && <StatusTag variant={r.status === 'verified' ? 'green' : 'yellow'}>{r.status === 'verified' ? '✓' : 'Draft'}</StatusTag>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* HISTORY */}
      {subTab === 'history' && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30 flex justify-between items-center">
            <span className="font-bold text-sm">Sale History</span>
            <div className="flex gap-1.5">
              <StatusTag variant="green">{sales.filter(s => s.status === 'processed').length} processed</StatusTag>
              <StatusTag variant="yellow">{flaggedSales.length} flagged</StatusTag>
            </div>
          </div>
          {sales.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-[13px]">No sales recorded yet</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Item</th>
                      <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Qty</th>
                      <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Status</th>
                      <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Source</th>
                      <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.slice(0, historyPage * HISTORY_PAGE_SIZE).map(s => (
                      <tr key={s.id} className="border-b border-border/30 hover:bg-muted/30">
                        <td className="px-3.5 py-2.5 font-semibold">{s.item}</td>
                        <td className="px-3.5 py-2.5"><Mono>×{s.qty}</Mono></td>
                        <td className="px-3.5 py-2.5">
                          {s.status === 'flagged'
                            ? <StatusTag variant="yellow">⚠ {s.reason}</StatusTag>
                            : <StatusTag variant="green">✓ Processed</StatusTag>}
                        </td>
                        <td className="px-3.5 py-2.5"><StatusTag variant="slate">{s.source}</StatusTag></td>
                        <td className="px-3.5 py-2.5 text-xs text-muted-foreground">
                          {new Date(s.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {historyPage * HISTORY_PAGE_SIZE < sales.length && (
                <div className="px-4 py-3 border-t border-border/30 flex items-center justify-between text-[13px] text-muted-foreground">
                  <span>Showing {Math.min(historyPage * HISTORY_PAGE_SIZE, sales.length)} of {sales.length}</span>
                  <Button variant="outline" size="sm" onClick={() => setHistoryPage(p => p + 1)}>
                    Show more
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* POS INTEGRATION */}
      {subTab === 'pos' && (
        <div className="space-y-3.5">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="font-bold text-sm mb-1">Connect your POS system</div>
            <p className="text-xs text-muted-foreground mb-4">
              When connected, sales flow in automatically and inventory is deducted in real time.
              You'll need a live account with the provider and app credentials set in your Supabase environment.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {POS_SYSTEMS.map(pos => {
                const conn = posConnections.find(c => c.pos_type === pos.id);
                const isConnected = conn?.status === 'connected';
                const isError = conn?.status === 'error';
                const lastSync = conn?.last_sync_at
                  ? new Date(conn.last_sync_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                  : null;

                return (
                  <div
                    key={pos.id}
                    className={`flex items-start gap-3 p-3.5 rounded-lg border transition-colors ${
                      isConnected
                        ? 'border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-800'
                        : isError
                          ? 'border-red-200 bg-red-50/50 dark:bg-red-950/20'
                          : 'border-border bg-muted/30'
                    }`}
                  >
                    {/* Color dot */}
                    <div
                      className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-white font-bold text-[11px] mt-0.5"
                      style={{ background: pos.color }}
                    >
                      {pos.name.slice(0, 2).toUpperCase()}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-semibold text-[13px]">{pos.name}</span>
                        {isConnected && <StatusTag variant="green">Connected</StatusTag>}
                        {isError && <StatusTag variant="red">Error</StatusTag>}
                      </div>
                      <div className="text-[11px] text-muted-foreground mb-2">{pos.desc}</div>

                      {isConnected && conn?.merchant_id && (
                        <div className="text-[11px] text-muted-foreground mb-1.5">
                          Merchant: <Mono>{conn.merchant_id}</Mono>
                        </div>
                      )}
                      {isConnected && lastSync && (
                        <div className="text-[11px] text-muted-foreground mb-2">
                          Last sync: {lastSync}
                        </div>
                      )}
                      {isError && conn?.error_message && (
                        <div className="text-[11px] text-red-600 mb-2">{conn.error_message}</div>
                      )}

                      {isConnected ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-[12px] h-7 text-red-600 hover:text-red-700 hover:border-red-300"
                          disabled={disconnecting === pos.id}
                          onClick={() => handleDisconnect(pos.id)}
                        >
                          {disconnecting === pos.id ? 'Disconnecting…' : 'Disconnect'}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="text-[12px] h-7"
                          style={{ background: pos.color, color: pos.color === '#FFC72C' ? '#333' : 'white' }}
                          disabled={initiatePOSOAuth.isPending}
                          onClick={() => handleConnect(pos.id)}
                        >
                          Connect {pos.name}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Webhook setup info */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="font-semibold text-[13px] mb-1.5 flex items-center gap-2">
              🔗 Webhook endpoint
              <StatusTag variant="slate">For your POS dashboard</StatusTag>
            </div>
            <p className="text-xs text-muted-foreground mb-2.5">
              After connecting, configure your POS to send sale events to this URL so inventory updates in real time:
            </p>
            <div className="bg-muted/50 rounded-lg p-2.5 border border-border/50 font-mono text-[11px] break-all">
              {(import.meta.env.VITE_SUPABASE_URL as string) || 'https://[project].supabase.co'}/functions/v1/pos-webhook?provider=<span className="text-primary">square</span>
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              Replace <Mono>square</Mono> with the provider name. See Supabase Edge Function logs for webhook delivery status.
            </div>
          </div>

          {/* Manual API note */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="font-semibold text-[13px] mb-1.5">Custom / manual push</div>
            <div className="text-xs text-muted-foreground mb-2">
              If you use a custom ordering system, insert directly into the <Mono>sales</Mono> table:
            </div>
            <div className="bg-muted/50 rounded-lg p-2.5 border border-border/50 font-mono text-[11px]">
              supabase.from('sales').insert(&#123; item, qty, source, user_id &#125;)
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
