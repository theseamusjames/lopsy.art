import type { ToolId } from '../../types';
import type { ToolHandler } from './interaction-types';
import { toolRegistry } from '../../tools/tool-registry';
import { handleTransformMove } from './transform-handlers';

/**
 * Per-tool down/move/up handlers, derived from the tool registry. Tools
 * without a handler (placeholder ToolIds like `burn` or `lasso-poly`) are
 * absent from this map.
 */
export const toolHandlers: Partial<Record<ToolId, ToolHandler>> = Object.fromEntries(
  Object.entries(toolRegistry)
    .filter(([, d]) => d.handler)
    .map(([id, d]) => [id, d.handler!]),
) as Partial<Record<ToolId, ToolHandler>>;

export { handleTransformMove };
