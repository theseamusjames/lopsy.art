import type { ToolId } from '../../types';
import type { ToolHandler } from './interaction-types';

import { handleMoveDown, handleMoveMove, handleMoveUp } from './move-handlers';
import { handlePaintDown, handlePaintMove } from './paint-handlers';
import { handleSelectionDown, handleSelectionMove, handleSelectionUp } from './selection-handlers';
import { handleTransformMove } from './transform-handlers';
import {
  handleFillDown, handleEyedropperDown, handleEyedropperMove,
  handleDodgeDown, handleDodgeMove,
  handleSmudgeDown, handleSmudgeMove,
  handleStampDown, handleStampMove,
  handleTextDown, handleTextMove, handleTextUp,
  handleCropDown, handleCropMove, handleCropUp,
  handlePathDown, handlePathMove, handlePathUp,
  handleShapeGradientDown, handleShapeUp, handleShapeMove, handleGradientMove,
} from './misc-handlers';

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
    down: (ctx) => handleShapeGradientDown(ctx, 'shape'),
    move: (ctx, state) => handleShapeMove(state, ctx.layerPos),
    up: (ctx, state) => handleShapeUp(state, ctx.layerPos),
  },
  gradient: {
    down: (ctx) => handleShapeGradientDown(ctx, 'gradient'),
    move: (ctx, state) => handleGradientMove(state, ctx.layerPos),
  },
};

export { handleTransformMove };
