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
  { id: 'sales', label: 'Sales', top: '7%', left: '53%', width: '9%', height: '7%' },
  { id: 'recipes', label: 'Recipes', top: '47%', left: '36%', width: '11%', height: '7%' },
  { id: 'inventory', label: 'Inventory', top: '50%', left: '61%', width: '11%', height: '7%' },
  { id: 'overview', label: 'Dashboard', top: '48%', left: '79%', width: '13%', height: '7%' },
  { id: 'orders', label: 'Orders', top: '62%', left: '84%', width: '11%', height: '7%' },
  { id: 'costs', label: 'Costs', top: '80%', left: '79%', width: '9%', height: '7%' },
];

interface DinerHomeProps {
  setTab: (tab: TabId) => void;
}

export const DinerHome = ({ setTab }: DinerHomeProps) => {
  return (
    <div className="animate-fade-up flex items-center justify-center" style={{ height: 'calc(100vh - 10px)' }}>
      <div className="relative inline-block max-w-full" style={{ maxHeight: '100%' }}>
        <img
          src="/diner-home.png"
          alt="Diner illustration — click a room to navigate"
          className="block max-w-full h-auto"
          style={{ maxHeight: 'calc(100vh - 10px)' }}
          draggable={false}
        />

        {hotspots.map((h) => (
          <Tooltip key={h.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setTab(h.id)}
                className="absolute rounded-lg border-0 bg-transparent cursor-pointer transition-all duration-200 hover:bg-white/20 hover:shadow-[0_0_18px_4px_rgba(255,255,255,0.35)] hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
