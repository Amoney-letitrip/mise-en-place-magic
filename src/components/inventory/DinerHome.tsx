import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { TabId } from '@/lib/types';

interface Hotspot {
  id: TabId;
  label: string;
  top: string;
  left: string;
  width: string;
  height: string;
}

const hotspots: Hotspot[] = [
  { id: 'sales', label: 'Sales', top: '10%', left: '58%', width: '8%', height: '5%' },
  { id: 'recipes', label: 'Recipes', top: '43%', left: '36%', width: '10%', height: '5%' },
  { id: 'inventory', label: 'Inventory', top: '43%', left: '66%', width: '10%', height: '5%' },
  { id: 'overview', label: 'Dashboard', top: '43%', left: '82%', width: '11%', height: '5%' },
  { id: 'orders', label: 'Orders', top: '53%', left: '85%', width: '9%', height: '5%' },
  { id: 'costs', label: 'Costs', top: '10%', left: '72%', width: '8%', height: '5%' },
];

interface DinerHomeProps {
  setTab: (tab: TabId) => void;
  restaurantName?: string | null;
  isMobile?: boolean;
}

export const DinerHome = ({ setTab, restaurantName, isMobile }: DinerHomeProps) => {
  const containerHeight = isMobile ? 'calc(100vh - 70px)' : '100vh';

  return (
    <div className="animate-fade-up flex items-center justify-center" style={{ height: containerHeight }}>
      <div className="relative inline-block max-w-full" style={{ maxHeight: '100%' }}>
        <img
          src="/diner-home.png"
          alt="Diner illustration — click a room to navigate"
          className="block max-w-full h-auto"
          style={{ maxHeight: containerHeight }}
          draggable={false}
        />

        {/* Restaurant name overlay */}
        {restaurantName && (
          <div
            className="absolute font-bold pointer-events-none"
            style={{
              top: '16px',
              left: '24px',
              fontSize: '20px',
              color: 'white',
              textShadow: '0 2px 8px rgba(0,0,0,0.7), 0 1px 3px rgba(0,0,0,0.5)',
            }}
          >
            {restaurantName}
          </div>
        )}

        {/* Watermark cover */}
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: 0,
            right: 0,
            width: '60px',
            height: '60px',
            background: 'linear-gradient(135deg, transparent 40%, #C4A070 100%)',
          }}
        />

        {hotspots.map((h) => (
          <Tooltip key={h.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setTab(h.id)}
                className="absolute border-0 bg-transparent cursor-pointer rounded-full transition-all duration-200 hover:scale-110 hover:brightness-125 hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                style={{
                  top: h.top,
                  left: h.left,
                  width: h.width,
                  height: h.height,
                }}
                aria-label={`Go to ${h.label}`}
              />
            </TooltipTrigger>
            <TooltipContent side="top">{h.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
};
