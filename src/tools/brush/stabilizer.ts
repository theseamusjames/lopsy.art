interface Point {
  x: number;
  y: number;
}

export interface StabilizerState {
  buffer: Point[];
  outputPoint: Point;
}

export function createStabilizerState(startPoint: Point): StabilizerState {
  return {
    buffer: [startPoint],
    outputPoint: { x: startPoint.x, y: startPoint.y },
  };
}

/**
 * Compute the stabilized output position given a new raw pointer input.
 *
 * Uses a "pulling string" / weighted moving average approach:
 * - The buffer stores the last N raw positions (N scales with strength).
 * - The output is a weighted average of the buffer, with exponential
 *   decay toward older samples. This produces a smooth, trailing cursor
 *   that dampens hand tremor while preserving intentional direction.
 *
 * strength: 0-100. 0 = no smoothing (passthrough). 100 = max smoothing.
 */
export function stabilize(
  state: StabilizerState,
  rawPoint: Point,
  strength: number,
): Point {
  if (strength <= 0) {
    state.outputPoint = { x: rawPoint.x, y: rawPoint.y };
    state.buffer = [rawPoint];
    return state.outputPoint;
  }

  const windowSize = Math.round(2 + (strength / 100) * 18);

  state.buffer.push(rawPoint);
  if (state.buffer.length > windowSize) {
    state.buffer.splice(0, state.buffer.length - windowSize);
  }

  const decay = 0.7 - (strength / 100) * 0.5;
  let totalWeight = 0;
  let wx = 0;
  let wy = 0;

  for (let i = state.buffer.length - 1; i >= 0; i--) {
    const age = state.buffer.length - 1 - i;
    const weight = Math.pow(1 - decay, age);
    wx += state.buffer[i]!.x * weight;
    wy += state.buffer[i]!.y * weight;
    totalWeight += weight;
  }

  state.outputPoint = {
    x: wx / totalWeight,
    y: wy / totalWeight,
  };

  return state.outputPoint;
}

/**
 * Flush remaining buffer points as a series of smoothed positions,
 * converging on the final raw position. Called on pointer-up so the
 * stroke reaches the cursor's actual end point instead of stopping
 * short.
 */
export function flushStabilizer(state: StabilizerState): Point[] {
  if (state.buffer.length <= 1) return [];

  const target = state.buffer[state.buffer.length - 1]!;
  const points: Point[] = [];
  const steps = Math.max(2, Math.ceil(state.buffer.length / 2));

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: state.outputPoint.x + (target.x - state.outputPoint.x) * t,
      y: state.outputPoint.y + (target.y - state.outputPoint.y) * t,
    });
  }

  state.buffer = [target];
  state.outputPoint = { x: target.x, y: target.y };
  return points;
}
