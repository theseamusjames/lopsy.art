import type { InteractionState } from '../../app/interactions/interaction-types';
import type { Engine } from '../../engine-wasm/wasm-bridge';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { useEditorStore } from '../../app/editor-store';
import { interpolatePointsWithScatter } from './brush';
import type { SymmetryConfig } from '../symmetry';
import { mirrorBatchPoints } from '../symmetry';
import {
  applyBrushDabBatch as gpuBrushDabBatch,
} from '../../engine-wasm/wasm-bridge';
import type { SubBrush } from '../../types/brush';

interface BrushStrokeDeps {
  engine: Engine;
  state: InteractionState;
  layerLocalPos: { x: number; y: number };
  sym: SymmetryConfig;
  interpolateWithSpacing: (from: { x: number; y: number }, to: { x: number; y: number }, spacing: number, remainder: number) => { points: Float64Array; remainder: number };
  emitFlatDabsWithFade: (engine: Engine, layerId: string, pts: Float64Array, size: number, hardness: number, r: number, g: number, b: number, a: number, opacity: number, fade: number, state: InteractionState, sym: SymmetryConfig, angle: number, aJ: number, oJ: number) => void;
  emitDabsWithFade: (engine: Engine, layerId: string, scatterPts: Array<{ x: number; y: number }>, from: { x: number; y: number }, size: number, hardness: number, r: number, g: number, b: number, a: number, opacity: number, fade: number, state: InteractionState, sym: SymmetryConfig, angle: number, aJ: number, oJ: number) => void;
  advanceJitterWalk: (state: InteractionState, segDist: number, size: number, hardness: number, sizeJitter: number, hardnessJitter: number) => { size: number; hardness: number };
  getActiveSubBrushes: () => readonly SubBrush[];
  emitSubBrushDabs: (engine: Engine, layerId: string, pts: Float64Array, size: number, r: number, g: number, b: number, a: number, opacity: number, subs: readonly SubBrush[], sym: SymmetryConfig) => void;
}

