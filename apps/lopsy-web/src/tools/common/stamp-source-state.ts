import type { Point } from '../../types';

interface StampSourceState {
  source: Point | null;
  offset: Point | null;
}

export const stampSourceState: StampSourceState = {
  source: null,
  offset: null,
};
