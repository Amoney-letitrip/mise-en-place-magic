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
  { id: 'sales', label: 'Sales', top: '8%', left: '52%', width: '10%', height: '8%' },
  { id: 'recipes', label: 'Recipes', top: '45%', left: '35%', width: '12%', height: '8%' },
  { id: 'inventory', label: 'Inventory', top: '48%', left: '58%', width: '12%', height: '8%' },
  { id: 'overview', label: 'Dashboard', top: '35%', left: '78%', width: '14%', height: '8%' },
  { id: 'orders', label: 'Orders', top: '58%', left: '82%', width: '12%', height: '8%' },
  { id: 'costs', label: 'Costs', top: '78%', left: '78%', width: '10%', height: '8%' },
];

interface DinerHomeProps {
  setTab: (tab: TabId) => void;
}

export const DinerHome = ({ setTab }: DinerHomeProps) => {
  return (
    <div className="animate-fade-up flex justify-center">
      <div
        className="relative w-full"
        style={{ maxHeight: 'calc(100vh - 120px)' }}
      >
        <img
          src="/diner-home.png"
          alt="Diner illustration — click a room to navigate"
          className="w-full h-auto object-contain"
          style={{ maxHeight: 'calc(100vh - 120px)' }}
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