export function handleBrushStroke(deps: BrushStrokeDeps): void {
  const { engine, state, layerLocalPos, sym } = deps;
  if (!state.lastPoint || !state.layerId) return;

  const toolSettings = useToolSettingsStore.getState();
  const brush = toolSettings.settings.brush;
  const baseSize = brush.size;
  const baseHardness = brush.hardness / 100;
  const opacity = brush.opacity / 100;
  const brushScatter = brush.scatter;
  const brushFade = brush.fade;
  const sizeJitter = toolSettings.settings.brushJitter.size / 100;
  const hardnessJitter = toolSettings.settings.brushJitter.hardness / 100;
  const aJ = toolSettings.settings.brushJitter.angle / 100;
  const oJ = toolSettings.settings.brushJitter.opacity / 100;
  const speedSize = toolSettings.settings.brushSpeed.size / 100;
  const color = state.strokeColor ?? useToolSettingsStore.getState().foregroundColor;
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  const dx = layerLocalPos.x - state.lastPoint.x;
  const dy = layerLocalPos.y - state.lastPoint.y;
  const segDist = Math.sqrt(dx * dx + dy * dy);

  let size = baseSize;

  if (speedSize > 0) {
    const now = performance.now();
    const dt = now - (state.lastPointTime ?? now);
    const rawSpeed = dt > 0 ? segDist / dt : 0;
    const maxSpeed = 5;
    const normalizedSpeed = Math.min(rawSpeed / maxSpeed, 1);

    const sensitivity = toolSettings.settings.brushSpeed.sensitivity;
    const maWindow = sensitivity === 'high' ? 2
      : sensitivity === 'low' ? 6 : 3;
    if (!state.speedHistory) state.speedHistory = [];
    state.speedHistory.push(normalizedSpeed);
    if (state.speedHistory.length > maWindow) state.speedHistory.shift();

    const avgSpeed = state.speedHistory.reduce((a, b) => a + b, 0) / state.speedHistory.length;

    const invert = toolSettings.settings.brushSpeed.sizeInvert;
    const targetScale = invert
      ? 1 + speedSize * avgSpeed
      : 1 - speedSize * avgSpeed;

    const prev = state.speedSizeCurrent ?? 1;
    const blend = 0.25;
    const current = prev + (targetScale - prev) * blend;
    state.speedSizeCurrent = current;
    state.lastPointTime = now;

    size = Math.max(1, size * current);
  }

  const jittered = deps.advanceJitterWalk(state, segDist, size, baseHardness, sizeJitter, hardnessJitter);
  size = jittered.size;
  const hardness = jittered.hardness;

  const brushTaper = brush.taper;
  if (brushTaper > 0) {
    const taperFactor = Math.max(0, 1 - (state.strokeDistance ?? 0) / brushTaper);
    size = size * taperFactor;
    if (size < 0.5) {
      state.lastPoint = layerLocalPos;
      return;
    }
  }

  const spacing = Math.max(1, size * brush.spacing / 100);

  if (brushFade > 0 && (state.strokeDistance ?? 0) >= brushFade) {
    state.lastPoint = layerLocalPos;
    return;
  }

  if (brushScatter > 0) {
    const scatterPts = interpolatePointsWithScatter(state.lastPoint, layerLocalPos, spacing, brushScatter, size);
    if (brushFade > 0) {
      deps.emitDabsWithFade(engine, state.layerId, scatterPts, state.lastPoint, size, hardness, r, g, b, color.a, opacity, brushFade, state, sym, 0, aJ, oJ);
    } else {
      const pts = new Float64Array(scatterPts.length * 2);
      for (let i = 0; i < scatterPts.length; i++) {
        pts[i * 2] = scatterPts[i]!.x;
        pts[i * 2 + 1] = scatterPts[i]!.y;
      }
      gpuBrushDabBatch(engine, state.layerId, pts, size, hardness, r, g, b, color.a, opacity, 1, 0, aJ, oJ);
      for (const m of mirrorBatchPoints(pts, sym)) {
        gpuBrushDabBatch(engine, state.layerId, m, size, hardness, r, g, b, color.a, opacity, 1, 0, aJ, oJ);
      }
      const subs = deps.getActiveSubBrushes();
      if (subs.length > 0) deps.emitSubBrushDabs(engine, state.layerId, pts, size, r, g, b, color.a, opacity, subs, sym);
    }
  } else {
    const { points: pts, remainder: spacingRem } = deps.interpolateWithSpacing(state.lastPoint, layerLocalPos, spacing, state.spacingRemainder ?? 0);
    state.spacingRemainder = spacingRem;
    if (brushFade > 0) {
      deps.emitFlatDabsWithFade(engine, state.layerId, pts, size, hardness, r, g, b, color.a, opacity, brushFade, state, sym, 0, aJ, oJ);
    } else {
      gpuBrushDabBatch(engine, state.layerId, pts, size, hardness, r, g, b, color.a, opacity, 1, 0, aJ, oJ);
      for (const m of mirrorBatchPoints(pts, sym)) {
        gpuBrushDabBatch(engine, state.layerId, m, size, hardness, r, g, b, color.a, opacity, 1, 0, aJ, oJ);
      }
      const subs2 = deps.getActiveSubBrushes();
      if (subs2.length > 0) deps.emitSubBrushDabs(engine, state.layerId, pts, size, r, g, b, color.a, opacity, subs2, sym);
    }
  }

  if (brushFade <= 0) {
    const sdx = layerLocalPos.x - state.lastPoint.x;
    const sdy = layerLocalPos.y - state.lastPoint.y;
    state.strokeDistance = (state.strokeDistance ?? 0) + Math.sqrt(sdx * sdx + sdy * sdy);
  }
  if (state.strokePoints) {
    state.strokePoints.push({ x: layerLocalPos.x, y: layerLocalPos.y });
  }
  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}
