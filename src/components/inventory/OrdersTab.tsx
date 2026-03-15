import { useState } from 'react';
import { StatusTag, Mono, SectionHead } from './StatusTag';
import { Button } from '@/components/ui/button';
import { fmtDate, fmtN, diffDays, addDays } from '@/lib/inventory-utils';
import type { Database } from '@/integrations/supabase/types';

type Ingredient = Database['public']['Tables']['ingredients']['Row'];
type Vendor = Database['public']['Tables']['vendors']['Row'];

interface OrderVendor {
  vendor: string;
  items: Array<Ingredient & { adu: number; daysLeft: number; stockoutDate: Date | null; orderByDate: Date | null; recommendedQty: number; orderDue: boolean }>;
  anyDue: boolean;
}

interface OrdersTabProps {
  orderDraft: OrderVendor[];
  vendors: Vendor[];
  forecasts: Record<string, any>;
  targetDays: number;
  setTargetDays: (d: number) => void;
}

const buildMailto = (ve: OrderVendor, vendors: Vendor[]) => {
  const vm = vendors.find(v => v.name === ve.vendor);
  if (!vm?.email) return null;
  const now = new Date();
  const lines = ve.items.map(i => `  - ${i.name}: ${i.recommendedQty} ${i.unit}`).join('\n');
  const sub = encodeURIComponent(`Purchase Order — ${fmtDate(now)}`);
  const body = encodeURIComponent(`Hi ${ve.vendor},\n\nPlease process this order:\n\n${lines}\n\nDelivery needed by: ${addDays(now, (vm.lead_time_days ?? 2) + 1).toLocaleDateString()}\n\nThanks`);
  return `mailto:${vm.email}?subject=${sub}&body=${body}`;
};

