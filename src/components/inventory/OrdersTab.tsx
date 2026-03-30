import { useState } from 'react';
import { StatusTag, Mono } from './StatusTag';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { fmtDate, fmtN, diffDays, addDays } from '@/lib/inventory-utils';
import type { Database } from '@/integrations/supabase/types';
import { useCreateVendor, useUpdateVendor } from '@/hooks/use-inventory-data';
import { toast } from 'sonner';

type Ingredient = Database['public']['Tables']['ingredients']['Row'];
type Vendor = Database['public']['Tables']['vendors']['Row'];

const EMPTY_VENDOR_FORM = { name: '', email: '', phone: '', lead_time_days: '2', notes: '' };

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
  const [vendorForm, setVendorForm] = useState(EMPTY_VENDOR_FORM);
  const [editTarget, setEditTarget] = useState<Vendor | null>(null);
  const [showAddVendor, setShowAddVendor] = useState(false);
  const createVendor = useCreateVendor();
  const updateVendor = useUpdateVendor();
  const now = new Date();

  const openEditVendor = (v: Vendor) => {
    setEditTarget(v);
    setVendorForm({
      name: v.name,
      email: v.email ?? '',
      phone: v.phone ?? '',
      lead_time_days: String(v.lead_time_days ?? 2),
      notes: v.notes ?? '',
    });
  };

  const handleSaveVendor = async () => {
    const payload = {
      name: vendorForm.name.trim(),
      email: vendorForm.email.trim() || null,
      phone: vendorForm.phone.trim() || null,
      lead_time_days: Math.max(0, parseInt(vendorForm.lead_time_days) || 2),
      notes: vendorForm.notes.trim() || null,
    };
    if (!payload.name) { toast.error('Vendor name is required'); return; }
    try {
      if (editTarget) {
        await updateVendor.mutateAsync({ id: editTarget.id, updates: payload });
        toast.success('Vendor updated');
        setEditTarget(null);
      } else {
        await createVendor.mutateAsync(payload);
        toast.success('Vendor added');
        setShowAddVendor(false);
      }
      setVendorForm(EMPTY_VENDOR_FORM);
    } catch {
      toast.error('Failed to save vendor');
    }
  };

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
              onChange={e => {
                const v = Math.min(30, Math.max(1, parseInt(e.target.value) || 7));
                setTargetDays(v);
              }}
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
            <Button onClick={() => { setVendorForm(EMPTY_VENDOR_FORM); setShowAddVendor(true); }}>+ Add Vendor</Button>
          </div>
          {vendors.length === 0 ? (
            <div className="bg-card border border-dashed border-border rounded-lg p-8 text-center text-muted-foreground text-[13px]">
              No vendors yet — add your first supplier to start generating purchase orders
            </div>
          ) : (
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
                    <Button variant="outline" size="sm" onClick={() => openEditVendor(vm)}>Edit</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Vendor Dialog */}
      <Dialog
        open={showAddVendor || !!editTarget}
        onOpenChange={open => { if (!open) { setShowAddVendor(false); setEditTarget(null); setVendorForm(EMPTY_VENDOR_FORM); } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget ? `Edit ${editTarget.name}` : 'Add Vendor'}</DialogTitle>
            <DialogDescription>Supplier contact and ordering details</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {[
              { label: 'Name *', key: 'name', placeholder: 'Sysco', type: 'text' },
              { label: 'Email', key: 'email', placeholder: 'orders@sysco.com', type: 'email' },
              { label: 'Phone', key: 'phone', placeholder: '+1 555-555-5555', type: 'tel' },
              { label: 'Lead time (days)', key: 'lead_time_days', placeholder: '2', type: 'number' },
              { label: 'Notes', key: 'notes', placeholder: 'Cash & carry, no min order', type: 'text' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground mb-1">{f.label}</label>
                <input
                  type={f.type}
                  value={vendorForm[f.key as keyof typeof vendorForm]}
                  onChange={e => setVendorForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full px-3 py-2 border border-border rounded-md text-[13px] bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddVendor(false); setEditTarget(null); setVendorForm(EMPTY_VENDOR_FORM); }}>Cancel</Button>
            <Button onClick={handleSaveVendor} disabled={createVendor.isPending || updateVendor.isPending}>
              {createVendor.isPending || updateVendor.isPending ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Vendor'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
