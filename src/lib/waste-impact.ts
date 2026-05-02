// Conversion factors for food waste climate impact estimates.
// These are approximate values for restaurant planning purposes only —
// not for formal carbon accounting or compliance reporting.
export const WASTE_IMPACT_CONSTANTS = {
  // Estimated equivalent miles not driven per lb of mixed food waste avoided.
  // Derived from ~3.3 lbs CO2e per lb food waste (EPA) / ~0.94 lbs CO2e per mile (EPA).
  MIXED_FOOD_WASTE_MILES_PER_LB: 3.5,

  // Future per-category refinements (not yet active):
  // MEAT_MILES_PER_LB: 8.0,
  // DAIRY_MILES_PER_LB: 4.5,
  // PRODUCE_MILES_PER_LB: 1.5,
  // DRY_GOODS_MILES_PER_LB: 1.0,

  // CO2e factors used internally
  CO2E_LBS_PER_LB_FOOD_WASTE: 3.3,
} as const;

export interface WasteImpactInput {
  foodWasteAvoidedLbs: number;
  estimatedFoodCostSaved: number;
}

export interface WasteImpactResult {
  foodWasteAvoidedLbs: number;
  estimatedMilesNotDriven: number;
  estimatedFoodCostSaved: number;
  estimatedCo2eLbs: number;
}

export function calculateWasteImpact(input: WasteImpactInput): WasteImpactResult {
  const { foodWasteAvoidedLbs, estimatedFoodCostSaved } = input;

  return {
    foodWasteAvoidedLbs: Math.round(foodWasteAvoidedLbs),
    estimatedMilesNotDriven: Math.round(
      foodWasteAvoidedLbs * WASTE_IMPACT_CONSTANTS.MIXED_FOOD_WASTE_MILES_PER_LB
    ),
    estimatedFoodCostSaved: Math.round(estimatedFoodCostSaved),
    estimatedCo2eLbs: Math.round(
      foodWasteAvoidedLbs * WASTE_IMPACT_CONSTANTS.CO2E_LBS_PER_LB_FOOD_WASTE
    ),
  };
}

// Demo data used until real waste tracking is wired up.
export const DEMO_WASTE_IMPACT_INPUT: WasteImpactInput = {
  foodWasteAvoidedLbs: 86,
  estimatedFoodCostSaved: 412,
};
