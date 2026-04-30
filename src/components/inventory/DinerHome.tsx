import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeDollarSign,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  LineChart,
  Package,
  ShoppingCart,
  Snowflake,
  type LucideIcon,
} from 'lucide-react';
import type { TabId } from '@/lib/types';
import { useIsMobile } from '@/hooks/use-mobile';

interface DinerHomeProps {
  setTab: (tab: TabId) => void;
  restaurantName?: string | null;
  lowItems: number;
  stockoutRisk: number;
  expiredLots: number;
  expiringLots: number;
  flaggedSales: number;
  draftRecipes: number;
  ordersDue: number;
  totalSales: number;
}

interface StationConfig {
  id: TabId;
  label: string;
  zone: string;
  action: string;
  top: string;
  left: string;
  mobileBg: string;
  color: string;
  count?: number;
  isUrgent: boolean;
  icon: LucideIcon;
}

const getStatusColor = (count: number, warnAt: number) => {
  if (count === 0) return '#27AE60';
  if (count <= warnAt) return '#F1C40F';
  return '#E74C3C';
};

export const DinerHome = ({
  setTab,
  restaurantName,
  lowItems,
  stockoutRisk,
  expiredLots,
  expiringLots,
  flaggedSales,
  draftRecipes,
  ordersDue,
  totalSales,
}: DinerHomeProps) => {
  const isMobile = useIsMobile();
  const freshnessCount = expiredLots + expiringLots;
  const freshnessColor = expiredLots > 0 ? '#E74C3C' : '#E67E22';
  const activeTotal = lowItems + flaggedSales + draftRecipes + ordersDue + freshnessCount;

  const stations: StationConfig[] = useMemo(() => [
    {
      id: 'sales',
      label: 'Sales',
      zone: 'Register',
      action: flaggedSales > 0 ? 'Review flagged tickets before stock moves.' : `${totalSales} sales logged.`,
      top: '13%',
      left: '63%',
      mobileBg: '62% 12%',
      color: getStatusColor(flaggedSales, 3),
      count: flaggedSales || undefined,
      isUrgent: flaggedSales > 3,
      icon: BadgeDollarSign,
    },
    {
      id: 'recipes',
      label: 'Recipes',
      zone: 'Prep Rail',
      action: draftRecipes > 0 ? 'Verify draft recipes so inventory can track portions.' : 'Recipe book is ready.',
      top: '48%',
      left: '48%',
      mobileBg: '46% 50%',
      color: getStatusColor(draftRecipes, 2),
      count: draftRecipes || undefined,
      isUrgent: draftRecipes > 2,
      icon: ClipboardList,
    },
    {
      id: 'inventory',
      label: 'Inventory',
      zone: 'Walk-In',
      action: lowItems > 0 ? 'Count low stock and check lots before service.' : 'Stock levels are clear.',
      top: '44%',
      left: '73%',
      mobileBg: '73% 44%',
      color: getStatusColor(lowItems, 3),
      count: lowItems || undefined,
      isUrgent: lowItems > 3,
      icon: Package,
    },
    {
      id: 'overview',
      label: 'Overview',
      zone: 'Manager Desk',
      action: activeTotal > 0 ? 'Start with the shift overview and clear the queue.' : 'The floor is quiet.',
      top: '49%',
      left: '87%',
      mobileBg: '88% 50%',
      color: getStatusColor(activeTotal, 5),
      count: activeTotal || undefined,
      isUrgent: activeTotal > 5,
      icon: BarChart3,
    },
    {
      id: 'orders',
      label: 'Orders',
      zone: 'Back Door',
      action: ordersDue > 0 ? 'Build purchase orders before the next delivery window.' : 'No orders are due.',
      top: '63%',
      left: '61%',
      mobileBg: '60% 64%',
      color: getStatusColor(ordersDue, 1),
      count: ordersDue || undefined,
      isUrgent: ordersDue > 1,
      icon: ShoppingCart,
    },
    {
      id: 'costs',
      label: 'Costs',
      zone: 'Cost Board',
      action: 'Check recipe margin and inventory value.',
      top: '24%',
      left: '80%',
      mobileBg: '80% 24%',
      color: '#27AE60',
      isUrgent: false,
      icon: LineChart,
    },
  ], [activeTotal, draftRecipes, flaggedSales, lowItems, ordersDue, totalSales]);

  const [activeStationId, setActiveStationId] = useState<TabId>('overview');
  const activeStation = stations.find((station) => station.id === activeStationId) ?? stations[0];
  const ActiveIcon = activeStation.icon;

  const statusItems = [
    { label: 'Stock', count: lowItems, color: getStatusColor(lowItems, 3) },
    { label: 'Sales', count: flaggedSales, color: getStatusColor(flaggedSales, 3) },
    { label: 'Recipes', count: draftRecipes, color: getStatusColor(draftRecipes, 2) },
    { label: 'Orders', count: ordersDue, color: getStatusColor(ordersDue, 1) },
    { label: 'Freshness', count: freshnessCount, color: freshnessCount === 0 ? '#27AE60' : freshnessCount <= 2 ? '#E67E22' : '#E74C3C' },
  ];

  const updateActive = (id: TabId) => setActiveStationId(id);

  if (isMobile) {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#151010' }}>
        <div className="px-5 pt-12 pb-4">
          <p className="text-white/50 text-sm mb-0.5">{greeting}</p>
          {restaurantName && <h1 className="text-2xl font-extrabold text-white">{restaurantName}</h1>}
        </div>

        <div className="px-4 pb-4">
          <div className="relative overflow-hidden rounded-[22px] border border-white/10 bg-black/25">
            <img src="/diner-home.png" alt="" className="w-full h-auto opacity-90" draggable={false} />
            <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
              <div className="flex items-center gap-2 text-white">
                <ActiveIcon className="h-4 w-4 shrink-0" style={{ color: activeStation.color }} />
                <div className="min-w-0">
                  <p className="text-[11px] uppercase text-white/50">{activeStation.zone}</p>
                  <p className="text-sm font-bold truncate">{activeStation.action}</p>
                </div>
              </div>
            </div>

            {stations.map((station) => (
              <button
                key={station.id}
                onClick={() => setTab(station.id)}
                onFocus={() => updateActive(station.id)}
                onPointerEnter={() => updateActive(station.id)}
                className="absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60 bg-black/45 shadow-lg backdrop-blur-sm active:scale-95"
                style={{ top: station.top, left: station.left }}
                aria-label={`Open ${station.label}${station.count ? ` with ${station.count} alerts` : ''}`}
              >
                <span className="absolute inset-1 rounded-full" style={{ background: station.color }} />
                {station.count != null && station.count > 0 && (
                  <span
                    className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[10px] font-black"
                    style={{ color: station.color }}
                  >
                    {station.count > 99 ? '99' : station.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 px-4 pb-6 grid grid-cols-2 gap-3">
          {stations.map((station) => {
            const Icon = station.icon;
            const isActive = station.id === activeStation.id;
            return (
              <button
                key={station.id}
                onClick={() => setTab(station.id)}
                onFocus={() => updateActive(station.id)}
                onPointerEnter={() => updateActive(station.id)}
                className="flex flex-col items-start p-4 rounded-2xl text-left active:scale-95 transition-transform"
                style={{
                  backgroundColor: isActive ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)',
                  backgroundImage: `linear-gradient(135deg, rgba(12,8,7,${isActive ? 0.58 : 0.74}), rgba(12,8,7,${isActive ? 0.36 : 0.58})), url("/diner-home.png")`,
                  backgroundSize: '100% 100%, 360%',
                  backgroundPosition: `center, ${station.mobileBg}`,
                  backgroundRepeat: 'no-repeat',
                  border: `1px solid ${isActive ? station.color : 'rgba(255,255,255,0.1)'}`,
                  boxShadow: isActive ? `0 0 0 1px ${station.color}30 inset` : '0 0 0 1px rgba(255,255,255,0.02) inset',
                }}
              >
                <div className="flex items-center justify-between w-full mb-3">
                  <Icon className="h-5 w-5" style={{ color: station.color }} />
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: station.color }} />
                </div>
                <span className="text-white font-bold text-[15px]">{station.label}</span>
                <span className="text-xs text-white/40 mt-0.5">{station.zone}</span>
                {station.count != null && station.count > 0 ? (
                  <span className="text-xs mt-1 font-semibold" style={{ color: station.color }}>
                    {station.count} alert{station.count !== 1 ? 's' : ''}
                  </span>
                ) : (
                  <span className="text-xs text-white/35 mt-1">All clear</span>
                )}
              </button>
            );
          })}
        </div>

        <div
          className="flex items-center justify-around px-4 py-3"
          style={{ background: 'rgba(0,0,0,0.5)', borderTop: '1px solid rgba(255,255,255,0.08)' }}
        >
          {statusItems.map((item) => (
            <div key={item.label} className="flex flex-col items-center gap-0.5">
              <span className="rounded-full inline-block" style={{ width: '8px', height: '8px', background: item.color }} />
              <span className="text-[10px] text-white/50">{item.label}</span>
              <span className="text-[11px] font-bold text-white">{item.count === 0 ? 'OK' : item.count}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-hidden" style={{ background: '#151010' }}>
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1500px] items-center justify-center px-4 py-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.08),transparent_42%)]" />
        <div className="relative w-full overflow-hidden rounded-[28px] border border-white/10 bg-black shadow-2xl">
          <img src="/diner-home.png" alt="" className="block w-full h-auto select-none" draggable={false} />

          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.64)_0%,rgba(0,0,0,0.06)_38%,rgba(0,0,0,0.16)_100%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.48)_0%,transparent_34%,rgba(0,0,0,0.72)_100%)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/30" />

          <div className="absolute left-6 top-6 w-[320px] rounded-2xl border border-white/12 bg-black/55 p-5 text-white shadow-2xl backdrop-blur-md">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-white/45">Shift Board</p>
            <h1 className="mt-1 text-2xl font-black leading-tight">{restaurantName || 'Mise en Place'}</h1>

            <div className="mt-5 flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-white/10">
                <ActiveIcon className="h-6 w-6" style={{ color: activeStation.color }} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-white/45">{activeStation.zone}</p>
                <p className="text-lg font-black leading-tight">{activeStation.label}</p>
                <p className="mt-1 text-sm leading-snug text-white/70">{activeStation.action}</p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2">
                <p className="text-[10px] font-bold uppercase text-white/40">Alerts</p>
                <p className="text-xl font-black">{activeStation.count || 0}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2">
                <p className="text-[10px] font-bold uppercase text-white/40">Risk</p>
                <p className="text-xl font-black">{stockoutRisk}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2">
                <p className="text-[10px] font-bold uppercase text-white/40">Sales</p>
                <p className="text-xl font-black">{totalSales}</p>
              </div>
            </div>

            <button
              onClick={() => setTab(activeStation.id)}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black text-white transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-white/70"
              style={{ background: activeStation.color }}
            >
              <ActiveIcon className="h-4 w-4" />
              Open {activeStation.label}
            </button>
          </div>

          {stations.map((station) => {
            const Icon = station.icon;
            const isActive = station.id === activeStation.id;
            const hasAlert = station.count != null && station.count > 0;
            return (
              <button
                key={station.id}
                onClick={() => setTab(station.id)}
                onFocus={() => updateActive(station.id)}
                onPointerEnter={() => updateActive(station.id)}
                className="group absolute flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/45 bg-black/40 shadow-2xl backdrop-blur-sm transition-all duration-200 hover:scale-110 focus:scale-110 focus:outline-none focus:ring-2 focus:ring-white/80"
                style={{
                  top: station.top,
                  left: station.left,
                  boxShadow: isActive ? `0 0 0 8px ${station.color}33, 0 0 28px ${station.color}99` : '0 10px 24px rgba(0,0,0,0.35)',
                  animation: station.isUrgent ? 'alert-pulse 2s ease-in-out infinite' : undefined,
                }}
                aria-label={`Open ${station.label}${station.count ? ` with ${station.count} alerts` : ''}`}
              >
                <span className="absolute inset-[-10px] rounded-full border opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100" style={{ borderColor: station.color }} />
                <span className="absolute inset-2 rounded-full" style={{ background: station.color }} />
                <Icon className="relative h-6 w-6 text-white drop-shadow" />
                {hasAlert && (
                  <span
                    className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-1 text-[11px] font-black shadow"
                    style={{ color: station.color }}
                  >
                    {station.count! > 99 ? '99' : station.count}
                  </span>
                )}
                <span className="pointer-events-none absolute left-1/2 top-[calc(100%+8px)] -translate-x-1/2 whitespace-nowrap rounded-full border border-white/15 bg-black/70 px-3 py-1 text-xs font-black text-white opacity-0 shadow-xl backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus:opacity-100">
                  {station.zone}
                </span>
              </button>
            );
          })}

          {freshnessCount > 0 && (
            <button
              onClick={() => setTab('inventory')}
              onFocus={() => updateActive('inventory')}
              onPointerEnter={() => updateActive('inventory')}
              className="absolute flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/45 bg-black/50 shadow-2xl backdrop-blur-sm transition-transform hover:scale-110 focus:scale-110 focus:outline-none focus:ring-2 focus:ring-white/80"
              style={{ top: '42%', left: '68%', boxShadow: `0 0 18px ${freshnessColor}88` }}
              aria-label={`${freshnessCount} freshness alerts`}
            >
              <span className="absolute inset-2 rounded-full" style={{ background: freshnessColor }} />
              <Snowflake className="relative h-5 w-5 text-white" />
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[10px] font-black" style={{ color: freshnessColor }}>
                {freshnessCount}
              </span>
            </button>
          )}

          <div className="absolute inset-x-6 bottom-6">
            <div className="grid grid-cols-5 gap-2 rounded-2xl border border-white/10 bg-black/60 p-2 shadow-2xl backdrop-blur-md">
              {statusItems.map((item) => {
                const clear = item.count === 0;
                return (
                  <div key={item.label} className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.07] px-3 py-2 text-white">
                    {clear ? (
                      <CheckCircle2 className="h-4 w-4" style={{ color: item.color }} />
                    ) : (
                      <AlertTriangle className="h-4 w-4" style={{ color: item.color }} />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-bold uppercase text-white/45">{item.label}</p>
                      <p className="text-sm font-black">{clear ? 'OK' : item.count}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pointer-events-none absolute right-7 top-7 flex flex-col items-end gap-2">
            <div className="rounded-full border border-white/10 bg-black/50 px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-white/55 backdrop-blur-sm">
              Service Mode
            </div>
            <div className="flex gap-1">
              {stations.map((station) => (
                <span
                  key={station.id}
                  className="h-2 w-8 rounded-full opacity-80"
                  style={{ background: station.id === activeStation.id ? station.color : 'rgba(255,255,255,0.2)' }}
                />
              ))}
            </div>
          </div>
        </div>

        <style>{`
          @keyframes alert-pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(231, 76, 60, 0); }
            50% { box-shadow: 0 0 18px 8px rgba(231, 76, 60, 0.45); }
          }
        `}</style>
      </div>
    </div>
  );
};
