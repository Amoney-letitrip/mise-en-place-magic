import { StatusTag } from './StatusTag';
import { fmtDate } from '@/lib/inventory-utils';
import type { TabId } from '@/lib/types';
import type { Database } from '@/integrations/supabase/types';

type Ingredient = Database['public']['Tables']['ingredients']['Row'];
type Lot = Database['public']['Tables']['lots']['Row'];

interface DashboardTabProps {
  ingredients: Ingredient[];
  orderDraft: Array<{ vendor: string; anyDue: boolean }>;
  stockoutRisk: Ingredient[];
  expiredLots: Lot[];
  expiringLots: Lot[];
  suggestions: Array<{ icon: string; text: string; tab: TabId }>;
  fefo: boolean;
  setTab: (tab: TabId) => void;
  restaurantName?: string | null;
  sales: Array<{ id: string }>;
}

export const DashboardTab = ({
  orderDraft, stockoutRisk, expiredLots, expiringLots,
  suggestions, fefo, setTab, restaurantName,
}: DashboardTabProps) => {
  const now = new Date();
  const dueOrders = orderDraft.filter(v => v.anyDue);

  return (
    <div className="animate-fade-up">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Good morning 👋</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">{fmtDate(now)} · {fefo ? 'FEFO' : 'FIFO'} lot mode</p>
        </div>
      </div>

      {/* 3 action cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <button
          onClick={() => setTab('orders')}
          className={`bg-card border rounded-lg p-4 text-left transition-colors hover:border-primary/50 ${dueOrders.length ? 'bg-blue-50/50 border-blue-200' : 'border-border'}`}
        >
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground mb-2">📦 Orders Due</div>
          <div className={`text-4xl font-extrabold leading-none mb-1 ${dueOrders.length ? 'text-primary' : 'text-muted-foreground/30'}`}>{dueOrders.length}</div>
          <div className="text-xs text-muted-foreground">vendor order{dueOrders.length !== 1 ? 's' : ''} due today</div>
        </button>

        <button
          onClick={() => setTab('orders')}
          className={`bg-card border rounded-lg p-4 text-left transition-colors hover:border-primary/50 ${stockoutRisk.length ? 'bg-red-50/50 border-red-200' : 'border-border'}`}
        >
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground mb-2">⚠ Stockout Risk</div>
          <div className={`text-4xl font-extrabold leading-none mb-1 ${stockoutRisk.length ? 'text-destructive' : 'text-muted-foreground/30'}`}>{stockoutRisk.length}</div>
          <div className="text-xs text-muted-foreground">{stockoutRisk.length ? (stockoutRisk.length <= 3 ? stockoutRisk.map(i => i.name).join(', ') : `${stockoutRisk.slice(0, 3).map(i => i.name).join(', ')} +${stockoutRisk.length - 3} more`) : 'All good'}</div>
        </button>

        <button
          onClick={() => setTab('inventory')}
          className={`bg-card border rounded-lg p-4 text-left transition-colors hover:border-primary/50 ${(expiredLots.length + expiringLots.length) ? 'bg-orange-50/50 border-orange-200' : 'border-border'}`}
        >
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground mb-2">🧊 Freshness Alerts</div>
          <div className={`text-4xl font-extrabold leading-none mb-1 ${(expiredLots.length + expiringLots.length) ? 'text-orange' : 'text-muted-foreground/30'}`}>
            {expiredLots.length + expiringLots.length}
          </div>
          <div className="text-xs text-muted-foreground">{expiredLots.length} expired · {expiringLots.length} expiring soon</div>
        </button>
      </div>

      {/* Action List */}
      <div className="bg-card border border-border rounded-lg p-4 mb-4">
        <div className="font-bold text-sm mb-2.5 flex items-center gap-2">
          🤖 Today's Action List
          {suggestions.length > 0 && <StatusTag variant="blue">{suggestions.length}</StatusTag>}
        </div>
        {suggestions.length === 0 ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-5 text-center">
            <div className="text-2xl mb-1.5">✅</div>
            <div className="font-bold text-emerald-700 text-sm">All clear — no action items right now</div>
            <div className="text-xs text-emerald-600 mt-0.5">Your restaurant is running smoothly</div>
          </div>
        ) : (
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => setTab(s.tab)}
                className="flex items-start gap-2.5 px-3 py-2.5 bg-muted/50 rounded-lg border border-border/50 w-full text-left hover:bg-muted transition-colors"
              >
                <span className="text-base flex-shrink-0">{s.icon}</span>
                <span className="text-[13px] text-foreground flex-1 leading-snug">{s.text}</span>
                <span className="text-muted-foreground text-xs">→</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
