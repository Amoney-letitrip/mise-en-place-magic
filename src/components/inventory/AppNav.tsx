import { StatusTag } from './StatusTag';
import type { TabId } from '@/lib/types';

interface NavItem {
  id: TabId;
  label: string;
  badge?: number | null;
}

interface AppNavProps {
  tab: TabId;
  setTab: (tab: TabId) => void;
  fefo: boolean;
  setFefo: (v: boolean) => void;
  navItems: NavItem[];
}

export const AppNav = ({ tab, setTab, fefo, setFefo, navItems }: AppNavProps) => (
  <nav className="sticky top-0 z-50 bg-card/95 backdrop-blur-md border-b border-border shadow-sm">
    <div className="max-w-content mx-auto px-4 flex items-center h-[52px] gap-0.5">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-5 flex-shrink-0">
        <div className="w-[30px] h-[30px] bg-primary rounded-lg flex items-center justify-center text-base">🍽</div>
        <span className="font-extrabold text-[15px] text-foreground tracking-tight">Mise en Place</span>
      </div>

      {/* Nav tabs */}
      <div className="flex gap-0.5 flex-1 overflow-x-auto">
        {navItems.map(n => (
          <button
            key={n.id}
            onClick={() => setTab(n.id)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-semibold rounded-lg transition-all whitespace-nowrap ${
              tab === n.id
                ? 'text-primary bg-primary/10'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {n.label}
            {n.badge ? (
              <span className={`min-w-[16px] h-4 rounded-full text-[10px] font-bold inline-flex items-center justify-center px-1 ${
                tab === n.id ? 'bg-primary/20 text-primary' : 'bg-red-100 text-red-700'
              }`}>
                {n.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2 ml-2 flex-shrink-0">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
          <input type="checkbox" checked={fefo} onChange={e => setFefo(e.target.checked)} className="accent-primary" />
          FEFO
        </label>
        <div className="w-[30px] h-[30px] bg-primary rounded-full flex items-center justify-center font-bold text-xs text-primary-foreground">M</div>
      </div>
    </div>
  </nav>
);
