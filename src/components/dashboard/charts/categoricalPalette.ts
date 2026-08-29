// Fixed categorical order (dataviz skill's validated default palette) -
// assigned by index, never cycled/reordered, so a series' color stays
// tied to its position, not its rank. Passes every adjacent-pair CVD/
// contrast gate in both light and dark - correct for stacked bars and
// grouped bars (identity-by-position), which is all this app uses it for.
// Categories are admin-configurable and can exceed 8, so anything past
// the 8th slot folds into a shared muted "Other" color rather than
// generating a 9th hue.
export const CATEGORICAL_PALETTE = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
] as const;

export const CATEGORICAL_OVERFLOW_COLOR = "#898781";

export function categoricalColor(index: number): string {
  return index < CATEGORICAL_PALETTE.length ? CATEGORICAL_PALETTE[index] : CATEGORICAL_OVERFLOW_COLOR;
}
