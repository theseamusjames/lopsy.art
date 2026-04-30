import { filterChannelMixer } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';

export const channelMixer: FilterDefinition = {
  id: 'channel-mixer',
  title: 'Channel Mixer',
  params: [
    { key: 'redRed', label: 'Red → Red', min: -200, max: 200, step: 1, defaultValue: 100 },
    { key: 'redGreen', label: 'Green → Red', min: -200, max: 200, step: 1, defaultValue: 0 },
    { key: 'redBlue', label: 'Blue → Red', min: -200, max: 200, step: 1, defaultValue: 0 },
    { key: 'greenRed', label: 'Red → Green', min: -200, max: 200, step: 1, defaultValue: 0 },
    { key: 'greenGreen', label: 'Green → Green', min: -200, max: 200, step: 1, defaultValue: 100 },
    { key: 'greenBlue', label: 'Blue → Green', min: -200, max: 200, step: 1, defaultValue: 0 },
    { key: 'blueRed', label: 'Red → Blue', min: -200, max: 200, step: 1, defaultValue: 0 },
    { key: 'blueGreen', label: 'Green → Blue', min: -200, max: 200, step: 1, defaultValue: 0 },
    { key: 'blueBlue', label: 'Blue → Blue', min: -200, max: 200, step: 1, defaultValue: 100 },
    { key: 'constRed', label: 'Red Constant', min: -100, max: 100, step: 1, defaultValue: 0 },
    { key: 'constGreen', label: 'Green Constant', min: -100, max: 100, step: 1, defaultValue: 0 },
    { key: 'constBlue', label: 'Blue Constant', min: -100, max: 100, step: 1, defaultValue: 0 },
  ],
  applyGpu: (engine, layerId, values) =>
    filterChannelMixer(
      engine, layerId,
      values['redRed'] ?? 100, values['redGreen'] ?? 0, values['redBlue'] ?? 0,
      values['greenRed'] ?? 0, values['greenGreen'] ?? 100, values['greenBlue'] ?? 0,
      values['blueRed'] ?? 0, values['blueGreen'] ?? 0, values['blueBlue'] ?? 100,
      values['constRed'] ?? 0, values['constGreen'] ?? 0, values['constBlue'] ?? 0,
    ),
};
