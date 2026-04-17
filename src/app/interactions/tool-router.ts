import type { ToolId } from '../../types';
import type { ToolHandler } from './interaction-types';

import { handleMoveDown, handleMoveMove, handleMoveUp } from './move-handlers';
import { handlePaintDown, handlePaintMove } from './paint-handlers';
import { handleSelectionDown, handleSelectionMove, handleSelectionUp } from './selection-handlers';
import { handleTransformMove } from './transform-handlers';
import { handleFillDown } from '../../tools/fill/fill-interaction';
import { handleEyedropperDown, handleEyedropperMove } from '../../tools/eyedropper/eyedropper-interaction';
import { handleDodgeDown, handleDodgeMove } from '../../tools/dodge/dodge-interaction';
import { handleSmudgeDown, handleSmudgeMove } from '../../tools/smudge/smudge-interaction';
import { handleStampDown, handleStampMove } from '../../tools/stamp/stamp-interaction';
import { handleTextDown, handleTextMove, handleTextUp } from '../../tools/text/text-interaction';
import { handleCropDown, handleCropMove, handleCropUp } from '../../tools/crop/crop-interaction';
import { handlePathDown, handlePathMove, handlePathUp } from '../../tools/path/path-interaction';
import { handleShapeDown, handleShapeMove, handleShapeUp } from '../../tools/shape/shape-interaction';
import { handleGradientDown, handleGradientMove } from '../../tools/gradient/gradient-interaction';

export const toolHandlers: Partial<Record<ToolId, ToolHandler>> = {
  move: {
    down: (ctx) => handleMoveDown(ctx),
    move: (ctx, state) => handleMoveMove(state, ctx.canvasPos, ctx.floatingSelectionRef),
    up: (ctx, state) => handleMoveUp(state, ctx.canvasPos, ctx.floatingSelectionRef, ctx.persistentTransformRef),
  },
  brush: {
    down: (ctx) => handlePaintDown(ctx, 'brush'),
    move: (ctx, state) => handlePaintMove(ctx, state),
  },
  pencil: {
    down: (ctx) => handlePaintDown(ctx, 'pencil'),
    move: (ctx, state) => handlePaintMove(ctx, state),
  },
  eraser: {
    down: (ctx) => handlePaintDown(ctx, 'eraser'),
    move: (ctx, state) => handlePaintMove(ctx, state),
  },
  'marquee-rect': {
    down: (ctx) => handleSelectionDown(ctx, 'marquee-rect'),
    move: (_ctx, state) => handleSelectionMove(state, _ctx.canvasPos),
    up: (ctx, state) => handleSelectionUp(state, ctx.canvasPos, ctx.screenToCanvas!, ctx.containerRef!, ctx),
  },
  'marquee-ellipse': {
    down: (ctx) => handleSelectionDown(ctx, 'marquee-ellipse'),
    move: (_ctx, state) => handleSelectionMove(state, _ctx.canvasPos),
    up: (ctx, state) => handleSelectionUp(state, ctx.canvasPos, ctx.screenToCanvas!, ctx.containerRef!, ctx),
  },
  wand: {
    down: (ctx) => handleSelectionDown(ctx, 'wand'),
  },
  lasso: {
    down: (ctx) => handleSelectionDown(ctx, 'lasso'),
    move: (_ctx, state) => handleSelectionMove(state, _ctx.canvasPos),
    up: (ctx, state) => handleSelectionUp(state, ctx.canvasPos, ctx.screenToCanvas!, ctx.containerRef!, ctx),
  },
  'lasso-magnetic': {
    down: (ctx) => handleSelectionDown(ctx, 'lasso-magnetic'),
    move: (_ctx, state) => handleSelectionMove(state, _ctx.canvasPos),
    up: (ctx, state) => handleSelectionUp(state, ctx.canvasPos, ctx.screenToCanvas!, ctx.containerRef!, ctx),
  },
  fill: {
    down: (ctx) => { handleFillDown(ctx); return undefined; },
  },
  eyedropper: {
    down: (ctx) => handleEyedropperDown(ctx),
    move: (ctx, state) => handleEyedropperMove(state, ctx.layerPos),
  },
  dodge: {
    down: (ctx) => handleDodgeDown(ctx),
    move: (ctx, state) => handleDodgeMove(state, ctx.layerPos),
  },
  smudge: {
    down: (ctx) => handleSmudgeDown(ctx),
    move: (ctx, state) => handleSmudgeMove(state, ctx.layerPos),
  },
  stamp: {
    down: (ctx) => handleStampDown(ctx),
    move: (ctx, state) => handleStampMove(state, ctx.layerPos, ctx.stampOffsetRef),
  },
  text: {
    down: (ctx) => handleTextDown(ctx),
    move: (ctx, state) => handleTextMove(state, ctx.canvasPos),
    up: (ctx, state) => handleTextUp(state, ctx.canvasPos),
  },
  crop: {
    down: (ctx) => handleCropDown(ctx),
    move: (ctx, state) => handleCropMove(state, ctx.canvasPos),
    up: (_ctx, state) => handleCropUp(state),
  },
  path: {
    down: (ctx) => handlePathDown(ctx),
    move: (ctx, state) => handlePathMove(state, ctx.layerPos),
    up: () => handlePathUp(),
  },
  shape: {
    down: (ctx) => handleShapeDown(ctx),
    move: (ctx, state) => handleShapeMove(state, ctx.layerPos),
    up: (ctx, state) => handleShapeUp(state, ctx.layerPos),
  },
  gradient: {
    down: (ctx) => handleGradientDown(ctx),
    move: (ctx, state) => handleGradientMove(state, ctx.layerPos),
  },
};

export { handleTransformMove };
