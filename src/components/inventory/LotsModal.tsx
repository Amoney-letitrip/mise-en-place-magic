import { FreshBadge, Mono, StatusTag } from './StatusTag';
import { fmtDate, fmtN } from '@/lib/inventory-utils';
import type { Database } from '@/integrations/supabase/types';

type Ingredient = Database['public']['Tables']['ingredients']['Row'];
type Lot = Database['public']['Tables']['lots']['Row'];

interface LotsModalProps {
  ingredient: Ingredient;
  lots: Lot[];
  fefo: boolean;
  onClose: () => void;
}

export const LotsModal = ({ ingredient, lots, fefo, onClose }: LotsModalProps) => (
  <div className="fixed inset-0 bg-foreground/50 flex items-center justify-center z-[200] p-4" onClick={onClose}>
    <div className="bg-card border border-border rounded-lg w-full max-w-lg animate-fade-up overflow-hidden" onClick={e => e.stopPropagation()}>
      <div className="px-4 py-3 border-b border-border flex justify-between items-center">
        <div className="font-bold text-sm">{ingredient.name} — Lots ({fefo ? 'FEFO' : 'FIFO'})</div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">×</button>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-muted/50">
            <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Lot</th>
            <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Received</th>
            <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Expires</th>
            <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Remaining</th>
            <th className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {lots.map(lot => (
            <tr key={lot.id} className="border-b border-border/30">
              <td className="px-3.5 py-2.5"><Mono className="text-muted-foreground">{lot.lot_label}</Mono></td>
              <td className="px-3.5 py-2.5 text-xs">{fmtDate(lot.received_at)}</td>
              <td className="px-3.5 py-2.5 text-xs">{lot.expires_at ? fmtDate(lot.expires_at) : '—'}</td>
              <td className="px-3.5 py-2.5">
                <Mono className={lot.quantity_remaining === 0 ? 'text-muted-foreground/40' : ''}>
                  {fmtN(lot.quantity_remaining)} {ingredient.unit}
                </Mono>
              </td>
              <td className="px-3.5 py-2.5">
                {lot.expires_at ? <FreshBadge expiresAt={lot.expires_at} /> : <StatusTag variant="gray">No expiry</StatusTag>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3.5 py-2.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
        {fefo ? '🔄 FEFO: soonest-expiring lot depleted first' : '🔄 FIFO: oldest-received lot depleted first'}
      </div>
    </div>
  </div>
);
