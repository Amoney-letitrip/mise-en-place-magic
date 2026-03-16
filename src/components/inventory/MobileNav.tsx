import type { TabId } from '@/lib/types';

interface NavItem {
  id: TabId;
  label: string;
  icon: string;
  badge?: number | null;
}

interface MobileNavProps {
  tab: TabId;
  setTab: (tab: TabId) => void;
  navItems: Array<{ id: TabId; label: string; badge?: number | null }>;
}

const ICONS: Record<TabId, string> = {
  dashboard: '📊',
  inventory: '📦',
  orders: '🛒',
  sales: '💰',
  recipes: '📋',
  costs: '📈',
};

export const MobileNav = ({ tab, setTab, navItems }: MobileNavProps) => (
  <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-t border-border shadow-[0_-2px_10px_rgba(0,0,0,0.06)] md:hidden">
    <div className="flex justify-around items-center h-[60px] px-1 safe-bottom">
      {navItems.map(n => (
        <button
          key={n.id}
          onClick={() => setTab(n.id)}
          className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors relative min-w-[48px] ${
            tab === n.id
              ? 'text-primary'
              : 'text-muted-foreground'
          }`}
        >
          <span className="text-lg leading-none">{ICONS[n.id]}</span>
          <span className="text-[10px] font-semibold leading-none">{n.label}</span>
          {n.badge ? (
            <span className="absolute -top-0.5 right-0 min-w-[14px] h-[14px] rounded-full text-[9px] font-bold inline-flex items-center justify-center px-0.5 bg-destructive text-destructive-foreground">
              {n.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  </nav>
);
