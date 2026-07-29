import { calculateWasteImpact } from '@/lib/waste-impact';
import type { WasteImpactInput } from '@/lib/waste-impact';

interface WasteImpactCardProps {
  // Pass measured waste-history data when it becomes available.
  data?: WasteImpactInput;
  // Optional period label, e.g. "this month"
  period?: string;
}

export const WasteImpactCard = ({
  data,
  period = 'this month',
}: WasteImpactCardProps) => {
  if (!data) {
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
          🌱 Waste Impact
        </div>
        <div className="font-semibold text-sm text-foreground">No measured waste impact yet</div>
        <p className="text-xs text-muted-foreground mt-1">
          Waste history is not stored yet, so savings and climate estimates are intentionally hidden.
        </p>
      </div>
    );
  }

  const result = calculateWasteImpact(data);

  return (
    <div className="bg-emerald-50/60 border border-emerald-200 rounded-lg p-4">
      <div className="text-xs font-bold uppercase tracking-wider text-emerald-700 mb-2">
        🌱 Waste Impact
      </div>

      <div className="text-4xl font-extrabold leading-none text-emerald-700 mb-1">
        {result.estimatedMilesNotDriven.toLocaleString()}
      </div>
      <div className="text-[13px] font-semibold text-emerald-800 mb-3">
        equivalent miles not driven
      </div>

      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2 text-[12px] text-emerald-700">
          <span className="text-base">🥬</span>
          <span>
            Based on{' '}
            <span className="font-bold">{result.foodWasteAvoidedLbs} lb</span>{' '}
            of estimated food waste avoided {period}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-emerald-700">
          <span className="text-base">💰</span>
          <span>
            <span className="font-bold">${result.estimatedFoodCostSaved.toLocaleString()}</span>{' '}
            estimated food cost saved
          </span>
        </div>
      </div>

      <div className="text-[11px] text-emerald-600/70 border-t border-emerald-200/60 pt-2 leading-snug">
        Impact estimates are approximate and based on avoided mixed food waste.
      </div>
    </div>
  );
};
