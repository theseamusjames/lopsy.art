import { getMaxDocumentSide } from '../../engine-wasm/gpu-limits';
import type { BorderPlan, BorderWidths } from '../../layers/border';

/** The Border dialog's line under its fields; with no plan it says why Apply is disabled. */
export function describeBorderPlan(
  plan: BorderPlan | null,
  widths: BorderWidths,
  docWidth: number,
  docHeight: number,
): string {
  if (!plan) {
    const hasWidth = widths.top + widths.right + widths.bottom + widths.left > 0;
    return hasWidth
      ? `Too large: the canvas can be at most ${getMaxDocumentSide()} px on a side.`
      : 'Enter a border width.';
  }
  return plan.width === docWidth && plan.height === docHeight
    ? `Canvas stays ${docWidth} × ${docHeight} px`
    : `New size: ${plan.width} × ${plan.height} px`;
}