export const OrdersTab = ({ orderDraft, vendors, forecasts, targetDays, setTargetDays }: OrdersTabProps) => {
  const [subTab, setSubTab] = useState<'orders' | 'vendors'>('orders');
  const now = new Date();

  return (
    <div className="animate-fade-up">
      <div className="flex justify-between items-end mb-0">
        <div>
          <h1 className="text-xl font-bold text-foreground">
            {subTab === 'orders' ? 'Order Draft' : 'Vendors'}
          </h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {subTab === 'orders'
              ? `Auto-generated purchase orders · ${targetDays}-day stock target`
              : 'Supplier contacts and delivery settings'}
          </p>
        </div>
        {subTab === 'orders' && (
          <label className="text-[13px] text-muted-foreground flex items-center gap-1.5">
            Stock target:
            <input
              type="number"
              min={1}
              max={30}
              value={targetDays}
              onChange={e => setTargetDays(Number(e.target.value) || 7)}
              className="w-[55px] text-center py-1 px-2 border border-border rounded-md text-[13px] bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            days
          </label>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="border-b border-border mb-4 mt-3 flex gap-5">
        <button
          onClick={() => setSubTab('orders')}
          className={`pb-2 text-[13px] font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${subTab === 'orders' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}
        >
          Purchase Orders
          {orderDraft.filter(v => v.anyDue).length > 0 && (
            <StatusTag variant="red">{orderDraft.filter(v => v.anyDue).length} due</StatusTag>
          )}
        </button>
        <button
          onClick={() => setSubTab('vendors')}
          className={`pb-2 text-[13px] font-semibold border-b-2 transition-colors ${subTab === 'vendors' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}
        >
          Vendors
        </button>
      </div>

      {/* ORDERS */}
      {subTab === 'orders' && (
        orderDraft.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-10 text-center">
            <div className="text-4xl mb-2">✅</div>
            <div className="text-[15px] font-semibold text-foreground">All vendors stocked</div>
            <div className="text-[13px] text-muted-foreground mt-1">No orders needed at current usage for {targetDays} days</div>
          </div>
        ) : (
          <div className="grid gap-3">
            {orderDraft.map(ve => {
              const vm = vendors.find(v => v.name === ve.vendor);
              const mailto = buildMailto(ve, vendors);
              return (
                <div key={ve.vendor} className={`bg-card border rounded-lg overflow-hidden ${ve.anyDue ? 'border-blue-200' : 'border-border'}`}>
                  <div className={`px-4 py-3 border-b border-border/30 flex justify-between items-center ${ve.anyDue ? 'bg-blue-50/50' : 'bg-muted/30'}`}>
                    <div>
                      <div className="font-bold text-sm flex items-center gap-2">
                        {ve.vendor}
                        {ve.anyDue && <StatusTag variant="red">Due today</StatusTag>}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {vm?.email || 'No email'} · Lead time {vm?.lead_time_days ?? 2}d · {vm?.notes || ''}
                      </div>
                    </div>
                    {mailto ? (
                      <a href={mailto} target="_blank" rel="noreferrer">
                        <Button>📧 Send PO Email</Button>
                      </a>
                    ) : (
                      <Button variant="outline" disabled>No email on file</Button>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Ingredient</th>
                          <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Current</th>
                          <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Daily Use</th>
                          <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Days Left</th>
                          <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Stockout</th>
                          <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Order By</th>
                          <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Order Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ve.items.map(item => {
                          const fc = forecasts[item.id];
                          return (
                            <tr key={item.id} className="border-b border-border/30 hover:bg-muted/30">
                              <td className="px-3.5 py-2.5 font-semibold">{item.name}</td>
                              <td className="px-3.5 py-2.5">
                                <Mono className={item.current_stock <= item.threshold ? 'text-destructive' : ''}>{fmtN(item.current_stock)} {item.unit}</Mono>
                              </td>
                              <td className="px-3.5 py-2.5">
                                <Mono className="text-muted-foreground">{fc?.adu > 0 ? `${fmtN(fc.adu)}/d` : '—'}</Mono>
                              </td>
                              <td className="px-3.5 py-2.5">
                                <StatusTag variant={fc?.daysLeft <= (vm?.lead_time_days ?? 2) ? 'red' : fc?.daysLeft <= 5 ? 'yellow' : 'green'}>
                                  {fc?.daysLeft === Infinity ? '∞' : `${Math.round(fc?.daysLeft ?? 0)}d`}
                                </StatusTag>
                              </td>
                              <td className="px-3.5 py-2.5 text-xs text-muted-foreground">
                                {fc?.stockoutDate ? fmtDate(fc.stockoutDate) : '—'}
                              </td>
                              <td className="px-3.5 py-2.5">
                                {fc?.orderByDate ? (
                                  <StatusTag variant={diffDays(fc.orderByDate, now) <= 0 ? 'red' : 'gray'}>
                                    {diffDays(fc.orderByDate, now) <= 0 ? 'Today!' : fmtDate(fc.orderByDate)}
                                  </StatusTag>
                                ) : <span className="text-xs text-muted-foreground/40">—</span>}
                              </td>
                              <td className="px-3.5 py-2.5">
                                <Mono className="font-bold">{fmtN(fc?.recommendedQty ?? 0)} {item.unit}</Mono>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* VENDORS */}
      {subTab === 'vendors' && (
        <div>
          <div className="flex justify-between items-center mb-3.5">
            <div className="text-[13px] text-muted-foreground">Manage supplier contacts, lead times, and delivery windows</div>
            <Button>+ Add Vendor</Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {vendors.map(vm => (
              <div key={vm.id} className="bg-card border border-border rounded-lg p-4">
                <div className="font-bold text-[15px] mb-2.5">{vm.name}</div>
                <div className="grid gap-1.5 mb-3">
                  {vm.email && (
                    <div className="flex gap-1.5 items-center text-[13px]">
                      📧 <a href={`mailto:${vm.email}`} className="text-primary hover:underline">{vm.email}</a>
                    </div>
                  )}
                  {vm.phone && (
                    <div className="flex gap-1.5 items-center text-[13px] font-mono text-foreground">📞 {vm.phone}</div>
                  )}
                  <div className="flex gap-1.5 items-center text-xs text-muted-foreground">⏱ {vm.lead_time_days}d lead time</div>
                  {vm.notes && (
                    <div className="text-xs text-muted-foreground border-t border-border/30 pt-1.5 italic">{vm.notes}</div>
                  )}
                </div>
                <div className="flex gap-1.5">
                  {vm.email && (
                    <a href={`mailto:${vm.email}`}>
                      <Button variant="outline" size="sm">📧 Email</Button>
                    </a>
                  )}
                  <Button variant="outline" size="sm">Edit</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
