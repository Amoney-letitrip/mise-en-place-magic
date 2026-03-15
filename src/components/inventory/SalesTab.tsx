import { useState, useRef, useCallback } from 'react';
import { StatusTag, Mono, SectionHead } from './StatusTag';
import { Button } from '@/components/ui/button';
import '@/lib/inventory-utils';
import type { Database } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

type Sale = Database['public']['Tables']['sales']['Row'];

const POS_SYSTEMS = [
  { id: 'square', name: 'Square', color: '#00A8E0', desc: 'Point of Sale & Payments' },
  { id: 'toast', name: 'Toast', color: '#FF4C00', desc: 'Restaurant Management Platform' },
  { id: 'clover', name: 'Clover', color: '#1DA462', desc: 'Smart POS System' },
  { id: 'lightspeed', name: 'Lightspeed', color: '#FFC72C', desc: 'Retail & Restaurant POS' },
  { id: 'revel', name: 'Revel', color: '#E63E36', desc: 'iPad POS System' },
];

const parseSalesCSV = (text: string) =>
  text.trim().split('\n').map(l => l.trim()).filter(Boolean).map(row => {
    const [item, qtyStr] = row.split(',').map(s => s.trim());
    const qty = parseInt(qtyStr);
    return (!item || isNaN(qty) || qty <= 0) ? null : { item, qty };
  }).filter(Boolean) as Array<{ item: string; qty: number }>;

interface SalesTabProps {
  sales: Sale[];
  recipes: Array<{ id: string; name: string; status: string }>;
  flaggedSales: Sale[];
  fefo: boolean;
}

