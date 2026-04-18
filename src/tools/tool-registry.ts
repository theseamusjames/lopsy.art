import type { ComponentType } from 'react';
import type { ToolId } from '../types';
import type { ToolHandler } from '../app/interactions/interaction-types';

import { handleMoveDown, handleMoveMove, handleMoveUp } from '../app/interactions/move-handlers';
import { handlePaintDown, handlePaintMove } from '../app/interactions/paint-handlers';
import { handleSelectionDown, handleSelectionMove, handleSelectionUp } from '../app/interactions/selection-handlers';
import { handleFillDown } from './fill/fill-interaction';
import { handleEyedropperDown, handleEyedropperMove } from './eyedropper/eyedropper-interaction';
import { handleDodgeDown, handleDodgeMove } from './dodge/dodge-interaction';
import { handleSmudgeDown, handleSmudgeMove } from './smudge/smudge-interaction';
import { handleStampDown, handleStampMove } from './stamp/stamp-interaction';
import { handleTextDown, handleTextMove, handleTextUp } from './text/text-interaction';
import { handleCropDown, handleCropMove, handleCropUp } from './crop/crop-interaction';
import { handlePathDown, handlePathMove, handlePathUp } from './path/path-interaction';
import { handleShapeDown, handleShapeMove, handleShapeUp } from './shape/shape-interaction';
import { handleGradientDown, handleGradientMove } from './gradient/gradient-interaction';

import { MoveOptions } from '../app/OptionsBar/tool-options/MoveOptions';
import { BrushOptions } from '../app/OptionsBar/tool-options/BrushOptions';
import { PencilOptions } from '../app/OptionsBar/tool-options/PencilOptions';
import { EraserOptions } from '../app/OptionsBar/tool-options/EraserOptions';
import { FillOptions } from '../app/OptionsBar/tool-options/FillOptions';
import { WandOptions } from '../app/OptionsBar/tool-options/WandOptions';
import { MarqueeOptions } from '../app/OptionsBar/tool-options/MarqueeOptions';
import { DodgeOptions } from '../app/OptionsBar/tool-options/DodgeOptions';
import { SmudgeOptions } from '../app/OptionsBar/tool-options/SmudgeOptions';
import { ShapeOptions } from '../app/OptionsBar/tool-options/ShapeOptions';
import { GradientOptions } from '../app/OptionsBar/tool-options/GradientOptions';
import { StampOptions } from '../app/OptionsBar/tool-options/StampOptions';
import { PathOptions } from '../app/OptionsBar/tool-options/PathOptions';
import { TextOptions } from '../app/OptionsBar/tool-options/TextOptions';
import { MagneticLassoOptions } from '../app/OptionsBar/tool-options/MagneticLassoOptions';
import { CropOptions } from '../app/OptionsBar/tool-options/CropOptions';

import { useToolSettingsStore } from '../app/tool-settings-store';

/**
 * Single source of truth for every tool. Adding a new tool is a single-file
 * change: append a descriptor here. The router, options bar, keyboard
 * shortcut map, paint-tool set, and GPU-tool set all derive from this.
 *
 * `Record<ToolId, ToolDescriptor>` makes "missing a tool" a type error.
 */
export interface ToolDescriptor {
  id: ToolId;
  label: string;
  /** Single-key shortcut. Modifier-bearing shortcuts live in shortcut/ files. */
  shortcut?: string;
  /** Down/move/up callbacks; absent for tools that aren't selectable yet. */
  handler?: ToolHandler;
  /** Component rendered in the options bar; absent means "no settings". */
  optionsComponent?: ComponentType;
  /** True for tools that paint into a layer — drives brush-cursor visibility. */
  isPaint?: boolean;
  /** True for tools whose down/move are handled directly via WASM and don't
   *  need JS-side pixel data (skips the 16-bit → 8-bit round-trip). */
  isGpu?: boolean;
  /** Hook that runs when the user selects this tool. Used for tool-specific
   *  setup (e.g. shape tool seeding its fill color from the current
   *  foreground) so those side effects live with the tool rather than
   *  leaking into generic setActiveTool code. */
  onActivate?: () => void;
}

