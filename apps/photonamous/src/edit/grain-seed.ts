import { useEffect } from 'react';
import type { DevelopEngine } from '../engine/develop-engine';
import { grainSeed } from '../engine/finish-controls';

/** Seeds the Edit view's grain from the photo, as exports and background previews are, so all of them match. */
export function useGrainSeed(engine: DevelopEngine | null, assetId: string): void {
  useEffect(() => {
    engine?.setGrainSeed(grainSeed(assetId));
  }, [engine, assetId]);
}
