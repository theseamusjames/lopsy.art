import { filterSpherize } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';
export { applySpherizeToPixels } from './spherize-cpu';
export type { SpherizeMode } from './spherize-cpu';

export const spherize: FilterDefinition = {
  id: 'spherize',
  title: 'Spherize',
  params: [
    { key: 'amount', label: 'Amount', min: -100, max: 100, step: 1, defaultValue: 50 },
    {
      key: 'mode',
      label: 'Mode',
      type: 'select' as const,
      options: [
        { label: 'Normal', value: 0 },
        { label: 'Horizontal Only', value: 1 },
        { label: 'Vertical Only', value: 2 },
      ],
      defaultValue: 0,
    },
  ],
  applyGpu: (engine, layerId, values) =>
    filterSpherize(
      engine,
      layerId,
      (values['amount'] ?? 50) / 100,
      Math.round(values['mode'] ?? 0),
    ),
};