export const toolRegistry: Record<ToolId, ToolDescriptor> = {
  move: {
    id: 'move',
    label: 'Move',
    shortcut: 'v',
    optionsComponent: MoveOptions,
    handler: {
      down: (ctx) => handleMoveDown(ctx),
      move: (ctx, state) => handleMoveMove(state, ctx.canvasPos, ctx.floatingSelectionRef),
      up: (ctx, state) => handleMoveUp(state, ctx.canvasPos, ctx.floatingSelectionRef, ctx.persistentTransformRef),
    },
  },
  brush: {
    id: 'brush',
    label: 'Brush',
    shortcut: 'b',
    optionsComponent: BrushOptions,
    isPaint: true,
    isGpu: true,
    handler: {
      down: (ctx) => handlePaintDown(ctx, 'brush'),
      move: (ctx, state) => handlePaintMove(ctx, state),
    },
  },
  pencil: {
    id: 'pencil',
    label: 'Pencil',
    shortcut: 'n',
    optionsComponent: PencilOptions,
    isPaint: true,
    isGpu: true,
    handler: {
      down: (ctx) => handlePaintDown(ctx, 'pencil'),
      move: (ctx, state) => handlePaintMove(ctx, state),
    },
  },
  eraser: {
    id: 'eraser',
    label: 'Eraser',
    shortcut: 'e',
    optionsComponent: EraserOptions,
    isPaint: true,
    isGpu: true,
    handler: {
      down: (ctx) => handlePaintDown(ctx, 'eraser'),
      move: (ctx, state) => handlePaintMove(ctx, state),
    },
  },
  fill: {
    id: 'fill',
    label: 'Paint Bucket',
    shortcut: 'g',
    optionsComponent: FillOptions,
    handler: {
      down: (ctx) => { handleFillDown(ctx); return undefined; },
    },
  },
  gradient: {
    id: 'gradient',
    label: 'Gradient',
    optionsComponent: GradientOptions,
    isGpu: true,
    handler: {
      down: (ctx) => handleGradientDown(ctx),
      move: (ctx, state) => handleGradientMove(state, ctx.layerPos),
    },
  },
  eyedropper: {
    id: 'eyedropper',
    label: 'Eyedropper',
    shortcut: 'i',
    handler: {
      down: (ctx) => handleEyedropperDown(ctx),
      move: (ctx, state) => handleEyedropperMove(state, ctx.layerPos),
    },
  },
  stamp: {
    id: 'stamp',
    label: 'Clone Stamp',
    shortcut: 's',
    optionsComponent: StampOptions,
    isPaint: true,
    isGpu: true,
    handler: {
      down: (ctx) => handleStampDown(ctx),
      move: (ctx, state) => handleStampMove(state, ctx.layerPos, ctx.stampOffsetRef),
    },
  },
  dodge: {
    id: 'dodge',
    label: 'Dodge/Burn',
    shortcut: 'o',
    optionsComponent: DodgeOptions,
    isPaint: true,
    isGpu: true,
    handler: {
      down: (ctx) => handleDodgeDown(ctx),
      move: (ctx, state) => handleDodgeMove(state, ctx.layerPos),
    },
  },
  smudge: {
    id: 'smudge',
    label: 'Smudge',
    shortcut: 'r',
    optionsComponent: SmudgeOptions,
    handler: {
      down: (ctx) => handleSmudgeDown(ctx),
      move: (ctx, state) => handleSmudgeMove(state, ctx.layerPos),
    },
  },
  'marquee-rect': {
    id: 'marquee-rect',
    label: 'Rectangular Marquee',
    shortcut: 'm',
    optionsComponent: MarqueeOptions,
    handler: {
      down: (ctx) => handleSelectionDown(ctx, 'marquee-rect'),
      move: (_ctx, state) => handleSelectionMove(state, _ctx.canvasPos),
      up: (ctx, state) => handleSelectionUp(state, ctx.canvasPos, ctx.screenToCanvas!, ctx.containerRef!, ctx),
    },
  },
  'marquee-ellipse': {
    id: 'marquee-ellipse',
    label: 'Elliptical Marquee',
    optionsComponent: MarqueeOptions,
    handler: {
      down: (ctx) => handleSelectionDown(ctx, 'marquee-ellipse'),
      move: (_ctx, state) => handleSelectionMove(state, _ctx.canvasPos),
      up: (ctx, state) => handleSelectionUp(state, ctx.canvasPos, ctx.screenToCanvas!, ctx.containerRef!, ctx),
    },
  },
  lasso: {
    id: 'lasso',
    label: 'Lasso',
    shortcut: 'l',
    handler: {
      down: (ctx) => handleSelectionDown(ctx, 'lasso'),
      move: (_ctx, state) => handleSelectionMove(state, _ctx.canvasPos),
      up: (ctx, state) => handleSelectionUp(state, ctx.canvasPos, ctx.screenToCanvas!, ctx.containerRef!, ctx),
    },
  },
  'lasso-magnetic': {
    id: 'lasso-magnetic',
    label: 'Magnetic Lasso',
    optionsComponent: MagneticLassoOptions,
    handler: {
      down: (ctx) => handleSelectionDown(ctx, 'lasso-magnetic'),
      move: (_ctx, state) => handleSelectionMove(state, _ctx.canvasPos),
      up: (ctx, state) => handleSelectionUp(state, ctx.canvasPos, ctx.screenToCanvas!, ctx.containerRef!, ctx),
    },
  },
  wand: {
    id: 'wand',
    label: 'Magic Wand',
    shortcut: 'w',
    optionsComponent: WandOptions,
    handler: {
      down: (ctx) => handleSelectionDown(ctx, 'wand'),
    },
  },
  shape: {
    id: 'shape',
    label: 'Shape',
    shortcut: 'u',
    optionsComponent: ShapeOptions,
    isGpu: true,
    handler: {
      down: (ctx) => handleShapeDown(ctx),
      move: (ctx, state) => handleShapeMove(state, ctx.layerPos),
      up: (ctx, state) => handleShapeUp(state, ctx.layerPos),
    },
    // Seed the shape's fill color from the current foreground on activation —
    // users expect "pick a color, then click shape" to draw in that color.
    onActivate: () => {
      const ts = useToolSettingsStore.getState();
      ts.setShapeFillColor(ts.foregroundColor);
    },
  },
  text: {
    id: 'text',
    label: 'Text',
    shortcut: 't',
    optionsComponent: TextOptions,
    handler: {
      down: (ctx) => handleTextDown(ctx),
      move: (ctx, state) => handleTextMove(state, ctx.canvasPos),
      up: (ctx, state) => handleTextUp(state, ctx.canvasPos),
    },
  },
  crop: {
    id: 'crop',
    label: 'Crop',
    shortcut: 'c',
    optionsComponent: CropOptions,
    handler: {
      down: (ctx) => handleCropDown(ctx),
      move: (ctx, state) => handleCropMove(state, ctx.canvasPos),
      up: (_ctx, state) => handleCropUp(state),
    },
  },
  path: {
    id: 'path',
    label: 'Pen Tool',
    shortcut: 'p',
    optionsComponent: PathOptions,
    handler: {
      down: (ctx) => handlePathDown(ctx),
      move: (ctx, state) => handlePathMove(state, ctx.layerPos),
      up: () => handlePathUp(),
    },
  },
};

/**
 * Memoized derived sets — allocated once, reused everywhere. Anything that
 * iterates the registry on a hot path should use these instead of
 * recomputing.
 */
function buildSet(predicate: (d: ToolDescriptor) => boolean): ReadonlySet<ToolId> {
  return new Set(Object.values(toolRegistry).filter(predicate).map((d) => d.id));
}

export const PAINT_TOOLS: ReadonlySet<ToolId> = buildSet((d) => !!d.isPaint);
export const GPU_TOOLS: ReadonlySet<ToolId> = buildSet((d) => !!d.isGpu);

/** Map of single-key shortcut → tool id, derived from the registry. */
export const SHORTCUT_TO_TOOL: ReadonlyMap<string, ToolId> = new Map(
  Object.values(toolRegistry)
    .filter((d): d is ToolDescriptor & { shortcut: string } => !!d.shortcut)
    .map((d) => [d.shortcut, d.id]),
);
