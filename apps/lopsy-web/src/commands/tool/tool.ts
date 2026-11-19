import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { useUIStore } from '../../app/ui-store';
import { toolRegistry } from '../../tools/tool-registry';
import {
  TOOL_OPTIONS,
  checkOption,
  describeOption,
  optionValues,
  textOptionsRefusal,
  type OptionDescription,
} from './tool-options';
import type { ToolId } from '../../types';

export const SELECTABLE_TOOLS: readonly ToolId[] = Object.values(toolRegistry)
  .filter((descriptor) => descriptor.handler !== undefined)
  .map((descriptor) => descriptor.id);

export interface ToolOptionsResult {
  tool: ToolId;
  options: Record<string, unknown>;
}

const toolSpec = { type: 'string', enum: SELECTABLE_TOOLS } as const;
const optionalToolSpec = {
  type: 'string',
  enum: SELECTABLE_TOOLS,
  optional: true,
  description: 'A tool id. Omitted means the active tool.',
} as const;

function activeTool(): ToolId {
  return useUIStore.getState().activeTool;
}

export const toolSelect = defineCommand({
  id: 'tool.select',
  summary:
    'Makes a tool the active tool, as clicking it in the toolbox or pressing its letter key does; leaving the Text tool commits text being edited, and leaving the Pen or Crop tool drops its unfinished path or perspective quad, as a switch in the UI does. No history step of its own. Returns the active tool.',
  surface: 'document',
  params: { tool: toolSpec },
  run({ tool }): { tool: ToolId } {
    useUIStore.getState().setActiveTool(tool);
    return { tool: activeTool() };
  },
});

export const toolOptions = defineCommand({
  id: 'tool.options',
  summary:
    'Reads a tool\'s current options (default: the active tool) as the options bar shows them: numbers in the bar\'s units, colours as hex, gradient stops as { position, color }. Call tool.describe for each option\'s type and range. Returns the tool id and its options.',
  surface: 'document',
  params: { tool: optionalToolSpec },
  run({ tool }): ToolOptionsResult {
    const id = tool ?? activeTool();
    return { tool: id, options: optionValues(id) };
  },
});

export const toolDescribe = defineCommand({
  id: 'tool.describe',
  summary:
    'Lists the options tool.set takes for one tool, or for every tool when `tool` is omitted: each option\'s type, allowed values or range for the open document, a note on its unit, and its current value.',
  surface: 'document',
  params: { tool: { ...toolSpec, optional: true, description: 'A tool id. Omitted means every tool.' } },
  run({ tool }): { tools: Record<string, Record<string, OptionDescription>> } {
    const ids = tool ? [tool] : SELECTABLE_TOOLS;
    const tools: Record<string, Record<string, OptionDescription>> = {};
    for (const id of ids) {
      tools[id] = Object.fromEntries(Object.entries(TOOL_OPTIONS[id]).map(([name, option]) => [name, describeOption(option)]));
    }
    return { tools };
  },
});

function validNames(tool: ToolId): string {
  const names = Object.keys(TOOL_OPTIONS[tool]);
  return names.length > 0 ? `valid options for ${tool}: ${names.join(', ')}` : `${tool} has no options`;
}

function checkOptions(tool: ToolId, options: Record<string, unknown>): void {
  const table = TOOL_OPTIONS[tool];
  const names = Object.keys(options);
  if (names.length === 0) throw new CommandError('invalid', `tool.set: options is empty; ${validNames(tool)}`);
  for (const name of names) {
    const option = table[name];
    if (!option) throw new CommandError('invalid', `tool.set: unknown option ${JSON.stringify(name)}; ${validNames(tool)}`);
    checkOption(`options.${name}`, option, options[name]);
  }
}

export const toolSet = defineCommand({
  id: 'tool.set',
  summary:
    'Changes a tool\'s options as its options bar does (and the Gradient Editor for gradient stops); painting, filling and selecting commands use them. Options left out keep their values. Call tool.describe for the names, types and ranges. Text options are refused while a text layer is active or text is being edited, since in the UI they would restyle it. No history step. Returns the tool\'s options after.',
  surface: 'document',
  params: {
    tool: toolSpec,
    options: {
      type: 'record',
      description: 'Option names and values, for example { "size": 40, "hardness": 100 } for the brush; tool.describe lists them per tool.',
    },
  },
  run({ tool, options }): ToolOptionsResult {
    checkOptions(tool, options);
    if (tool === 'text') {
      const refusal = textOptionsRefusal();
      if (refusal) throw new CommandError('refused', refusal);
    }
    const table = TOOL_OPTIONS[tool];
    for (const [name, option] of Object.entries(table)) {
      if (name in options) option.write(options[name]);
    }
    return { tool, options: optionValues(tool) };
  },
});
