/**
 * The white balance mode menu (spec 5.4): As shot, Auto, the camera's
 * presets when the engine gives them, and Custom for anything else. The
 * recipe keeps `whiteBalance.mode` ('asShot' or 'custom') and the two
 * sliders; Auto and a preset are named values of those sliders.
 */

import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';

export interface WhiteBalanceValues {
  readonly temperature: number;
  readonly tint: number;
}

/** A named white balance (Daylight, Cloudy…) as slider values. */
export interface WhiteBalancePreset extends WhiteBalanceValues {
  readonly id: string;
  readonly name: string;
}

export type WhiteBalanceChoice = 'asShot' | 'auto' | 'custom' | `preset:${string}`;

function isSame(a: WhiteBalanceValues, b: WhiteBalanceValues): boolean {
  return Math.round(a.temperature) === Math.round(b.temperature) && Math.round(a.tint) === Math.round(b.tint);
}

/** Which entry the menu shows for `recipe`. */
export function currentChoice(recipe: Recipe, auto: WhiteBalanceValues | null, presets: readonly WhiteBalancePreset[]): WhiteBalanceChoice {
  const wb = recipe.whiteBalance;
  if (wb.mode === 'asShot') return 'asShot';
  if (auto && isSame(wb, auto)) return 'auto';
  const preset = presets.find((p) => isSame(wb, p));
  return preset ? `preset:${preset.id}` : 'custom';
}

/** The recipe changes and history label for choosing `choice`; null for Custom, which the sliders make. */
export function choiceChanges(
  choice: WhiteBalanceChoice,
  auto: WhiteBalanceValues | null,
  presets: readonly WhiteBalancePreset[],
): { changes: Record<string, Json>; label: string } | null {
  if (choice === 'asShot') {
    return { changes: { 'whiteBalance.mode': 'asShot', 'whiteBalance.temperature': 0, 'whiteBalance.tint': 0 }, label: 'White balance: As shot' };
  }
  const values = choice === 'auto' ? auto : presets.find((p) => `preset:${p.id}` === choice) ?? null;
  if (!values) return null;
  const name = choice === 'auto' ? 'Auto' : (values as WhiteBalancePreset).name;
  return {
    changes: { 'whiteBalance.mode': 'custom', 'whiteBalance.temperature': values.temperature, 'whiteBalance.tint': values.tint },
    label: `White balance: ${name}`,
  };
}
