import { filterTexture } from '../engine-wasm/wasm-bridge';
import type { FilterDefinition } from './filter-types';
import { TEXTURE_PARAMS, textureArgs } from './texture-params';

export const texture: FilterDefinition = {
  id: 'texture',
  title: 'Texture',
  params: TEXTURE_PARAMS,
  applyGpu: (engine, layerId, values) => {
    const a = textureArgs(values);
    filterTexture(
      engine,
      layerId,
      a.kind,
      a.blend,
      a.amount,
      a.size,
      a.stretch,
      a.angleDegrees,
      a.detail,
      a.contrast,
      a.isColored,
      a.seed,
    );
  },
};
