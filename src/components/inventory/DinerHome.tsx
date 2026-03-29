import { Snowflake } from 'lucide-react';
import type { TabId } from '@/lib/types';

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

const getStatusColor = (count: number, warnAt: number, urgentAt: number) => {
  if (count === 0) return '#27AE60';
  if (count <= warnAt) return '#E67E22';
  return '#E74C3C';
};

interface BadgeConfig {
  id: TabId;
  label: string;
  top: string;
  left: string;
  color: string;
  count?: number;
  isUrgent: boolean;
}

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
  const badges: BadgeConfig[] = [
    {
      id: 'sales', label: 'Sales', top: '13%', left: '63%',
      color: getStatusColor(flaggedSales, 3, 3),
      count: flaggedSales || undefined,
      isUrgent: flaggedSales > 3,
    },
    {
      id: 'recipes', label: 'Recipes', top: '48%', left: '48%',
      color: getStatusColor(draftRecipes, 2, 2),
      count: draftRecipes || undefined,
      isUrgent: draftRecipes > 2,
    },
    {
      id: 'inventory', label: 'Inventory', top: '44%', left: '73%',
      color: getStatusColor(lowItems, 3, 3),
      count: lowItems || undefined,
      isUrgent: lowItems > 3,
    },
    {
      id: 'overview', label: 'Overview', top: '49%', left: '90%',
      color: '#2980B9',
      count: undefined,
      isUrgent: false,
    },
    {
      id: 'orders', label: 'Orders', top: '63%', left: '61%',
      color: getStatusColor(ordersDue, 1, 1),
      count: ordersDue || undefined,
      isUrgent: ordersDue > 1,
    },
    {
      id: 'costs', label: 'Costs', top: '75%', left: '86%',
      color: '#8E44AD',
      count: undefined,
      isUrgent: false,
    },
  ];

  const freshnessCount = expiredLots + expiringLots;
  const freshnessColor = expiredLots > 0 ? '#E74C3C' : '#E67E22';

  const statusItems = [
    { label: 'Stock', count: lowItems, color: getStatusColor(lowItems, 3, 3) },
    { label: 'Sales', count: flaggedSales, color: getStatusColor(flaggedSales, 3, 3) },
    { label: 'Recipes', count: draftRecipes, color: getStatusColor(draftRecipes, 2, 2) },
    { label: 'Orders', count: ordersDue, color: getStatusColor(ordersDue, 1, 1) },
    { label: 'Freshness', count: freshnessCount, color: freshnessCount === 0 ? '#27AE60' : freshnessCount <= 2 ? '#E67E22' : '#E74C3C' },
  ];

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: '#151010' }}>
      <div className="relative w-full max-w-[1400px] mx-auto">
        <img
          src="/diner-home.png"
          alt="Diner illustration — click areas to navigate"
          className="block w-full h-auto"
          draggable={false}
        />

        {/* Restaurant name */}
        {restaurantName && (
          <div
            className="absolute font-bold pointer-events-none"
            style={{
              top: '3%', left: '3%',
              fontSize: '18px', color: 'white',
              textShadow: '0 2px 8px rgba(0,0,0,0.7), 0 1px 3px rgba(0,0,0,0.5)',
            }}
          >
            {restaurantName}
          </div>
        )}

        {/* Room labels */}
        {[
          { text: 'Dining Room', top: '4%', left: '35%' },
          { text: 'Kitchen', top: '52%', left: '12%' },
          { text: 'Storage', top: '78%', left: '35%' },
          { text: 'Office', top: '4%', left: '85%' },
        ].map((room) => (
          <span
            key={room.text}
            className="absolute pointer-events-none select-none"
            style={{
              top: room.top, left: room.left,
              transform: 'translateX(-50%)',
              fontSize: '11px',
              fontWeight: 600,
              color: 'rgba(255,255,255,0.45)',
              textTransform: 'uppercase',
              letterSpacing: '1.5px',
              textShadow: '0 1px 4px rgba(0,0,0,0.5)',
            }}
          >
            {room.text}
          </span>
        ))}

        {/* Badge buttons */}
        {badges.map((b) => (
          <button
            key={b.id}
            onClick={() => setTab(b.id)}
            className="absolute flex items-center gap-1.5 border-0 cursor-pointer font-bold text-white"
            style={{
              top: b.top, left: b.left,
              transform: 'translate(-50%, -50%)',
              background: b.color,
              borderRadius: '20px',
              padding: '6px 16px',
              fontSize: '13px',
              transition: 'all 0.3s ease',
              animation: b.isUrgent ? 'alert-pulse 2s ease-in-out infinite' : undefined,
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.08)';
              e.currentTarget.style.filter = 'brightness(1.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translate(-50%, -50%)';
              e.currentTarget.style.filter = '';
            }}
            aria-label={`Go to ${b.label}${b.count ? ` (${b.count} alerts)` : ''}`}
          >
            {b.label}
            {b.count != null && b.count > 0 && (
              <span
                className="inline-flex items-center justify-center rounded-full font-bold"
                style={{
                  width: '18px', height: '18px',
                  fontSize: '11px',
                  background: 'white',
                  color: b.color,
                }}
              >
                {b.count > 99 ? '99' : b.count}
              </span>
            )}
          </button>
        ))}

        {/* Freshness warning */}
        {freshnessCount > 0 && (
          <button
            onClick={() => setTab('inventory')}
            className="absolute flex items-center justify-center border-0 cursor-pointer"
            style={{
              top: '42%', left: '68%',
              transform: 'translate(-50%, -50%)',
              width: '28px', height: '28px',
              borderRadius: '50%',
              background: freshnessColor,
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            }}
            aria-label={`${freshnessCount} freshness alerts`}
          >
            <Snowflake className="text-white" style={{ width: '14px', height: '14px' }} />
            <span
              className="absolute font-bold"
              style={{
                top: '-6px', right: '-6px',
                width: '16px', height: '16px',
                borderRadius: '50%',
                background: 'white',
                color: freshnessColor,
                fontSize: '10px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {freshnessCount}
            </span>
          </button>
        )}

        {/* Status summary bar */}
        <div
          className="absolute left-0 right-0 bottom-0 flex items-center justify-around"
          style={{
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(4px)',
            padding: '8px 16px',
          }}
        >
          {statusItems.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5" style={{ fontSize: '11px', color: 'white' }}>
              <span className="rounded-full inline-block" style={{ width: '10px', height: '10px', background: s.color }} />
              <span>{s.label}</span>
              <span className="font-bold">{s.count === 0 ? 'OK' : s.count}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes alert-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(231, 76, 60, 0); }
          50% { box-shadow: 0 0 14px 5px rgba(231, 76, 60, 0.5); }
        }
      `}</style>
    </div>
  );
};
