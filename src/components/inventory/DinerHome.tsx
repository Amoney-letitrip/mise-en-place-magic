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

// Positioned precisely over the colored badge callouts in the image
const hotspots: Hotspot[] = [
  { id: 'sales', label: 'Sales', top: '9%', left: '54%', width: '7%', height: '4.5%' },
  { id: 'recipes', label: 'Recipes', top: '47%', left: '38%', width: '8%', height: '4.5%' },
  { id: 'inventory', label: 'Inventory', top: '49%', left: '63%', width: '8%', height: '4.5%' },
  { id: 'overview', label: 'Dashboard', top: '49%', left: '79%', width: '9%', height: '4.5%' },
  { id: 'orders', label: 'Orders', top: '60%', left: '86%', width: '7%', height: '4.5%' },
  { id: 'costs', label: 'Costs', top: '79%', left: '80%', width: '6%', height: '4.5%' },
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