export const SalesTab = ({ sales, recipes, flaggedSales, fefo }: SalesTabProps) => {
  const [subTab, setSubTab] = useState<'record' | 'history' | 'pos'>('record');
  const [saleForm, setSaleForm] = useState({ item: '', qty: '1' });
  const [saleResult, setSaleResult] = useState<{ status: string; reason?: string | null } | null>(null);
  const [csvText, setCsvText] = useState('');
  const [csvResult, setCsvResult] = useState<{ err?: string; processed?: number; flagged?: number; total?: number } | null>(null);
  const [connectedPOS, setConnectedPOS] = useState<Array<{ id: string; name: string }>>([]);
  const [posModal, setPosModal] = useState(false);
  const [posSetupStep, setPosSetupStep] = useState<'list' | 'configure' | 'done'>('list');
  const [posSelected, setPosSelected] = useState<typeof POS_SYSTEMS[0] | null>(null);
  const saleTimer = useRef<NodeJS.Timeout | null>(null);
  const qc = useQueryClient();

  const itemPopularity = (() => {
    const counts: Record<string, number> = {};
    sales.filter(s => s.status === 'processed').forEach(s => { counts[s.item] = (counts[s.item] || 0) + s.qty; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  })();

  const recordSale = useCallback(async (itemName: string, qty: number, source = 'Manual') => {
    const recipe = recipes.find(r => r.name.toLowerCase() === itemName.toLowerCase());
    let status = 'flagged';
    let reason: string | null = null;
    if (!recipe) reason = 'Menu item not found';
    else if (recipe.status !== 'verified') reason = 'Recipe not verified';
    else status = 'processed';

    const { error } = await supabase.from('sales').insert({ item: itemName, qty, status, reason, source });
    if (error) { toast.error('Failed to record sale'); return { status: 'error', reason: error.message }; }
    qc.invalidateQueries({ queryKey: ['sales'] });
    return { status, reason };
  }, [recipes, qc]);

  const doRecordSale = async () => {
    if (!saleForm.item.trim()) return;
    if (saleTimer.current) clearTimeout(saleTimer.current);
    const r = await recordSale(saleForm.item, parseInt(saleForm.qty) || 1);
    setSaleResult(r);
    saleTimer.current = setTimeout(() => setSaleResult(null), 4000);
    if (r.status === 'processed') toast.success(`${saleForm.item} ×${saleForm.qty} recorded`);
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

  return (
    <div className="animate-fade-up">
      <SectionHead title="Sales" sub="Record sales, import CSV, or sync your POS" />

      {/* Sub-tabs */}
      <div className="border-b border-border mb-4 flex gap-5">
        <button
          onClick={() => setSubTab('record')}
          className={`pb-2 text-[13px] font-semibold border-b-2 transition-colors ${subTab === 'record' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}
        >
          Record
        </button>
        <button
          onClick={() => setSubTab('history')}
          className={`pb-2 text-[13px] font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${subTab === 'history' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}
        >
          History
          {flaggedSales.length > 0 && <StatusTag variant="yellow">{flaggedSales.length} flagged</StatusTag>}
        </button>
        <button
          onClick={() => setSubTab('pos')}
          className={`pb-2 text-[13px] font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${subTab === 'pos' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}
        >
          POS Integration
          {connectedPOS.length > 0 ? <StatusTag variant="green">Connected</StatusTag> : <StatusTag variant="slate">Not set up</StatusTag>}
        </button>
      </div>

      {/* RECORD */}
      {subTab === 'record' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {/* Manual Entry */}
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

          {/* CSV Import */}
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

          {/* Expected Top Sellers */}
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
                {sales.slice(0, 20).map(s => (
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
        </div>
      )}

      {/* POS INTEGRATION */}
      {subTab === 'pos' && (
        <div>
          {connectedPOS.length === 0 && (
            <div className="bg-card border border-dashed border-muted-foreground/30 rounded-lg p-8 text-center mb-3.5">
              <div className="text-4xl mb-2.5">🔌</div>
              <div className="font-bold text-base mb-1">No POS connected</div>
              <div className="text-[13px] text-muted-foreground mb-4">Connect your point-of-sale system to automatically sync every sale into inventory tracking</div>
              <Button onClick={() => { setPosModal(true); setPosSetupStep('list'); }}>Connect a POS System</Button>
            </div>
          )}

          {connectedPOS.length > 0 && (
            <div className="mb-3.5">
              {connectedPOS.map(pos => {
                const info = POS_SYSTEMS.find(p => p.id === pos.id);
                return (
                  <div key={pos.id} className="bg-card border border-emerald-200 rounded-lg p-4 mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold font-mono" style={{ background: info?.color + '22', border: `1px solid ${info?.color}44`, color: info?.color }}>■</div>
                      <div>
                        <div className="font-bold text-sm">{pos.name}</div>
                        <div className="text-xs text-emerald-600 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block" />
                          Syncing sales live
                        </div>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => { setConnectedPOS(prev => prev.filter(c => c.id !== pos.id)); toast.success(`${pos.name} disconnected`); }}>Disconnect</Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-3.5">
            {POS_SYSTEMS.map(pos => {
              const connected = connectedPOS.some(c => c.id === pos.id);
              return (
                <div key={pos.id} className="bg-card border border-border rounded-lg p-3.5">
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-[34px] h-[34px] rounded-lg flex items-center justify-center text-xs font-bold font-mono" style={{ background: pos.color + '22', border: `1px solid ${pos.color}44`, color: pos.color }}>■</div>
                    <div>
                      <div className="font-bold text-[13px]">{pos.name}</div>
                      <div className="text-[11px] text-muted-foreground">{pos.desc}</div>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {connected ? (
                      <StatusTag variant="green">✓ Connected</StatusTag>
                    ) : (
                      <Button size="sm" onClick={() => {
                        setConnectedPOS(prev => [...prev, { id: pos.id, name: pos.name }]);
                        toast.success(`${pos.name} connected`);
                      }}>Connect</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <div className="font-semibold text-[13px] mb-1.5">Manual API / Webhook</div>
            <div className="text-xs text-muted-foreground mb-2">Point any system to our endpoint</div>
            <div className="flex gap-2 items-center bg-muted/50 rounded-lg p-2.5 border border-border/50">
              <code className="flex-1 text-[11px] font-mono text-foreground">POST https://yourdomain.com/api/sales</code>
              <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText('https://yourdomain.com/api/sales'); toast.success('Webhook URL copied'); }}>Copy</Button>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground font-mono">
              Headers: x-api-key · Body: {'{ menuItemName, quantity, timestamp }'}
            </div>
          </div>
        </div>
      )}

      {/* POS Modal */}
      {posModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[200] p-4" onClick={() => setPosModal(false)}>
          <div className="bg-card border border-border rounded-lg w-full max-w-[500px] animate-fade-up overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border/30 flex justify-between items-center">
              <span className="font-bold text-base">Connect POS System</span>
              <button onClick={() => setPosModal(false)} className="text-muted-foreground hover:text-foreground text-lg">×</button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-2.5">
              {POS_SYSTEMS.filter(p => !connectedPOS.find(c => c.id === p.id)).map(pos => (
                <button
                  key={pos.id}
                  onClick={() => {
                    setConnectedPOS(prev => [...prev, { id: pos.id, name: pos.name }]);
                    toast.success(`${pos.name} connected`);
                    setPosModal(false);
                  }}
                  className="p-4 border border-border rounded-lg hover:border-primary/50 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold font-mono mb-2" style={{ background: pos.color + '22', border: `1px solid ${pos.color}44`, color: pos.color }}>■</div>
                  <div className="font-bold text-[13px]">{pos.name}</div>
                  <div className="text-[11px] text-muted-foreground">{pos.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
